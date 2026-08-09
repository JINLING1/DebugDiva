import { describe, expect, it } from 'vitest';
import type { ChatMessage, MessageStatus } from '../../types/chat';
import type {
	DocumentAttachment,
	ImageAttachment,
} from '../../types/attachment';
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

const attachment = (
	id: string,
	text: string,
	overrides: Partial<DocumentAttachment> = {},
): DocumentAttachment => ({
	id,
	kind: 'document',
	status: 'ready',
	name: `${id}.txt`,
	mimeType: 'text/plain',
	size: text.length,
	text,
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const imageAttachment = (
	id: string,
	overrides: Partial<ImageAttachment> = {},
): ImageAttachment => ({
	id,
	kind: 'image',
	status: 'ready',
	name: `${id}.png`,
	mimeType: 'image/png',
	size: 100,
	result: {
		summary: '代码编辑器和错误终端截图',
		extractedText: 'TypeError: value is undefined',
		objects: ['代码编辑器', '终端'],
		warnings: [],
	},
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
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

	it('injects active attachments before the associated user question in file order', () => {
		const user = message('u1', 'user', 'completed', ['请审查这些文件']);
		user.contents.push(
			{
				type: 'file',
				attachmentId: 'second',
				name: 'second.txt',
				mimeType: 'text/plain',
				size: 2,
			},
			{
				type: 'file',
				attachmentId: 'first',
				name: 'first.txt',
				mimeType: 'text/plain',
				size: 1,
			},
		);

		const [providerMessage] = buildChatContext([user], undefined, {
			activeAttachmentIds: ['first', 'second'],
			attachmentResults: [attachment('first', 'A'), attachment('second', 'B')],
		});

		expect(providerMessage.content).toContain(
			'[附件开始]\n文件名：second.txt\n文件类型：text/plain\n内容：\nB\n[附件结束]',
		);
		expect(providerMessage.content.indexOf('second.txt')).toBeLessThan(
			providerMessage.content.indexOf('first.txt'),
		);
		expect(providerMessage.content).toMatch(/\[附件结束\]\n\n用户问题：请审查这些文件$/);
	});

	it('does not inject inactive, missing, failed, or empty attachments', () => {
		const user = message('u1', 'user', 'completed', ['问题']);
		user.contents.push(
			{ type: 'file', attachmentId: 'inactive', name: 'i', mimeType: 'text/plain', size: 1 },
			{ type: 'file', attachmentId: 'failed', name: 'f', mimeType: 'text/plain', size: 1 },
			{ type: 'file', attachmentId: 'empty', name: 'e', mimeType: 'text/plain', size: 1 },
		);

		expect(
			buildChatContext([user], undefined, {
				activeAttachmentIds: ['failed', 'empty', 'missing'],
				attachmentResults: [
					attachment('inactive', 'not active'),
					attachment('failed', 'bad', { status: 'error' }),
					attachment('empty', '   '),
				],
			}),
		).toEqual([{ role: 'user', content: '问题' }]);
	});

	it('injects each attachment once and falls back to the latest user turn after cropping', () => {
		const first = message('u1', 'user', 'completed', ['第一问']);
		first.contents.push({
			type: 'file', attachmentId: 'doc', name: 'doc.txt', mimeType: 'text/plain', size: 3,
		});
		const second = message('u2', 'user', 'completed', ['继续分析']);
		second.contents.push({
			type: 'file', attachmentId: 'doc', name: 'doc.txt', mimeType: 'text/plain', size: 3,
		});
		const options = {
			activeAttachmentIds: ['doc'],
			attachmentResults: [attachment('doc', '正文')],
		};

		const full = buildChatContext([first, second], undefined, options);
		expect(full.map(item => item.content).join('\n').match(/\[附件开始\]/g)).toHaveLength(1);

		const cropped = buildChatContext([message('u3', 'user', 'completed', ['摘要后的问题'])], undefined, options);
		expect(cropped[0].content).toContain('正文');
		expect(cropped[0].content).toMatch(/摘要后的问题$/);
	});

	it('injects persisted vision results before the user question without image bytes', () => {
		const user = message('vision-user', 'user', 'completed', ['请分析这个错误']);
		user.contents.push({
			type: 'image',
			attachmentId: 'screenshot',
			alt: 'error.png',
		});
		const image = imageAttachment('screenshot', {
			previewUrl: 'blob:https://example.test/private',
		});

		const [providerMessage] = buildChatContext([user], undefined, {
			activeAttachmentIds: ['screenshot'],
			attachmentResults: [image],
		});

		expect(providerMessage.content).toBe(
			[
				'[图片分析结果]',
				'图片名称：screenshot.png',
				'整体描述：代码编辑器和错误终端截图',
				'识别文字：',
				'TypeError: value is undefined',
				'可见对象：代码编辑器、终端',
				'[图片分析结果结束]',
				'',
				'用户问题：请分析这个错误',
			].join('\n'),
		);
		expect(providerMessage.content).not.toContain('blob:');
		expect(providerMessage.content).not.toContain('data:image');
	});

	it('supports mixed document and image context while skipping unfinished vision results', () => {
		const user = message('mixed-user', 'user', 'completed', ['综合说明']);
		user.contents.push(
			{ type: 'image', attachmentId: 'image', alt: 'image.png' },
			{
				type: 'file',
				attachmentId: 'document',
				name: 'document.txt',
				mimeType: 'text/plain',
				size: 3,
			},
			{ type: 'image', attachmentId: 'pending', alt: 'pending.png' },
		);

		const [providerMessage] = buildChatContext([user], undefined, {
			activeAttachmentIds: ['document', 'image', 'pending'],
			attachmentResults: [
				attachment('document', 'DOC'),
				imageAttachment('image'),
				imageAttachment('pending', { status: 'analyzing', result: undefined }),
			],
		});

		expect(providerMessage.content.indexOf('[图片分析结果]')).toBeLessThan(
			providerMessage.content.indexOf('[附件开始]'),
		);
		expect(providerMessage.content).not.toContain('pending.png');
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
