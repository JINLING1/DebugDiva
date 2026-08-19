// @vitest-environment jsdom

import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageList from './MessageList.vue';
import type { ChatMessage } from '../../types/chat';

const scrollToBottom = vi.fn();
let resizeCallback: ResizeObserverCallback | undefined;

const DynamicScrollerStub = defineComponent({
	name: 'DynamicScroller',
	props: { items: { type: Array, default: () => [] } },
	emits: ['scroll'],
	setup(_props, { expose }) {
		expose({ scrollToBottom });
		return {};
	},
	template: `
		<div class="scroller-stub" @scroll="$emit('scroll')">
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

const MessageItemStub = defineComponent({
	name: 'MessageItem',
	props: { message: { type: Object, required: true } },
	template: '<article>{{ message.id }}</article>',
});

const message = (text: string): ChatMessage => ({
	id: 'assistant-1',
	role: 'assistant',
	status: 'completed',
	contents: [{ type: 'text', text }],
	createdAt: 1,
});

const renderList = () =>
	mount(MessageList, {
		props: { messages: [message('初始回答')] },
		global: {
			stubs: {
				DynamicScroller: DynamicScrollerStub,
				DynamicScrollerItem: DynamicScrollerItemStub,
				MessageItem: MessageItemStub,
			},
		},
	});

describe('MessageList bottom anchoring', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		scrollToBottom.mockClear();
		resizeCallback = undefined;
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: ResizeObserverCallback) {
					resizeCallback = callback;
				}

				observe() {}
				disconnect() {}
			},
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('keeps the last message visible when the list resizes at the bottom', async () => {
		renderList();
		resizeCallback?.([], {} as ResizeObserver);
		await nextTick();

		expect(scrollToBottom).toHaveBeenCalled();
	});

	it('does not force the user back to the bottom after they scroll upward', async () => {
		const wrapper = renderList();
		const scroller = wrapper.get('.scroller-stub');
		Object.defineProperties(scroller.element, {
			scrollHeight: { configurable: true, value: 1000 },
			clientHeight: { configurable: true, value: 400 },
			scrollTop: { configurable: true, value: 100, writable: true },
		});
		await scroller.trigger('scroll');
		scrollToBottom.mockClear();

		resizeCallback?.([], {} as ResizeObserver);
		await nextTick();
		vi.runAllTimers();

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	it('does not pull upward-reading users down during streaming updates', async () => {
		const wrapper = renderList();
		const scroller = wrapper.get('.scroller-stub');
		Object.defineProperties(scroller.element, {
			scrollHeight: { configurable: true, value: 1000 },
			clientHeight: { configurable: true, value: 400 },
			scrollTop: { configurable: true, value: 100, writable: true },
		});
		await scroller.trigger('scroll');
		scrollToBottom.mockClear();

		await wrapper.setProps({ messages: [message('流式回答新增内容')] });
		await nextTick();
		vi.runAllTimers();

		expect(scrollToBottom).not.toHaveBeenCalled();
	});
});
