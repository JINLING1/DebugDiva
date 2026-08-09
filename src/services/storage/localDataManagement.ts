import { ATTACHMENT_RESULTS_STORAGE_KEY } from './attachmentStorage';
import {
	CHAT_SESSIONS_STORAGE_KEY,
	LEGACY_CHAT_SESSIONS_STORAGE_KEY,
	MIGRATION_BACKUP_STORAGE_KEY,
} from './chatStorage';
import { CONVERSATION_SUMMARIES_STORAGE_KEY } from './summaryStorage';
import { SETTINGS_STORAGE_KEY } from '../../store/settings';

export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const LEGACY_CLIENT_ID_STORAGE_KEY = 'debugdiva:client-id:v1';

export const DEBUG_DIVA_LOCAL_DATA_KEYS = [
	CHAT_SESSIONS_STORAGE_KEY,
	SETTINGS_STORAGE_KEY,
	ATTACHMENT_RESULTS_STORAGE_KEY,
	CONVERSATION_SUMMARIES_STORAGE_KEY,
	MIGRATION_BACKUP_STORAGE_KEY,
	LEGACY_CLIENT_ID_STORAGE_KEY,
	LEGACY_CHAT_SESSIONS_STORAGE_KEY,
	LEGACY_THEME_STORAGE_KEY,
] as const;

export interface LocalDataStorageLike {
	removeItem(key: string): void;
}

export interface LocalDataRemovalFailure {
	key: string;
	error: string;
}

export interface ClearAllLocalDataResult {
	ok: boolean;
	attempted: number;
	removedKeys: string[];
	failed: LocalDataRemovalFailure[];
}

const errorMessage = (error: unknown): string =>
	error instanceof Error && error.message.trim()
		? error.message
		: '浏览器拒绝删除该本地数据';

/**
 * Remove only storage owned by DebugDiva. This deliberately never calls
 * `Storage.clear()`, so unrelated data sharing the same origin is preserved.
 */
export const clearAllDebugDivaLocalData = (
	storage: LocalDataStorageLike,
): ClearAllLocalDataResult => {
	const removedKeys: string[] = [];
	const failed: LocalDataRemovalFailure[] = [];

	for (const key of DEBUG_DIVA_LOCAL_DATA_KEYS) {
		try {
			storage.removeItem(key);
			removedKeys.push(key);
		} catch (error) {
			failed.push({ key, error: errorMessage(error) });
		}
	}

	return {
		ok: failed.length === 0,
		attempted: DEBUG_DIVA_LOCAL_DATA_KEYS.length,
		removedKeys,
		failed,
	};
};
