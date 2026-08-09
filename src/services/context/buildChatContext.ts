import type {
	ChatMessage,
	ConversationSummary,
	MessageContent,
	TokenUsage,
} from '../../types/chat';
import type { ChatAttachment } from '../../types/attachment';
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
	attachmentResults?: readonly ChatAttachment[];
	summary?: ConversationSummary;
}

const sanitizeAttachmentMetadata = (value: string): string =>
	value.replace(/[\r\n]+/g, ' ').trim();

const hasUsableAttachmentContext = (attachment: ChatAttachment): boolean => {
	if (attachment.status !== 'ready') return false;
	if (attachment.kind === 'document') return Boolean(attachment.text.trim());
	return Boolean(
		attachment.result &&
			(attachment.result.summary.trim() ||
				attachment.result.extractedText.trim() ||
				attachment.result.objects.length),
	);
};

const formatAttachmentBlock = (attachment: ChatAttachment): string => {
	if (attachment.kind === 'document') {
		return [
			'[附件开始]',
			`文件名：${sanitizeAttachmentMetadata(attachment.name)}`,
			`文件类型：${sanitizeAttachmentMetadata(attachment.mimeType)}`,
			'内容：',
			attachment.text.trim(),
			'[附件结束]',
		].join('\n');
	}

	const result = attachment.result!;
	return [
		'[图片分析结果]',
		`图片名称：${sanitizeAttachmentMetadata(attachment.name)}`,
		`整体描述：${result.summary.trim() || '未提供'}`,
		'识别文字：',
		result.extractedText.trim() || '未识别到文字',
		`可见对象：${result.objects.join('、') || '未识别'}`,
		'[图片分析结果结束]',
	].join('\n');
};

const formatSummaryList = (items: readonly string[]): string[] =>
	items.length ? items.map(item => `- ${item}`) : ['- 无'];

export const formatConversationSummary = (
	summary: ConversationSummary,
): string =>
	[
		'[历史会话摘要开始]',
		'用户目标：',
		...formatSummaryList(summary.userGoals),
		'已确认事实：',
		...formatSummaryList(summary.confirmedFacts),
		'已做决定：',
		...formatSummaryList(summary.decisions),
		'未解决问题：',
		...formatSummaryList(summary.unresolvedQuestions),
		'[历史会话摘要结束]',
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
			.filter(hasUsableAttachmentContext)
			.map(attachment => [attachment.id, attachment]),
	);
	const injectedIds = new Set<string>();
	const context: ProviderMessage[] = [];
	let lastUserIndex = -1;
	let lastUserHasAttachmentBlock = false;
	const eligibleMessages = messages
		.slice(0, endExclusive)
		.filter(
			message =>
				(message.role === 'user' || message.role === 'assistant') &&
				isContextMessage(message),
		);
	const summaryBoundary = options.summary
		? eligibleMessages.findIndex(
				message => message.id === options.summary?.coveredUntilMessageId,
			)
		: -1;
	const activeSummary =
		summaryBoundary >= 0 ? options.summary : undefined;
	const rawMessages = activeSummary
		? eligibleMessages.slice(summaryBoundary + 1)
		: eligibleMessages;

	if (activeSummary) {
		context.push({
			role: 'user',
			content: formatConversationSummary(activeSummary),
		});

		const stableAttachmentBlocks = activeIds
			.map(id => readyAttachments.get(id))
			.filter(
				(attachment): attachment is ChatAttachment =>
					attachment !== undefined,
			)
			.map(attachment => {
				injectedIds.add(attachment.id);
				return formatAttachmentBlock(attachment);
			});
		if (stableAttachmentBlocks.length) {
			context.push({
				role: 'user',
				content: [
					'[当前激活附件上下文开始]',
					...stableAttachmentBlocks,
					'[当前激活附件上下文结束]',
				].join('\n\n'),
			});
		}
	}

	for (const message of rawMessages) {
		const messageText = getMessageText(message).trim();
		let content = messageText;

		if (message.role === 'user' && !activeSummary) {
			const blocks: string[] = [];
			for (const item of message.contents) {
				const attachmentId =
					item.type === 'file' || item.type === 'image'
						? item.attachmentId
						: undefined;
				if (
					!attachmentId ||
					!activeIdSet.has(attachmentId) ||
					injectedIds.has(attachmentId)
				) {
					continue;
				}

				const attachment = readyAttachments.get(attachmentId);
				if (!attachment) continue;
				blocks.push(formatAttachmentBlock(attachment));
				injectedIds.add(attachmentId);
			}

			if (blocks.length) {
				content = `${blocks.join('\n\n')}\n\n用户问题：${messageText}`;
			}
		}
		if (message.role === 'user') {
			lastUserIndex = context.length;
			lastUserHasAttachmentBlock = content !== messageText;
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
				(attachment): attachment is ChatAttachment =>
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
