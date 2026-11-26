/**
 * 评测用查询改写缓存：按“模型 + 提示词 + 查询”的 SHA-256 缓存改写结果（temperature = 0）。
 * 修改提示词会自动失效。同时记录未命中缓存的请求耗时。缓存目录已 gitignore。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	REWRITE_SYSTEM_PROMPT,
	requestRewrite,
	type RewriteProviderConfig,
} from '../../functions/_shared/ragUpstream';

export interface CachedRewriter {
	readonly model: string;
	rewrite(query: string): Promise<string>;
	readonly latenciesMs: readonly number[];
	/** 改写失败的次数（失败时返回原查询，与应用的降级行为一致）。 */
	readonly failures: number;
	save(): Promise<void>;
}

export const createCachedRewriter = async (
	config: RewriteProviderConfig,
	cachePath: string,
): Promise<CachedRewriter> => {
	const cache: Record<string, string> = existsSync(cachePath)
		? JSON.parse(await readFile(cachePath, 'utf8'))
		: {};
	const latenciesMs: number[] = [];
	let failures = 0;
	const keyOf = (query: string) =>
		`${config.model}:${createHash('sha256')
			.update(REWRITE_SYSTEM_PROMPT)
			.update('\u0000')
			.update(query)
			.digest('hex')}`;

	return {
		model: config.model,
		latenciesMs,
		get failures() {
			return failures;
		},
		async rewrite(query) {
			const key = keyOf(query);
			if (cache[key] !== undefined) return cache[key];
			const started = performance.now();
			try {
				const rewritten = await requestRewrite(config, query, AbortSignal.timeout(30_000));
				latenciesMs.push(performance.now() - started);
				cache[key] = rewritten;
				return rewritten;
			} catch {
				failures += 1;
				return query;
			}
		},
		async save() {
			await mkdir(dirname(cachePath), { recursive: true });
			await writeFile(cachePath, JSON.stringify(cache), 'utf8');
		},
	};
};
