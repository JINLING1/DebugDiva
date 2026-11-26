import { describe, expect, it } from 'vitest';
import { createBm25Index } from './bm25';
import {
	buildRetrievalQuery,
	createRetriever,
	denseSearch,
	normalizeVector,
	reciprocalRankFusion,
	type IndexedChunk,
} from './retrieve';
import { tokenize } from './tokenizer';

describe('tokenize', () => {
	it('splits Chinese runs into bigrams', () => {
		expect(tokenize('循环引用')).toEqual(['循环', '环引', '引用']);
		expect(tokenize('错')).toEqual(['错']);
	});

	it('keeps whole error codes and also their parts', () => {
		const tokens = tokenize('ERR_HTTP_HEADERS_SENT');
		expect(tokens[0]).toBe('err_http_headers_sent');
		expect(tokens).toEqual(
			expect.arrayContaining(['err', 'http', 'headers', 'sent']),
		);
	});

	it('splits camelCase and dotted identifiers', () => {
		expect(tokenize('document.getElementById')).toEqual(
			expect.arrayContaining(['document.getelementbyid', 'get', 'element', 'by', 'id']),
		);
	});

	it('handles mixed Chinese and English text', () => {
		expect(tokenize('Node 报 EADDRINUSE 端口占用')).toEqual([
			'node',
			'报',
			'eaddrinuse',
			'端口',
			'口占',
			'占用',
		]);
	});
});

describe('createBm25Index', () => {
	const index = createBm25Index([
		{ id: 'a', text: 'ERR_HTTP_HEADERS_SENT：响应头已发送后又设置响应头' },
		{ id: 'b', text: 'ERR_STREAM_WRITE_AFTER_END：end 之后调用 write' },
		{ id: 'c', text: 'JSON 不支持循环引用，JSON.stringify 会失败' },
	]);

	it('ranks exact error-code matches first', () => {
		expect(index.search('Express 报 ERR_HTTP_HEADERS_SENT', 3)[0].id).toBe('a');
		expect(index.search('stream write after end', 3)[0].id).toBe('b');
	});

	it('matches Chinese queries through bigrams', () => {
		expect(index.search('对象有循环引用怎么办', 3)[0].id).toBe('c');
	});

	it('returns nothing for unknown terms', () => {
		expect(index.search('完全无关的词汇 zzz', 3)).toEqual([]);
	});
});

describe('dense search and fusion', () => {
	it('normalizes vectors and ranks by cosine similarity', () => {
		const chunks: IndexedChunk[] = [
			{ id: 'x', attachmentId: 'd', text: '', vector: normalizeVector([1, 0]) },
			{ id: 'y', attachmentId: 'd', text: '', vector: normalizeVector([1, 1]) },
			{ id: 'z', attachmentId: 'd', text: '' },
		];
		const result = denseSearch(chunks, normalizeVector([0, 3]), 5);
		expect(result.map(item => item.id)).toEqual(['y', 'x']);
		expect(result[0].score).toBeCloseTo(Math.SQRT1_2);
	});

	it('fuses ranked lists with RRF', () => {
		const fused = reciprocalRankFusion([
			[{ id: 'a', score: 9 }, { id: 'b', score: 8 }],
			[{ id: 'b', score: 1 }, { id: 'c', score: 0.5 }],
		]);
		expect(fused.map(item => item.id)).toEqual(['b', 'a', 'c']);
		expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61);
	});
});

describe('createRetriever', () => {
	const chunks: IndexedChunk[] = [
		{ id: 'net', attachmentId: 'd', text: 'EADDRINUSE 地址已被占用', vector: normalizeVector([1, 0, 0]) },
		{ id: 'json', attachmentId: 'd', text: 'JSON.parse 末尾逗号', vector: normalizeVector([0, 1, 0]) },
		{ id: 'http', attachmentId: 'd', text: '404 资源不存在', vector: normalizeVector([0, 0, 1]) },
	];
	const retriever = createRetriever(chunks);

	it('combines dense and BM25 evidence in hybrid mode', () => {
		const hits = retriever.search('端口被占用 EADDRINUSE', normalizeVector([0.1, 0, 1]));
		expect(hits[0].chunkId).toBe('net');
		expect(hits[0].bm25Rank).toBe(0);
		expect(hits.find(hit => hit.chunkId === 'http')?.denseRank).toBe(0);
	});

	it('falls back to BM25 without a query vector', () => {
		const hits = retriever.search('JSON.parse 逗号', undefined, { mode: 'hybrid' });
		expect(hits[0].chunkId).toBe('json');
		expect(hits[0].denseRank).toBeUndefined();
	});

	it('supports dense-only mode', () => {
		const hits = retriever.search('无关', normalizeVector([0, 0, 1]), { mode: 'dense', limit: 1 });
		expect(hits).toEqual([expect.objectContaining({ chunkId: 'http' })]);
	});
});

describe('buildRetrievalQuery', () => {
	const history = [
		{ role: 'user' as const, content: 'Node.js 里 EMFILE 是什么错误？' },
		{ role: 'assistant' as const, content: '文件描述符达到上限。' },
	];

	it('prepends the previous user question for short or referential follow-ups', () => {
		expect(buildRetrievalQuery('为什么在 macOS 上更容易遇到？', history)).toBe(
			'Node.js 里 EMFILE 是什么错误？\n为什么在 macOS 上更容易遇到？',
		);
		expect(
			buildRetrievalQuery('那后者对搜索引擎优化有什么具体的影响和建议呢？', history),
		).toContain('EMFILE');
	});

	it('keeps self-contained questions unchanged', () => {
		expect(
			buildRetrievalQuery('Express 里报 ERR_HTTP_HEADERS_SENT 是什么意思，如何排查？', history),
		).toBe('Express 里报 ERR_HTTP_HEADERS_SENT 是什么意思，如何排查？');
		expect(buildRetrievalQuery('短问题')).toBe('短问题');
	});
});
