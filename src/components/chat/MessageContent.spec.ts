// @vitest-environment jsdom

import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MessageContent from './MessageContent.vue';
import type { ChatAttachment } from '../../types/attachment';
import type { ChatRole, MessageContent as ChatContent } from '../../types/chat';

const MarkdownStub = defineComponent({
	name: 'Markdown',
	props: {
		message: { type: String, default: '' },
		isUserMessage: Boolean,
	},
	template:
		'<div data-testid="markdown" :data-user="String(isUserMessage)">{{ message }}</div>',
});

const renderContent = (
	content: ChatContent,
	role: ChatRole = 'assistant',
	attachment?: ChatAttachment,
) =>
	mount(MessageContent, {
		props: { content, role, attachment },
		global: {
			stubs: { Markdown: MarkdownStub },
		},
	});

describe('MessageContent', () => {
	it('delegates text rendering to Markdown with the message role', () => {
		const wrapper = renderContent(
			{ type: 'text', text: '**需要渲染的内容**' },
			'user',
		);

		const markdown = wrapper.get('[data-testid="markdown"]');
		expect(markdown.text()).toBe('**需要渲染的内容**');
		expect(markdown.attributes('data-user')).toBe('true');
	});

	it('shows file metadata in a semantic attachment card', () => {
		const wrapper = renderContent({
			type: 'file',
			attachmentId: 'file-1',
			name: '需求说明.pdf',
			mimeType: 'application/pdf',
			size: 1536,
		});

		const card = wrapper.get('article[aria-label="文件附件"]');
		expect(card.text()).toContain('需求说明.pdf');
		expect(card.text()).toContain('application/pdf');
		expect(card.text()).toContain('1.5 KB');
	});

	it('renders an image preview with accessible alternative text', () => {
		const wrapper = renderContent({
			type: 'image',
			attachmentId: 'image-1',
			previewUrl: 'blob:test-preview',
			alt: '控制台截图',
		});

		const image = wrapper.get('img');
		expect(image.attributes('src')).toBe('blob:test-preview');
		expect(image.attributes('alt')).toBe('控制台截图');
		expect(wrapper.get('figcaption').text()).toBe('控制台截图');
	});

	it('shows an accessible placeholder when an image has no preview', () => {
		const wrapper = renderContent({
			type: 'image',
			attachmentId: 'image-2',
			alt: '网络架构图',
		});

		expect(wrapper.find('img').exists()).toBe(false);
		expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe(
			'网络架构图',
		);
		expect(wrapper.text()).toContain('图片暂不可预览');
	});

	it('renders runtime previews without exposing persisted vision analysis', () => {
		const wrapper = renderContent(
			{
				type: 'image',
				attachmentId: 'vision-image',
				alt: '报错截图',
			},
			'user',
			{
				id: 'vision-image',
				kind: 'image',
				status: 'ready',
				name: 'error.png',
				mimeType: 'image/png',
				size: 100,
				previewUrl: 'blob:test-vision-preview',
				result: {
					summary: '终端显示运行时错误',
					extractedText: 'TypeError: undefined',
					objects: ['终端', '代码编辑器'],
					warnings: ['部分文字可能不完整'],
				},
				warnings: [],
				createdAt: 1,
				updatedAt: 2,
			},
		);

		expect(wrapper.get('img').attributes('src')).toBe(
			'blob:test-vision-preview',
		);
		expect(wrapper.find('[aria-label="图片分析结果"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain('终端显示运行时错误');
		expect(wrapper.text()).not.toContain('TypeError: undefined');
		expect(wrapper.text()).not.toContain('终端、代码编辑器');
	});

	it('does not expose cached analysis when an image preview is gone', () => {
		const wrapper = renderContent(
			{ type: 'image', attachmentId: 'restored', alt: 'restored.png' },
			'user',
			{
				id: 'restored',
				kind: 'image',
				status: 'ready',
				name: 'restored.png',
				mimeType: 'image/png',
				size: 10,
				result: {
					summary: '已恢复的分析',
					extractedText: '',
					objects: [],
					warnings: [],
				},
				warnings: ['原图未保存，仍可继续对话'],
				createdAt: 1,
				updatedAt: 2,
			},
		);

		expect(wrapper.find('img').exists()).toBe(false);
		expect(wrapper.text()).toContain('图片暂不可预览');
		expect(wrapper.text()).not.toContain('已恢复的分析');
	});

	it('renders a citation source, page and excerpt', () => {
		const wrapper = renderContent({
			type: 'citation',
			attachmentId: 'citation-1',
			name: 'Vue 指南.pdf',
			page: 12,
			excerpt: '组合式 API 可以更灵活地组织逻辑。',
		});

		const citation = wrapper.get('aside[aria-label="引用内容"]');
		expect(citation.text()).toContain('Vue 指南.pdf');
		expect(citation.text()).toContain('第 12 页');
		expect(citation.get('blockquote').text()).toBe(
			'组合式 API 可以更灵活地组织逻辑。',
		);
	});
});
