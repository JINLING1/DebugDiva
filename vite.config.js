import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

const readRequestBody = request =>
	new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => (body += chunk));
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});

const deepSeekDevProxy = env => ({
	name: 'deepseek-dev-proxy',
	configureServer(server) {
		server.middlewares.use('/api/chat', async (request, response) => {
			if (request.method !== 'POST') {
				response.statusCode = 405;
				response.setHeader('Content-Type', 'application/json; charset=utf-8');
				response.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
				return;
			}

			const apiKey = env.DEEPSEEK_API_KEY || env.VITE_DEEPSEEK_API_KEY;
			const baseUrl = (
				env.DEEPSEEK_BASE_URL ||
				env.VITE_DEEPSEEK_BASE_URL ||
				'https://api.deepseek.com'
			).replace(/\/$/, '');
			const model =
				env.DEEPSEEK_MODEL || env.VITE_DEEPSEEK_MODEL || 'deepseek-v4-flash';

			if (!apiKey) {
				response.statusCode = 500;
				response.setHeader('Content-Type', 'application/json; charset=utf-8');
				response.end(JSON.stringify({ error: { message: '本地 DeepSeek API Key 未配置' } }));
				return;
			}

			try {
				const clientPayload = JSON.parse(await readRequestBody(request));
				if (!Array.isArray(clientPayload.messages) || !clientPayload.messages.length) {
					throw new Error('messages 不能为空');
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
						model,
						messages: clientPayload.messages,
						thinking: {
							type: clientPayload.thinking ? 'enabled' : 'disabled',
						},
						...(clientPayload.thinking && clientPayload.reasoningEffort
							? { reasoning_effort: clientPayload.reasoningEffort }
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
				response.statusCode = error?.name === 'AbortError' ? 499 : 500;
				response.setHeader('Content-Type', 'application/json; charset=utf-8');
				response.end(
					JSON.stringify({ error: { message: error?.message || '代理请求失败' } }),
				);
			}
		});
	},
});

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');

	return {
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
