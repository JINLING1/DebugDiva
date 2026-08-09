// @vitest-environment jsdom

import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MessageItem from './MessageItem.vue';
import type { ChatMessage } from '../../types/chat';

const MarkdownStub = defineComponent({
	name: 'Markdown',
	props: {
		message: { type: String, default: '' },
		isUserMessage: Boolean,
	},
	template:
		'<div data-testid="markdown" :data-user="String(isUserMessage)">{{ message }}</div>',
});

const createMessage = (
	overrides: Partial<ChatMessage> = {},
): ChatMessage => ({
	id: 'message-1',
	role: 'assistant',
	status: 'completed',
	contents: [{ type: 'text', text: '一条回复' }],
	createdAt: 1,
	...overrides,
});

const renderItem = (message: ChatMessage, isLast = true) =>
	mount(MessageItem, {
		props: { message, isLast },
		global: {
			stubs: { Markdown: MarkdownStub },
		},
	});

describe('MessageItem', () => {
	it('renders every content part with the message role', () => {
		const wrapper = renderItem(
			createMessage({
				role: 'user',
				contents: [
					{ type: 'text', text: '第一段' },
					{ type: 'text', text: '第二段' },
				],
			}),
		);

		const markdownParts = wrapper.findAll('[data-testid="markdown"]');
		expect(markdownParts.map(part => part.text())).toEqual(['第一段', '第二段']);
		expect(markdownParts.every(part => part.attributes('data-user') === 'true')).toBe(
			true,
		);
	});

	it.each(['pending', 'streaming'] as const)(
		'shows a spinner for an empty %s assistant response',
		status => {
			const wrapper = renderItem(createMessage({ status, contents: [] }));

			expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe(
				'AI 正在回复',
			);
		},
	);

	it('does not show the spinner after streaming content arrives', () => {
		const wrapper = renderItem(createMessage({ status: 'streaming' }));

		expect(wrapper.find('[role="status"]').exists()).toBe(false);
	});

	it('shows stopped and error status labels', async () => {
		const wrapper = renderItem(createMessage({ status: 'stopped' }));
		expect(wrapper.get('.stopped-status').text()).toBe('已停止');

		await wrapper.setProps({
			message: createMessage({
				status: 'error',
				errorCode: 'REQUEST_FAILED',
				requestId: 'req-visible',
			}),
		});
		expect(wrapper.find('.stopped-status').exists()).toBe(false);
		expect(wrapper.get('.error-status').text()).toBe(
			'请求失败 · ID req-visible',
		);
	});

	it('emits the message id when copying or regenerating a completed reply', async () => {
		const wrapper = renderItem(createMessage({ id: 'answer-7' }));

		await wrapper.get('[aria-label="复制回复"]').trigger('click');
		await wrapper.get('[aria-label="重新生成回复"]').trigger('click');

		expect(wrapper.emitted('copy')).toEqual([['answer-7']]);
		expect(wrapper.emitted('regenerate')).toEqual([['answer-7']]);
		expect(wrapper.find('[aria-label="重试回复"]').exists()).toBe(false);
	});

	it('hides regeneration for active or non-last replies', async () => {
		const wrapper = renderItem(createMessage({ status: 'streaming' }));
		expect(wrapper.find('[aria-label="重新生成回复"]').exists()).toBe(false);

		await wrapper.setProps({
			message: createMessage({ status: 'completed' }),
			isLast: false,
		});
		expect(wrapper.find('[aria-label="重新生成回复"]').exists()).toBe(false);
	});

	it('uses retry instead of regeneration for the last failed reply', async () => {
		const wrapper = renderItem(
			createMessage({ id: 'failed-answer', status: 'error', contents: [] }),
		);

		expect(wrapper.find('[aria-label="重新生成回复"]').exists()).toBe(false);
		await wrapper.get('[aria-label="重试回复"]').trigger('click');
		expect(wrapper.emitted('retry')).toEqual([['failed-answer']]);
	});
});
