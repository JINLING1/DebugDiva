import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { resolveModelMode } from './functions/_shared/modelMode.ts';
import { onRequestPost as parseFileRequest } from './functions/api/files/parse.ts';
import { onRequestPost as analyzeVisionRequest } from './functions/api/vision/analyze.ts';

const MAX_MULTIPART_REQUEST_SIZE = 11 * 1024 * 1024;

const readRequestBody = request =>
	new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => (body += chunk));
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});

const readBinaryRequestBody = (request, maxBytes = MAX_MULTIPART_REQUEST_SIZE) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		let totalBytes = 0;
		let rejected = false;
		request.on('data', chunk => {
			if (rejected) return;
			const bytes = Buffer.from(chunk);
			totalBytes += bytes.length;
			if (totalBytes > maxBytes) {
				rejected = true;
				chunks.length = 0;
				const error = new Error('单个文件不能超过 10MB');
				error.code = 'FILE_TOO_LARGE';
				reject(error);
				return;
			}
			chunks.push(bytes);
		});
		request.on('end', () => {
			if (!rejected) resolve(Buffer.concat(chunks, totalBytes));
		});
		request.on('error', reject);
	});

const sendJsonError = (response, status, code, message) => {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify({ error: { code, message } }));
};

const deepSeekDevProxy = env => ({
	name: 'deepseek-dev-proxy',
	configureServer(server) {
		server.middlewares.use('/api/chat', async (request, response) => {
			if (request.method !== 'POST') {
				sendJsonError(response, 405, 'INVALID_REQUEST', 'Method Not Allowed');
				return;
			}

			// Legacy VITE_* names are read only by this Node-side proxy. The custom
			// envPrefix below prevents them from being exposed to browser modules.
			const apiKey = env.DEEPSEEK_API_KEY || env.VITE_DEEPSEEK_API_KEY;
			const baseUrl = (
				env.DEEPSEEK_BASE_URL ||
				env.VITE_DEEPSEEK_BASE_URL ||
				'https://api.deepseek.com'
			).replace(/\/$/, '');

			if (!apiKey) {
				sendJsonError(
					response,
					500,
					'AUTH_FAILED',
					'本地 DeepSeek API Key 未配置',
				);
				return;
			}

			try {
				const clientPayload = JSON.parse(await readRequestBody(request));
				const modeConfig = resolveModelMode(clientPayload.mode);
				if (!modeConfig) {
					sendJsonError(response, 400, 'INVALID_MODEL_MODE', '不支持的模型模式');
					return;
				}
				if (!Array.isArray(clientPayload.messages) || !clientPayload.messages.length) {
					sendJsonError(response, 400, 'INVALID_REQUEST', 'messages 不能为空');
					return;
				}
				if (
					clientPayload.clientId !== undefined &&
					(typeof clientPayload.clientId !== 'string' ||
						clientPayload.clientId.length > 128)
				) {
					sendJsonError(response, 400, 'INVALID_REQUEST', 'clientId 格式无效');
					return;
				}

				const controller = new AbortController();
				response.on('close', () => {
					if (!response.writableEnded) controller.abort();
				});

				const upstream = await fetch(`${baseUrl}/chat/completions`, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: modeConfig.model,
						messages: clientPayload.messages,
						thinking: modeConfig.thinking,
						...('reasoning_effort' in modeConfig
							? { reasoning_effort: modeConfig.reasoning_effort }
							: {}),
						stream: true,
						stream_options: { include_usage: true },
					}),
					signal: controller.signal,
				});

				response.statusCode = upstream.status;
				response.setHeader(
					'Content-Type',
					upstream.headers.get('content-type') || 'application/json; charset=utf-8',
				);
				response.setHeader('Cache-Control', 'no-cache, no-transform');

				if (!upstream.body) {
					response.end();
					return;
				}

				const reader = upstream.body.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					response.write(value);
				}
				response.end();
			} catch (error) {
				if (response.writableEnded) return;
				const invalidJson = error instanceof SyntaxError;
				sendJsonError(
					response,
					invalidJson ? 400 : error?.name === 'AbortError' ? 499 : 500,
					invalidJson
						? 'INVALID_REQUEST'
						: error?.name === 'AbortError'
							? 'REQUEST_ABORTED'
							: 'UPSTREAM_UNAVAILABLE',
					invalidJson ? '请求体不是有效的 JSON' : error?.message || '代理请求失败',
				);
			}
		});
	},
});

const fileParseDevProxy = () => ({
	name: 'file-parse-dev-proxy',
	configureServer(server) {
		server.middlewares.use('/api/files/parse', async (request, response) => {
			if (request.method !== 'POST') {
				sendJsonError(response, 405, 'INVALID_REQUEST', 'Method Not Allowed');
				return;
			}
			const contentLength = Number(request.headers['content-length']);
			if (
				Number.isFinite(contentLength) &&
				contentLength > MAX_MULTIPART_REQUEST_SIZE
			) {
				sendJsonError(
					response,
					413,
					'FILE_TOO_LARGE',
					'单个文件不能超过 10MB',
				);
				return;
			}

			try {
				const body = await readBinaryRequestBody(request);
				const headers = new Headers();
				for (const name of ['content-type', 'content-length']) {
					const value = request.headers[name];
					if (typeof value === 'string') headers.set(name, value);
				}
				const webRequest = new Request('http://localhost/api/files/parse', {
					method: 'POST',
					headers,
					body,
				});
				const result = await parseFileRequest({ request: webRequest });
				response.statusCode = result.status;
				result.headers.forEach((value, name) => response.setHeader(name, value));
				response.end(Buffer.from(await result.arrayBuffer()));
			} catch (error) {
				if (response.writableEnded) return;
				sendJsonError(
					response,
					error?.code === 'FILE_TOO_LARGE' ? 413 : 500,
					error?.code === 'FILE_TOO_LARGE'
						? 'FILE_TOO_LARGE'
						: 'PARSE_FAILED',
					error?.message || '文件解析失败',
				);
			}
		});
	},
});

const createWorkersAIDevBinding = env => {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_API_TOKEN;
	if (!accountId || !apiToken) return undefined;

	return {
		async run(model, input) {
			const upstream = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(input),
				},
			);
			const payload = await upstream.json().catch(() => undefined);
			if (
				!upstream.ok ||
				!payload ||
				typeof payload !== 'object' ||
				!('result' in payload)
			) {
				throw new Error('Workers AI request failed');
			}
			return payload.result;
		},
	};
};

const visionAnalyzeDevProxy = env => ({
	name: 'vision-analyze-dev-proxy',
	configureServer(server) {
		server.middlewares.use('/api/vision/analyze', async (request, response) => {
			if (request.method !== 'POST') {
				sendJsonError(response, 405, 'INVALID_REQUEST', 'Method Not Allowed');
				return;
			}
			const contentLength = Number(request.headers['content-length']);
			if (
				Number.isFinite(contentLength) &&
				contentLength > MAX_MULTIPART_REQUEST_SIZE
			) {
				sendJsonError(
					response,
					413,
					'FILE_TOO_LARGE',
					'单张图片不能超过 10MB',
				);
				return;
			}

			try {
				const body = await readBinaryRequestBody(request);
				const headers = new Headers();
				for (const name of ['content-type', 'content-length']) {
					const value = request.headers[name];
					if (typeof value === 'string') headers.set(name, value);
				}
				const webRequest = new Request(
					'http://localhost/api/vision/analyze',
					{ method: 'POST', headers, body },
				);
				const result = await analyzeVisionRequest({
					request: webRequest,
					env: {
						AI: createWorkersAIDevBinding(env),
						VISION_MODEL: env.VISION_MODEL,
					},
				});
				response.statusCode = result.status;
				result.headers.forEach((value, name) => response.setHeader(name, value));
				response.end(Buffer.from(await result.arrayBuffer()));
			} catch (error) {
				if (response.writableEnded) return;
				sendJsonError(
					response,
					error?.code === 'FILE_TOO_LARGE' ? 413 : 500,
					error?.code === 'FILE_TOO_LARGE'
						? 'FILE_TOO_LARGE'
						: 'VISION_ANALYSIS_FAILED',
					error?.code === 'FILE_TOO_LARGE'
						? error.message
						: '图片分析服务暂时不可用，请稍后重试',
				);
			}
		});
	},
});

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');

	return {
		envPrefix: 'PUBLIC_',
		plugins: [
			vue(),
			fileParseDevProxy(),
			visionAnalyzeDevProxy(env),
			deepSeekDevProxy(env),
			AutoImport({ resolvers: [ElementPlusResolver()] }),
			Components({ resolvers: [ElementPlusResolver()] }),
		],
		css: {
			preprocessorOptions: {
				scss: { api: 'modern-compiler' },
			},
		},
	};
});
