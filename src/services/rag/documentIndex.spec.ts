import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { segmentMarkdown } from '../../../functions/_shared/documentSegments';
import { createIndexedDbRagIndexRepository } from '../storage/ragIndexStorage';
import {
	createDocumentIndexService,
	RERANK_FALLBACK_LIMIT,
	type Embedder,
	type Reranker,
	type Rewriter,
} from './documentIndex';

const DOC = [
	'# 错误手册',
	'## EADDRINUSE',
	'端口已被其他服务占用，绑定地址失败。可以换一个端口或停止占用该端口的进程。',
	'## JSON.parse 语法错误',
	'JSON 不允许末尾多余的逗号，属性名必须使用双引号。',
	'## 404 Not Found',
	'服务器无法找到所请求的资源，通常是链接失效。',
].join('\n');

/** 关键词决定向量方向的假 embedding：便于断言稠密检索的效果。 */
const fakeEmbed: Embedder = async texts => ({
	model: 'fake-model',
	dims: 3,
	vectors: texts.map(text => [
		/端口|EADDRINUSE|占用/.test(text) ? 1 : 0,
		/JSON|逗号|引号/.test(text) ? 1 : 0,
		/404|资源|链接/.test(text) ? 1 : 0.01,
	]),
});

const TOPICS = [/端口|EADDRINUSE|占用/, /JSON|逗号|引号/, /404|资源|链接/];

/** 与查询共享主题的文档得高分，其余得低分。 */
const fakeRerank: Reranker = async (query, documents) => ({
	model: 'fake-reranker',
	results: documents
		.map((document, index) => ({
			index,
			score: TOPICS.some(topic => topic.test(query) && topic.test(document)) ? 0.9 : 0.001,
		}))
		.sort((a, b) => b.score - a.score),
});

const setup = (
	embed: Embedder = fakeEmbed,
	rerank: Reranker | null = fakeRerank,
	rewrite: Rewriter | null = null,
) => {
	const repository = createIndexedDbRagIndexRepository(new IDBFactory());
	const service = createDocumentIndexService(repository, { embed, rerank, rewrite, now: () => 1 });
	return { repository, service };
};

/** 每节足够长，保证切出多个 chunk。 */
const LONG_DOC = Array.from(
	{ length: 12 },
	(_, i) =>
		`## 第 ${i + 1} 节\n${`第 ${i + 1} 节讲的是配置项 option${i + 1} 的含义与默认值。`.repeat(20)}`,
).join('\n');

const store = (service: ReturnType<typeof setup>['service'], id = 'doc-1', text = DOC) =>
	service.storeDocument({ attachmentId: id, name: `${id}.md`, text, segments: segmentMarkdown(text) });

describe('documentIndex', () => {
	it('supports BM25 retrieval right after storing, before embeddings exist', async () => {
		const { service } = setup();
		const stored = await store(service);
		expect(stored.chunkCount).toBeGreaterThan(0);

		const result = await service.retrieve({ query: 'EADDRINUSE 怎么办', attachmentIds: ['doc-1'] });

		expect(result.mode).toBe('bm25');
		expect(result.degraded).toEqual(['no-vectors']);
		expect(result.passages[0].text).toContain('EADDRINUSE');
		expect(result.passages[0].name).toBe('doc-1.md');
	});

	it('uses hybrid retrieval once embeddings are stored', async () => {
		const { service } = setup();
		await store(service);
		await expect(service.embedDocument('doc-1')).resolves.toEqual({ model: 'fake-model' });

		const result = await service.retrieve({ query: '端口冲突了', attachmentIds: ['doc-1'] });

		expect(result.mode).toBe('hybrid');
		expect(result.degraded).toEqual([]);
		expect(result.passages[0].text).toContain('端口');
	});

	it('falls back to BM25 when query embedding fails', async () => {
		const embed = vi.fn<Embedder>(fakeEmbed);
		const { service } = setup(embed);
		await store(service);
		await service.embedDocument('doc-1');
		embed.mockRejectedValueOnce(new Error('rate limited'));

		const result = await service.retrieve({ query: 'JSON.parse 逗号', attachmentIds: ['doc-1'] });

		expect(result.mode).toBe('bm25');
		expect(result.degraded).toContain('query-embedding-failed');
		expect(result.passages[0].text).toContain('JSON');
	});

	it('ignores stored vectors from a different embedding model', async () => {
		const { repository, service } = setup();
		await store(service);
		await service.embedDocument('doc-1');

		// 同一份本地索引，但服务端已切换到另一个向量模型
		const switched = createDocumentIndexService(repository, {
			embed: async texts => ({ ...(await fakeEmbed(texts)), model: 'other-model' }),
			rerank: fakeRerank,
			rewrite: null,
		});
		const result = await switched.retrieve({ query: 'JSON 逗号', attachmentIds: ['doc-1'] });

		expect(result.mode).toBe('bm25');
		expect(result.degraded).toContain('model-mismatch');
		expect(result.passages[0].text).toContain('JSON');
	});

	it('keeps passages within the character budget but always returns one', async () => {
		const { service } = setup();
		await store(service);
		const result = await service.retrieve({
			query: '端口 JSON 404',
			attachmentIds: ['doc-1'],
			budget: 1,
		});
		expect(result.passages).toHaveLength(1);
	});

	it('only searches the requested attachments and supports removal', async () => {
		const { service } = setup();
		await store(service, 'doc-1');
		await store(service, 'doc-2', '## 其他\n与端口无关的内容，讲的是缓存。');

		const scoped = await service.retrieve({ query: '端口占用', attachmentIds: ['doc-2'] });
		expect(scoped.passages.every(passage => passage.attachmentId === 'doc-2')).toBe(true);

		await service.remove('doc-1');
		const removed = await service.retrieve({ query: '端口占用', attachmentIds: ['doc-1'] });
		expect(removed.passages).toEqual([]);
		expect(removed.degraded).toEqual(['no-index']);

		await expect(service.retain([])).resolves.toEqual(['doc-2']);
	});

	it('reranks candidates and reports it', async () => {
		const rerank = vi.fn<Reranker>(fakeRerank);
		const { service } = setup(fakeEmbed, rerank);
		await store(service);
		const result = await service.retrieve({ query: 'JSON 逗号', attachmentIds: ['doc-1'] });

		expect(result.reranked).toBe(true);
		expect(result.noAnswer).toBe(false);
		expect(result.passages[0].score).toBe(0.9);
		const [query, documents] = rerank.mock.calls[0];
		expect(query).toBe('JSON 逗号');
		// 送去重排序的是带文档名与标题路径前缀的文本
		expect(documents[0]).toContain('《doc-1.md》');
	});

	it('returns no passages and flags noAnswer when every candidate is below the threshold', async () => {
		const { service } = setup();
		await store(service);
		// “错误手册”能被 BM25 召回，但与任何主题都不相关
		const result = await service.retrieve({ query: '错误手册里的 Redis 集群', attachmentIds: ['doc-1'] });

		expect(result.reranked).toBe(true);
		expect(result.noAnswer).toBe(true);
		expect(result.passages).toEqual([]);
	});

	it('falls back to RRF order with a smaller limit when rerank fails', async () => {
		const { service } = setup(fakeEmbed, async () => {
			throw new Error('upstream 503');
		});
		await store(service, 'doc-1', LONG_DOC);
		const result = await service.retrieve({
			query: '配置项 option3 默认值',
			attachmentIds: ['doc-1'],
			budget: 100_000,
		});

		expect(result.reranked).toBe(false);
		expect(result.noAnswer).toBe(false);
		expect(result.degraded).toContain('rerank-failed');
		const chunkCount = result.passages.reduce(
			(sum, passage) => sum + (passage.chunkIds?.length ?? 1),
			0,
		);
		expect(chunkCount).toBeGreaterThan(0);
		expect(chunkCount).toBeLessThanOrEqual(RERANK_FALLBACK_LIMIT);
	});

	it('merges adjacent chunks of the same document into one passage', async () => {
		// 所有候选同分，按 RRF 顺序全部保留，连续的 chunk 应被合并
		const { service } = setup(fakeEmbed, async (_query, documents) => ({
			model: 'flat',
			results: documents.map((_, index) => ({ index, score: 0.5 })),
		}));
		await store(service, 'doc-1', LONG_DOC);
		const result = await service.retrieve({
			query: '配置项 默认值',
			attachmentIds: ['doc-1'],
			limit: 20,
			budget: 100_000,
		});

		const merged = result.passages.filter(passage => (passage.chunkIds?.length ?? 1) > 1);
		expect(merged.length).toBeGreaterThan(0);
		// 合并后的正文是原文的连续片段，没有重复的重叠部分
		for (const passage of merged) expect(LONG_DOC).toContain(passage.text);
	});

	it('searches with both the original and the rewritten query but reranks against the original', async () => {
		const embed = vi.fn<Embedder>(fakeEmbed);
		const rerank = vi.fn<Reranker>(fakeRerank);
		// 原问题与文档没有共同的词，只有改写后的术语能命中
		const rewrite = vi.fn<Rewriter>(async () => ({ model: 'fake-llm', query: 'EADDRINUSE 端口占用' }));
		const { service } = setup(embed, rerank, rewrite);
		await store(service);
		await service.embedDocument('doc-1');
		embed.mockClear();

		const result = await service.retrieve({ query: '服务起不来，说地址被别人用了', attachmentIds: ['doc-1'] });

		expect(result.rewrittenQuery).toBe('EADDRINUSE 端口占用');
		expect(embed).toHaveBeenCalledOnce();
		expect(embed.mock.calls[0][0]).toEqual(['服务起不来，说地址被别人用了', 'EADDRINUSE 端口占用']);
		expect(rerank.mock.calls[0][0]).toBe('服务起不来，说地址被别人用了');
		expect(result.degraded).toEqual([]);
	});

	it('falls back to the original query when the rewrite fails', async () => {
		const { service } = setup(fakeEmbed, fakeRerank, async () => {
			throw new Error('429');
		});
		await store(service);
		const result = await service.retrieve({ query: 'EADDRINUSE 怎么办', attachmentIds: ['doc-1'] });

		expect(result.degraded).toContain('rewrite-failed');
		expect(result.rewrittenQuery).toBeUndefined();
		expect(result.passages[0].text).toContain('EADDRINUSE');
	});

	it('propagates cancellation', async () => {
		const { service } = setup();
		await store(service);
		const controller = new AbortController();
		controller.abort();
		await expect(
			service.retrieve({ query: '端口', attachmentIds: ['doc-1'], signal: controller.signal }),
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});
