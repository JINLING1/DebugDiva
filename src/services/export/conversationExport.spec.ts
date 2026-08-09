// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	ChatAttachment,
	DocumentAttachment,
	ImageAttachment,
} from '../../types/attachment';
import type { ChatSession } from '../../types/chat';
import {
	collectSessionAttachmentIds,
	createConversationExport,
	createConversationExportFilename,
	downloadConversationExport,
	serializeConversationExport,
} from './conversationExport';

const summary = {
	userGoals: ['定位构建问题'],
	confirmedFacts: ['项目使用 Vue 3'],
	decisions: ['保留最近消息'],
	unresolvedQuestions: ['是否需要部署'],
	coveredUntilMessageId: 'message-1',
	updatedAt: 1_725_000_000_000,
};

const sessionFixture = (): ChatSession =>
	({
		id: 'session-1',
		title: '构建问题 / Vue',
		createdAt: 1_724_000_000_000,
		updatedAt: 1_725_000_000_000,
		messages: [
			{
				id: 'message-1',
				role: 'user',
				status: 'completed',
				contents: [
					{ type: 'text', text: '分析附件' },
					{
						type: 'file',
						attachmentId: 'document-1',
						name: 'debug.txt',
						mimeType: 'text/plain',
						size: 12,
					},
					{
						type: 'image',
						attachmentId: 'image-1',
						alt: '错误截图',
						previewUrl: 'blob:message-preview',
					},
				],
				createdAt: 1_724_000_000_100,
				apiKey: 'message-api-key',
			},
		],
		summary: { ...summary, apiKey: 'summary-api-key' },
		activeAttachmentIds: ['document-1', 'document-1'],
		clientId: 'anonymous-secret-client',
		settings: { apiKey: 'settings-api-key' },
	} as unknown as ChatSession);

const attachmentsFixture = (): ChatAttachment[] => [
	{
		id: 'document-1',
		kind: 'document',
		status: 'ready',
		name: 'debug.txt',
		mimeType: 'text/plain',
		size: 12,
		text: 'TypeError',
		truncated: false,
		warnings: [],
		createdAt: 1,
		updatedAt: 2,
		file: new File(['secret bytes'], 'debug.txt'),
		base64: 'base64-secret-payload',
		apiKey: 'attachment-api-key',
	} as DocumentAttachment,
	{
		id: 'image-1',
		kind: 'image',
		status: 'ready',
		name: 'error.png',
		mimeType: 'image/png',
		size: 24,
		previewUrl: 'blob:image-secret-preview',
		result: {
			summary: '终端错误截图',
			extractedText: 'ReferenceError',
			objects: ['终端'],
			warnings: [],
		},
		warnings: [],
		createdAt: 3,
		updatedAt: 4,
		rawBlob: new Blob(['secret image bytes']),
	} as ImageAttachment,
	{
		id: 'other-session-attachment',
		kind: 'document',
		status: 'ready',
		name: 'private.txt',
		mimeType: 'text/plain',
		size: 30,
		text: 'other-session-secret',
		truncated: false,
		warnings: [],
		createdAt: 5,
		updatedAt: 6,
	} as DocumentAttachment,
];

describe('conversation export', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('builds a versioned, single-session allowlisted export', () => {
		const exported = createConversationExport(
			sessionFixture(),
			attachmentsFixture(),
			new Date('2026-08-09T08:00:00.000Z'),
		);

		expect(exported).toMatchObject({
			schemaVersion: 1,
			app: 'DebugDiva',
			exportedAt: '2026-08-09T08:00:00.000Z',
			session: {
				id: 'session-1',
				title: '构建问题 / Vue',
				summary,
				activeAttachmentIds: ['document-1'],
			},
		});
		expect(exported.attachments.map(item => item.id)).toEqual([
			'document-1',
			'image-1',
		]);

		const serialized = serializeConversationExport(exported);
		expect(serialized).not.toContain('other-session-secret');
		expect(serialized).not.toContain('anonymous-secret-client');
		expect(serialized).not.toContain('api-key');
		expect(serialized).not.toContain('base64-secret-payload');
		expect(serialized).not.toContain('blob:');
		expect(serialized).not.toContain('secret bytes');
		expect(Object.keys(exported.session)).toEqual([
			'id',
			'title',
			'createdAt',
			'updatedAt',
			'messages',
			'summary',
			'activeAttachmentIds',
		]);
		expect(Object.keys(exported.attachments[1])).not.toContain('previewUrl');
	});

	it('collects unique file, image, citation and active attachment references', () => {
		const session = sessionFixture();
		session.messages[0].contents.push({
			type: 'citation',
			attachmentId: 'citation-1',
			name: 'source.md',
			excerpt: 'source',
		});
		session.activeAttachmentIds.push('active-1');

		expect(collectSessionAttachmentIds(session)).toEqual([
			'document-1',
			'image-1',
			'citation-1',
			'active-1',
		]);
	});

	it('creates a filesystem-safe, bounded filename', () => {
		const filename = createConversationExportFilename(
			'  ../CON:<构建>|*?  ',
			new Date('2026-08-09T08:00:00.000Z'),
		);

		expect(filename).toBe('DebugDiva-CON-构建-2026-08-09.json');
		expect(filename).not.toMatch(/[<>:"/\\|?*]/);
		expect(filename.length).toBeLessThanOrEqual(100);
		expect(createConversationExportFilename('CON')).toContain(
			'DebugDiva-conversation-',
		);
	});

	it('downloads through an object URL and always revokes it', () => {
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => undefined);
		const urlApi = {
			createObjectURL: vi.fn(() => 'blob:conversation-export'),
			revokeObjectURL: vi.fn(),
		};

		const result = downloadConversationExport(
			sessionFixture(),
			attachmentsFixture(),
			new Date('2026-08-09T08:00:00.000Z'),
			{ documentRef: document, urlApi },
		);

		expect(result.filename).toBe(
			'DebugDiva-构建问题 - Vue-2026-08-09.json',
		);
		expect(result.bytes).toBeGreaterThan(0);
		expect(click).toHaveBeenCalledTimes(1);
		expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1);
		expect(urlApi.revokeObjectURL).toHaveBeenCalledWith(
			'blob:conversation-export',
		);
		expect(document.querySelector('a[download]')).toBeNull();
	});

	it('revokes the object URL even when the browser click fails', () => {
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
			throw new Error('download blocked');
		});
		const urlApi = {
			createObjectURL: vi.fn(() => 'blob:failed-export'),
			revokeObjectURL: vi.fn(),
		};

		expect(() =>
			downloadConversationExport(
				sessionFixture(),
				attachmentsFixture(),
				new Date('2026-08-09T08:00:00.000Z'),
				{ documentRef: document, urlApi },
			),
		).toThrow('download blocked');
		expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:failed-export');
		expect(document.querySelector('a[download]')).toBeNull();
	});
});
