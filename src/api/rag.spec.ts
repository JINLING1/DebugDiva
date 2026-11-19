import { describe, expect, it, vi } from 'vitest';
import { embedTexts, rerankTexts, type RagFetch } from './rag';

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});

describe('rerankTexts', () => {
	it('posts query and documents and returns results sorted by score', async () => {
		const fetchImpl = vi.fn<RagFetch>().mockResolvedValue(
			jsonResponse({
				data: {
					model: 'BAAI/bge-reranker-v2-m3',
					results: [
						{ index: 1, score: 0.1 },
						{ index: 0, score: 0.7 },
					],
				},
			}),
		);
		const result = await rerankTexts('q', ['A', 'B'], { fetchImpl });
		expect(result.results).toEqual([
			{ index: 0, score: 0.7 },
			{ index: 1, score: 0.1 },
		]);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('/api/rag/rerank');
		expect(JSON.parse(String(init?.body))).toEqual({ query: 'q', documents: ['A', 'B'] });
	});

	it('rejects results that do not cover every document exactly once', async () => {
		const fetchImpl = vi.fn<RagFetch>().mockResolvedValue(
			jsonResponse({ data: { model: 'm', results: [{ index: 0, score: 0.5 }] } }),
		);
		await expect(rerankTexts('q', ['A', 'B'], { fetchImpl })).rejects.toMatchObject({
			code: 'INVALID_RERANK_RESPONSE',
		});
	});

	it('maps server errors and passes aborts through', async () => {
		const failing = vi.fn<RagFetch>().mockResolvedValue(
			jsonResponse({ error: { code: 'RATE_LIMITED', message: '太快了', retryable: true } }, 429),
		);
		await expect(rerankTexts('q', ['A'], { fetchImpl: failing })).rejects.toMatchObject({
			code: 'RATE_LIMITED',
			retryable: true,
		});

		const aborted = vi
			.fn<RagFetch>()
			.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		await expect(rerankTexts('q', ['A'], { fetchImpl: aborted })).rejects.toMatchObject({
			name: 'AbortError',
		});
	});
});

describe('embedTexts', () => {
	it('validates vector count and dimensions', async () => {
		// 每次调用返回新的 Response，避免第二次读取已消费的 body
		const fetchImpl = vi
			.fn<RagFetch>()
			.mockImplementation(async () =>
				jsonResponse({ data: { model: 'm', dims: 2, vectors: [[0.1, 0.2]] } }),
			);
		await expect(embedTexts(['a'], { fetchImpl })).resolves.toEqual({
			model: 'm',
			dims: 2,
			vectors: [[0.1, 0.2]],
		});
		await expect(embedTexts(['a', 'b'], { fetchImpl })).rejects.toMatchObject({
			code: 'INVALID_EMBEDDING_RESPONSE',
		});
	});
});
