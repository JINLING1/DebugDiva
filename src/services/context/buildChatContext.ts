import type { ChatMessage, MessageContent, TokenUsage } from '../../types/chat';
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

export const buildChatContext = (
	messages: ChatMessage[],
	endExclusive = messages.length,
): ProviderMessage[] =>
	messages
		.slice(0, endExclusive)
		.filter(isContextMessage)
		.map(message => ({
			role: message.role,
			content: getMessageText(message).trim(),
		}));

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
