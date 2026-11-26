import { tokenize } from './tokenizer';

export interface Bm25Options {
	k1?: number;
	b?: number;
}

export interface ScoredId {
	id: string;
	score: number;
}

interface IndexedDocument {
	id: string;
	length: number;
	termFrequency: Map<string, number>;
}

export interface Bm25Index {
	readonly size: number;
	search(query: string, limit: number): ScoredId[];
}

/** 构建内存 BM25 索引。几千个 chunk 的规模下构建耗时在毫秒级，不需要持久化倒排表。 */
export const createBm25Index = (
	items: readonly { id: string; text: string }[],
	{ k1 = 1.2, b = 0.75 }: Bm25Options = {},
): Bm25Index => {
	const documents: IndexedDocument[] = [];
	const documentFrequency = new Map<string, number>();
	let totalLength = 0;

	for (const item of items) {
		const tokens = tokenize(item.text);
		const termFrequency = new Map<string, number>();
		for (const token of tokens) {
			termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
		}
		for (const term of termFrequency.keys()) {
			documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
		}
		documents.push({ id: item.id, length: tokens.length, termFrequency });
		totalLength += tokens.length;
	}

	const count = documents.length;
	const averageLength = count ? totalLength / count : 0;
	// BM25+ 风格的 IDF 下限为正，避免高频词出现负分。
	const idf = (term: string) => {
		const df = documentFrequency.get(term) ?? 0;
		return Math.log(1 + (count - df + 0.5) / (df + 0.5));
	};

	return {
		size: count,
		search(query, limit) {
			const terms = [...new Set(tokenize(query))].filter(term =>
				documentFrequency.has(term),
			);
			if (!terms.length || !count) return [];
			const weights = terms.map(term => [term, idf(term)] as const);

			const scored: ScoredId[] = [];
			for (const document of documents) {
				let score = 0;
				for (const [term, weight] of weights) {
					const tf = document.termFrequency.get(term);
					if (!tf) continue;
					const norm = k1 * (1 - b + (b * document.length) / (averageLength || 1));
					score += (weight * tf * (k1 + 1)) / (tf + norm);
				}
				if (score > 0) scored.push({ id: document.id, score });
			}
			return scored.sort((a, b) => b.score - a.score).slice(0, limit);
		},
	};
};
