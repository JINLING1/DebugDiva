import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './chat';

const fetchMock = vi.fn<typeof fetch>();

const env = {
	DEEPSEEK_API_KEY: 'server-only-test-key',
	DEEPSEEK_BASE_URL: 'https://api.deepseek.example/',
};

const createRequest = (body: Record<string, unknown>) =>
	new Request('https://debugdiva.example/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

const validMessages = [{ role: 'user' as const, content: 'hello' }];

describe('POST /api/chat model routing', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(
			new Response('data: [DONE]\n\n', {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			}),
		);
		vi.stubGlobal('fetch', fetchMock);
	});

	it.each([
		[
			'fast',
			{
				model: 'deepseek-v4-flash',
				thinking: { type: 'disabled' },
			},
		],
		[
			'deep',
			{
				model: 'deepseek-v4-flash',
				thinking: { type: 'enabled' },
				reasoning_effort: 'high',
			},
		],
		[
			'quality',
			{
				model: 'deepseek-v4-pro',
				thinking: { type: 'enabled' },
				reasoning_effort: 'high',
			},
		],
	])('maps %s to a fixed upstream configuration', async (mode, expected) => {
		const response = await onRequestPost({
			request: createRequest({ messages: validMessages, mode }),
			env,
		});

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.deepseek.example/chat/completions');
		const upstreamBody = JSON.parse(String(init?.body));
		expect(upstreamBody).toEqual(
			expect.objectContaining({
				...expected,
				messages: validMessages,
				stream: true,
				stream_options: { include_usage: true },
			}),
		);
	});

	it('ignores client attempts to override model and thinking parameters', async () => {
		await onRequestPost({
			request: createRequest({
				messages: validMessages,
				mode: 'fast',
				model: 'attacker-controlled-model',
				thinking: { type: 'enabled' },
				reasoning_effort: 'max',
				baseUrl: 'https://attacker.example',
			}),
			env,
		});

		const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(upstreamBody.model).toBe('deepseek-v4-flash');
		expect(upstreamBody.thinking).toEqual({ type: 'disabled' });
		expect(upstreamBody).not.toHaveProperty('reasoning_effort');
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://api.deepseek.example/chat/completions',
		);
	});

	it.each([undefined, '', 'turbo', '__proto__'])(
		'rejects unsupported mode %s before calling upstream',
		async mode => {
			const response = await onRequestPost({
				request: createRequest({ messages: validMessages, mode }),
				env,
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: {
					code: 'INVALID_MODEL_MODE',
					message: '不支持的模型模式',
				},
			});
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});
