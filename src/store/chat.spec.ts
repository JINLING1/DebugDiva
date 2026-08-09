// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DeepSeekChatProvider } from '../providers/chat/DeepSeekChatProvider';
import { AppError } from '../services/errors/AppError';
import type { ChatEvent } from '../types/provider';
import { getMessageText } from '../services/context/buildChatContext';
import { IMAGE_GENERATION_UNAVAILABLE_MESSAGE } from '../services/context/detectImageGenerationIntent';
import { saveAttachmentResults } from '../services/storage/attachmentStorage';
import {
	CHAT_SESSIONS_STORAGE_KEY,
	MAX_CHAT_STORAGE_RAW_BYTES,
	saveChatSessions,
} from '../services/storage/chatStorage';
import {
	CONVERSATION_SUMMARIES_STORAGE_KEY,
	loadConversationSummaries,
	saveConversationSummaries,
} from '../services/storage/summaryStorage';
import type {
	ChatMessage,
	ChatSession,
	ConversationSummary,
} from '../types/chat';
import type {
	DocumentAttachment,
	ImageAttachment,
} from '../types/attachment';
import { useSettingsStore } from './settings';
import { useChatStore } from './chat';

const createStream = async function* (events: ChatEvent[]) {
	for (const event of events) yield event;
};

const attachment = (
	id: string,
	text: string,
	overrides: Partial<DocumentAttachment> = {},
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
	...overrides,
});

const imageAttachment = (
	id: string,
	overrides: Partial<ImageAttachment> = {},
): ImageAttachment => ({
	id,
	kind: 'image',
	status: 'ready',
	name: `${id}.png`,
	mimeType: 'image/png',
	size: 100,
	result: {
		summary: '一张包含错误终端的截图',
		extractedText: 'TypeError: undefined',
		objects: ['终端'],
		warnings: [],
	},
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const mockSuccessfulProvider = () =>
	vi.spyOn(DeepSeekChatProvider.prototype, 'stream').mockImplementation(() =>
		createStream([
			{ type: 'text-delta', text: '附件分析完成' },
			{ type: 'done', finishReason: 'stop' },
		]),
	);

const historyMessages = (count: number): ChatMessage[] =>
	Array.from({ length: count }, (_, index) => ({
		id: `m-${index + 1}`,
		role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
		status: 'completed' as const,
		contents: [{ type: 'text' as const, text: `content-m-${index + 1}` }],
		createdAt: index + 1,
	}));

const storedSession = (messages: ChatMessage[]): ChatSession => ({
	id: 'long-session',
	title: '长对话',
	createdAt: 1,
	updatedAt: 2,
	messages,
	activeAttachmentIds: [],
});

const conversationSummary = (
	coveredUntilMessageId: string,
): ConversationSummary => ({
	userGoals: ['完成长对话摘要'],
	confirmedFacts: ['项目使用 Vue 3'],
	decisions: ['保留最近十二条消息'],
	unresolvedQuestions: [],
	coveredUntilMessageId,
	updatedAt: 100,
});

describe('chat store provider orchestration', () => {
	beforeEach(() => {
		localStorage.clear();
		setActivePinia(createPinia());
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('answers explicit image generation requests locally without a provider call', async () => {
		const streamSpy = vi.spyOn(DeepSeekChatProvider.prototype, 'stream');
		const store = useChatStore();

		await store.handleChat({ input: '请帮我生成一张宇宙飞船图片' });

		expect(streamSpy).not.toHaveBeenCalled();
		expect(store.isAssistantTyping).toBe(false);
		expect(store.chatHistory).toHaveLength(2);
		expect(getMessageText(store.chatHistory[1])).toBe(
			IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
		);
		expect(store.chatHistory[1].status).toBe('completed');
		expect(localStorage.getItem('debugdiva:sessions:v2')).toContain(
			IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
		);
	});

	it('keeps image-generation knowledge questions on the normal provider path', async () => {
		const streamSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() =>
				createStream([
					{ type: 'start', requestId: 'request-1' },
					{ type: 'text-delta', text: '它通常使用扩散模型。' },
					{ type: 'done', finishReason: 'stop' },
				]),
			);
		const store = useChatStore();

		await store.handleChat({ input: '图片生成的原理是什么？' });

		expect(streamSpy).toHaveBeenCalledOnce();
		const request = streamSpy.mock.calls[0][0];
		expect(request.messages[0]).toEqual(
			expect.objectContaining({ role: 'system' }),
		);
		expect(request.messages[0].content).toContain(
			IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
		);
		expect(request.messages.at(-1)).toEqual({
			role: 'user',
			content: '图片生成的原理是什么？',
		});
		expect(getMessageText(store.chatHistory.at(-1)!)).toBe(
			'它通常使用扩散模型。',
		);
	});

	it('passes the selected mode and consumes only normalized provider events', async () => {
		const streamSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() =>
				createStream([
					{ type: 'start', requestId: 'req-store' },
					{ type: 'reasoning-delta', text: '先分析问题。' },
					{ type: 'text-delta', text: '最终答案' },
					{
						type: 'usage',
						usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
					},
					{ type: 'done', finishReason: 'stop' },
				]),
			);
		const settings = useSettingsStore();
		settings.setModelMode('quality');
		const store = useChatStore();

		await store.handleChat({ input: '分析这段代码' });

		expect(streamSpy.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				mode: 'quality',
				clientId: expect.stringMatching(/^anonymous-/),
			}),
		);
		const answer = store.chatHistory.at(-1)!;
		expect(answer.status).toBe('completed');
		expect(answer.reasoning).toBe('先分析问题。');
		expect(getMessageText(answer)).toBe('最终答案');
		expect(answer.usage).toEqual({
			promptTokens: 12,
			completionTokens: 4,
			totalTokens: 16,
		});
		expect(answer.requestId).toBe('req-store');
	});

	it('stores a normalized provider error instead of parsing supplier payloads', async () => {
		vi.spyOn(DeepSeekChatProvider.prototype, 'stream').mockImplementation(() =>
			createStream([
				{
					type: 'error',
					error: Object.assign(new Error('请求过于频繁，请稍后重试'), {
						code: 'RATE_LIMITED',
						retryable: true,
					}),
				},
			]),
		);
		const store = useChatStore();

		await store.handleChat({ input: '你好' });

		const answer = store.chatHistory.at(-1)!;
		expect(answer.status).toBe('error');
		expect(answer.errorCode).toBe('RATE_LIMITED');
		expect(getMessageText(answer)).toBe('请求过于频繁，请稍后重试');
	});

	it('retries one empty 5xx stream once and then succeeds', async () => {
		const streamSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementationOnce(() =>
				createStream([
					{
						type: 'error',
						error: new AppError({
							code: 'UPSTREAM_UNAVAILABLE',
							message: 'AI 服务暂时不可用',
							status: 503,
							retryable: true,
						}),
					},
				]),
			)
			.mockImplementationOnce(() =>
				createStream([
					{ type: 'text-delta', text: '重试成功' },
					{ type: 'done', finishReason: 'stop' },
				]),
			);
		const store = useChatStore();

		await store.handleChat({ input: '自动重试' });

		expect(streamSpy).toHaveBeenCalledTimes(2);
		expect(store.chatHistory.at(-1)?.status).toBe('completed');
		expect(getMessageText(store.chatHistory.at(-1)!)).toBe('重试成功');
	});

	it('does not auto-retry a 5xx after any streamed output', async () => {
		const streamSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() =>
				createStream([
					{ type: 'text-delta', text: '部分内容' },
					{
						type: 'error',
						error: new AppError({
							code: 'UPSTREAM_UNAVAILABLE',
							message: 'AI 服务暂时不可用',
							status: 503,
							retryable: true,
						}),
					},
				]),
			);
		const store = useChatStore();

		await store.handleChat({ input: '不要重复输出' });

		expect(streamSpy).toHaveBeenCalledTimes(1);
		expect(store.chatHistory.at(-1)?.status).toBe('error');
	});

	it('never retries authentication failures or more than one 5xx attempt', async () => {
		const authSpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() =>
				createStream([
					{
						type: 'error',
						error: new AppError({
							code: 'AUTH_FAILED',
							message: 'AI 服务鉴权失败',
							status: 401,
							retryable: false,
						}),
					},
				]),
			);
		const firstStore = useChatStore();
		await firstStore.handleChat({ input: '鉴权失败' });
		expect(authSpy).toHaveBeenCalledTimes(1);

		vi.restoreAllMocks();
		setActivePinia(createPinia());
		const unavailable = new AppError({
			code: 'UPSTREAM_UNAVAILABLE',
			message: 'AI 服务暂时不可用',
			status: 503,
			retryable: true,
		});
		const retrySpy = vi
			.spyOn(DeepSeekChatProvider.prototype, 'stream')
			.mockImplementation(() =>
				createStream([{ type: 'error', error: unavailable }]),
			);
		const secondStore = useChatStore();
		await secondStore.handleChat({ input: '服务故障' });

		expect(retrySpy).toHaveBeenCalledTimes(2);
		expect(secondStore.chatHistory.at(-1)?.status).toBe('error');
	});

	it('adds ready document metadata to the message and injects parsed text into provider context', async () => {
		expect(
			saveAttachmentResults(localStorage, [
				attachment('resume', '前端工程师，熟悉 Vue 3。'),
			]),
		).toMatchObject({ ok: true });
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();

		await store.handleChat({
			input: '请概括这份简历',
			attachmentIds: ['resume'],
		});

		expect(streamSpy).toHaveBeenCalledOnce();
		const request = streamSpy.mock.calls[0][0];
		expect(request.messages.at(-1)?.content).toBe(
			[
				'[附件开始]',
				'文件名：resume.txt',
				'文件类型：text/plain',
				'内容：',
				'前端工程师，熟悉 Vue 3。',
				'[附件结束]',
				'',
				'用户问题：请概括这份简历',
			].join('\n'),
		);
		expect(store.chatHistory[0].contents).toContainEqual({
			type: 'file',
			attachmentId: 'resume',
			name: 'resume.txt',
			mimeType: 'text/plain',
			size: 15,
		});
		expect(store.chatSessions[0].activeAttachmentIds).toEqual(['resume']);
	});

	it('does not call the provider while an active attachment is unavailable or failed', async () => {
		saveAttachmentResults(localStorage, [
			attachment('failed', '', {
				status: 'error',
				errorCode: 'PARSE_FAILED',
				errorMessage: '解析失败',
			}),
		]);
		const streamSpy = vi.spyOn(DeepSeekChatProvider.prototype, 'stream');
		const store = useChatStore();

		await store.handleChat({ input: '分析文件', attachmentIds: ['failed'] });
		expect(streamSpy).not.toHaveBeenCalled();
		expect(store.chatHistory).toEqual([]);

		await store.handleChat({ input: '分析文件', attachmentIds: ['missing'] });
		expect(streamSpy).not.toHaveBeenCalled();
		expect(store.chatHistory).toEqual([]);
	});

	it('uses the runtime attachment snapshot when persistence is unavailable', async () => {
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();
		const runtimeAttachment = attachment('runtime', '仅存在于当前页面');

		await store.handleChat({
			input: '分析当前附件',
			attachmentIds: ['runtime'],
			attachmentResults: [runtimeAttachment],
		});

		expect(streamSpy).toHaveBeenCalledOnce();
		expect(streamSpy.mock.calls[0][0].messages.at(-1)?.content).toContain(
			'仅存在于当前页面',
		);
	});

	it('stores image metadata without preview URLs and sends only the vision result to DeepSeek', async () => {
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();
		const image = imageAttachment('error-shot', {
			previewUrl: 'blob:https://example.test/private',
		});

		await store.handleChat({
			input: '分析截图中的错误',
			attachmentIds: ['error-shot'],
			attachmentResults: [image],
		});

		expect(store.chatHistory[0].contents).toContainEqual({
			type: 'image',
			attachmentId: 'error-shot',
			alt: 'error-shot.png',
		});
		const requestContent = streamSpy.mock.calls[0][0].messages.at(-1)!.content;
		expect(requestContent).toContain('[图片分析结果]');
		expect(requestContent).toContain('TypeError: undefined');
		expect(requestContent).not.toContain('blob:');
		expect(requestContent).not.toContain('data:image');
		expect(localStorage.getItem('debugdiva:sessions:v2')).not.toContain('blob:');
	});

	it('does not send a chat request while image analysis is unfinished', async () => {
		const streamSpy = vi.spyOn(DeepSeekChatProvider.prototype, 'stream');
		const store = useChatStore();

		await store.handleChat({
			input: '分析图片',
			attachmentIds: ['pending-image'],
			attachmentResults: [
				imageAttachment('pending-image', {
					status: 'analyzing',
					result: undefined,
				}),
			],
		});

		expect(streamSpy).not.toHaveBeenCalled();
		expect(store.chatHistory).toEqual([]);
	});

	it('blocks requests when active document text exceeds the 80,000 character total', async () => {
		saveAttachmentResults(localStorage, [
			attachment('one', 'a'.repeat(30_000)),
			attachment('two', 'b'.repeat(30_000)),
			attachment('three', 'c'.repeat(30_001)),
		]);
		const streamSpy = vi.spyOn(DeepSeekChatProvider.prototype, 'stream');
		const store = useChatStore();

		await store.handleChat({
			input: '综合分析',
			attachmentIds: ['one', 'two', 'three'],
		});

		expect(streamSpy).not.toHaveBeenCalled();
		expect(store.chatHistory).toEqual([]);
	});

	it('blocks more than three active attachments even when their text is small', async () => {
		saveAttachmentResults(localStorage, [
			attachment('one', '1'),
			attachment('two', '2'),
			attachment('three', '3'),
			attachment('four', '4'),
		]);
		const streamSpy = vi.spyOn(DeepSeekChatProvider.prototype, 'stream');
		const store = useChatStore();

		await store.handleChat({
			input: '分析',
			attachmentIds: ['one', 'two', 'three', 'four'],
		});

		expect(streamSpy).not.toHaveBeenCalled();
		expect(store.chatHistory).toEqual([]);
		expect(store.activeAttachmentIds).toEqual([]);
	});

	it('restores and persists active attachment IDs with their chat session', async () => {
		saveAttachmentResults(localStorage, [attachment('doc', 'context')]);
		mockSuccessfulProvider();
		const store = useChatStore();
		await store.handleChat({ input: '问题', attachmentIds: ['doc'] });
		const sessionId = store.currentSessionId!;

		store.startNewChat();
		expect(store.activeAttachmentIds).toEqual([]);
		store.switchSession(sessionId);
		expect(store.activeAttachmentIds).toEqual(['doc']);

		store.setActiveAttachmentIds([]);
		store.startNewChat();
		store.switchSession(sessionId);
		expect(store.activeAttachmentIds).toEqual([]);
	});

	it('reconciles missing active attachment IDs so a restored session cannot get stuck', async () => {
		saveAttachmentResults(localStorage, [attachment('doc', 'context')]);
		mockSuccessfulProvider();
		const store = useChatStore();
		await store.handleChat({ input: '问题', attachmentIds: ['doc'] });

		expect(store.reconcileActiveAttachmentIds([])).toEqual(['doc']);
		expect(store.activeAttachmentIds).toEqual([]);
		expect(store.chatSessions[0].activeAttachmentIds).toEqual([]);
	});

	it('regenerates with the attachments recorded on the original user turn', async () => {
		const firstAttachment = attachment('first', 'FIRST_ATTACHMENT_BODY');
		const secondAttachment = attachment('second', 'SECOND_ATTACHMENT_BODY');
		saveAttachmentResults(localStorage, [firstAttachment, secondAttachment]);
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();

		await store.handleChat({ input: '第一问', attachmentIds: ['first'] });
		await store.handleChat({ input: '第二问', attachmentIds: ['second'] });
		expect(
			store.chatHistory[2].contents.filter(content => content.type === 'file'),
		).toEqual([
			{
				type: 'file',
				attachmentId: 'second',
				name: 'second.txt',
				mimeType: 'text/plain',
				size: 22,
			},
		]);

		await store.handleUpdate(1, [firstAttachment, secondAttachment]);

		const regenerationRequest = streamSpy.mock.calls.at(-1)![0];
		const serializedContext = regenerationRequest.messages
			.map(message => message.content)
			.join('\n');
		expect(serializedContext).toContain('FIRST_ATTACHMENT_BODY');
		expect(serializedContext).not.toContain('SECOND_ATTACHMENT_BODY');
		expect(store.activeAttachmentIds).toEqual(['second']);
	});

	it('restores an independent summary and sends only messages after its boundary', async () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(21))]);
		saveConversationSummaries(localStorage, {
			'long-session': conversationSummary('m-9'),
		});
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.switchSession('long-session');

		await store.handleChat({ input: '最新问题' });

		const providerMessages = streamSpy.mock.calls[0][0].messages;
		expect(providerMessages[1].content).toContain('[历史会话摘要开始]');
		expect(providerMessages[1].content).toContain('完成长对话摘要');
		const serialized = providerMessages.map(item => item.content).join('\n');
		expect(providerMessages).not.toContainEqual({
			role: 'user',
			content: 'content-m-1',
		});
		expect(providerMessages).not.toContainEqual({
			role: 'user',
			content: 'content-m-9',
		});
		expect(serialized).toContain('content-m-10');
		expect(providerMessages.at(-1)).toEqual({
			role: 'user',
			content: '最新问题',
		});
	});

	it('generates and persists a background summary without blocking chat', async () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(20))]);
		mockSuccessfulProvider();
		const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			const coveredUntilMessageId = body.messages.at(-1).id;
			return Response.json({
				data: {
					...conversationSummary(coveredUntilMessageId),
					updatedAt: 1_000,
				},
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.switchSession('long-session');

		await store.handleChat({ input: '触发摘要' });

		expect(getMessageText(store.chatHistory.at(-1)!)).toBe('附件分析完成');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(store.chatSessions[0].summary?.coveredUntilMessageId).toBe('m-10'),
		);
		const summaryRequest = JSON.parse(
			String(fetchMock.mock.calls[0][1]?.body),
		);
		expect(summaryRequest.messages).toHaveLength(10);
		expect(summaryRequest.messages[0]).toEqual({
			id: 'm-1',
			role: 'user',
			content: 'content-m-1',
		});
		expect(String(fetchMock.mock.calls[0][1]?.body)).not.toMatch(
			/attachment|blob:|base64/i,
		);
		expect(
			loadConversationSummaries(localStorage).summaries['long-session']
				.coveredUntilMessageId,
		).toBe('m-10');
		expect(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)).not.toContain(
			'"summary"',
		);
	});

	it('keeps chat successful when background summarization fails', async () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(20))]);
		mockSuccessfulProvider();
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new TypeError('summary offline'));
		vi.stubGlobal('fetch', fetchMock);
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.switchSession('long-session');

		await store.handleChat({ input: '聊天必须继续' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

		expect(store.chatHistory.at(-1)?.status).toBe('completed');
		expect(getMessageText(store.chatHistory.at(-1)!)).toBe('附件分析完成');
		expect(store.chatSessions[0].summary).toBeUndefined();
	});

	it('invalidates a summary that covers a regenerated answer', async () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(22))]);
		saveConversationSummaries(localStorage, {
			'long-session': conversationSummary('m-10'),
		});
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.switchSession('long-session');

		await store.handleUpdate(9);

		expect(store.chatSessions[0].summary).toBeUndefined();
		expect(
			loadConversationSummaries(localStorage).summaries['long-session'],
		).toBeUndefined();
		expect(
			streamSpy.mock.calls[0][0].messages.some(message =>
				message.content.includes('[历史会话摘要开始]'),
			),
		).toBe(false);
	});

	it('keeps the original question when its user turn is summary-covered', async () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(22))]);
		saveConversationSummaries(localStorage, {
			'long-session': conversationSummary('m-9'),
		});
		const streamSpy = mockSuccessfulProvider();
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.switchSession('long-session');

		await store.handleUpdate(9);

		expect(store.chatSessions[0].summary).toBeUndefined();
		expect(streamSpy.mock.calls[0][0].messages).toContainEqual({
			role: 'user',
			content: 'content-m-9',
		});
	});

	it('migrates the newest embedded summary into dedicated storage', () => {
		const embeddedSummary = {
			...conversationSummary('m-4'),
			updatedAt: 200,
		};
		localStorage.setItem(
			CHAT_SESSIONS_STORAGE_KEY,
			JSON.stringify([
				{
					...storedSession(historyMessages(6)),
					summary: embeddedSummary,
				},
			]),
		);
		saveConversationSummaries(localStorage, {
			'long-session': conversationSummary('m-2'),
		});
		const store = useChatStore();

		store.loadDataFromLocalStorage();

		expect(store.chatSessions[0].summary).toEqual(embeddedSummary);
		expect(
			loadConversationSummaries(localStorage).summaries['long-session'],
		).toEqual(embeddedSummary);
		expect(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)).not.toContain(
			'"summary"',
		);
	});

	it('preserves corrupt dedicated summary data while restoring sessions', () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(2))]);
		localStorage.setItem(CONVERSATION_SUMMARIES_STORAGE_KEY, '{broken');
		const store = useChatStore();

		store.loadDataFromLocalStorage();

		expect(store.chatSessions).toHaveLength(1);
		expect(store.chatSessions[0].messages).toHaveLength(2);
		expect(localStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe(
			'{broken',
		);
	});

	it.each(['corrupted', 'oversized'] as const)(
		'preserves independent summaries when chat storage is %s',
		failureKind => {
			saveConversationSummaries(localStorage, {
				'preserved-session': conversationSummary('message-9'),
			});
			const originalSummaryRaw = localStorage.getItem(
				CONVERSATION_SUMMARIES_STORAGE_KEY,
			);
			localStorage.setItem(
				CHAT_SESSIONS_STORAGE_KEY,
				failureKind === 'corrupted'
					? '{broken'
					: 'x'.repeat(MAX_CHAT_STORAGE_RAW_BYTES + 1),
			);
			const store = useChatStore();

			store.loadDataFromLocalStorage();

			expect(store.canPruneAttachmentResults).toBe(false);
			expect(
				localStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY),
			).toBe(originalSummaryRaw);
			expect(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)).toBe(
				failureKind === 'corrupted'
					? '{broken'
					: 'x'.repeat(MAX_CHAT_STORAGE_RAW_BYTES + 1),
			);
		},
	);

	it('does not overwrite preserved summaries after a new background summary completes', async () => {
		saveConversationSummaries(localStorage, {
			'preserved-session': conversationSummary('message-9'),
		});
		const originalSummaryRaw = localStorage.getItem(
			CONVERSATION_SUMMARIES_STORAGE_KEY,
		);
		localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, '{broken');
		mockSuccessfulProvider();
		const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			return Response.json({
				data: conversationSummary(body.messages.at(-1).id),
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.chatSessions = [storedSession(historyMessages(20))];
		store.switchSession('long-session');

		await store.handleChat({ input: '继续当前内存中的会话' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(store.chatSessions[0].summary).toBeDefined(),
		);

		expect(localStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe(
			originalSummaryRaw,
		);
		expect(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)).toBe('{broken');
	});

	it('does not overwrite unreadable summary storage after background summarization', async () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(20))]);
		localStorage.setItem(CONVERSATION_SUMMARIES_STORAGE_KEY, '{broken');
		mockSuccessfulProvider();
		const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			return Response.json({
				data: conversationSummary(body.messages.at(-1).id),
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		const store = useChatStore();
		store.loadDataFromLocalStorage();
		store.switchSession('long-session');

		await store.handleChat({ input: '继续聊天但保留损坏的摘要原文' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(store.chatSessions[0].summary).toBeDefined(),
		);

		expect(localStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).toBe(
			'{broken',
		);
	});

	it('removes the dedicated summary when deleting its session', () => {
		saveChatSessions(localStorage, [storedSession(historyMessages(2))]);
		saveConversationSummaries(localStorage, {
			'long-session': conversationSummary('m-2'),
		});
		const store = useChatStore();
		store.loadDataFromLocalStorage();

		store.deleteSession('long-session');

		expect(loadConversationSummaries(localStorage).summaries).toEqual({});
		expect(localStorage.getItem(CONVERSATION_SUMMARIES_STORAGE_KEY)).not.toContain(
			'long-session',
		);
	});
});
