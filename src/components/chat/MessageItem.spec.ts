// @vitest-environment jsdom

import { defineComponent, nextTick } from 'vue';
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
		expect(wrapper.get('.error-status .status-dot').attributes('aria-hidden')).toBe(
			'true',
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

describe('MessageItem citations and retrieval trace', () => {
	const citedMessage = createMessage({
		contents: [
			{ type: 'text', text: '端口被占用 [1]。' },
			{
				type: 'citation',
				attachmentId: 'doc',
				name: 'node-errors.md',
				index: 1,
				headingPath: ['Errors', 'Common system errors'],
				excerpt: 'EADDRINUSE (Address already in use)',
			},
		],
		retrievalTrace: {
			query: '端口被占用',
			rewrittenQuery: 'EADDRINUSE address already in use',
			mode: 'hybrid',
			reranked: true,
			noAnswer: false,
			degraded: [],
			hits: [{ chunkId: 'doc:3', attachmentId: 'doc', score: 0.93, merged: 2 }],
			durationMs: 812,
		},
	});

	it('renders [n] as a clickable reference that focuses the citation card', async () => {
		// 使用真实的 Markdown 组件，验证上标渲染与点击联动
		const wrapper = mount(MessageItem, {
			props: { message: citedMessage, isLast: true },
			attachTo: document.body,
		});
		await nextTick();
		const reference = wrapper.get('sup.citation-ref');
		expect(reference.text()).toBe('[1]');

		await reference.trigger('click');
		const card = wrapper.get('[data-citation-index="1"]');
		expect(card.classes()).toContain('citation-content--highlight');
		expect(document.activeElement).toBe(card.element);
		expect(card.text()).toContain('Errors › Common system errors');
		wrapper.unmount();
	});

	it('does not turn [n] into a reference when there is no matching card or inside code', async () => {
		const wrapper = mount(MessageItem, {
			props: {
				message: createMessage({
					contents: [{ type: 'text', text: '普通文本 [1] 与 `arr[1]`' }],
				}),
				isLast: true,
			},
		});
		await nextTick();
		expect(wrapper.find('sup.citation-ref').exists()).toBe(false);
		expect(wrapper.text()).toContain('[1]');
	});

	it('shows a collapsed retrieval details panel with the attachment names', () => {
		const wrapper = mount(MessageItem, {
			props: {
				message: citedMessage,
				isLast: true,
				attachmentResults: [
					{
						id: 'doc',
						kind: 'document',
						name: 'node-errors.md',
						mimeType: 'text/markdown',
						size: 1,
						status: 'ready',
						text: '',
					} as never,
				],
			},
			global: { stubs: { Markdown: MarkdownStub } },
		});
		const details = wrapper.get('details.retrieval-trace');
		expect(details.attributes('open')).toBeUndefined();
		expect(details.text()).toContain('混合检索 + 改写 + 重排序 · 1 段 · 812 ms');
		expect(details.text()).toContain('EADDRINUSE address already in use');
		expect(details.text()).toContain('node-errors.md');
		expect(details.text()).toContain('合并 2 段');
	});
});
