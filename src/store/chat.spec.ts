// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DeepSeekChatProvider } from '../providers/chat/DeepSeekChatProvider';
import type { ChatEvent } from '../types/provider';
import { getMessageText } from '../services/context/buildChatContext';
import { IMAGE_GENERATION_UNAVAILABLE_MESSAGE } from '../services/context/detectImageGenerationIntent';
import { useSettingsStore } from './settings';
import { useChatStore } from './chat';

const createStream = async function* (events: ChatEvent[]) {
	for (const event of events) yield event;
};

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
});
