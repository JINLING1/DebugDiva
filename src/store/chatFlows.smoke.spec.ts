// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DeepSeekChatProvider } from '../providers/chat/DeepSeekChatProvider';
import { getMessageText } from '../services/context/buildChatContext';
import { IMAGE_GENERATION_UNAVAILABLE_MESSAGE } from '../services/context/detectImageGenerationIntent';
import {
	loadAttachmentResults,
	saveAttachmentResults,
} from '../services/storage/attachmentStorage';
import { CHAT_SESSIONS_STORAGE_KEY } from '../services/storage/chatStorage';
import { saveConversationSummaries } from '../services/storage/summaryStorage';
import type {
	DocumentAttachment,
	ImageAttachment,
} from '../types/attachment';
import type { ConversationSummary } from '../types/chat';
import type { ChatEvent } from '../types/provider';
import { useChatStore } from './chat';
import { useSettingsStore } from './settings';

const streamEvents = async function* (events: readonly ChatEvent[]) {
	for (const event of events) yield event;
};

const completedStream = (text: string) =>
	streamEvents([
		{ type: 'start', requestId: 'mock-request' },
		{ type: 'text-delta', text },
		{ type: 'done', finishReason: 'stop' },
	]);

const documentAttachment = (
	id: string,
	text: string,
): DocumentAttachment => ({
	id,
	kind: 'document',
	status: 'ready',
	name: `${id}.txt`,
	mimeType: 'text/plain',
	size: text.length,
	text,
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
});

const imageAttachment = (id: string): ImageAttachment => ({
	id,
	kind: 'image',
	status: 'ready',
	name: `${id}.png`,
	mimeType: 'image/png',
	size: 128,
	previewUrl: 'blob:https://debugdiva.test/private-preview',
	result: {
		summary: '浏览器控制台截图',
		extractedText: 'TypeError: value is undefined',
		objects: ['console', 'stack trace'],
		warnings: [],
	},
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
});

const summaryFor = (coveredUntilMessageId: string): ConversationSummary => ({
	userGoals: ['完成 Vue 3 项目排错'],
	confirmedFacts: ['用户上传了诊断附件'],
	decisions: ['使用质量模式'],
	unresolvedQuestions: [],
	coveredUntilMessageId,
	updatedAt: 10,
});

describe('chat application flows (mock providers only)', () => {
	let unexpectedFetch: ReturnType<typeof vi.fn<typeof fetch>>;

	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
		setActivePinia(createPinia());
		unexpectedFetch = vi.fn<typeof fetch>(async input => {
			const url = input instanceof Request ? input.url : String(input);
			throw new Error(`Unexpected network request in smoke test: ${url}`);
		});
		vi.stubGlobal('fetch', unexpectedFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('streams reasoning and text deltas through completion without network access', async () => {
		vi.spyOn(DeepSeekChatProvider.prototype, 'stream').mockImplementation(() =>
			streamEvents([
				{ type: 'start', requestId: 'stream-1' },
				{ type: 'reasoning-delta', text: '先定位问题，' },
				{ type: 'reasoning-delta', text: '再给出修复。' },
				{ type: 'text-delta', text: '第一段，' },
				{ type: 'text-delta', text: '第二段。' },
				{ type: 'done', finishReason: 'stop' },
			]),
		);
		const store = useChatStore();

		await store.handleChat({ input: '帮我排查错误' });

		const answer = store.chatHistory.at(-1)!;
		expect(answer.status).toBe('completed');
		expect(answer.reasoning).toBe('先定位问题，再给出修复。');
		expect(getMessageText(answer)).toBe('第一段，第二段。');
		expect(store.isAssistantTyping).toBe(false);
		expect(unexpectedFetch).not.toHaveBeenCalled();
	});

	it('stops an in-flight stream while preserving partial text and hiding AbortError', async () => {
		vi.spyOn(DeepSeekChatProvider.prototype, 'stream').mockImplementation(
			async function* (request) {
				yield { type: 'start', requestId: 'stream-stop' };
				yield { type: 'text-delta', text: '已经生成的部分' };
				await new Promise<void>((_resolve, reject) => {
					const abort = () => {
						const error = new Error('mock request aborted');
						error.name = 'AbortError';
						reject(error);
					};
					if (request.signal.aborted) abort();
					else request.signal.addEventListener('abort', abort, { once: true });
				});
			},
		);
		const store = useChatStore();

		const pendingChat = store.handleChat({ input: '写一份长答案' });
		await vi.waitFor(() =>
			expect(getMessageText(store.chatHistory.at(-1)!)).toBe('已经生成的部分'),
		);
		store.pauseChat();
		await pendingChat;

		const answer = store.chatHistory.at(-1)!;
		expect(answer.status).toBe('stopped');
		expect(getMessageText(answer)).toBe('已经生成的部分');
		expect(answer.errorCode).toBeUndefined();
		expect(JSON.stringify(answer)).not.toContain('AbortError');
		expect(store.isAssistantTyping).toBe(false);
		expect(unexpectedFetch).not.toHaveBeenCalled();
	});

	it('regenerates an ordinary answer with the original context and truncates later turns', async () => {
		const replies = ['第一版答案', '第二问答案', '重生成答案'];
		const streamSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() => completedStream(replies.shift()!));
		const store = useChatStore();

		await store.handleChat({ input: '第一问' });
		await store.handleChat({ input: '第二问' });
		await store.handleUpdate(1);

		expect(store.chatHistory).toHaveLength(2);
		expect(getMessageText(store.chatHistory[0])).toBe('第一问');
		expect(getMessageText(store.chatHistory[1])).toBe('重生成答案');
		const regenerationContext = streamSpy.mock.calls[2][0].messages;
		expect(regenerationContext).toContainEqual({
			role: 'user',
			content: '第一问',
		});
		expect(regenerationContext.some(message => message.content.includes('第二问'))).toBe(
			false,
		);
		expect(
			regenerationContext.some(message => message.content.includes('第二问答案')),
		).toBe(false);
		expect(unexpectedFetch).not.toHaveBeenCalled();
	});

	it('injects ready document and vision results without forwarding binary image data', async () => {
		const streamSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() => completedStream('分析完成'));
		const store = useChatStore();
		const document = Object.assign(
			documentAttachment('diagnostic', 'DOCUMENT_CONTEXT_ONLY'),
			{ rawBytes: 'DOCUMENT_BINARY_SECRET' },
		);
		const image = Object.assign(imageAttachment('screenshot'), {
			originalBase64: 'data:image/png;base64,IMAGE_BINARY_SECRET',
		});

		await store.handleChat({
			input: '分析文档',
			attachmentIds: [document.id],
			attachmentResults: [document],
		});
		store.startNewChat();
		await store.handleChat({
			input: '分析截图',
			attachmentIds: [image.id],
			attachmentResults: [image],
		});

		const documentRequest = JSON.stringify(streamSpy.mock.calls[0][0].messages);
		const visionRequest = JSON.stringify(streamSpy.mock.calls[1][0].messages);
		expect(documentRequest).toContain('DOCUMENT_CONTEXT_ONLY');
		expect(documentRequest).not.toContain('DOCUMENT_BINARY_SECRET');
		expect(visionRequest).toContain('浏览器控制台截图');
		expect(visionRequest).toContain('TypeError: value is undefined');
		expect(visionRequest).not.toMatch(/blob:|data:image|IMAGE_BINARY_SECRET/i);
		expect(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)).not.toMatch(
			/blob:|data:image|BINARY_SECRET/i,
		);
		expect(unexpectedFetch).not.toHaveBeenCalled();
	});

	it('answers image-generation intent locally without invoking any provider or API', async () => {
		const providerSpy = vi.spyOn(DeepSeekChatProvider.prototype, 'stream');
		const store = useChatStore();

		await store.handleChat({ input: '请生成一张雪山日落图片' });

		expect(providerSpy).not.toHaveBeenCalled();
		expect(unexpectedFetch).not.toHaveBeenCalled();
		expect(store.chatHistory).toHaveLength(2);
		expect(getMessageText(store.chatHistory[1])).toBe(
			IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
		);
		expect(store.chatHistory[1].status).toBe('completed');
	});

	it('restores session, model mode, summary and sanitized attachments after a remount', async () => {
		const document = documentAttachment('resume', 'Vue 3 and TypeScript');
		const image = imageAttachment('console');
		expect(saveAttachmentResults(localStorage, [document, image]).ok).toBe(true);
		vi.spyOn(DeepSeekChatProvider.prototype, 'stream').mockImplementation(() =>
			completedStream('已结合附件分析'),
		);

		const firstSettings = useSettingsStore();
		firstSettings.setModelMode('quality');
		const firstChat = useChatStore();
		await firstChat.handleChat({
			input: '结合附件给出建议',
			attachmentIds: [document.id, image.id],
			attachmentResults: [document, image],
		});
		const sessionId = firstChat.currentSessionId!;
		const coveredMessageId = firstChat.chatHistory[0].id;
		expect(
			saveConversationSummaries(localStorage, {
				[sessionId]: summaryFor(coveredMessageId),
			}).ok,
		).toBe(true);

		setActivePinia(createPinia());
		const restoredSettings = useSettingsStore();
		restoredSettings.loadSettings();
		const restoredChat = useChatStore();
		restoredChat.loadDataFromLocalStorage();
		restoredChat.switchSession(sessionId);
		const restoredAttachments = loadAttachmentResults(localStorage).attachments;

		expect(restoredSettings.modelMode).toBe('quality');
		expect(restoredChat.currentSessionId).toBe(sessionId);
		expect(restoredChat.chatHistory.map(getMessageText)).toEqual([
			'结合附件给出建议',
			'已结合附件分析',
		]);
		expect(restoredChat.chatSessions[0].summary).toEqual(
			summaryFor(coveredMessageId),
		);
		expect(restoredChat.activeAttachmentIds).toEqual(['resume', 'console']);
		expect(restoredAttachments.map(item => item.id)).toEqual(['resume', 'console']);
		expect(restoredAttachments[1]).not.toHaveProperty('previewUrl');
		expect(JSON.stringify(restoredAttachments)).not.toMatch(/blob:|data:image/i);
		expect(unexpectedFetch).not.toHaveBeenCalled();
	});
});
