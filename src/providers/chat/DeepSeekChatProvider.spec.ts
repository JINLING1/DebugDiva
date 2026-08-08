import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../services/errors/AppError';
import type { ChatEvent, ChatRequest } from '../../types/provider';
import { DeepSeekChatProvider } from './DeepSeekChatProvider';

const encoder = new TextEncoder();

const createStreamResponse = (
	chunks: Uint8Array[],
	headers: HeadersInit = {},
): Response =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		{ status: 200, headers },
	);

const byteByByte = (text: string): Uint8Array[] =>
	Array.from(encoder.encode(text), byte => Uint8Array.of(byte));

const request = (signal = new AbortController().signal): ChatRequest => ({
	messages: [{ role: 'user', content: 'hello' }],
	mode: 'deep',
	clientId: 'anonymous-client',
	signal,
});

const collectEvents = async (
	iterable: AsyncIterable<ChatEvent>,
): Promise<ChatEvent[]> => {
	const events: ChatEvent[] = [];
	for await (const event of iterable) events.push(event);
	return events;
};

describe('DeepSeekChatProvider', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
	});

	it('posts only the public request fields and maps arbitrary UTF-8 SSE chunks', async () => {
		const reasoningText = String.fromCodePoint(0x601d, 0x8003);
		const contentText = String.fromCodePoint(0x4f60, 0x597d);
		const sse = [
			': keep-alive\r\n\r\n',
			`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoningText } }] })}\r\n\r\n`,
			'data: {\r\n',
			`data: "choices":[{"delta":{"content":"${contentText}"},"finish_reason":"stop"}],\r\n`,
			'data: "usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}\r\n',
			'data: }\r\n\r\n',
			'data: {"choices":[],"usage":{"prompt_cache_hit_tokens":4,"prompt_cache_miss_tokens":5}}\r\n\r\n',
			'data: [DONE]\r\n\r\n',
		].join('');
		fetchMock.mockResolvedValue(
			createStreamResponse(byteByByte(sse), { 'x-request-id': 'req-header' }),
		);

		const provider = new DeepSeekChatProvider();
		const chatRequest = request();
		const events = await collectEvents(provider.stream(chatRequest));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe('/api/chat');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(init.signal).toBe(chatRequest.signal);
		expect(JSON.parse(String(init.body))).toEqual({
			messages: [{ role: 'user', content: 'hello' }],
			mode: 'deep',
			clientId: 'anonymous-client',
		});
		expect(JSON.parse(String(init.body))).not.toHaveProperty('model');
		expect(JSON.parse(String(init.body))).not.toHaveProperty('thinking');

		expect(events[0]).toEqual({ type: 'start', requestId: 'req-header' });
		expect(events[1]).toEqual({ type: 'reasoning-delta', text: reasoningText });
		expect(events[2]).toEqual({ type: 'text-delta', text: contentText });
		expect(events[3]).toMatchObject({
			type: 'usage',
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		});
		expect(events[4]).toMatchObject({
			type: 'usage',
			usage: { cacheHitTokens: 4, cacheMissTokens: 5 },
		});
		expect(events[5]).toEqual({ type: 'done', finishReason: 'stop' });
	});

	it('accepts LF events and a final DONE block without a trailing blank line', async () => {
		fetchMock.mockResolvedValue(
			createStreamResponse([
				encoder.encode(
					'data: {"choices":[{"delta":{"content":"last"},"finish_reason":"length"}]}\n\ndata: [DONE]',
				),
			]),
		);

		const events = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(events).toEqual([
			{ type: 'start', requestId: undefined },
			{ type: 'text-delta', text: 'last' },
			{ type: 'done', finishReason: 'length' },
		]);
	});

	it('emits done when a valid stream closes without the DONE sentinel', async () => {
		fetchMock.mockResolvedValue(
			createStreamResponse([
				encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}'),
			]),
		);

		const events = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(events.at(-1)).toEqual({ type: 'done', finishReason: undefined });
	});

	it('turns malformed SSE JSON into one STREAM_PARSE_FAILED event', async () => {
		fetchMock.mockResolvedValue(
			createStreamResponse([encoder.encode('data: {not-json}\n\n')]),
		);

		const events = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(events).toHaveLength(2);
		expect(events[0].type).toBe('start');
		expect(events[1].type).toBe('error');
		if (events[1].type !== 'error') throw new Error('Expected an error event');
		expect(events[1].error).toBeInstanceOf(AppError);
		expect(events[1].error.code).toBe('STREAM_PARSE_FAILED');
	});

	it('maps a structured HTTP failure to an AppError event', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: 'RATE_LIMITED',
						message: 'Slow down',
						requestId: 'req-body',
						retryable: true,
					},
				}),
				{ status: 429, headers: { 'x-request-id': 'req-header' } },
			),
		);

		const events = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('error');
		if (events[0].type !== 'error') throw new Error('Expected an error event');
		expect(events[0].error).toMatchObject({
			code: 'RATE_LIMITED',
			message: 'Slow down',
			requestId: 'req-body',
			status: 429,
			retryable: true,
		});
	});

	it('maps an error carried by the SSE payload', async () => {
		fetchMock.mockResolvedValue(
			createStreamResponse([
				encoder.encode(
					'data: {"error":{"code":"UPSTREAM_UNAVAILABLE","message":"Unavailable","retryable":true},"request_id":"req-event"}\n\n',
				),
			]),
		);

		const events = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(events).toHaveLength(2);
		expect(events[1].type).toBe('error');
		if (events[1].type !== 'error') throw new Error('Expected an error event');
		expect(events[1].error).toMatchObject({
			code: 'UPSTREAM_UNAVAILABLE',
			message: 'Unavailable',
			requestId: 'req-event',
			retryable: true,
		});
	});

	it('maps fetch failures but rethrows AbortError unchanged', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('offline'));
		const networkEvents = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(networkEvents).toHaveLength(1);
		expect(networkEvents[0].type).toBe('error');
		if (networkEvents[0].type !== 'error') {
			throw new Error('Expected an error event');
		}
		expect(networkEvents[0].error).toMatchObject({
			code: 'UPSTREAM_UNAVAILABLE',
			retryable: true,
		});

		const abortError = new DOMException('Aborted', 'AbortError');
		fetchMock.mockRejectedValueOnce(abortError);
		await expect(
			collectEvents(new DeepSeekChatProvider().stream(request())),
		).rejects.toBe(abortError);
	});

	it('reports a successful response without a body as a parse failure', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		const events = await collectEvents(
			new DeepSeekChatProvider().stream(request()),
		);

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('error');
		if (events[0].type !== 'error') throw new Error('Expected an error event');
		expect(events[0].error.code).toBe('STREAM_PARSE_FAILED');
	});
});
