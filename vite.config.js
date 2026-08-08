import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { resolveModelMode } from './functions/_shared/modelMode.ts';

const readRequestBody = request =>
	new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => (body += chunk));
		request.on('end', () => resolve(body));
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

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');

	return {
		envPrefix: 'PUBLIC_',
		plugins: [
			vue(),
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
