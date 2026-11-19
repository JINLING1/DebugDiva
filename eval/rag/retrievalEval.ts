/**
 * 检索实验：E1 稠密 / E2 BM25 / E3 混合（RRF）/ E4 混合 + 重排序。
 *
 * 所有文档同时处于激活状态（模拟用户一次上传三份文档），chunk 混在同一个池子里检索。
 * 查询使用与应用相同的规则式改写 buildRetrievalQuery；最终注入内容使用与应用相同的
 * selectPassages（阈值、条数、字符预算、相邻块合并），因此“注入”列衡量的就是模型实际看到的内容。
 */

import type { ParsedDocumentData } from '../../functions/_shared/fileParsing';
import {
	buildEmbedText,
	chunkDocument,
	type ChunkOptions,
} from '../../functions/_shared/chunker';
import {
	DEFAULT_PASSAGE_BUDGET,
	DEFAULT_PASSAGE_LIMIT,
	RERANK_CANDIDATES,
	RERANK_SCORE_THRESHOLD,
} from '../../src/services/rag/documentIndex';
import {
	buildRetrievalQuery,
	createRetriever,
	normalizeVector,
	type IndexedChunk,
	type RetrievalHit,
} from '../../src/services/rag/retrieve';
import {
	selectPassages,
	type SelectionCandidate,
} from '../../src/services/rag/selection';
import {
	mean,
	ndcgAtK,
	recallAtK,
	reciprocalRank,
	spanHit,
	type EvalItem,
	type Span,
} from './metrics';

export interface ResolvedEvalItem {
	item: EvalItem;
	spans: Span[];
}

export type ModeKey = 'dense' | 'bm25' | 'hybrid' | 'rerank';

export const MODE_LABELS: Record<ModeKey, string> = {
	dense: 'E1 稠密检索',
	bm25: 'E2 BM25',
	hybrid: 'E3 混合 + RRF',
	rerank: 'E4 混合 + 重排序',
};

export interface TypeBreakdown {
	type: string;
	count: number;
	recall5?: number;
	fullRecall5?: number;
	injectedFull?: number;
}

export interface ModeResult {
	mode: ModeKey;
	label: string;
	recall5?: number;
	recall10?: number;
	fullRecall5?: number;
	mrr?: number;
	ndcg10?: number;
	/** 应用实际注入的片段覆盖了全部证据的比例。 */
	injectedFull?: number;
	/** 应用实际注入的平均字符数（有答案的题）。 */
	injectedChars?: number;
	/** 有答案的题被错误判定为“没有答案”的比例（仅 E4）。 */
	falseRefusal?: number;
	/** 无答案题被正确判定为“没有答案”的比例（仅 E4）。 */
	refusal?: number;
	byType: TypeBreakdown[];
}

export interface ThresholdRow {
	threshold: number;
	refusal?: number;
	falseRefusal?: number;
	injectedFull?: number;
}

export interface ScoreSample {
	id: string;
	type: string;
	question: string;
	topScore: number;
	/** 证据 chunk 在重排序后的最好名次（1 起），未召回为 undefined。 */
	evidenceRank?: number;
}

export interface RetrievalEvalResult {
	chunkCount: number;
	modes: ModeResult[];
	thresholdSweep?: ThresholdRow[];
	scoreSamples?: ScoreSample[];
	skipped: string[];
}

export interface RetrievalEvalOptions {
	chunk?: ChunkOptions;
	/** 是否在 embedding / BM25 / rerank 文本前加《文档名》> 标题路径前缀，默认 true。 */
	prefix?: boolean;
	embed?: (texts: readonly string[]) => Promise<Float32Array[]>;
	/** 返回与 documents 对齐的分数。 */
	rerank?: (query: string, documents: readonly string[]) => Promise<number[]>;
	modes?: ModeKey[];
	threshold?: number;
	sweep?: number[];
	/**
	 * E5 查询改写：混合检索同时使用原查询与改写后的查询（多查询 RRF）。
	 * 改写失败时返回原查询即可，与应用的降级行为一致。
	 */
	rewrite?: (query: string) => Promise<string>;
	/** 重排序打分使用的查询：原查询（默认）、改写后的查询，或两者拼接。 */
	rerankQuery?: 'original' | 'rewritten' | 'both';
}

const DEFAULT_SWEEP = [0, 0.001, 0.003, 0.01, 0.02, 0.05, 0.1, 0.2];

const groupBy = <T>(values: readonly T[], key: (value: T) => string) => {
	const groups = new Map<string, T[]>();
	for (const value of values) {
		const k = key(value);
		groups.set(k, [...(groups.get(k) ?? []), value]);
	}
	return groups;
};

interface EvalChunk extends IndexedChunk {
	ordinal: number;
	charStart: number;
	charEnd: number;
}

interface Row {
	type: string;
	answerable: boolean;
	recall5?: number;
	recall10?: number;
	fullRecall5?: number;
	mrr?: number;
	ndcg10?: number;
	injectedFull?: number;
	injectedChars?: number;
	noAnswer: boolean;
}

export const evaluateRetrieval = async (
	documents: Map<string, ParsedDocumentData>,
	resolved: ResolvedEvalItem[],
	{
		chunk: chunkOptions,
		prefix = true,
		embed,
		rerank,
		modes: requestedModes = ['dense', 'bm25', 'hybrid', 'rerank'],
		threshold = RERANK_SCORE_THRESHOLD,
		sweep = DEFAULT_SWEEP,
		rewrite,
		rerankQuery = 'original',
	}: RetrievalEvalOptions = {},
): Promise<RetrievalEvalResult> => {
	const chunks: EvalChunk[] = [];
	for (const [name, document] of documents) {
		for (const chunk of chunkDocument(document.text, document.segments, chunkOptions)) {
			chunks.push({
				id: `${name}#${chunk.ordinal}`,
				attachmentId: name,
				ordinal: chunk.ordinal,
				charStart: chunk.charStart,
				charEnd: chunk.charEnd,
				text: chunk.text,
				searchText: prefix ? buildEmbedText(name, chunk) : chunk.text,
			});
		}
	}
	const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
	const spanOf = (id: string): Span => {
		const chunk = byId.get(id)!;
		return { doc: chunk.attachmentId, charStart: chunk.charStart, charEnd: chunk.charEnd };
	};

	const skipped: string[] = [];
	const queries = resolved.map(({ item }) => buildRetrievalQuery(item.question, item.history));
	const rewritten: (string | undefined)[] = [];
	if (rewrite) {
		for (const query of queries) {
			const value = await rewrite(query);
			rewritten.push(value && value !== query ? value : undefined);
		}
	}
	let queryVectors: (Float32Array | undefined)[] = queries.map(() => undefined);
	let rewrittenVectors: (Float32Array | undefined)[] = queries.map(() => undefined);
	if (embed) {
		const chunkVectors = await embed(chunks.map(chunk => chunk.searchText!));
		chunks.forEach((chunk, i) => {
			chunk.vector = normalizeVector(chunkVectors[i]);
		});
		queryVectors = (await embed(queries)).map(vector => normalizeVector(vector));
		const extra = rewritten.filter((value): value is string => Boolean(value));
		if (extra.length) {
			const vectors = await embed(extra);
			let next = 0;
			rewrittenVectors = queries.map((_, index) =>
				rewritten[index] ? normalizeVector(vectors[next++]) : undefined,
			);
		}
	} else {
		skipped.push('未配置向量化 API Key：E1 / E3 已跳过，E4 的候选改用 BM25。');
	}
	if (!rerank) skipped.push('未配置重排序 API Key：E4 已跳过。');

	const modes = requestedModes.filter(
		mode => (mode !== 'dense' && mode !== 'hybrid') || embed,
	).filter(mode => mode !== 'rerank' || rerank);

	const retriever = createRetriever(chunks);
	/** 有改写时用原查询 + 改写查询做多查询检索，否则与应用的单查询检索一致。 */
	const searchQueries = (index: number) => [
		{ text: queries[index], vector: queryVectors[index] },
		...(rewritten[index]
			? [{ text: rewritten[index]!, vector: rewrittenVectors[index] }]
			: []),
	];
	const rerankText = (index: number) => {
		const extra = rewritten[index];
		if (!extra || rerankQuery === 'original') return queries[index];
		return rerankQuery === 'rewritten' ? extra : `${queries[index]}
${extra}`;
	};
	const toCandidate = (id: string, score: number): SelectionCandidate => {
		const chunk = byId.get(id)!;
		return {
			id,
			attachmentId: chunk.attachmentId,
			ordinal: chunk.ordinal,
			charStart: chunk.charStart,
			charEnd: chunk.charEnd,
			text: chunk.text,
			score,
		};
	};

	/** E4 每题的重排序结果，供阈值扫描复用。 */
	const reranked: SelectionCandidate[][] = [];
	if (rerank && modes.includes('rerank')) {
		for (const index of queries.keys()) {
			const hits = retriever.searchMany(searchQueries(index), {
				mode: embed ? 'hybrid' : 'bm25',
				limit: RERANK_CANDIDATES,
				candidates: 30,
			});
			const scores = hits.length
				? await rerank(rerankText(index), hits.map(hit => byId.get(hit.chunkId)!.searchText!))
				: [];
			reranked[index] = hits
				.map((hit, i) => toCandidate(hit.chunkId, scores[i]))
				.sort((a, b) => b.score - a.score);
		}
	}

	const injection = (candidates: SelectionCandidate[], spans: Span[], limit: number, τ?: number) => {
		const selection = selectPassages(candidates, {
			limit,
			budget: DEFAULT_PASSAGE_BUDGET,
			threshold: τ,
		});
		const covered = selection.passages.map(
			(passage): Span => ({
				doc: passage.attachmentId,
				charStart: passage.charStart,
				charEnd: passage.charEnd,
			}),
		);
		return {
			noAnswer: selection.noAnswer,
			full:
				spans.length && spans.every(span => covered.some(passage => spanHit(passage, span)))
					? 1
					: 0,
			chars: selection.passages.reduce((sum, passage) => sum + passage.text.length, 0),
		};
	};

	const results: ModeResult[] = modes.map(mode => {
		const rows: Row[] = resolved.map(({ item, spans }, index): Row => {
			let candidates: SelectionCandidate[];
			let τ: number | undefined;
			if (mode === 'rerank') {
				candidates = reranked[index];
				τ = threshold;
			} else {
				// 改写只作用于混合检索：E1 / E2 保持单查询，便于对照
				const hits: RetrievalHit[] =
					mode === 'hybrid'
						? retriever.searchMany(searchQueries(index), { mode, limit: 10, candidates: 30 })
						: retriever.search(queries[index], queryVectors[index], {
								mode,
								limit: 10,
								candidates: 30,
							});
				candidates = hits.map(hit => toCandidate(hit.chunkId, hit.score));
			}
			const injected = injection(candidates, spans, DEFAULT_PASSAGE_LIMIT, τ);
			if (!spans.length) {
				return { type: item.type, answerable: false, noAnswer: injected.noAnswer };
			}
			const ranked = candidates.slice(0, 10).map(candidate => spanOf(candidate.id));
			const recall5 = recallAtK(ranked, spans, 5);
			return {
				type: item.type,
				answerable: true,
				recall5,
				recall10: recallAtK(ranked, spans, 10),
				fullRecall5: recall5 === 1 ? 1 : 0,
				mrr: reciprocalRank(ranked, spans),
				ndcg10: ndcgAtK(ranked, spans, 10),
				injectedFull: injected.full,
				injectedChars: injected.chars,
				noAnswer: injected.noAnswer,
			};
		});
		const answerable = rows.filter(row => row.answerable);
		const unanswerable = rows.filter(row => !row.answerable);
		return {
			mode,
			label: MODE_LABELS[mode],
			recall5: mean(answerable.map(row => row.recall5)),
			recall10: mean(answerable.map(row => row.recall10)),
			fullRecall5: mean(answerable.map(row => row.fullRecall5)),
			mrr: mean(answerable.map(row => row.mrr)),
			ndcg10: mean(answerable.map(row => row.ndcg10)),
			injectedFull: mean(answerable.map(row => row.injectedFull)),
			injectedChars: mean(answerable.map(row => row.injectedChars)),
			...(mode === 'rerank'
				? {
						falseRefusal: mean(answerable.map(row => (row.noAnswer ? 1 : 0))),
						refusal: mean(unanswerable.map(row => (row.noAnswer ? 1 : 0))),
					}
				: {}),
			byType: [...groupBy(answerable, row => row.type)].map(([type, group]) => ({
				type,
				count: group.length,
				recall5: mean(group.map(row => row.recall5)),
				fullRecall5: mean(group.map(row => row.fullRecall5)),
				injectedFull: mean(group.map(row => row.injectedFull)),
			})),
		};
	});

	let thresholdSweep: ThresholdRow[] | undefined;
	let scoreSamples: ScoreSample[] | undefined;
	if (reranked.length) {
		thresholdSweep = sweep.map(τ => {
			const outcomes = resolved.map(({ spans }, index) => ({
				answerable: spans.length > 0,
				...injection(reranked[index], spans, DEFAULT_PASSAGE_LIMIT, τ),
			}));
			const answerable = outcomes.filter(outcome => outcome.answerable);
			return {
				threshold: τ,
				refusal: mean(
					outcomes.filter(outcome => !outcome.answerable).map(outcome => (outcome.noAnswer ? 1 : 0)),
				),
				falseRefusal: mean(answerable.map(outcome => (outcome.noAnswer ? 1 : 0))),
				injectedFull: mean(answerable.map(outcome => outcome.full)),
			};
		});
		scoreSamples = resolved.map(({ item, spans }, index) => {
			const ranked = reranked[index];
			const rank = ranked.findIndex(candidate =>
				spans.some(span => spanHit(spanOf(candidate.id), span)),
			);
			return {
				id: item.id,
				type: item.type,
				question: item.question,
				topScore: ranked[0]?.score ?? 0,
				...(rank >= 0 ? { evidenceRank: rank + 1 } : {}),
			};
		});
	}

	return { chunkCount: chunks.length, modes: results, thresholdSweep, scoreSamples, skipped };
};
