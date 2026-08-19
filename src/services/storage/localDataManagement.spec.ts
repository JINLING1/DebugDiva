import { describe, expect, it, vi } from 'vitest';
import {
	clearAllDebugDivaLocalData,
	DEBUG_DIVA_LOCAL_DATA_KEYS,
	IMAGE_BLOB_LOCAL_DATA_KEY,
} from './localDataManagement';
import type { ImageBlobRepository } from './imageBlobStorage';

const imageRepository = (clear = vi.fn()): ImageBlobRepository => ({
	put: vi.fn(),
	get: vi.fn(),
	getMany: vi.fn(async () => []),
	delete: vi.fn(),
	retain: vi.fn(async () => []),
	clear,
	close: vi.fn(),
});

describe('local data management', () => {
	it('owns the complete local data key allowlist', () => {
		expect(DEBUG_DIVA_LOCAL_DATA_KEYS).toEqual([
			'debugdiva:sessions:v2',
			'debugdiva:settings:v1',
			'debugdiva:attachment-results:v1',
			'debugdiva:summaries:v1',
			'debugdiva:client-id:v1',
			'theme',
		]);
	});

	it('removes every known DebugDiva key and IndexedDB image without clearing the origin', async () => {
		const values = new Map<string, string>([
			...DEBUG_DIVA_LOCAL_DATA_KEYS.map(
				key => [key, `value:${key}`] as const,
			),
			['portfolio:unrelated', 'keep-me'],
		]);
		const clear = vi.fn();
		const removeItem = vi.fn((key: string) => values.delete(key));
		const storage = { removeItem, clear };

		const repository = imageRepository();
		const result = await clearAllDebugDivaLocalData(storage, repository);

		expect(result).toEqual({
			ok: true,
			attempted: DEBUG_DIVA_LOCAL_DATA_KEYS.length + 1,
			removedKeys: [...DEBUG_DIVA_LOCAL_DATA_KEYS, IMAGE_BLOB_LOCAL_DATA_KEY],
			failed: [],
		});
		expect(removeItem.mock.calls.map(([key]) => key)).toEqual([
			...DEBUG_DIVA_LOCAL_DATA_KEYS,
		]);
		expect(clear).not.toHaveBeenCalled();
		expect(repository.clear).toHaveBeenCalledTimes(1);
		expect(values.get('portfolio:unrelated')).toBe('keep-me');
	});

	it('continues after individual failures and reports partial details', async () => {
		const failedKeys = new Set([
			'debugdiva:summaries:v1',
			'theme',
		]);
		const removeItem = vi.fn((key: string) => {
			if (failedKeys.has(key)) throw new Error(`blocked:${key}`);
		});

		const result = await clearAllDebugDivaLocalData(
			{ removeItem },
			imageRepository(),
		);

		expect(result.ok).toBe(false);
		expect(result.attempted).toBe(DEBUG_DIVA_LOCAL_DATA_KEYS.length + 1);
		expect(result.removedKeys).toHaveLength(
			DEBUG_DIVA_LOCAL_DATA_KEYS.length - failedKeys.size + 1,
		);
		expect(result.failed).toEqual([
			{
				key: 'debugdiva:summaries:v1',
				error: 'blocked:debugdiva:summaries:v1',
			},
			{ key: 'theme', error: 'blocked:theme' },
		]);
		expect(removeItem).toHaveBeenCalledTimes(DEBUG_DIVA_LOCAL_DATA_KEYS.length);
	});

	it('uses a safe error description for non-Error browser exceptions', async () => {
		const result = await clearAllDebugDivaLocalData(
			{
				removeItem: () => {
					throw 'denied';
				},
			},
			imageRepository(),
		);

		expect(result.failed[0]?.error).toBe('浏览器拒绝删除该本地数据');
	});

	it('reports an IndexedDB clear failure after removing localStorage keys', async () => {
		const clear = vi.fn().mockRejectedValue(new Error('idb blocked'));
		const result = await clearAllDebugDivaLocalData(
			{ removeItem: vi.fn() },
			imageRepository(clear),
		);

		expect(result.ok).toBe(false);
		expect(result.failed).toContainEqual({
			key: IMAGE_BLOB_LOCAL_DATA_KEY,
			error: 'idb blocked',
		});
	});
});
