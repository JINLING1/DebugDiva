import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '../../types/chat';
import {
	CONVERSATION_SUMMARIES_STORAGE_KEY,
	loadConversationSummaries,
	MAX_SUMMARY_ITEM_CHARACTERS,
	MAX_SUMMARY_ITEMS_PER_CATEGORY,
	MAX_SUMMARY_MESSAGE_ID_CHARACTERS,
	removeConversationSummary,
	retainConversationSummaries,
	saveConversationSummaries,
	type SummaryStorageLike,
} from './summaryStorage';

class MemoryStorage implements SummaryStorageLike {
	readonly values = new Map<string, string>();
	failRead = false;
	failWrite?: Error;

	getItem(key: string) {
		if (this.failRead) throw new Error('storage unavailable');
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		if (this.failWrite) throw this.failWrite;
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

const summary = (
	overrides: Partial<ConversationSummary> = {},
): ConversationSummary => ({
	userGoals: ['完成一个对话组件库'],
	confirmedFacts: ['项目使用 Vue 3'],
	decisions: ['摘要保存在浏览器本地'],
	unresolvedQuestions: [],
	coveredUntilMessageId: 'message-20',
	updatedAt: 1_000,
	...overrides,
});

describe('conversation summary storage', () => {
	it('round-trips a versioned envelope using only allowed fields', () => {
		const storage = new MemoryStorage();
		const unsafe = {
			...summary(),
			messageBody: 'must not persist',
			attachment: 'data:image/png;base64,secret',
		} as ConversationSummary;

		expect(saveConversationSummaries(storage, { 'session-1': unsafe })).toEqual({
			ok: true,
			entries: 1,
		});
		const raw = storage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY) || '';
		expect(JSON.parse(raw)).toEqual({
			version: 1,
			entries: [{ sessionId: 'session-1', summary: summary() }],
		});
		expect(raw).not.toContain('messageBody');
		expect(raw).not.toContain('attachment');
		expect(raw).not.toContain('base64');
		expect(loadConversationSummaries(storage)).toEqual({
			summaries: { 'session-1': summary() },
			recoveredFromError: false,
		});
	});

	it('keeps the last valid entry when session IDs are duplicated', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			CONVERSATION_SUMMARIES_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				entries: [
					{ sessionId: 'session-1', summary: summary({ updatedAt: 1 }) },
					{ sessionId: 'session-1', summary: { updatedAt: -1 } },
					{ sessionId: 'session-1', summary: summary({ updatedAt: 3 }) },
				],
			}),
		);

		const result = loadConversationSummaries(storage);
		expect(result.summaries['session-1'].updatedAt).toBe(3);
		expect(result).toMatchObject({
			recoveredFromError: true,
			errorCode: 'INVALID_SUMMARY_DATA',
		});
	});

	it('returns an empty structured recovery result for corrupt JSON and preserves it', () => {
		const storage = new MemoryStorage();
		storage.setItem(CONVERSATION_SUMMARIES_STORAGE_KEY, '{broken');

		expect(loadConversationSummaries(storage)).toMatchObject({
			summaries: {},
			recoveredFromError: true,
			errorCode: 'SUMMARY_STORAGE_CORRUPTED',
		});
		expect(storage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe('{broken');
		expect(removeConversationSummary(storage, 'session-1')).toMatchObject({
			ok: false,
			errorCode: 'SUMMARY_STORAGE_CORRUPTED',
		});
		expect(storage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe('{broken');
	});

	it('reports storage read, write and quota failures', () => {
		const readStorage = new MemoryStorage();
		readStorage.failRead = true;
		expect(loadConversationSummaries(readStorage)).toMatchObject({
			summaries: {},
			recoveredFromError: true,
			errorCode: 'SUMMARY_STORAGE_READ_FAILED',
		});

		const writeStorage = new MemoryStorage();
		writeStorage.setItem(CONVERSATION_SUMMARIES_STORAGE_KEY, 'old-write-value');
		writeStorage.failWrite = new Error('disk unavailable');
		expect(
			saveConversationSummaries(writeStorage, { 'session-1': summary() }),
		).toMatchObject({ ok: false, errorCode: 'SUMMARY_STORAGE_WRITE_FAILED' });
		expect(writeStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe(
			'old-write-value',
		);

		const quotaStorage = new MemoryStorage();
		quotaStorage.setItem(CONVERSATION_SUMMARIES_STORAGE_KEY, 'old-quota-value');
		const quotaError = new Error('Quota exceeded');
		quotaError.name = 'QuotaExceededError';
		quotaStorage.failWrite = quotaError;
		expect(
			saveConversationSummaries(quotaStorage, { 'session-1': summary() }),
		).toMatchObject({
			ok: false,
			errorCode: 'SUMMARY_STORAGE_QUOTA_EXCEEDED',
		});
		expect(quotaStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe(
			'old-quota-value',
		);
	});

	it('rejects empty IDs, invalid timestamps and overlong categories', () => {
		const storage = new MemoryStorage();
		storage.setItem(CONVERSATION_SUMMARIES_STORAGE_KEY, 'original');

		for (const invalid of [
			summary({ coveredUntilMessageId: ' ' }),
			summary({
				coveredUntilMessageId: 'm'.repeat(
					MAX_SUMMARY_MESSAGE_ID_CHARACTERS + 1,
				),
			}),
			summary({ updatedAt: 0 }),
			summary({ updatedAt: 1.5 }),
			summary({ decisions: ['   '] }),
			summary({ userGoals: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY + 1).fill('x') }),
			summary({ decisions: ['x'.repeat(MAX_SUMMARY_ITEM_CHARACTERS + 1)] }),
		]) {
			expect(
				saveConversationSummaries(storage, { 'session-1': invalid }),
			).toMatchObject({ ok: false, errorCode: 'INVALID_SUMMARY_DATA' });
			expect(storage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe(
				'original',
			);
		}

		expect(saveConversationSummaries(storage, { '': summary() })).toMatchObject({
			ok: false,
			errorCode: 'INVALID_SUMMARY_DATA',
		});
	});

	it('enforces the 16,000-character aggregate summary limit', () => {
		const storage = new MemoryStorage();
		const maximum = Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill('x'.repeat(200));
		expect(
			saveConversationSummaries(storage, {
				'session-1': summary({
					userGoals: maximum,
					confirmedFacts: maximum,
					decisions: maximum,
					unresolvedQuestions: maximum,
				}),
			}),
		).toMatchObject({ ok: true });

		expect(
			saveConversationSummaries(storage, {
				'session-1': summary({
					userGoals: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill(
						'x'.repeat(400),
					),
					confirmedFacts: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill(
						'x'.repeat(400),
					),
					decisions: ['x'],
				}),
			}),
		).toMatchObject({ ok: false, errorCode: 'INVALID_SUMMARY_DATA' });
	});

	it('counts Unicode code points without splitting emoji', () => {
		const storage = new MemoryStorage();
		const exactlyAtLimit = '🙂'.repeat(MAX_SUMMARY_ITEM_CHARACTERS);

		expect(
			saveConversationSummaries(storage, {
				'session-emoji': summary({ decisions: [exactlyAtLimit] }),
			}),
		).toMatchObject({ ok: true });
		expect(
			saveConversationSummaries(storage, {
				'session-emoji': summary({ decisions: [`${exactlyAtLimit}🙂`] }),
			}),
		).toMatchObject({ ok: false, errorCode: 'INVALID_SUMMARY_DATA' });
	});

	it('removes one summary without touching the others', () => {
		const storage = new MemoryStorage();
		saveConversationSummaries(storage, {
			'session-1': summary({ updatedAt: 1 }),
			'session-2': summary({ updatedAt: 2 }),
		});

		expect(removeConversationSummary(storage, 'session-1')).toEqual({
			ok: true,
			entries: 1,
			changed: 1,
		});
		expect(loadConversationSummaries(storage).summaries).toEqual({
			'session-2': summary({ updatedAt: 2 }),
		});
	});

	it('cleans orphaned summaries while retaining current sessions', () => {
		const storage = new MemoryStorage();
		saveConversationSummaries(storage, {
			active: summary({ updatedAt: 1 }),
			orphaned: summary({ updatedAt: 2 }),
		});

		expect(retainConversationSummaries(storage, ['active'])).toEqual({
			ok: true,
			entries: 1,
			changed: 1,
		});
		expect(loadConversationSummaries(storage).summaries).toEqual({
			active: summary({ updatedAt: 1 }),
		});
	});
});
