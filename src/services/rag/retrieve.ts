/**
 * 混合检索核心（纯函数，浏览器与离线评测共用）。
 *
 * 稠密检索：查询向量与 chunk 向量的余弦相似度（向量预先归一化，点积即余弦）。
 * 稀疏检索：BM25。
 * 融合：Reciprocal Rank Fusion，score = Σ 1 / (k + rank)，不需要把两路分数归一化到同一尺度。
 */

import { createBm25Index, type Bm25Index, type ScoredId } from './bm25';

export type RetrievalMode = 'dense' | 'bm25' | 'hybrid';

export interface IndexedChunk {
	id: string;
	attachmentId: string;
	text: string;
	/** 用于 BM25 的文本；默认与 `text` 相同，评测时可加入标题前缀。 */
	searchText?: string;
	/** 已归一化的向量；缺失时该 chunk 只参与 BM25。 */
	vector?: Float32Array;
}

export interface RetrievalHit {
	chunkId: string;
	score: number;
	denseRank?: number;
	denseScore?: number;
	bm25Rank?: number;
	bm25Score?: number;
}

export interface RetrieveOptions {
	mode?: RetrievalMode;
	/** 每一路召回的候选数。 */
	candidates?: number;
	/** 最终返回条数。 */
	limit?: number;
	rrfK?: number;
}

export const normalizeVector = (values: ArrayLike<number>): Float32Array => {
	const vector = Float32Array.from(values);
	let norm = 0;
	for (const value of vector) norm += value * value;
	norm = Math.sqrt(norm);
	if (!norm) return vector;
	for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
	return vector;
};

export const denseSearch = (
	chunks: readonly IndexedChunk[],
	queryVector: Float32Array,
	limit: number,
): ScoredId[] => {
	const scored: ScoredId[] = [];
	for (const chunk of chunks) {
		const vector = chunk.vector;
		if (!vector || vector.length !== queryVector.length) continue;
		let dot = 0;
		for (let i = 0; i < vector.length; i += 1) dot += vector[i] * queryVector[i];
		scored.push({ id: chunk.id, score: dot });
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit);
};

export const reciprocalRankFusion = (
	lists: readonly (readonly ScoredId[])[],
	k = 60,
): ScoredId[] => {
	const scores = new Map<string, number>();
	for (const list of lists) {
		list.forEach((item, rank) => {
			scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1));
		});
	}
	return [...scores]
		.map(([id, score]) => ({ id, score }))
		.sort((a, b) => b.score - a.score);
};

export interface RetrievalQuery {
	text: string;
	vector?: Float32Array;
}

export interface Retriever {
	readonly chunkCount: number;
	readonly hasVectors: boolean;
	search(
		query: string,
		queryVector: Float32Array | undefined,
		options?: RetrieveOptions,
	): RetrievalHit[];
	/**
	 * 多查询检索（例如原问题 + LLM 改写）：每个查询的稠密、BM25 排名一起做 RRF。
	 * 只有一个查询时与 search 完全等价。排名信息记录第一个查询的名次。
	 */
	searchMany(queries: readonly RetrievalQuery[], options?: RetrieveOptions): RetrievalHit[];
}

/**
 * 基于一组 chunk 构建检索器。没有查询向量或 chunk 没有向量时，自动退化为 BM25。
 */
export const createRetriever = (chunks: readonly IndexedChunk[]): Retriever => {
	const bm25: Bm25Index = createBm25Index(
		chunks.map(chunk => ({ id: chunk.id, text: chunk.searchText ?? chunk.text })),
	);
	const hasVectors = chunks.some(chunk => chunk.vector);

	return {
		chunkCount: chunks.length,
		hasVectors,
		search(query, queryVector, options = {}) {
			return this.searchMany([{ text: query, vector: queryVector }], options);
		},
		searchMany(queries, options = {}) {
			const { candidates = 30, limit = 10, rrfK = 60 } = options;
			const requested = options.mode ?? 'hybrid';
			const perQuery = queries.map(({ text, vector }) => {
				const canDense = Boolean(vector && hasVectors);
				const mode: RetrievalMode = requested !== 'bm25' && !canDense ? 'bm25' : requested;
				return {
					mode,
					dense: mode === 'bm25' ? [] : denseSearch(chunks, vector!, candidates),
					sparse: mode === 'dense' ? [] : bm25.search(text, candidates),
				};
			});
			const single = perQuery.length === 1 ? perQuery[0] : undefined;
			const ranked =
				single?.mode === 'dense'
					? single.dense
					: single?.mode === 'bm25'
						? single.sparse
						: reciprocalRankFusion(
								perQuery.flatMap(({ mode, dense, sparse }) =>
									mode === 'dense' ? [dense] : mode === 'bm25' ? [sparse] : [dense, sparse],
								),
								rrfK,
							);
			const { dense = [], sparse = [] } = perQuery[0] ?? {};

			const denseInfo = new Map(dense.map((item, rank) => [item.id, { rank, score: item.score }]));
			const sparseInfo = new Map(sparse.map((item, rank) => [item.id, { rank, score: item.score }]));
			return ranked.slice(0, limit).map(item => ({
				chunkId: item.id,
				score: item.score,
				...(denseInfo.has(item.id)
					? { denseRank: denseInfo.get(item.id)!.rank, denseScore: denseInfo.get(item.id)!.score }
					: {}),
				...(sparseInfo.has(item.id)
					? { bm25Rank: sparseInfo.get(item.id)!.rank, bm25Score: sparseInfo.get(item.id)!.score }
					: {}),
			}));
		},
	};
};

const SHORT_QUERY_LENGTH = 20;
const REFERENCE_PATTERN = /它|这个|那个|上面|前面|后者|前者|那么?|这些|那些|该|此|上述|第[一二三四五六七八九十\d]+(?:种|个|条)/;

/**
 * 规则式查询改写（零延迟）：追问通常很短或带指代，单独检索会丢失主题，
 * 此时把上一轮用户问题拼接进来。
 */
export const buildRetrievalQuery = (
	question: string,
	history: readonly { role: 'user' | 'assistant'; content: string }[] = [],
): string => {
	const trimmed = question.trim();
	const previousUser = [...history].reverse().find(turn => turn.role === 'user');
	if (
		previousUser &&
		(Array.from(trimmed).length < SHORT_QUERY_LENGTH || REFERENCE_PATTERN.test(trimmed))
	) {
		return `${previousUser.content.trim()}\n${trimmed}`;
	}
	return trimmed;
};
