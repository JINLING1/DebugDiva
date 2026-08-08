import { describe, expect, it } from 'vitest';
import type { ChatMessage, MessageStatus } from '../../types/chat';
import {
	buildChatContext,
	getMessageText,
	mapTokenUsage,
} from './buildChatContext';

const message = (
	id: string,
	role: ChatMessage['role'],
	status: MessageStatus,
	texts: string[],
): ChatMessage => ({
	id,
	role,
	status,
	contents: texts.map(text => ({ type: 'text', text })),
	createdAt: 1,
});

describe('buildChatContext', () => {
	it('keeps completed messages in order and joins text contents', () => {
		const messages = [
			message('system', 'system', 'completed', ['规则']),
			message('user', 'user', 'completed', ['第一段', '第二段']),
			message('assistant', 'assistant', 'completed', ['回答']),
		];

		expect(buildChatContext(messages)).toEqual([
			{ role: 'system', content: '规则' },
			{ role: 'user', content: '第一段\n\n第二段' },
			{ role: 'assistant', content: '回答' },
		]);
	});

	it.each<MessageStatus>(['pending', 'streaming', 'stopped', 'error'])(
		'filters %s messages',
		status => {
			expect(
				buildChatContext([
					message('user', 'user', 'completed', ['问题']),
					message('assistant', 'assistant', status, ['不应进入上下文']),
				]),
			).toEqual([{ role: 'user', content: '问题' }]);
		},
	);

	it('filters empty text and the legacy loading marker', () => {
		expect(
			buildChatContext([
				message('empty', 'user', 'completed', ['  ']),
				message('loading', 'assistant', 'completed', [
					'<div class="loading-spinner"></div>',
				]),
			]),
		).toEqual([]);
	});

	it('supports an exclusive regeneration boundary', () => {
		const messages = [
			message('u1', 'user', 'completed', ['问题一']),
			message('a1', 'assistant', 'completed', ['回答一']),
			message('u2', 'user', 'completed', ['问题二']),
			message('a2', 'assistant', 'completed', ['需要重新生成']),
			message('u3', 'user', 'completed', ['后续消息']),
		];

		expect(buildChatContext(messages, 3)).toEqual([
			{ role: 'user', content: '问题一' },
			{ role: 'assistant', content: '回答一' },
			{ role: 'user', content: '问题二' },
		]);
	});

	it('does not include reasoning in provider text', () => {
		const assistant = message('a1', 'assistant', 'completed', ['最终回答']);
		assistant.reasoning = '内部推理';
		expect(getMessageText(assistant)).toBe('最终回答');
		expect(buildChatContext([assistant])).toEqual([
			{ role: 'assistant', content: '最终回答' },
		]);
	});

	it('maps DeepSeek token usage into the domain model', () => {
		expect(
			mapTokenUsage({
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
				prompt_cache_hit_tokens: 7,
				prompt_cache_miss_tokens: 3,
			}),
		).toEqual({
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			cacheHitTokens: 7,
			cacheMissTokens: 3,
		});
	});
});
