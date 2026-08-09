import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CHAT_TIMEOUT_MS,
	MAX_CHAT_MESSAGES,
	MAX_CHAT_REQUEST_BYTES,
	onRequestPost,
} from './chat';

const fetchMock = vi.fn<typeof fetch>();

const env = {
	DEEPSEEK_API_KEY: 'server-only-test-key',
	DEEPSEEK_BASE_URL: 'https://api.deepseek.example/',
};

const createRequest = (
	body: unknown,
	init: { signal?: AbortSignal; headers?: HeadersInit } = {},
) =>
	new Request('https://debugdiva.example/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...init.headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
		signal: init.signal,
	});

const validMessages = [{ role: 'user' as const, content: 'hello' }];

const streamResponse = (events = 'data: [DONE]\n\n') =>
	new Response(events, {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' },
	});

const waitForFetchCall = async () => {
	for (let index = 0; index < 20 && fetchMock.mock.calls.length === 0; index += 1) {
		await Promise.resolve();
	}
	expect(fetchMock).toHaveBeenCalledOnce();
};

describe('POST /api/chat', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(streamResponse());
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
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
		expect(response.headers.get('x-request-id')).toMatch(/\S+/);
		expect(response.headers.get('cache-control')).toBe('no-store');
		await response.text();
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

	it('ignores top-level overrides and strips unrecognized message fields', async () => {
		const response = await onRequestPost({
			request: createRequest({
				messages: [{ ...validMessages[0], secret: 'MESSAGE_SECRET' }],
				mode: 'fast',
				model: 'attacker-controlled-model',
				thinking: { type: 'enabled' },
				reasoning_effort: 'max',
				baseUrl: 'https://attacker.example',
			}),
			env,
		});
		await response.text();

		const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(upstreamBody.model).toBe('deepseek-v4-flash');
		expect(upstreamBody.thinking).toEqual({ type: 'disabled' });
		expect(upstreamBody).not.toHaveProperty('reasoning_effort');
		expect(upstreamBody.messages).toEqual(validMessages);
		expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('MESSAGE_SECRET');
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
			await expect(response.json()).resolves.toMatchObject({
				error: {
					code: 'INVALID_MODEL_MODE',
					message: '不支持的模型模式',
					retryable: false,
					requestId: expect.any(String),
				},
			});
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it('strictly validates content type, body size, messages and anonymous clientId', async () => {
		const wrongType = await onRequestPost({
			request: new Request('https://debugdiva.example/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: '{}',
			}),
			env,
		});
		expect(wrongType.status).toBe(415);

		const tooLarge = await onRequestPost({
			request: createRequest(
				{ messages: validMessages, mode: 'fast' },
				{ headers: { 'Content-Length': String(MAX_CHAT_REQUEST_BYTES + 1) } },
			),
			env,
		});
		expect(tooLarge.status).toBe(413);

		const cases = [
			{ messages: [], mode: 'fast' },
			{
				messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => validMessages[0]),
				mode: 'fast',
			},
			{ messages: [{ role: 'tool', content: 'hello' }], mode: 'fast' },
			{ messages: [{ role: 'user', content: '   ' }], mode: 'fast' },
			{
				messages: validMessages,
				mode: 'fast',
				clientId: 'person@example.com',
			},
		];
		for (const payload of cases) {
			const response = await onRequestPost({
				request: createRequest(payload),
				env,
			});
			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toMatchObject({
				error: { code: 'INVALID_REQUEST', retryable: false },
			});
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		[401, 'AUTH_FAILED', 502, false],
		[403, 'AUTH_FAILED', 502, false],
		[402, 'INSUFFICIENT_BALANCE', 402, false],
		[429, 'RATE_LIMITED', 429, true],
		[408, 'REQUEST_TIMEOUT', 504, true],
		[504, 'REQUEST_TIMEOUT', 504, true],
		[503, 'UPSTREAM_UNAVAILABLE', 502, true],
	] as const)(
		'maps upstream status %s to %s without exposing its body',
		async (status, code, expectedStatus, retryable) => {
			fetchMock.mockResolvedValueOnce(
				new Response('SECRET_UPSTREAM_BODY_AND_KEY', { status }),
			);
			const response = await onRequestPost({
				request: createRequest({ messages: validMessages, mode: 'fast' }),
				env,
			});
			const body = await response.text();

			expect(response.status).toBe(expectedStatus);
			expect(body).toContain(code);
			expect(JSON.parse(body).error.retryable).toBe(retryable);
			expect(body).not.toContain('SECRET_UPSTREAM_BODY_AND_KEY');
			expect(body).not.toContain(env.DEEPSEEK_API_KEY);
		},
	);

	it('rejects a successful non-SSE provider response', async () => {
		fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));
		const response = await onRequestPost({
			request: createRequest({ messages: validMessages, mode: 'fast' }),
			env,
		});

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'STREAM_PARSE_FAILED', retryable: true },
		});
	});

	it('times out and aborts the upstream request before response headers', async () => {
		vi.useFakeTimers();
		fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
		const pending = onRequestPost({
			request: createRequest({ messages: validMessages, mode: 'fast' }),
			env,
		});
		await waitForFetchCall();

		await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
		const response = await pending;
		expect(response.status).toBe(504);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'REQUEST_TIMEOUT', retryable: true },
		});
		expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
	});

	it('keeps the deadline active while streaming and emits a sanitized SSE error', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValueOnce(
			new Response(new ReadableStream<Uint8Array>({ start() {} }), {
				headers: { 'Content-Type': 'text/event-stream' },
			}),
		);
		const response = await onRequestPost({
			request: createRequest({ messages: validMessages, mode: 'fast' }),
			env,
		});
		const body = response.text();

		await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
		await expect(body).resolves.toContain('REQUEST_TIMEOUT');
		expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
	});

	it('links client cancellation to the upstream request', async () => {
		fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
		const controller = new AbortController();
		const pending = onRequestPost({
			request: createRequest(
				{ messages: validMessages, mode: 'fast' },
				{ signal: controller.signal },
			),
			env,
		});
		await waitForFetchCall();

		controller.abort();
		const response = await pending;
		expect(response.status).toBe(499);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'REQUEST_ABORTED', retryable: false },
		});
		expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
	});

	it('logs only allowlisted lifecycle metadata, including sanitized stream usage', async () => {
		const prompt = 'SECRET_PROMPT_MARKER';
		const providerStream =
			'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10},"secret":"PROVIDER_SECRET"}\n\n' +
			'data: [DONE]\n\n';
		fetchMock.mockResolvedValueOnce(
			streamResponse(providerStream),
		);
		const response = await onRequestPost({
			request: createRequest({
				messages: [{ role: 'user', content: prompt }],
				mode: 'fast',
			}),
			env,
		});
		await expect(response.text()).resolves.toBe(providerStream);

		const info = vi.mocked(console.info);
		expect(info).toHaveBeenCalledOnce();
		const rawLog = String(info.mock.calls[0][0]);
		expect(rawLog).not.toContain(prompt);
		expect(rawLog).not.toContain('PROVIDER_SECRET');
		expect(rawLog).not.toContain(env.DEEPSEEK_API_KEY);
		const entry = JSON.parse(rawLog);
		expect(Object.keys(entry).sort()).toEqual([
			'duration',
			'mode',
			'requestId',
			'status',
			'usage',
		]);
		expect(entry).toMatchObject({
			status: 200,
			mode: 'fast',
			usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
		});
	});

	it('uses stable sanitized errors for missing credentials and network failures', async () => {
		const missingAuth = await onRequestPost({
			request: createRequest({ messages: validMessages, mode: 'fast' }),
			env: { DEEPSEEK_API_KEY: '' },
		});
		expect(missingAuth.status).toBe(500);
		expect(missingAuth.headers.get('cache-control')).toBe('no-store');
		expect(missingAuth.headers.get('x-content-type-options')).toBe('nosniff');
		expect(missingAuth.headers.get('x-request-id')).toMatch(/\S+/);
		await expect(missingAuth.json()).resolves.toMatchObject({
			error: { code: 'AUTH_FAILED', retryable: false },
		});

		fetchMock.mockRejectedValueOnce(new Error('SECRET_NETWORK_STACK'));
		const failed = await onRequestPost({
			request: createRequest({ messages: validMessages, mode: 'fast' }),
			env,
		});
		const body = await failed.text();
		expect(failed.status).toBe(502);
		expect(body).toContain('UPSTREAM_UNAVAILABLE');
		expect(body).not.toContain('SECRET_NETWORK_STACK');
		expect(body).not.toContain(env.DEEPSEEK_API_KEY);
	});
});
