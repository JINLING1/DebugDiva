import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RERANK_DOCUMENTS, RERANK_TIMEOUT_MS, onRequestPost } from './rerank';

const fetchMock = vi.fn<typeof fetch>();

const env = {
	SILICONFLOW_API_KEY: 'SERVER_ONLY_SECRET_KEY',
	SILICONFLOW_BASE_URL: 'https://api.siliconflow.example/v1/',
};

const createRequest = (body: unknown, init: { headers?: HeadersInit } = {}) =>
	new Request('https://debugdiva.example/api/rag/rerank', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...init.headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});

const errorOf = async (response: Response) =>
	((await response.json()) as { error: { code: string; retryable: boolean } }).error;

describe('POST /api/rag/rerank', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('returns scores sorted by relevance and calls the SiliconFlow rerank API', async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({
				results: [
					{ index: 1, relevance_score: 0.2 },
					{ index: 0, relevance_score: 0.912345678 },
				],
			}),
		);
		const response = await onRequestPost({
			request: createRequest({ query: '循环引用', documents: ['A', 'B'] }),
			env,
		});
		expect(response.status).toBe(200);
		const { data } = (await response.json()) as {
			data: { model: string; results: { index: number; score: number }[] };
		};
		expect(data.model).toBe('BAAI/bge-reranker-v2-m3');
		expect(data.results).toEqual([
			{ index: 0, score: 0.912346 },
			{ index: 1, score: 0.2 },
		]);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.siliconflow.example/v1/rerank');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer SERVER_ONLY_SECRET_KEY');
		expect(JSON.parse(String(init?.body))).toEqual({
			model: 'BAAI/bge-reranker-v2-m3',
			query: '循环引用',
			documents: ['A', 'B'],
			top_n: 2,
			return_documents: false,
		});
	});

	it('follows the embedding provider unless a rerank provider is set', async () => {
		fetchMock.mockResolvedValue(Response.json({ results: [{ index: 0, relevance_score: 0.5 }] }));
		await onRequestPost({
			request: createRequest({ query: 'q', documents: ['A'] }),
			env: { RAG_EMBEDDING_PROVIDER: 'dashscope', DASHSCOPE_API_KEY: 'DASH' },
		});
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://dashscope.aliyuncs.com/compatible-api/v1/reranks',
		);
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe('qwen3-rerank');

		await onRequestPost({
			request: createRequest({ query: 'q', documents: ['A'] }),
			env: { ...env, RAG_EMBEDDING_PROVIDER: 'dashscope', RAG_RERANK_PROVIDER: 'siliconflow' },
		});
		expect(fetchMock.mock.calls[1][0]).toBe('https://api.siliconflow.example/v1/rerank');
	});

	it('fails closed without a key and does not call upstream', async () => {
		const response = await onRequestPost({
			request: createRequest({ query: 'q', documents: ['A'] }),
			env: {},
		});
		expect(response.status).toBe(500);
		expect((await errorOf(response)).code).toBe('AUTH_FAILED');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each<[unknown, string]>([
		[{ query: '', documents: ['A'] }, 'blank query'],
		[{ query: 'q', documents: [] }, 'no documents'],
		[{ query: 'q', documents: Array.from({ length: MAX_RERANK_DOCUMENTS + 1 }, () => 'x') }, 'too many'],
		[{ query: 'q', documents: ['字'.repeat(4001)] }, 'document too long'],
		[{ query: 'q', documents: [1] }, 'non-string'],
		['not json', 'invalid json'],
	])('rejects invalid payload: %s (%s)', async body => {
		const response = await onRequestPost({ request: createRequest(body), env });
		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe('INVALID_REQUEST');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects malformed upstream results', async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({
				results: [
					{ index: 0, relevance_score: 0.5 },
					{ index: 0, relevance_score: 0.4 },
				],
			}),
		);
		const response = await onRequestPost({
			request: createRequest({ query: 'q', documents: ['A', 'B'] }),
			env,
		});
		expect(response.status).toBe(502);
		expect((await errorOf(response)).code).toBe('INVALID_RERANK_RESPONSE');
	});

	it('maps upstream rate limits without leaking details', async () => {
		fetchMock.mockResolvedValueOnce(new Response('quota for sk-xxx', { status: 429 }));
		const response = await onRequestPost({
			request: createRequest({ query: 'q', documents: ['A'] }),
			env,
		});
		expect(response.status).toBe(429);
		const error = await errorOf(response);
		expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
		expect(JSON.stringify(error)).not.toContain('sk-xxx');
	});

	it('times out slow upstream calls', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
		const pending = onRequestPost({ request: createRequest({ query: 'q', documents: ['A'] }), env });
		for (let i = 0; i < 20 && fetchMock.mock.calls.length === 0; i += 1) {
			await Promise.resolve();
		}
		await vi.advanceTimersByTimeAsync(RERANK_TIMEOUT_MS + 1);
		const response = await pending;
		expect(response.status).toBe(504);
		expect((await errorOf(response)).code).toBe('REQUEST_TIMEOUT');
	});
});
