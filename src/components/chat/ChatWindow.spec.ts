// @vitest-environment jsdom

import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatWindow from './ChatWindow.vue';
import type { ChatMessage } from '../../types/chat';

const DynamicScrollerStub = defineComponent({
	name: 'DynamicScroller',
	props: { items: { type: Array, default: () => [] } },
	template: `
		<div data-testid="scroller">
			<slot
				v-for="(item, index) in items"
				:key="item.id"
				:item="item"
				:index="index"
				:active="true"
			/>
		</div>
	`,
});

const DynamicScrollerItemStub = defineComponent({
	name: 'DynamicScrollerItem',
	template: '<div><slot /></div>',
});

const MarkdownStub = defineComponent({
	name: 'Markdown',
	props: { message: { type: String, default: '' }, isUserMessage: Boolean },
	template:
		'<div data-testid="markdown" :data-user="String(isUserMessage)">{{ message }}</div>',
});

const ChatComposerStub = defineComponent({
	name: 'ChatComposer',
	emits: ['send', 'stop', 'selectFiles', 'modelChange'],
	template: `
		<div data-testid="composer">
			<button class="send" @click="$emit('send', 'mock question')">send</button>
			<button class="stop" @click="$emit('stop')">stop</button>
			<button class="mode" @click="$emit('modelChange', 'deep')">mode</button>
		</div>
	`,
});

const messages: ChatMessage[] = [
	{
		id: 'user-1',
		role: 'user',
		status: 'completed',
		contents: [{ type: 'text', text: 'Mock 用户问题' }],
		createdAt: 1,
	},
	{
		id: 'assistant-1',
		role: 'assistant',
		status: 'completed',
		contents: [{ type: 'text', text: 'Mock 助手回答' }],
		createdAt: 2,
	},
];

const renderWindow = () =>
	mount(ChatWindow, {
		props: { messages, streaming: false },
		global: {
			stubs: {
				DynamicScroller: DynamicScrollerStub,
				DynamicScrollerItem: DynamicScrollerItemStub,
				Markdown: MarkdownStub,
				ChatComposer: ChatComposerStub,
			},
		},
	});

describe('ChatWindow', () => {
	it('renders mock messages without Pinia, API or localStorage', () => {
		const wrapper = renderWindow();
		const markdown = wrapper.findAll('[data-testid="markdown"]');

		expect(markdown.map(item => item.text())).toEqual([
			'Mock 用户问题',
			'Mock 助手回答',
		]);
		expect(markdown[0].attributes('data-user')).toBe('true');
		expect(markdown[1].attributes('data-user')).toBe('false');
	});

	it('forwards composer events through its public interface', async () => {
		const wrapper = renderWindow();

		await wrapper.get('.send').trigger('click');
		await wrapper.get('.stop').trigger('click');
		await wrapper.get('.mode').trigger('click');

		expect(wrapper.emitted('send')).toEqual([['mock question']]);
		expect(wrapper.emitted('stop')).toEqual([[]]);
		expect(wrapper.emitted('modelChange')).toEqual([['deep']]);
	});

	it('forwards message actions by stable message id', async () => {
		const wrapper = renderWindow();

		await wrapper.get('[aria-label="复制回复"]').trigger('click');
		await wrapper.get('[aria-label="重新生成回复"]').trigger('click');

		expect(wrapper.emitted('copy')).toEqual([['assistant-1']]);
		expect(wrapper.emitted('regenerate')).toEqual([['assistant-1']]);
	});
});
