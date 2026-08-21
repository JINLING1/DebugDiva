import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import {
	MAX_CHAT_REQUEST_BYTES,
	onRequestPost as chatRequest,
} from './functions/api/chat.ts';
import { onRequestPost as parseFileRequest } from './functions/api/files/parse.ts';
import { onRequestPost as analyzeVisionRequest } from './functions/api/vision/analyze.ts';
import { MAX_SUMMARY_REQUEST_BYTES } from './functions/_shared/conversationSummary.ts';
import { onRequestPost as summarizeRequest } from './functions/api/summarize.ts';

const MAX_MULTIPART_REQUEST_SIZE = 11 * 1024 * 1024;

const readRequestBody = (request, maxBytes = 512 * 1024) =>
	new Promise((resolve, reject) => {
		let body = '';
		let totalBytes = 0;
		let rejected = false;
		request.setEncoding('utf8');
		request.on('data', chunk => {
			if (rejected) return;
			totalBytes += Buffer.byteLength(chunk);
			if (totalBytes > maxBytes) {
				rejected = true;
				body = '';
				const error = new Error('请求体过大');
				error.code = 'REQUEST_TOO_LARGE';
				reject(error);
				return;
			}
			body += chunk;
		});
		request.on('end', () => {
			if (!rejected) resolve(body);
		});
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

const sendJsonError = (
	response,
	status,
	code,
	message,
	retryable = status === 408 || status === 429 || status >= 500,
) => {
	const requestId =
		globalThis.crypto?.randomUUID?.() ??
		`dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('X-Request-Id', requestId);
	response.end(
		JSON.stringify({ error: { code, message, requestId, retryable } }),
	);
};

const writeWebResponse = async (response, result) => {
	if (response.destroyed) return;
	response.statusCode = result.status;
	result.headers.forEach((value, name) => response.setHeader(name, value));
	if (!result.body) {
		response.end();
		return;
	}

	const reader = result.body.getReader();
	try {
		while (!response.destroyed) {
			const { done, value } = await reader.read();
			if (done) break;
			response.write(Buffer.from(value));
		}
		if (response.destroyed) {
			await reader.cancel().catch(() => undefined);
			return;
		}
		response.end();
	} finally {
		reader.releaseLock();
	}
};

const deepSeekDevProxy = env => ({
	name: 'deepseek-dev-proxy',
	configureServer(server) {
		server.middlewares.use('/api/chat', async (request, response) => {
			if (request.method !== 'POST') {
				sendJsonError(
					response,
					405,
					'INVALID_REQUEST',
					'Method Not Allowed',
					false,
				);
				return;
			}

			const controller = new AbortController();
			response.on('close', () => {
				if (!response.writableEnded) controller.abort();
			});
			try {
				const body = await readRequestBody(request, MAX_CHAT_REQUEST_BYTES);
				const headers = new Headers();
				for (const name of ['content-type', 'content-length']) {
					const value = request.headers[name];
					if (typeof value === 'string') headers.set(name, value);
				}
				const webRequest = new Request('http://localhost/api/chat', {
					method: 'POST',
					headers,
					body,
					signal: controller.signal,
				});
				const result = await chatRequest({
					request: webRequest,
					env: {
						DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
						DEEPSEEK_BASE_URL: env.DEEPSEEK_BASE_URL,
					},
				});
				await writeWebResponse(response, result);
			} catch (error) {
				if (response.writableEnded || response.destroyed) return;
				const tooLarge = error?.code === 'REQUEST_TOO_LARGE';
				sendJsonError(
					response,
					tooLarge ? 413 : error?.name === 'AbortError' ? 499 : 500,
					tooLarge
						? 'REQUEST_TOO_LARGE'
						: error?.name === 'AbortError'
							? 'REQUEST_ABORTED'
							: 'UPSTREAM_UNAVAILABLE',
					tooLarge
						? '聊天请求体不能超过 256KB'
						: error?.name === 'AbortError'
							? '聊天请求已取消'
							: '聊天服务暂时不可用',
					error?.name !== 'AbortError' && !tooLarge,
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
				const tooLarge = error?.code === 'FILE_TOO_LARGE';
				sendJsonError(
					response,
					tooLarge ? 413 : 500,
					tooLarge ? 'FILE_TOO_LARGE' : 'PARSE_FAILED',
					tooLarge ? '单个文件不能超过 10MB' : '文件解析服务暂时不可用',
				);
			}
		});
	},
});

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

			const controller = new AbortController();
			response.on('close', () => {
				if (!response.writableEnded) controller.abort();
			});
			try {
				const body = await readBinaryRequestBody(request);
				const headers = new Headers();
				for (const name of ['content-type', 'content-length']) {
					const value = request.headers[name];
					if (typeof value === 'string') headers.set(name, value);
				}
				const webRequest = new Request(
					'http://localhost/api/vision/analyze',
					{ method: 'POST', headers, body, signal: controller.signal },
				);
				const result = await analyzeVisionRequest({
					request: webRequest,
					env: {
						DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY,
						DASHSCOPE_BASE_URL: env.DASHSCOPE_BASE_URL,
					},
				});
				if (response.destroyed) return;
				response.statusCode = result.status;
				result.headers.forEach((value, name) => response.setHeader(name, value));
				response.end(Buffer.from(await result.arrayBuffer()));
			} catch (error) {
				if (response.writableEnded || response.destroyed) return;
				sendJsonError(
					response,
					error?.code === 'FILE_TOO_LARGE'
						? 413
						: error?.name === 'AbortError'
							? 499
							: 500,
					error?.code === 'FILE_TOO_LARGE'
						? 'FILE_TOO_LARGE'
						: error?.name === 'AbortError'
							? 'REQUEST_ABORTED'
							: 'VISION_SERVICE_UNAVAILABLE',
					error?.code === 'FILE_TOO_LARGE'
						? error.message
						: error?.name === 'AbortError'
							? '图片分析请求已取消'
							: '图片分析服务暂时不可用，请稍后重试',
				);
			}
		});
	},
});

const summarizeDevProxy = env => ({
	name: 'summarize-dev-proxy',
	configureServer(server) {
		server.middlewares.use('/api/summarize', async (request, response) => {
			if (request.method !== 'POST') {
				sendJsonError(response, 405, 'INVALID_REQUEST', 'Method Not Allowed');
				return;
			}
			const contentLength = Number(request.headers['content-length']);
			if (
				Number.isFinite(contentLength) &&
				contentLength > MAX_SUMMARY_REQUEST_BYTES
			) {
				sendJsonError(
					response,
					413,
					'REQUEST_TOO_LARGE',
					'摘要请求体不能超过 128KB',
				);
				return;
			}

			const controller = new AbortController();
			response.on('close', () => {
				if (!response.writableEnded) controller.abort();
			});
			try {
				const body = await readRequestBody(
					request,
					MAX_SUMMARY_REQUEST_BYTES,
				);
				const headers = new Headers();
				for (const name of ['content-type', 'content-length']) {
					const value = request.headers[name];
					if (typeof value === 'string') headers.set(name, value);
				}
				const webRequest = new Request('http://localhost/api/summarize', {
					method: 'POST',
					headers,
					body,
					signal: controller.signal,
				});
				const result = await summarizeRequest({
					request: webRequest,
					env: {
						DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
						DEEPSEEK_BASE_URL: env.DEEPSEEK_BASE_URL,
					},
				});
				if (response.destroyed) return;
				response.statusCode = result.status;
				result.headers.forEach((value, name) => response.setHeader(name, value));
				response.end(Buffer.from(await result.arrayBuffer()));
			} catch (error) {
				if (response.writableEnded || response.destroyed) return;
				const tooLarge = error?.code === 'REQUEST_TOO_LARGE';
				sendJsonError(
					response,
					tooLarge ? 413 : 500,
					tooLarge ? 'REQUEST_TOO_LARGE' : 'UPSTREAM_UNAVAILABLE',
					tooLarge
						? '摘要请求体不能超过 128KB'
						: '摘要服务暂时不可用',
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
			summarizeDevProxy(env),
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
