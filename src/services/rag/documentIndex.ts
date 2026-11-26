/**
 * 文档索引服务：切块入库、后台向量化、检索。
 *
 * 两阶段索引：
 * 1. storeDocument：切块并写入 IndexedDB，立即可用 BM25 检索（毫秒级，不依赖网络）；
 * 2. embedDocument：后台调用 /api/rag/embed 补齐向量，完成后自动参与稠密检索。
 * 因此发送消息永远不需要等待向量化接口。
 *
 * 任何一环失败都会降级而不是报错：向量化失败 → 只用 BM25；查询向量化失败 → 只用 BM25；
 * 重排序失败或超时 → 使用 RRF 顺序取前 RERANK_FALLBACK_LIMIT 条。
 *
 * 检索流程：混合检索取前 RERANK_CANDIDATES 个候选 → 重排序 → 丢弃低于阈值的候选
 * （全部低于阈值即“资料中没有答案”）→ 条数与字符预算 → 相邻块合并。
 */

import { buildEmbedText, chunkDocument } from '../../../functions/_shared/chunker';
import type { DocumentSegment } from '../../../functions/_shared/documentSegments';
import {
	embedTexts,
	MAX_EMBED_BATCH,
	MAX_RERANK_DOCUMENT_CHARACTERS,
	rerankTexts,
	rewriteQuery,
	type EmbedResult,
	type RerankResult,
	type RewriteResult,
} from '../../api/rag';
import type {
	RagIndexRepository,
	StoredChunk,
	StoredDocumentIndex,
} from '../storage/ragIndexStorage';
import {
	createRetriever,
	normalizeVector,
	type IndexedChunk,
	type RetrievalMode,
	type Retriever,
} from './retrieve';
import { selectPassages, type SelectionCandidate } from './selection';

export const DEFAULT_PASSAGE_LIMIT = 8;
export const DEFAULT_PASSAGE_BUDGET = 6_000;
export const QUERY_EMBEDDING_TIMEOUT_MS = 5_000;
/** 送去重排序的混合检索候选数。 */
export const RERANK_CANDIDATES = 20;
export const RERANK_TIMEOUT_MS = 3_000;
/** 重排序不可用时，按 RRF 顺序保留的条数。 */
export const RERANK_FALLBACK_LIMIT = 6;
/**
 * bge-reranker-v2-m3 分数（0–1）低于该值的候选丢弃；全部低于则判定资料中没有答案。
 * 由评测集校准，见 docs/rag-design.md 第 8 节。
 */
export const RERANK_SCORE_THRESHOLD = 0.02;
/**
 * LLM 查询改写超时：超时或失败时只用原查询检索。
 * E5：改写使口语化题的注入完全召回从 58.3% 提升到 91.7%，P50 延迟约 0.6s。
 */
export const REWRITE_TIMEOUT_MS = 2_500;

export interface RetrievedPassage {
	/** 第一个 chunk 的 id；相邻块合并后其余 id 见 chunkIds。 */
	chunkId: string;
	chunkIds?: string[];
	attachmentId: string;
	name: string;
	text: string;
	page?: number;
	pageEnd?: number;
	headingPath?: string[];
	score: number;
}

export interface RetrievalResult {
	passages: RetrievedPassage[];
	mode: RetrievalMode;
	/** 降级原因，例如 `query-embedding-failed`、`rerank-failed`。 */
	degraded: string[];
	/** 结果是否经过重排序。 */
	reranked: boolean;
	/** 重排序后所有候选都低于阈值：资料中没有与问题相关的内容。 */
	noAnswer: boolean;
	/** LLM 改写后的检索查询（改写成功且与原查询不同时）。 */
	rewrittenQuery?: string;
}

export interface RetrieveRequest {
	query: string;
	attachmentIds: readonly string[];
	signal?: AbortSignal;
	limit?: number;
	budget?: number;
}

export interface DocumentIndexService {
	storeDocument(input: {
		attachmentId: string;
		name: string;
		text: string;
		segments: readonly DocumentSegment[];
	}): Promise<{ chunkCount: number; textLength: number }>;
	embedDocument(attachmentId: string, signal?: AbortSignal): Promise<{ model: string }>;
	retrieve(request: RetrieveRequest): Promise<RetrievalResult>;
	remove(attachmentId: string): Promise<void>;
	retain(attachmentIds: readonly string[]): Promise<string[]>;
	clear(): Promise<void>;
	close(): void;
}

export type Embedder = (texts: readonly string[], signal?: AbortSignal) => Promise<EmbedResult>;
export type Rewriter = (query: string, signal?: AbortSignal) => Promise<RewriteResult>;
export type Reranker = (
	query: string,
	documents: readonly string[],
	signal?: AbortSignal,
) => Promise<RerankResult>;

const truncateCodePoints = (text: string, max: number) => {
	const codePoints = Array.from(text);
	return codePoints.length > max ? codePoints.slice(0, max).join('') : text;
};

const withTimeout = (signal: AbortSignal | undefined, timeoutMs: number) => {
	const controller = new AbortController();
	const abort = () => controller.abort();
	const timer = setTimeout(abort, timeoutMs);
	if (signal?.aborted) abort();
	signal?.addEventListener('abort', abort, { once: true });
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		},
	};
};

const throwIfAborted = (signal?: AbortSignal) => {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

export const createDocumentIndexService = (
	repository: RagIndexRepository,
	{
		embed = (texts, signal) => embedTexts(texts, { signal }),
		rerank = (query, documents, signal) => rerankTexts(query, documents, { signal }),
		rewrite = (query, signal) => rewriteQuery(query, { signal }),
		now = Date.now,
		rerankThreshold = RERANK_SCORE_THRESHOLD,
	}: {
		embed?: Embedder;
		/** 传 null 关闭重排序。 */
		rerank?: Reranker | null;
		/** 传 null 关闭 LLM 查询改写。 */
		rewrite?: Rewriter | null;
		now?: () => number;
		rerankThreshold?: number;
	} = {},
): DocumentIndexService => {
	const chunkCache = new Map<string, StoredChunk[]>();
	const documentCache = new Map<string, StoredDocumentIndex>();
	let retrieverCache: { key: string; retriever: Retriever } | undefined;

	const invalidate = (attachmentId: string) => {
		chunkCache.delete(attachmentId);
		documentCache.delete(attachmentId);
		retrieverCache = undefined;
	};

	const load = async (attachmentIds: readonly string[]) => {
		const missing = attachmentIds.filter(id => !chunkCache.has(id));
		if (missing.length) {
			const [chunks, documents] = await Promise.all([
				repository.getChunks(missing),
				repository.getDocuments(missing),
			]);
			for (const id of missing) chunkCache.set(id, []);
			for (const chunk of chunks) chunkCache.get(chunk.attachmentId)?.push(chunk);
			for (const document of documents) documentCache.set(document.attachmentId, document);
		}
		return {
			chunks: attachmentIds.flatMap(id => chunkCache.get(id) ?? []),
			documents: new Map(
				attachmentIds
					.map(id => documentCache.get(id))
					.filter((document): document is StoredDocumentIndex => Boolean(document))
					.map(document => [document.attachmentId, document]),
			),
		};
	};

	return {
		async storeDocument({ attachmentId, name, text, segments }) {
			const chunks: StoredChunk[] = chunkDocument(text, segments).map(chunk => ({
				id: `${attachmentId}:${chunk.ordinal}`,
				attachmentId,
				ordinal: chunk.ordinal,
				text: chunk.text,
				searchText: buildEmbedText(name, chunk),
				charStart: chunk.charStart,
				charEnd: chunk.charEnd,
				kind: chunk.kind,
				...(chunk.page !== undefined ? { page: chunk.page } : {}),
				...(chunk.pageEnd !== undefined ? { pageEnd: chunk.pageEnd } : {}),
				...(chunk.headingPath ? { headingPath: chunk.headingPath } : {}),
			}));
			const textLength = Array.from(text).length;
			await repository.putDocument(
				{ attachmentId, name, chunkCount: chunks.length, textLength, createdAt: now() },
				chunks,
			);
			invalidate(attachmentId);
			return { chunkCount: chunks.length, textLength };
		},

		async embedDocument(attachmentId, signal) {
			const chunks = await repository.getChunks([attachmentId]);
			const vectors = new Map<string, Float32Array>();
			let model = '';
			let dims = 0;
			for (let start = 0; start < chunks.length; start += MAX_EMBED_BATCH) {
				throwIfAborted(signal);
				const batch = chunks.slice(start, start + MAX_EMBED_BATCH);
				const result = await embed(batch.map(chunk => chunk.searchText), signal);
				if (model && result.model !== model) {
					throw new Error('向量化模型在同一文档内发生变化');
				}
				model = result.model;
				dims = result.dims;
				batch.forEach((chunk, i) => vectors.set(chunk.id, normalizeVector(result.vectors[i])));
			}
			throwIfAborted(signal);
			if (model) await repository.putVectors(attachmentId, model, dims, vectors);
			invalidate(attachmentId);
			return { model };
		},

		async retrieve({ query, attachmentIds, signal, limit = DEFAULT_PASSAGE_LIMIT, budget = DEFAULT_PASSAGE_BUDGET }) {
			const ids = [...new Set(attachmentIds)].sort();
			const degraded: string[] = [];
			const { chunks, documents } = await load(ids);
			throwIfAborted(signal);
			if (!chunks.length) {
				return { passages: [], mode: 'bm25', degraded: ['no-index'], reranked: false, noAnswer: false };
			}

			// LLM 改写：与原查询一起做多查询检索；重排序仍以原问题打分（E5：用改写打分会让拒答率从 80% 降到 20%）。
			let rewrittenQuery: string | undefined;
			if (rewrite) {
				const scope = withTimeout(signal, REWRITE_TIMEOUT_MS);
				try {
					const result = await rewrite(query, scope.signal);
					const value = result.query.trim();
					if (value && value !== query.trim()) rewrittenQuery = value;
				} catch {
					throwIfAborted(signal);
					degraded.push('rewrite-failed');
				} finally {
					scope.dispose();
				}
			}

			let queryVector: Float32Array | undefined;
			let rewrittenVector: Float32Array | undefined;
			let queryModel: string | undefined;
			if (chunks.some(chunk => chunk.vector)) {
				const scope = withTimeout(signal, QUERY_EMBEDDING_TIMEOUT_MS);
				try {
					const result = await embed(
						rewrittenQuery ? [query, rewrittenQuery] : [query],
						scope.signal,
					);
					queryVector = normalizeVector(result.vectors[0]);
					if (rewrittenQuery) rewrittenVector = normalizeVector(result.vectors[1]);
					queryModel = result.model;
				} catch {
					throwIfAborted(signal);
					degraded.push('query-embedding-failed');
				} finally {
					scope.dispose();
				}
			} else {
				degraded.push('no-vectors');
			}

			const key = `${ids.join('|')}@${queryModel ?? ''}`;
			if (retrieverCache?.key !== key) {
				const indexed: IndexedChunk[] = chunks.map(chunk => ({
					id: chunk.id,
					attachmentId: chunk.attachmentId,
					text: chunk.text,
					searchText: chunk.searchText,
					// 只使用与查询同一模型生成的向量，模型切换后旧向量自动失效。
					vector:
						chunk.vector && documents.get(chunk.attachmentId)?.model === queryModel
							? chunk.vector
							: undefined,
				}));
				retrieverCache = { key, retriever: createRetriever(indexed) };
			}
			const retriever = retrieverCache.retriever;
			if (queryVector && !retriever.hasVectors) degraded.push('model-mismatch');

			const hits = retriever.searchMany(
				[
					{ text: query, vector: queryVector },
					...(rewrittenQuery ? [{ text: rewrittenQuery, vector: rewrittenVector }] : []),
				],
				{ mode: 'hybrid', limit: RERANK_CANDIDATES, candidates: 30 },
			);
			const mode: RetrievalMode = queryVector && retriever.hasVectors ? 'hybrid' : 'bm25';
			const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
			const toCandidate = (chunkId: string, score: number): SelectionCandidate => {
				const chunk = byId.get(chunkId)!;
				return {
					id: chunk.id,
					attachmentId: chunk.attachmentId,
					ordinal: chunk.ordinal,
					charStart: chunk.charStart,
					charEnd: chunk.charEnd,
					text: chunk.text,
					score,
					...(chunk.page !== undefined ? { page: chunk.page } : {}),
					...(chunk.pageEnd !== undefined ? { pageEnd: chunk.pageEnd } : {}),
					...(chunk.headingPath ? { headingPath: chunk.headingPath } : {}),
				};
			};

			let ranked: SelectionCandidate[] | undefined;
			if (rerank && hits.length) {
				const scope = withTimeout(signal, RERANK_TIMEOUT_MS);
				try {
					const result = await rerank(
						query,
						hits.map(hit =>
							truncateCodePoints(
								byId.get(hit.chunkId)!.searchText,
								MAX_RERANK_DOCUMENT_CHARACTERS,
							),
						),
						scope.signal,
					);
					ranked = result.results.map(({ index, score }) =>
						toCandidate(hits[index].chunkId, score),
					);
				} catch {
					throwIfAborted(signal);
					degraded.push('rerank-failed');
				} finally {
					scope.dispose();
				}
			}

			const selection = ranked
				? selectPassages(ranked, { limit, budget, threshold: rerankThreshold })
				: selectPassages(
						hits.map(hit => toCandidate(hit.chunkId, hit.score)),
						{ limit: Math.min(limit, RERANK_FALLBACK_LIMIT), budget },
					);
			const passages: RetrievedPassage[] = selection.passages.map(passage => ({
				chunkId: passage.chunkIds[0],
				...(passage.chunkIds.length > 1 ? { chunkIds: passage.chunkIds } : {}),
				attachmentId: passage.attachmentId,
				name: documents.get(passage.attachmentId)?.name ?? '附件',
				text: passage.text,
				score: passage.score,
				...(passage.page !== undefined ? { page: passage.page } : {}),
				...(passage.pageEnd !== undefined ? { pageEnd: passage.pageEnd } : {}),
				...(passage.headingPath ? { headingPath: passage.headingPath } : {}),
			}));
			return {
				passages,
				mode,
				degraded,
				reranked: Boolean(ranked),
				noAnswer: selection.noAnswer,
				...(rewrittenQuery ? { rewrittenQuery } : {}),
			};
		},

		async remove(attachmentId) {
			invalidate(attachmentId);
			await repository.delete(attachmentId);
		},
		async retain(attachmentIds) {
			const removed = await repository.retain(attachmentIds);
			removed.forEach(invalidate);
			return removed;
		},
		async clear() {
			chunkCache.clear();
			documentCache.clear();
			retrieverCache = undefined;
			await repository.clear();
		},
		close() {
			repository.close();
		},
	};
};
