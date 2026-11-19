import type { ChatAttachment } from './attachment';
import type { RetrievedPassage } from '../services/rag/documentIndex';

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
			pageEnd?: number;
			headingPath?: string[];
			/** 对应回答正文中的 `[index]`（检索引用回填时设置）。 */
			index?: number;
			excerpt: string;
	  };

/**
 * 一次检索的追踪信息，用于“检索详情”面板与调试。只存 id、分数和少量元数据，
 * 不存片段正文，避免占用 localStorage 配额。
 */
export interface RetrievalTrace {
	/** 规则式改写后的查询。 */
	query: string;
	/** LLM 改写后的查询（开启改写且成功时）。 */
	rewrittenQuery?: string;
	mode: 'hybrid' | 'bm25' | 'dense';
	reranked: boolean;
	noAnswer: boolean;
	degraded: string[];
	hits: { chunkId: string; attachmentId: string; score: number; merged?: number }[];
	/** 回答中被删除的越界引用编号数量（引用幻觉）。 */
	invalidCitations?: number;
	durationMs: number;
}

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
	retrievalTrace?: RetrievalTrace;
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
	/** 在已建立索引的大文档中检索与问题相关的片段；失败时调用方回退到全文注入。 */
	retrieveDocuments?: (request: {
		query: string;
		attachmentIds: string[];
		signal: AbortSignal;
	}) => Promise<{
		passages: RetrievedPassage[];
		mode?: RetrievalTrace['mode'];
		reranked?: boolean;
		noAnswer?: boolean;
		degraded?: string[];
		rewrittenQuery?: string;
	}>;
}
