// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AttachmentCard from './AttachmentCard.vue';
import type {
	DocumentAttachment,
	ImageAttachment,
} from '../../types/attachment';

const createAttachment = (
	overrides: Partial<DocumentAttachment> = {},
): DocumentAttachment => ({
	id: 'attachment-1',
	kind: 'document',
	status: 'ready',
	name: 'debug-notes.md',
	mimeType: 'text/markdown',
	size: 2048,
	text: '# Debug notes',
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 2,
	...overrides,
});

const createImageAttachment = (
	overrides: Partial<ImageAttachment> = {},
): ImageAttachment => ({
	id: 'image-1',
	kind: 'image',
	status: 'ready',
	name: 'console.png',
	mimeType: 'image/png',
	size: 4096,
	previewUrl: 'blob:console-preview',
	result: {
		summary: '一张包含报错终端的截图',
		extractedText: 'TypeError: value is undefined',
		objects: ['终端', '代码编辑器'],
		warnings: ['部分文字可能不完整'],
	},
	warnings: [],
	createdAt: 1,
	updatedAt: 2,
	...overrides,
});

describe('AttachmentCard', () => {
	it.each([
		['uploading', '上传中'],
		['parsing', '解析中'],
		['analyzing', '分析中'],
		['ready', '已就绪'],
		['error', '处理失败'],
	] as const)('shows the %s status', (status, label) => {
		const wrapper = mount(AttachmentCard, {
			props: { attachment: createAttachment({ status }) },
		});

		expect(wrapper.get(`[data-status="${status}"]`).text()).toContain(label);
	});

	it('shows extraction metadata, truncation and parser warnings', () => {
		const wrapper = mount(AttachmentCard, {
			props: {
				attachment: createAttachment({
					pageCount: 12,
					truncated: true,
					warnings: ['仅提取到部分文本'],
				}),
			},
		});

		expect(wrapper.text()).toContain('2 KB');
		expect(wrapper.text()).toContain('12 页');
		expect(wrapper.get('.truncated-label').text()).toBe('内容已截断');
		expect(wrapper.get('[aria-label="附件提示"]').text()).toContain(
			'仅提取到部分文本',
		);
	});

	it('shows an image preview, analysis summary and vision disclosure', () => {
		const wrapper = mount(AttachmentCard, {
			props: { attachment: createImageAttachment() },
		});

		expect(wrapper.get('img').attributes('src')).toBe('blob:console-preview');
		expect(wrapper.get('img').attributes('alt')).toContain('console.png');
		expect(wrapper.get('.vision-summary').text()).toContain('报错终端');
		expect(wrapper.get('.vision-disclosure').text()).toBe(
			'图片内容由视觉模型预解析',
		);
		expect(wrapper.get('[aria-label="附件提示"]').text()).toContain(
			'部分文字可能不完整',
		);
	});

	it('keeps the analysis visible when a restored image has no preview', () => {
		const wrapper = mount(AttachmentCard, {
			props: {
				attachment: createImageAttachment({
					previewUrl: undefined,
					warnings: ['原图未保存，已保留分析结果'],
				}),
			},
		});

		expect(wrapper.find('img').exists()).toBe(false);
		expect(wrapper.get('.image-thumbnail').text()).toContain('🖼️');
		expect(wrapper.text()).toContain('原图未保存，已保留分析结果');
	});

	it('emits the attachment id for cancel and remove while processing', async () => {
		const wrapper = mount(AttachmentCard, {
			props: {
				attachment: createAttachment({ id: 'parsing-7', status: 'parsing' }),
			},
		});

		await wrapper.get('[aria-label="取消处理 debug-notes.md"]').trigger('click');
		await wrapper.get('[aria-label="移除附件 debug-notes.md"]').trigger('click');

		expect(wrapper.emitted('cancel')).toEqual([['parsing-7']]);
		expect(wrapper.emitted('remove')).toEqual([['parsing-7']]);
	});

	it('shows a clear error and emits retry and remove ids', async () => {
		const wrapper = mount(AttachmentCard, {
			props: {
				attachment: createAttachment({
					id: 'failed-9',
					status: 'error',
					errorMessage: 'PDF 解析失败',
				}),
			},
		});

		expect(wrapper.get('[role="alert"]').text()).toBe('PDF 解析失败');
		await wrapper.get('[aria-label="重试附件 debug-notes.md"]').trigger('click');
		await wrapper.get('[aria-label="移除附件 debug-notes.md"]').trigger('click');

		expect(wrapper.emitted('retry')).toEqual([['failed-9']]);
		expect(wrapper.emitted('remove')).toEqual([['failed-9']]);
	});
});
