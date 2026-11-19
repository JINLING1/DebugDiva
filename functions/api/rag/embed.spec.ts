import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	EMBED_TIMEOUT_MS,
	MAX_EMBED_REQUEST_BYTES,
	MAX_EMBED_TEXTS,
	onRequestPost,
} from './embed';

const DIMS = 1024;
const fetchMock = vi.fn<typeof fetch>();

const vector = (seed: number) =>
	Array.from({ length: DIMS }, (_, i) => Math.sin(seed + i) / 3.1234567891);

const upstreamSuccess = (count: number, offset = 0) =>
	Response.json({
		model: 'BAAI/bge-m3',
		// 故意打乱顺序，验证按 index 还原
		data: Array.from({ length: count }, (_, i) => ({
			index: count - 1 - i,
			embedding: vector(offset + count - 1 - i),
		})),
	});

const env = {
	SILICONFLOW_API_KEY: 'SERVER_ONLY_SECRET_KEY',
	SILICONFLOW_BASE_URL: 'https://api.siliconflow.example/v1/',
};

const createRequest = (body: unknown, init: { signal?: AbortSignal; headers?: HeadersInit } = {}) =>
	new Request('https://debugdiva.example/api/rag/embed', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...init.headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
		signal: init.signal,
	});

const errorOf = async (response: Response) =>
	((await response.json()) as { error: { code: string; retryable: boolean } }).error;

describe('POST /api/rag/embed', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('returns vectors in input order with model metadata', async () => {
		fetchMock.mockResolvedValueOnce(upstreamSuccess(2));

		const response = await onRequestPost({
			request: createRequest({ texts: ['第一段', '第二段'] }),
			env,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('x-request-id')).toMatch(/\S+/);
		const { data } = (await response.json()) as {
			data: { model: string; dims: number; vectors: number[][] };
		};
		expect(data.model).toBe('BAAI/bge-m3');
		expect(data.dims).toBe(DIMS);
		expect(data.vectors).toHaveLength(2);
		expect(data.vectors[0][0]).toBeCloseTo(vector(0)[0], 6);
		expect(data.vectors[1][5]).toBeCloseTo(vector(1)[5], 6);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.siliconflow.example/v1/embeddings');
		expect(new Headers(init?.headers).get('authorization')).toBe(
			'Bearer SERVER_ONLY_SECRET_KEY',
		);
		expect(JSON.parse(String(init?.body))).toEqual({
			model: 'BAAI/bge-m3',
			input: ['第一段', '第二段'],
			encoding_format: 'float',
		});
	});

	it('splits into provider-sized batches for DashScope and sends dimensions', async () => {
		fetchMock
			.mockResolvedValueOnce(upstreamSuccess(10))
			.mockResolvedValueOnce(upstreamSuccess(2, 10));

		const response = await onRequestPost({
			request: createRequest({ texts: Array.from({ length: 12 }, (_, i) => `文本${i}`) }),
			env: {
				RAG_EMBEDDING_PROVIDER: 'dashscope',
				DASHSCOPE_API_KEY: 'DASH_KEY',
			},
		});

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(firstBody.model).toBe('text-embedding-v4');
		expect(firstBody.dimensions).toBe(DIMS);
		expect(firstBody.input).toHaveLength(10);
		const { data } = (await response.json()) as { data: { vectors: number[][] } };
		expect(data.vectors).toHaveLength(12);
		expect(data.vectors[11][0]).toBeCloseTo(vector(11)[0], 6);
	});

	it('fails closed when the provider key or name is not configured', async () => {
		const missingKey = await onRequestPost({ request: createRequest({ texts: ['a'] }), env: {} });
		expect(missingKey.status).toBe(500);
		expect((await errorOf(missingKey)).code).toBe('AUTH_FAILED');

		const badProvider = await onRequestPost({
			request: createRequest({ texts: ['a'] }),
			env: { ...env, RAG_EMBEDDING_PROVIDER: 'openai' },
		});
		expect((await errorOf(badProvider)).code).toBe('RAG_PROVIDER_MISCONFIGURED');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each<[unknown, string]>([
		[{ texts: [] }, 'empty list'],
		[{ texts: Array.from({ length: MAX_EMBED_TEXTS + 1 }, () => 'x') }, 'too many'],
		[{ texts: ['  '] }, 'blank text'],
		[{ texts: ['字'.repeat(2001)] }, 'text too long'],
		[{ texts: [1] }, 'non-string'],
		['not json', 'invalid json'],
	])('rejects invalid payload: %s (%s)', async body => {
		const response = await onRequestPost({ request: createRequest(body), env });
		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe('INVALID_REQUEST');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects non-JSON content types and oversized bodies', async () => {
		const wrongType = await onRequestPost({
			request: createRequest({ texts: ['a'] }, { headers: { 'Content-Type': 'text/plain' } }),
			env,
		});
		expect(wrongType.status).toBe(415);

		const tooLarge = await onRequestPost({
			request: createRequest('x'.repeat(MAX_EMBED_REQUEST_BYTES + 1)),
			env,
		});
		expect(tooLarge.status).toBe(413);
	});

	it('maps upstream rate limits and auth failures without leaking details', async () => {
		fetchMock.mockResolvedValueOnce(new Response('quota exceeded for key sk-xxx', { status: 429 }));
		const limited = await onRequestPost({ request: createRequest({ texts: ['a'] }), env });
		expect(limited.status).toBe(429);
		const limitedError = await errorOf(limited);
		expect(limitedError).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
		expect(JSON.stringify(limitedError)).not.toContain('sk-xxx');

		fetchMock.mockResolvedValueOnce(new Response('bad key', { status: 401 }));
		const auth = await onRequestPost({ request: createRequest({ texts: ['a'] }), env });
		expect((await errorOf(auth)).code).toBe('AUTH_FAILED');
	});

	it('rejects malformed upstream vectors', async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
		);
		const response = await onRequestPost({ request: createRequest({ texts: ['a'] }), env });
		expect(response.status).toBe(502);
		expect((await errorOf(response)).code).toBe('INVALID_EMBEDDING_RESPONSE');
	});

	it('times out slow upstream calls', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
		const pending = onRequestPost({ request: createRequest({ texts: ['a'] }), env });
		for (let i = 0; i < 20 && fetchMock.mock.calls.length === 0; i += 1) {
			await Promise.resolve();
		}
		await vi.advanceTimersByTimeAsync(EMBED_TIMEOUT_MS + 1);
		const response = await pending;
		expect(response.status).toBe(504);
		expect((await errorOf(response)).code).toBe('REQUEST_TIMEOUT');
	});
});
