// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DeepSeekChatProvider } from '../providers/chat/DeepSeekChatProvider';
import type { ChatEvent } from '../types/provider';
import { getMessageText } from '../services/context/buildChatContext';
import { IMAGE_GENERATION_UNAVAILABLE_MESSAGE } from '../services/context/detectImageGenerationIntent';
import { saveAttachmentResults } from '../services/storage/attachmentStorage';
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

describe('chat store provider orchestration', () => {
	beforeEach(() => {
		localStorage.clear();
		setActivePinia(createPinia());
		vi.restoreAllMocks();
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
					{ type: 'start' },
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
});
