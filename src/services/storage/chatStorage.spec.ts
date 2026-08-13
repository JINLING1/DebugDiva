import { describe, expect, it } from 'vitest';
import {
	CHAT_SESSIONS_STORAGE_KEY,
	MAX_CHAT_SESSIONS,
	MAX_CHAT_STORAGE_RAW_BYTES,
	MAX_MESSAGES_PER_SESSION,
	loadChatSessions,
	normalizeV2Sessions,
	saveChatSessions,
	type StorageLike,
} from './chatStorage';

class MemoryStorage implements StorageLike {
	readonly values = new Map<string, string>();
	failRead = false;

	getItem(key: string) {
		if (this.failRead) throw new Error('storage unavailable');
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

describe('chat storage', () => {
	it('normalizes interrupted v2 messages without leaving pending state', () => {
		const [session] = normalizeV2Sessions([
			{
				id: 'v2',
				title: 'v2',
				createdAt: 1,
				updatedAt: 2,
				activeAttachmentIds: [],
				messages: [
					{
						id: 'assistant',
						role: 'assistant',
						status: 'pending',
						contents: [],
						createdAt: 1,
					},
				],
			},
		]);

		expect(session.messages[0]).toMatchObject({
			status: 'stopped',
			contents: [{ type: 'text', text: '已停止回复' }],
		});
	});

	it('loads valid v2 data', () => {
		const storage = new MemoryStorage();
		storage.setItem(CHAT_SESSIONS_STORAGE_KEY, '[]');

		expect(loadChatSessions(storage)).toEqual({
			sessions: [],
			recoveredFromError: false,
		});
	});

	it('preserves corrupt v2 data without rewriting it', () => {
		const storage = new MemoryStorage();
		const raw = '{broken';
		storage.setItem(CHAT_SESSIONS_STORAGE_KEY, raw);

		expect(loadChatSessions(storage)).toMatchObject({
			sessions: [],
			recoveredFromError: true,
			errorCode: 'CHAT_STORAGE_CORRUPTED',
		});
		expect(storage.getItem(CHAT_SESSIONS_STORAGE_KEY)).toBe(raw);
	});

	it('handles storage read failures without throwing', () => {
		const storage = new MemoryStorage();
		storage.failRead = true;

		expect(loadChatSessions(storage)).toMatchObject({
			sessions: [],
			recoveredFromError: true,
			errorCode: 'CHAT_STORAGE_READ_FAILED',
		});
	});

	it('rejects oversized raw session data before parsing and preserves it', () => {
		const storage = new MemoryStorage();
		const raw = 'x'.repeat(MAX_CHAT_STORAGE_RAW_BYTES + 1);
		storage.setItem(CHAT_SESSIONS_STORAGE_KEY, raw);

		expect(loadChatSessions(storage)).toMatchObject({
			sessions: [],
			recoveredFromError: true,
			errorCode: 'CHAT_STORAGE_TOO_LARGE',
		});
		expect(storage.getItem(CHAT_SESSIONS_STORAGE_KEY)).toBe(raw);
	});

	it('never persists image preview URLs or runtime-only image fields', () => {
		const storage = new MemoryStorage();
		saveChatSessions(storage, [
			{
				id: 'vision-session',
				title: '图片分析',
				createdAt: 1,
				updatedAt: 2,
				activeAttachmentIds: ['image-1'],
				messages: [
					{
						id: 'user-image',
						role: 'user',
						status: 'completed',
						createdAt: 1,
						contents: [
							{
								type: 'image',
								attachmentId: 'image-1',
								previewUrl: 'blob:https://example.test/private',
								alt: '报错截图',
								base64: 'data:image/png;base64,SECRET',
							} as never,
						],
					},
				],
			},
		]);

		const raw = storage.getItem(CHAT_SESSIONS_STORAGE_KEY) || '';
		expect(raw).not.toContain('blob:');
		expect(raw).not.toContain('base64');
		expect(raw).not.toContain('data:image');
		expect(JSON.parse(raw)[0].messages[0].contents[0]).toEqual({
			type: 'image',
			attachmentId: 'image-1',
			alt: '报错截图',
		});
	});

	it('persists only allowlisted fields and bounds active attachment ids', () => {
		const storage = new MemoryStorage();
		const session = {
			id: 'safe-session',
			title: '安全保存',
			createdAt: 1,
			updatedAt: 2,
			activeAttachmentIds: ['a', 'a', 'b', 'c', 'd'],
			apiKey: 'sk-session-secret',
			messages: [
				{
					id: 'safe-message',
					role: 'user',
					status: 'pending',
					createdAt: 1,
					apiKey: 'sk-message-secret',
					contents: [
						{
							type: 'file',
							attachmentId: 'a',
							name: 'safe.txt',
							mimeType: 'text/plain',
							size: 4,
							file: { secret: true },
							rawBase64: 'data:application/octet-stream;base64,PRIVATE',
							previewUrl: 'blob:https://example.test/private',
						},
					],
					usage: { totalTokens: 3, apiKey: 'sk-usage-secret' },
				},
			],
		} as never;

		saveChatSessions(storage, [session]);

		const raw = storage.getItem(CHAT_SESSIONS_STORAGE_KEY) || '';
		expect(raw).not.toMatch(/sk-|rawBase64|base64|blob:|previewUrl|\"file\":/i);
		const [stored] = JSON.parse(raw);
		expect(stored.activeAttachmentIds).toEqual(['a', 'b', 'c']);
		expect(stored.messages[0]).toMatchObject({
			id: 'safe-message',
			role: 'user',
			status: 'pending',
			contents: [
				{
					type: 'file',
					attachmentId: 'a',
					name: 'safe.txt',
					mimeType: 'text/plain',
					size: 4,
				},
			],
			usage: { totalTokens: 3 },
		});
	});

	it('drops runtime-only image fields while loading stored sessions', () => {
		const [session] = normalizeV2Sessions([
			{
				id: 'stored-image-session',
				title: '图片分析',
				createdAt: 1,
				updatedAt: 2,
				activeAttachmentIds: ['image-1'],
				messages: [
					{
						id: 'stored-image-message',
						role: 'user',
						status: 'completed',
						createdAt: 1,
						contents: [
							{
								type: 'image',
								attachmentId: 'image-1',
								alt: '报错截图',
								previewUrl: 'blob:https://example.test/private',
								base64: 'data:image/png;base64,SECRET',
							},
						],
					},
				],
			},
		]);

		expect(session.messages[0].contents[0]).toEqual({
			type: 'image',
			attachmentId: 'image-1',
			alt: '报错截图',
		});
	});

	it('stores summaries only in the dedicated summary storage key', () => {
		const storage = new MemoryStorage();
		saveChatSessions(storage, [
			{
				id: 'session-with-summary',
				title: '长对话',
				createdAt: 1,
				updatedAt: 2,
				activeAttachmentIds: [],
				messages: [],
				summary: {
					userGoals: ['排查问题'],
					confirmedFacts: [],
					decisions: [],
					unresolvedQuestions: [],
					coveredUntilMessageId: 'message-9',
					updatedAt: 2,
				},
			},
		]);

		const stored = JSON.parse(
			storage.getItem(CHAT_SESSIONS_STORAGE_KEY) || '[]',
		);
		expect(stored[0]).not.toHaveProperty('summary');
	});

	it('keeps only valid embedded summaries', () => {
		const baseSession = {
			id: 'embedded-summary',
			title: '长对话',
			createdAt: 1,
			updatedAt: 2,
			activeAttachmentIds: [],
			messages: [],
		};
		const validSummary = {
			userGoals: ['排查问题'],
			confirmedFacts: [],
			decisions: [],
			unresolvedQuestions: [],
			coveredUntilMessageId: 'message-9',
			updatedAt: 2,
		};

		expect(
			normalizeV2Sessions([{ ...baseSession, summary: validSummary }])[0]
				.summary,
		).toEqual(validSummary);
		expect(
			normalizeV2Sessions([
				{
					...baseSession,
					summary: { ...validSummary, decisions: 'not-an-array' },
				},
			])[0].summary,
		).toBeUndefined();
	});

	it('bounds untrusted stored text and drops malformed usage fields', () => {
		const [session] = normalizeV2Sessions([
			{
				id: 'bounded',
				title: 't'.repeat(500),
				createdAt: 1,
				updatedAt: 2,
				activeAttachmentIds: [],
				messages: [
					{
						id: 'message',
						role: 'assistant',
						status: 'completed',
						createdAt: 1,
						contents: [
							{ type: 'text', text: 'x'.repeat(100_005) },
						],
						reasoning: 'r'.repeat(100_005),
						usage: { totalTokens: 10, prompt: 'secret', nested: {} },
					},
				],
			},
		]);

		expect(session.title).toHaveLength(200);
		expect(session.messages[0].contents[0]).toMatchObject({
			type: 'text',
			text: 'x'.repeat(100_000),
		});
		expect(session.messages[0].reasoning).toHaveLength(100_000);
		expect(session.messages[0].usage).toEqual({ totalTokens: 10 });
	});

	it('rejects excessive session and message counts', () => {
		expect(() =>
			normalizeV2Sessions(
				Array.from({ length: MAX_CHAT_SESSIONS + 1 }, () => ({})),
			),
		).toThrow(/会话数量/);
		expect(() =>
			normalizeV2Sessions([
				{
					id: 'too-many-messages',
					title: '会话',
					messages: Array.from(
						{ length: MAX_MESSAGES_PER_SESSION + 1 },
						() => ({}),
					),
				},
			]),
		).toThrow(/消息数量/);
	});
});
