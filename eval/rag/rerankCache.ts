/**
 * 评测用 rerank 缓存：cross-encoder 对每个 (query, document) 独立打分，
 * 因此可以按“模型 + query + document 的 SHA-256”逐对缓存，重复运行不再调用 API。
 * 同时记录未命中缓存的请求耗时，用于报告延迟。缓存目录已 gitignore。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	requestRerank,
	type RerankProviderConfig,
} from '../../functions/_shared/ragUpstream';

const pairKey = (model: string, query: string, document: string) =>
	`${model}:${createHash('sha256').update(query).update('\u0000').update(document).digest('hex')}`;

export interface CachedReranker {
	readonly model: string;
	/** 返回与 documents 对齐的分数。 */
	rerank(query: string, documents: readonly string[]): Promise<number[]>;
	/** 本次运行实际调用 API 的次数与耗时（毫秒）。 */
	readonly latenciesMs: readonly number[];
	save(): Promise<void>;
}

export const createCachedReranker = async (
	config: RerankProviderConfig,
	cachePath: string,
): Promise<CachedReranker> => {
	const cache: Record<string, number> = existsSync(cachePath)
		? JSON.parse(await readFile(cachePath, 'utf8'))
		: {};
	const latenciesMs: number[] = [];

	return {
		model: config.model,
		latenciesMs,
		async rerank(query, documents) {
			const keys = documents.map(document => pairKey(config.model, query, document));
			const missing = [...new Set(documents.filter((_, i) => cache[keys[i]] === undefined))];
			if (missing.length) {
				const started = performance.now();
				const scores = await requestRerank(config, query, missing, AbortSignal.timeout(60_000));
				latenciesMs.push(performance.now() - started);
				for (const { index, score } of scores) {
					cache[pairKey(config.model, query, missing[index])] = score;
				}
			}
			return keys.map(key => cache[key]);
		},
		async save() {
			await mkdir(dirname(cachePath), { recursive: true });
			await writeFile(cachePath, JSON.stringify(cache), 'utf8');
		},
	};
};
