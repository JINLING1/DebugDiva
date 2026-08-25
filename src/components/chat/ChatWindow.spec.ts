// @vitest-environment jsdom

import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatWindow from './ChatWindow.vue';
import type { DocumentAttachment } from '../../types/attachment';
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
	props: {
		attachments: { type: Array, default: () => [] },
		attachmentsDisabled: Boolean,
	},
	emits: [
		'send',
		'stop',
		'expandedChange',
		'selectFiles',
		'modelChange',
		'retryAttachment',
		'cancelAttachment',
		'removeAttachment',
	],
	template: `
		<div data-testid="composer">
			<button class="expand" @click="$emit('expandedChange', true)">expand</button>
			<button class="send" @click="$emit('send', 'mock question')">send</button>
			<button class="stop" @click="$emit('stop')">stop</button>
			<button class="mode" @click="$emit('modelChange', 'deep')">mode</button>
			<button class="retry-attachment" @click="$emit('retryAttachment', 'file-1')">retry attachment</button>
			<button class="cancel-attachment" @click="$emit('cancelAttachment', 'file-2')">cancel attachment</button>
			<button class="remove-attachment" @click="$emit('removeAttachment', 'file-3')">remove attachment</button>
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

const attachment: DocumentAttachment = {
	id: 'file-1',
	kind: 'document',
	status: 'ready',
	name: 'context.txt',
	mimeType: 'text/plain',
	size: 7,
	text: 'context',
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
};

const renderWindow = (
	props: Partial<InstanceType<typeof ChatWindow>['$props']> = {},
) =>
	mount(ChatWindow, {
		props: { messages, streaming: false, ...props },
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

	it('moves the empty welcome content when suggestions expand', async () => {
		const wrapper = renderWindow({ messages: [] });

		expect(wrapper.classes()).not.toContain('empty-composer-expanded');
		expect(wrapper.get('.welcome-wrapper').classes()).not.toContain(
			'composer-expanded',
		);

		await wrapper.get('.expand').trigger('click');

		expect(wrapper.classes()).toContain('empty-composer-expanded');
		expect(wrapper.get('.welcome-wrapper').classes()).toContain(
			'composer-expanded',
		);
	});

	it('passes attachments to the composer and forwards their actions', async () => {
		const wrapper = renderWindow({
			attachments: [attachment],
			attachmentsDisabled: false,
		});
		const composer = wrapper.getComponent(ChatComposerStub);

		expect(composer.props('attachments')).toEqual([attachment]);
		expect(composer.props('attachmentsDisabled')).toBe(false);

		await wrapper.get('.retry-attachment').trigger('click');
		await wrapper.get('.cancel-attachment').trigger('click');
		await wrapper.get('.remove-attachment').trigger('click');

		expect(wrapper.emitted('retryAttachment')).toEqual([['file-1']]);
		expect(wrapper.emitted('cancelAttachment')).toEqual([['file-2']]);
		expect(wrapper.emitted('removeAttachment')).toEqual([['file-3']]);
	});

	it('forwards message actions by stable message id', async () => {
		const wrapper = renderWindow();

		await wrapper.get('[aria-label="复制回复"]').trigger('click');
		await wrapper.get('[aria-label="重新生成回复"]').trigger('click');

		expect(wrapper.emitted('copy')).toEqual([['assistant-1']]);
		expect(wrapper.emitted('regenerate')).toEqual([['assistant-1']]);
	});
});
