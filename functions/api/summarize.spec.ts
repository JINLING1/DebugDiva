import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_SUMMARY_REQUEST_BYTES,
	MAX_SUMMARY_RESPONSE_BYTES,
	SUMMARY_MODEL,
	SUMMARY_TIMEOUT_MS,
} from '../_shared/conversationSummary';
import { onRequestPost } from './summarize';

const fetchMock = vi.fn<typeof fetch>();
const env = {
	DEEPSEEK_API_KEY: 'SERVER_ONLY_SECRET_KEY',
	DEEPSEEK_BASE_URL: 'https://api.deepseek.example/',
};

const messages = [
	{ id: 'message-1', role: 'user' as const, content: '我的目标是完成项目' },
	{ id: 'message-2', role: 'assistant' as const, content: '我们继续实现' },
];

const summaryArrays = {
	userGoals: ['完成项目'],
	confirmedFacts: [],
	decisions: ['继续实现'],
	unresolvedQuestions: [],
};

const upstreamSuccess = () =>
	Response.json({
		choices: [{ message: { content: JSON.stringify(summaryArrays) } }],
	});

const createRequest = (
	body: unknown,
	init: { signal?: AbortSignal; headers?: HeadersInit } = {},
) =>
	new Request('https://debugdiva.example/api/summarize', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...init.headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
		signal: init.signal,
	});

const waitForFetchCall = async () => {
	for (let index = 0; index < 20 && fetchMock.mock.calls.length === 0; index += 1) {
		await Promise.resolve();
	}
	expect(fetchMock).toHaveBeenCalledOnce();
};

describe('POST /api/summarize', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(upstreamSuccess());
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('uses fixed non-streaming JSON Output settings and server-owned metadata', async () => {
		const response = await onRequestPost({
			request: createRequest({
				messages,
				model: 'attacker-controlled',
				thinking: { type: 'enabled' },
				stream: true,
				response_format: { type: 'text' },
				coveredUntilMessageId: 'attacker-id',
				updatedAt: 1,
			}),
			env,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('x-request-id')).toMatch(/\S+/);
		const body = await response.json();
		expect(body).toEqual({
			data: {
				...summaryArrays,
				coveredUntilMessageId: 'message-2',
				updatedAt: expect.any(Number),
			},
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.deepseek.example/chat/completions');
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		const upstreamBody = JSON.parse(String(init?.body));
		expect(upstreamBody).toMatchObject({
			model: SUMMARY_MODEL,
			thinking: { type: 'disabled' },
			stream: false,
			response_format: { type: 'json_object' },
		});
		expect(upstreamBody.messages[0]).toMatchObject({
			role: 'system',
			content: expect.stringContaining('不可信的待摘要数据'),
		});
		expect(String(init?.body)).not.toContain('attacker-controlled');
	});

	it('validates JSON content type, body size, messages and previous summary before fetch', async () => {
		const wrongType = await onRequestPost({
			request: new Request('https://debugdiva.example/api/summarize', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: '{}',
			}),
			env,
		});
		expect(wrongType.status).toBe(415);

		const tooLarge = await onRequestPost({
			request: createRequest({ messages }, {
				headers: { 'Content-Length': String(MAX_SUMMARY_REQUEST_BYTES + 1) },
			}),
			env,
		});
		expect(tooLarge.status).toBe(413);
		await expect(tooLarge.json()).resolves.toMatchObject({
			error: { code: 'REQUEST_TOO_LARGE' },
		});

		const invalid = await onRequestPost({
			request: createRequest({
				messages: [{ ...messages[0], role: 'system' }],
			}),
			env,
		});
		expect(invalid.status).toBe(400);

		const invalidPrevious = await onRequestPost({
			request: createRequest({
				messages,
				previousSummary: {
					...summaryArrays,
					coveredUntilMessageId: 'message-0',
					updatedAt: 1,
					extra: 'not allowed',
				},
			}),
			env,
		});
		expect(invalidPrevious.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		[401, 'AUTH_FAILED', 502],
		[403, 'AUTH_FAILED', 502],
		[402, 'INSUFFICIENT_BALANCE', 402],
		[429, 'RATE_LIMITED', 429],
		[408, 'REQUEST_TIMEOUT', 504],
		[504, 'REQUEST_TIMEOUT', 504],
		[503, 'UPSTREAM_UNAVAILABLE', 502],
	] as const)('maps upstream status %s to %s without exposing its body', async (status, code, expectedStatus) => {
		fetchMock.mockResolvedValueOnce(
			new Response('SECRET_UPSTREAM_BODY_AND_KEY', { status }),
		);
		const response = await onRequestPost({
			request: createRequest({ messages }),
			env,
		});
		const body = await response.text();

		expect(response.status).toBe(expectedStatus);
		expect(body).toContain(code);
		expect(body).not.toContain('SECRET_UPSTREAM_BODY_AND_KEY');
		expect(body).not.toContain(env.DEEPSEEK_API_KEY);
		expect(JSON.parse(body).error).toMatchObject({
			requestId: expect.any(String),
			retryable:
				code === 'RATE_LIMITED' ||
				code === 'REQUEST_TIMEOUT' ||
				code === 'UPSTREAM_UNAVAILABLE',
		});
	});

	it('returns INVALID_SUMMARY_RESPONSE and never falls back to previousSummary', async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({ choices: [{ message: { content: '{not json' } }] }),
		);
		const response = await onRequestPost({
			request: createRequest({
				messages,
				previousSummary: {
					...summaryArrays,
					userGoals: ['SECRET_OLD_SUMMARY'],
					coveredUntilMessageId: 'message-0',
					updatedAt: 1,
				},
			}),
			env,
		});
		const body = await response.text();

		expect(response.status).toBe(502);
		expect(body).toContain('INVALID_SUMMARY_RESPONSE');
		expect(body).not.toContain('SECRET_OLD_SUMMARY');
	});

	it('rejects an oversized upstream response before parsing it', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(new Uint8Array(MAX_SUMMARY_RESPONSE_BYTES + 1)),
		);
		const response = await onRequestPost({
			request: createRequest({ messages }),
			env,
		});

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'INVALID_SUMMARY_RESPONSE' },
		});
	});

	it('aborts the complete upstream operation after 20 seconds', async () => {
		vi.useFakeTimers();
		fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
		const pending = onRequestPost({
			request: createRequest({ messages }),
			env,
		});
		await waitForFetchCall();

		await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS);
		const response = await pending;
		expect(response.status).toBe(504);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'REQUEST_TIMEOUT' },
		});
		expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
	});

	it('links request cancellation to the upstream AbortController', async () => {
		fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
		const controller = new AbortController();
		const pending = onRequestPost({
			request: createRequest({ messages }, { signal: controller.signal }),
			env,
		});
		await waitForFetchCall();

		controller.abort();
		const response = await pending;
		expect(response.status).toBe(499);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'REQUEST_ABORTED' },
		});
		expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
	});

	it('uses stable headers and sanitized errors for missing credentials and network failures', async () => {
		const missingAuth = await onRequestPost({
			request: createRequest({ messages }),
			env: {},
		});
		expect(missingAuth.status).toBe(500);
		expect(missingAuth.headers.get('cache-control')).toBe('no-store');
		expect(missingAuth.headers.get('x-content-type-options')).toBe('nosniff');
		expect(missingAuth.headers.get('x-request-id')).toMatch(/\S+/);

		fetchMock.mockRejectedValueOnce(new Error('SECRET_NETWORK_STACK'));
		const failed = await onRequestPost({
			request: createRequest({ messages }),
			env,
		});
		const body = await failed.text();
		expect(failed.status).toBe(502);
		expect(body).toContain('UPSTREAM_UNAVAILABLE');
		expect(body).not.toContain('SECRET_NETWORK_STACK');
		expect(body).not.toContain(env.DEEPSEEK_API_KEY);
	});

	it('logs only allowlisted lifecycle metadata and sanitized usage', async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({
				choices: [{ message: { content: JSON.stringify(summaryArrays) } }],
				usage: {
					prompt_tokens: 11,
					completion_tokens: 4,
					total_tokens: 15,
				},
				secret: 'SECRET_PROVIDER_METADATA',
			}),
		);
		const response = await onRequestPost({
			request: createRequest({
				messages: [{ ...messages[0], content: 'SECRET_SUMMARY_PROMPT' }],
			}),
			env,
		});
		expect(response.status).toBe(200);

		const info = vi.mocked(console.info);
		expect(info).toHaveBeenCalledOnce();
		const rawLog = String(info.mock.calls[0][0]);
		expect(rawLog).not.toContain('SECRET_SUMMARY_PROMPT');
		expect(rawLog).not.toContain('SECRET_PROVIDER_METADATA');
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
			mode: 'summary',
			usage: { promptTokens: 11, completionTokens: 4, totalTokens: 15 },
		});
	});
});
