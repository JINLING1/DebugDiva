import type { ChatAttachment } from './attachment';

export type ChatRole = 'user' | 'assistant' | 'system';

export type MessageStatus =
	| 'pending'
	| 'streaming'
	| 'completed'
	| 'stopped'
	| 'error';

export type MessageContent =
	| { type: 'text'; text: string }
	| {
			type: 'file';
			attachmentId: string;
			name: string;
			mimeType: string;
			size: number;
	  }
	| {
			type: 'image';
			attachmentId: string;
			previewUrl?: string;
			alt?: string;
	  }
	| {
			type: 'citation';
			attachmentId: string;
			name: string;
			page?: number;
			excerpt: string;
	  };

export interface TokenUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	cacheHitTokens?: number;
	cacheMissTokens?: number;
}

export interface ChatMessage {
	id: string;
	role: ChatRole;
	status: MessageStatus;
	contents: MessageContent[];
	reasoning?: string;
	errorCode?: string;
	requestId?: string;
	usage?: TokenUsage;
	createdAt: number;
}

export interface ConversationSummary {
	userGoals: string[];
	confirmedFacts: string[];
	decisions: string[];
	unresolvedQuestions: string[];
	coveredUntilMessageId: string;
	updatedAt: number;
}

export interface ChatSession {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
	summary?: ConversationSummary;
	activeAttachmentIds: string[];
}

export interface ChatParams {
	input?: string;
	userInput?: string;
	updateIndex?: number;
	attachmentIds?: string[];
	attachmentResults?: ChatAttachment[];
	onAccepted?: (attachmentIds: string[]) => void;
	prepareAttachments?: (request: {
		prompt: string;
		attachmentIds: string[];
		signal: AbortSignal;
	}) => Promise<ChatAttachment[]>;
}
