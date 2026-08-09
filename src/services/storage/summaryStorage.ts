import type { ConversationSummary } from '../../types/chat';

export const CONVERSATION_SUMMARIES_STORAGE_KEY =
	'debugdiva:summaries:v1';
export const MAX_SUMMARY_ITEMS_PER_CATEGORY = 20;
export const MAX_SUMMARY_ITEM_CHARACTERS = 400;
export const MAX_SUMMARY_TOTAL_CHARACTERS = 16_000;
export const MAX_SUMMARY_MESSAGE_ID_CHARACTERS = 128;
export const MAX_SUMMARY_SESSION_ID_CHARACTERS = 200;
export const MAX_CONVERSATION_SUMMARIES = 500;
export const MAX_SUMMARY_STORAGE_BYTES = 512 * 1024;

const SUMMARY_FIELDS = [
	'userGoals',
	'confirmedFacts',
	'decisions',
	'unresolvedQuestions',
] as const;

type SummaryListField = (typeof SUMMARY_FIELDS)[number];

export type ConversationSummaryMap = Record<string, ConversationSummary>;

export interface SummaryStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface LoadConversationSummariesResult {
	summaries: ConversationSummaryMap;
	recoveredFromError: boolean;
	errorCode?: string;
	error?: string;
}

export interface SaveConversationSummariesResult {
	ok: boolean;
	entries: number;
	errorCode?: string;
	error?: string;
}

export interface UpdateConversationSummariesResult
	extends SaveConversationSummariesResult {
	changed: number;
}

interface PersistedSummaryEntry {
	sessionId: string;
	summary: ConversationSummary;
}

interface PersistedSummaryEnvelope {
	version: 1;
	entries: PersistedSummaryEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const unicodeLength = (value: string): number => Array.from(value).length;
const byteLength = (value: string): number =>
	new TextEncoder().encode(value).byteLength;

const isQuotaError = (error: unknown): boolean => {
	if (!isRecord(error) && !(error instanceof Error)) return false;
	const name = 'name' in error ? String(error.name) : '';
	const message = 'message' in error ? String(error.message) : '';
	return (
		name === 'QuotaExceededError' ||
		name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		/quota/i.test(message)
	);
};

const normalizeSummaryList = (value: unknown): string[] | null => {
	if (!Array.isArray(value) || value.length > MAX_SUMMARY_ITEMS_PER_CATEGORY) {
		return null;
	}

	const result: string[] = [];
	for (const item of value) {
		if (
			typeof item !== 'string' ||
			item.trim().length === 0 ||
			unicodeLength(item) > MAX_SUMMARY_ITEM_CHARACTERS
		) {
			return null;
		}
		result.push(item);
	}
	return result;
};

/**
 * Rebuild a summary from an explicit field allowlist. Message bodies,
 * attachments and accidental runtime fields can therefore never be persisted.
 */
export const normalizeConversationSummary = (
	value: unknown,
): ConversationSummary | null => {
	if (!isRecord(value)) return null;
	if (
		typeof value.coveredUntilMessageId !== 'string' ||
		value.coveredUntilMessageId.trim().length === 0 ||
		unicodeLength(value.coveredUntilMessageId) >
			MAX_SUMMARY_MESSAGE_ID_CHARACTERS ||
		typeof value.updatedAt !== 'number' ||
		!Number.isSafeInteger(value.updatedAt) ||
		value.updatedAt <= 0
	) {
		return null;
	}

	const lists = {} as Record<SummaryListField, string[]>;
	let totalCharacters = 0;
	for (const field of SUMMARY_FIELDS) {
		const list = normalizeSummaryList(value[field]);
		if (!list) return null;
		for (const item of list) totalCharacters += unicodeLength(item);
		if (totalCharacters > MAX_SUMMARY_TOTAL_CHARACTERS) return null;
		lists[field] = list;
	}

	return {
		userGoals: lists.userGoals,
		confirmedFacts: lists.confirmedFacts,
		decisions: lists.decisions,
		unresolvedQuestions: lists.unresolvedQuestions,
		coveredUntilMessageId: value.coveredUntilMessageId,
		updatedAt: value.updatedAt,
	};
};

const normalizeEntry = (value: unknown): PersistedSummaryEntry | null => {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== 'string' ||
		value.sessionId.trim().length === 0 ||
		unicodeLength(value.sessionId) > MAX_SUMMARY_SESSION_ID_CHARACTERS
	) {
		return null;
	}
	const summary = normalizeConversationSummary(value.summary);
	return summary ? { sessionId: value.sessionId, summary } : null;
};

const emptySummaryMap = (): ConversationSummaryMap =>
	Object.fromEntries([]) as ConversationSummaryMap;

export const loadConversationSummaries = (
	storage: SummaryStorageLike,
): LoadConversationSummariesResult => {
	let raw: string | null;
	try {
		raw = storage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY);
	} catch (error) {
		return {
			summaries: emptySummaryMap(),
			recoveredFromError: true,
			errorCode: 'SUMMARY_STORAGE_READ_FAILED',
			error:
				error instanceof Error ? error.message : '会话摘要读取失败',
		};
	}

	if (raw === null) {
		return { summaries: emptySummaryMap(), recoveredFromError: false };
	}
	if (byteLength(raw) > MAX_SUMMARY_STORAGE_BYTES) {
		return {
			summaries: emptySummaryMap(),
			recoveredFromError: true,
			errorCode: 'SUMMARY_STORAGE_TOO_LARGE',
			error: '会话摘要超过安全读取上限',
		};
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			!isRecord(parsed) ||
			parsed.version !== 1 ||
			!Array.isArray(parsed.entries)
		) {
			throw new Error('会话摘要存储格式无效');
		}

		const summaries = new Map<string, ConversationSummary>();
		let skipped = 0;
		for (const value of parsed.entries.slice(0, MAX_CONVERSATION_SUMMARIES)) {
			const entry = normalizeEntry(value);
			if (!entry) {
				skipped += 1;
				continue;
			}
			// Iteration order makes the last valid duplicate authoritative.
			summaries.set(entry.sessionId, entry.summary);
		}
		skipped += Math.max(0, parsed.entries.length - MAX_CONVERSATION_SUMMARIES);

		return {
			summaries: Object.fromEntries(summaries),
			recoveredFromError: skipped > 0,
			errorCode: skipped > 0 ? 'INVALID_SUMMARY_DATA' : undefined,
			error:
				skipped > 0 ? `已忽略 ${skipped} 条无效会话摘要` : undefined,
		};
	} catch (error) {
		return {
			summaries: emptySummaryMap(),
			recoveredFromError: true,
			errorCode: 'SUMMARY_STORAGE_CORRUPTED',
			error:
				error instanceof Error ? error.message : '会话摘要解析失败',
		};
	}
};

export const saveConversationSummaries = (
	storage: SummaryStorageLike,
	summaries: Readonly<ConversationSummaryMap>,
): SaveConversationSummariesResult => {
	if (Object.keys(summaries).length > MAX_CONVERSATION_SUMMARIES) {
		return {
			ok: false,
			entries: 0,
			errorCode: 'TOO_MANY_CONVERSATION_SUMMARIES',
			error: `会话摘要不能超过 ${MAX_CONVERSATION_SUMMARIES} 条`,
		};
	}
	const entries: PersistedSummaryEntry[] = [];
	for (const [sessionId, value] of Object.entries(summaries)) {
		if (
			sessionId.trim().length === 0 ||
			unicodeLength(sessionId) > MAX_SUMMARY_SESSION_ID_CHARACTERS
		) {
			return {
				ok: false,
				entries: 0,
				errorCode: 'INVALID_SUMMARY_DATA',
				error: '会话摘要的 sessionId 不能为空',
			};
		}
		const summary = normalizeConversationSummary(value);
		if (!summary) {
			return {
				ok: false,
				entries: 0,
				errorCode: 'INVALID_SUMMARY_DATA',
				error: `会话 ${sessionId} 的摘要格式无效或超出限制`,
			};
		}
		entries.push({ sessionId, summary });
	}

	const envelope: PersistedSummaryEnvelope = { version: 1, entries };
	const serialized = JSON.stringify(envelope);
	if (byteLength(serialized) > MAX_SUMMARY_STORAGE_BYTES) {
		return {
			ok: false,
			entries: entries.length,
			errorCode: 'SUMMARY_STORAGE_TOO_LARGE',
			error: '会话摘要超过安全存储上限',
		};
	}
	try {
		storage.setItem(
			CONVERSATION_SUMMARIES_STORAGE_KEY,
			serialized,
		);
		return { ok: true, entries: entries.length };
	} catch (error) {
		return {
			ok: false,
			entries: entries.length,
			errorCode: isQuotaError(error)
				? 'SUMMARY_STORAGE_QUOTA_EXCEEDED'
				: 'SUMMARY_STORAGE_WRITE_FAILED',
			error:
				error instanceof Error ? error.message : '会话摘要保存失败',
		};
	}
};

const loadForUpdate = (
	storage: SummaryStorageLike,
):
	| { summaries: ConversationSummaryMap }
	| { result: UpdateConversationSummariesResult } => {
	const loaded = loadConversationSummaries(storage);
	if (
		loaded.errorCode === 'SUMMARY_STORAGE_READ_FAILED' ||
		loaded.errorCode === 'SUMMARY_STORAGE_CORRUPTED' ||
		loaded.errorCode === 'SUMMARY_STORAGE_TOO_LARGE'
	) {
		return {
			result: {
				ok: false,
				entries: 0,
				changed: 0,
				errorCode: loaded.errorCode,
				error: loaded.error,
			},
		};
	}
	return { summaries: loaded.summaries };
};

export const removeConversationSummary = (
	storage: SummaryStorageLike,
	sessionId: string,
): UpdateConversationSummariesResult => {
	if (sessionId.trim().length === 0) {
		return {
			ok: false,
			entries: 0,
			changed: 0,
			errorCode: 'INVALID_SUMMARY_SESSION_ID',
			error: 'sessionId 不能为空',
		};
	}

	const loaded = loadForUpdate(storage);
	if ('result' in loaded) return loaded.result;
	if (!Object.prototype.hasOwnProperty.call(loaded.summaries, sessionId)) {
		return {
			ok: true,
			entries: Object.keys(loaded.summaries).length,
			changed: 0,
		};
	}

	delete loaded.summaries[sessionId];
	return {
		...saveConversationSummaries(storage, loaded.summaries),
		changed: 1,
	};
};

/** Keep summaries only for sessions that still exist, removing orphaned data. */
export const retainConversationSummaries = (
	storage: SummaryStorageLike,
	sessionIds: readonly string[],
): UpdateConversationSummariesResult => {
	if (sessionIds.some(sessionId => typeof sessionId !== 'string')) {
		return {
			ok: false,
			entries: 0,
			changed: 0,
			errorCode: 'INVALID_SUMMARY_SESSION_ID',
			error: '会话 ID 列表格式无效',
		};
	}

	const loaded = loadForUpdate(storage);
	if ('result' in loaded) return loaded.result;
	const retainedIds = new Set(sessionIds);
	let changed = 0;
	for (const sessionId of Object.keys(loaded.summaries)) {
		if (!retainedIds.has(sessionId)) {
			delete loaded.summaries[sessionId];
			changed += 1;
		}
	}

	if (changed === 0) {
		return {
			ok: true,
			entries: Object.keys(loaded.summaries).length,
			changed: 0,
		};
	}

	return {
		...saveConversationSummaries(storage, loaded.summaries),
		changed,
	};
};
