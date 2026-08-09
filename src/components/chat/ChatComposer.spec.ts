// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';
import ChatComposer from './ChatComposer.vue';
import type { DocumentAttachment } from '../../types/attachment';

const createAttachment = (
	id: string,
	status: DocumentAttachment['status'] = 'ready',
): DocumentAttachment => ({
	id,
	kind: 'document',
	status,
	name: `${id}.txt`,
	mimeType: 'text/plain',
	size: 12,
	text: status === 'ready' ? 'ready' : '',
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
});

const renderComposer = (
	props: Partial<InstanceType<typeof ChatComposer>['$props']> = {},
) =>
	mount(ChatComposer, {
		props: {
			streaming: false,
			hasMessages: false,
			attachmentsDisabled: true,
			...props,
		},
		global: { plugins: [ElementPlus] },
	});

describe('ChatComposer', () => {
	it('emits a trimmed message and clears the input', async () => {
		const wrapper = renderComposer();
		const textarea = wrapper.get('textarea');

		await textarea.setValue('  如何定位内存泄漏？  ');
		await wrapper.get('[aria-label="发送消息"]').trigger('click');

		expect(wrapper.emitted('send')).toEqual([['如何定位内存泄漏？']]);
		expect((textarea.element as HTMLTextAreaElement).value).toBe('');
	});

	it('does not send whitespace-only input', async () => {
		const wrapper = renderComposer();
		await wrapper.get('textarea').setValue('   ');

		expect(wrapper.get('[aria-label="发送消息"]').attributes()).toHaveProperty(
			'disabled',
		);
		expect(wrapper.emitted('send')).toBeUndefined();
	});

	it('submits with Enter but preserves Shift+Enter for a newline', async () => {
		const wrapper = renderComposer();
		const textarea = wrapper.get('textarea');

		await textarea.setValue('第一条消息');
		await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });
		expect(wrapper.emitted('send')).toBeUndefined();

		await textarea.trigger('keydown', { key: 'Enter' });
		expect(wrapper.emitted('send')).toEqual([['第一条消息']]);
	});

	it('turns the primary action into stop while streaming', async () => {
		const wrapper = renderComposer({ streaming: true, hasMessages: true });

		await wrapper.get('[aria-label="停止生成"]').trigger('click');

		expect(wrapper.emitted('stop')).toEqual([[]]);
		expect(wrapper.emitted('send')).toBeUndefined();
	});

	it('emits a selected suggestion without depending on a store', async () => {
		const wrapper = renderComposer();
		await wrapper.get('textarea').trigger('click');

		const suggestion = wrapper.get('.suggestion-item');
		const text = suggestion.text();
		await suggestion.trigger('click');

		expect(wrapper.emitted('send')).toEqual([[text]]);
	});

	it('only emits files through its public event', async () => {
		const wrapper = renderComposer({ attachmentsDisabled: false });
		const input = wrapper.get('input[type="file"]');
		const file = new File(['const answer = 42;'], 'demo.ts', {
			type: 'text/typescript',
		});
		Object.defineProperty(input.element, 'files', {
			configurable: true,
			value: [file],
		});

		await input.trigger('change');

		expect(wrapper.emitted('selectFiles')).toEqual([[[file]]]);
	});

	it('accepts supported document and vision image formats', () => {
		const wrapper = renderComposer({ attachmentsDisabled: false });
		const accept = wrapper.get('input[type="file"]').attributes('accept');

		expect(accept).toContain('.vue');
		expect(accept).toContain('.pdf');
		expect(accept).toContain('.docx');
		expect(accept).toContain('application/pdf');
		expect(accept).toContain('.png');
		expect(accept).toContain('.jpg');
		expect(accept).toContain('.webp');
		expect(accept).toContain('image/png');
		expect(accept).not.toContain('.gif');
	});

	it('disables attachment selection while streaming or at the three-file limit', async () => {
		const wrapper = renderComposer({
			attachmentsDisabled: false,
			streaming: true,
		});

		expect(wrapper.get('input[type="file"]').attributes()).toHaveProperty(
			'disabled',
		);
		expect(wrapper.get('[aria-label="选择附件"]').attributes()).toHaveProperty(
			'disabled',
		);

		await wrapper.setProps({
			streaming: false,
			attachments: [
				createAttachment('one'),
				createAttachment('two'),
				createAttachment('three'),
			],
		});

		expect(wrapper.get('input[type="file"]').attributes()).toHaveProperty(
			'disabled',
		);
	});

	it('blocks sending until every selected attachment is ready', async () => {
		const wrapper = renderComposer({
			attachments: [createAttachment('pending', 'parsing')],
		});
		const textarea = wrapper.get('textarea');
		await textarea.setValue('请分析这个文件');

		expect(wrapper.get('[aria-label="发送消息"]').attributes()).toHaveProperty(
			'disabled',
		);
		await textarea.trigger('keydown', { key: 'Enter' });
		expect(wrapper.emitted('send')).toBeUndefined();

		await wrapper.setProps({ attachments: [createAttachment('pending', 'ready')] });
		await wrapper.get('[aria-label="发送消息"]').trigger('click');
		expect(wrapper.emitted('send')).toEqual([['请分析这个文件']]);
	});

	it('renders attachments above the input and forwards attachment actions', async () => {
		const wrapper = renderComposer({
			attachments: [createAttachment('failed', 'error')],
		});

		const list = wrapper.get('[aria-label="待发送附件"]');
		const textarea = wrapper.get('textarea');
		expect(
			list.element.compareDocumentPosition(textarea.element) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		await wrapper.get('[aria-label="重试附件 failed.txt"]').trigger('click');
		await wrapper.get('[aria-label="移除附件 failed.txt"]').trigger('click');

		expect(wrapper.emitted('retryAttachment')).toEqual([['failed']]);
		expect(wrapper.emitted('removeAttachment')).toEqual([['failed']]);
	});

	it('forwards only a supported model mode', async () => {
		const wrapper = renderComposer({ modelMode: 'fast' });

		await wrapper.get('select[aria-label="回答模式"]').setValue('deep');

		expect(wrapper.emitted('modelChange')).toEqual([['deep']]);
	});
});
