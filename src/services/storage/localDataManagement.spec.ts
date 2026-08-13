import { describe, expect, it, vi } from 'vitest';
import {
	clearAllDebugDivaLocalData,
	DEBUG_DIVA_LOCAL_DATA_KEYS,
} from './localDataManagement';

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

	it('removes every known DebugDiva key without clearing the origin', () => {
		const values = new Map<string, string>([
			...DEBUG_DIVA_LOCAL_DATA_KEYS.map(
				key => [key, `value:${key}`] as const,
			),
			['portfolio:unrelated', 'keep-me'],
		]);
		const clear = vi.fn();
		const removeItem = vi.fn((key: string) => values.delete(key));
		const storage = { removeItem, clear };

		const result = clearAllDebugDivaLocalData(storage);

		expect(result).toEqual({
			ok: true,
			attempted: DEBUG_DIVA_LOCAL_DATA_KEYS.length,
			removedKeys: [...DEBUG_DIVA_LOCAL_DATA_KEYS],
			failed: [],
		});
		expect(removeItem.mock.calls.map(([key]) => key)).toEqual([
			...DEBUG_DIVA_LOCAL_DATA_KEYS,
		]);
		expect(clear).not.toHaveBeenCalled();
		expect(values.get('portfolio:unrelated')).toBe('keep-me');
	});

	it('continues after individual failures and reports partial details', () => {
		const failedKeys = new Set([
			'debugdiva:summaries:v1',
			'theme',
		]);
		const removeItem = vi.fn((key: string) => {
			if (failedKeys.has(key)) throw new Error(`blocked:${key}`);
		});

		const result = clearAllDebugDivaLocalData({ removeItem });

		expect(result.ok).toBe(false);
		expect(result.attempted).toBe(DEBUG_DIVA_LOCAL_DATA_KEYS.length);
		expect(result.removedKeys).toHaveLength(
			DEBUG_DIVA_LOCAL_DATA_KEYS.length - failedKeys.size,
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

	it('uses a safe error description for non-Error browser exceptions', () => {
		const result = clearAllDebugDivaLocalData({
			removeItem: () => {
				throw 'denied';
			},
		});

		expect(result.failed[0]?.error).toBe('浏览器拒绝删除该本地数据');
	});
});
