// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AttachmentList from './AttachmentList.vue';
import type { DocumentAttachment } from '../../types/attachment';

const createAttachment = (
	id: string,
	status: DocumentAttachment['status'],
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

describe('AttachmentList', () => {
	it('renders each attachment in input order', () => {
		const wrapper = mount(AttachmentList, {
			props: {
				attachments: [
					createAttachment('first', 'ready'),
					createAttachment('second', 'parsing'),
				],
			},
		});

		expect(
			wrapper
				.findAll('[data-attachment-id]')
				.map(card => card.attributes('data-attachment-id')),
		).toEqual(['first', 'second']);
	});

	it('forwards card events with stable attachment ids', async () => {
		const wrapper = mount(AttachmentList, {
			props: {
				attachments: [
					createAttachment('failed', 'error'),
					createAttachment('pending', 'parsing'),
				],
			},
		});

		await wrapper.get('[aria-label="重试附件 failed.txt"]').trigger('click');
		await wrapper.get('[aria-label="取消处理 pending.txt"]').trigger('click');
		await wrapper.get('[aria-label="移除附件 failed.txt"]').trigger('click');

		expect(wrapper.emitted('retry')).toEqual([['failed']]);
		expect(wrapper.emitted('cancel')).toEqual([['pending']]);
		expect(wrapper.emitted('remove')).toEqual([['failed']]);
	});

	it('does not render a container for an empty list', () => {
		const wrapper = mount(AttachmentList, { props: { attachments: [] } });

		expect(wrapper.find('[aria-label="待发送附件"]').exists()).toBe(false);
	});
});
