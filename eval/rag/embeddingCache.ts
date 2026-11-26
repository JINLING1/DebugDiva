/**
 * 评测用 embedding 缓存：按“模型 + 文本 SHA-256”落盘，重复运行不再调用 API。
 * 向量以 base64 编码的 Float32Array 存储。缓存目录已 gitignore。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	requestEmbeddings,
	type EmbeddingProviderConfig,
} from '../../functions/_shared/ragUpstream';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

const encode = (vector: ArrayLike<number>) =>
	Buffer.from(Float32Array.from(vector).buffer).toString('base64');

const decode = (value: string) => {
	const bytes = Buffer.from(value, 'base64');
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
};

export interface CachedEmbedder {
	embed(texts: readonly string[]): Promise<Float32Array[]>;
	/** 本次运行实际请求 API 的条数。 */
	readonly requested: number;
	save(): Promise<void>;
}

export const createCachedEmbedder = async (
	config: EmbeddingProviderConfig,
	cachePath: string,
	batchSize = 32,
): Promise<CachedEmbedder> => {
	const cache: Record<string, string> = existsSync(cachePath)
		? JSON.parse(await readFile(cachePath, 'utf8'))
		: {};
	let requested = 0;

	return {
		get requested() {
			return requested;
		},
		async embed(texts) {
			const keys = texts.map(text => `${config.model}:${hash(text)}`);
			const missing = [...new Set(texts.filter((_, i) => !cache[keys[i]]))];
			for (let start = 0; start < missing.length; start += batchSize) {
				const batch = missing.slice(start, start + batchSize);
				const vectors = await requestEmbeddings(
					config,
					batch,
					AbortSignal.timeout(60_000),
				);
				batch.forEach((text, i) => {
					cache[`${config.model}:${hash(text)}`] = encode(vectors[i]);
				});
				requested += batch.length;
				process.stdout.write(`\r向量化 ${Math.min(start + batchSize, missing.length)}/${missing.length}`);
			}
			if (missing.length) process.stdout.write('\n');
			return keys.map(key => decode(cache[key]));
		},
		async save() {
			await mkdir(dirname(cachePath), { recursive: true });
			await writeFile(cachePath, JSON.stringify(cache), 'utf8');
		},
	};
};
