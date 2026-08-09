import type { ChatMessage, MessageContent, TokenUsage } from '../../types/chat';
import type { DocumentAttachment } from '../../types/attachment';
import type { ProviderMessage } from '../../types/provider';

const LEGACY_LOADING_MARKER = '<div class="loading-spinner"></div>';

export const getMessageText = (message: ChatMessage): string =>
	message.contents
		.filter(
			(content): content is Extract<MessageContent, { type: 'text' }> =>
				content.type === 'text',
		)
		.map(content => content.text)
		.filter(Boolean)
		.join('\n\n');

export const setMessageText = (message: ChatMessage, text: string) => {
	const textContent = message.contents.find(
		(content): content is Extract<MessageContent, { type: 'text' }> =>
			content.type === 'text',
	);

	if (textContent) {
		textContent.text = text;
	} else {
		message.contents.unshift({ type: 'text', text });
	}
};

export const appendMessageText = (message: ChatMessage, delta: string) => {
	setMessageText(message, getMessageText(message) + delta);
};

export const isContextMessage = (message: ChatMessage): boolean => {
	if (message.status !== 'completed') return false;
	const text = getMessageText(message).trim();
	return Boolean(text && text !== LEGACY_LOADING_MARKER);
};

export interface BuildChatContextOptions {
	activeAttachmentIds?: readonly string[];
	attachmentResults?: readonly DocumentAttachment[];
}

const sanitizeAttachmentMetadata = (value: string): string =>
	value.replace(/[\r\n]+/g, ' ').trim();

const formatAttachmentBlock = (attachment: DocumentAttachment): string =>
	[
		'[附件开始]',
		`文件名：${sanitizeAttachmentMetadata(attachment.name)}`,
		`文件类型：${sanitizeAttachmentMetadata(attachment.mimeType)}`,
		'内容：',
		attachment.text.trim(),
		'[附件结束]',
	].join('\n');

export const buildChatContext = (
	messages: ChatMessage[],
	endExclusive = messages.length,
	options: BuildChatContextOptions = {},
): ProviderMessage[] => {
	const activeIds = [...new Set(options.activeAttachmentIds ?? [])];
	const activeIdSet = new Set(activeIds);
	const readyAttachments = new Map(
		(options.attachmentResults ?? [])
			.filter(
				attachment =>
					attachment.status === 'ready' && Boolean(attachment.text.trim()),
			)
			.map(attachment => [attachment.id, attachment]),
	);
	const injectedIds = new Set<string>();
	const context: ProviderMessage[] = [];
	let lastUserIndex = -1;
	let lastUserHasAttachmentBlock = false;

	for (const message of messages.slice(0, endExclusive)) {
		if (!isContextMessage(message)) continue;

		const messageText = getMessageText(message).trim();
		let content = messageText;

		if (message.role === 'user') {
			const blocks: string[] = [];
			for (const item of message.contents) {
				if (
					item.type !== 'file' ||
					!activeIdSet.has(item.attachmentId) ||
					injectedIds.has(item.attachmentId)
				) {
					continue;
				}

				const attachment = readyAttachments.get(item.attachmentId);
				if (!attachment) continue;
				blocks.push(formatAttachmentBlock(attachment));
				injectedIds.add(item.attachmentId);
			}

			if (blocks.length) {
				content = `${blocks.join('\n\n')}\n\n用户问题：${messageText}`;
			}
			lastUserIndex = context.length;
			lastUserHasAttachmentBlock = blocks.length > 0;
		}

		context.push({ role: message.role, content });
	}

	// A summarized/cropped history may no longer contain the original file card.
	// Keep active documents available by attaching them to the latest user turn.
	if (lastUserIndex >= 0) {
		const remainingBlocks = activeIds
			.filter(id => !injectedIds.has(id))
			.map(id => readyAttachments.get(id))
			.filter(
				(attachment): attachment is DocumentAttachment =>
					attachment !== undefined,
			)
			.map(formatAttachmentBlock);

		if (remainingBlocks.length) {
			const latestUserContent = context[lastUserIndex].content;
			context[lastUserIndex] = {
				...context[lastUserIndex],
				content: `${remainingBlocks.join('\n\n')}\n\n${
					lastUserHasAttachmentBlock
						? latestUserContent
						: `用户问题：${latestUserContent}`
				}`,
			};
		}
	}

	return context;
};

export const mapTokenUsage = (
	usage?: Record<string, number>,
): TokenUsage | undefined => {
	if (!usage) return undefined;

	return {
		promptTokens: usage.prompt_tokens,
		completionTokens: usage.completion_tokens,
		totalTokens: usage.total_tokens,
		cacheHitTokens: usage.prompt_cache_hit_tokens,
		cacheMissTokens: usage.prompt_cache_miss_tokens,
	};
};
