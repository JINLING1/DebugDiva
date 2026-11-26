import type { DocumentSegment } from '../../functions/_shared/documentSegments';

export type AttachmentStatus =
	| 'waiting'
	| 'uploading'
	| 'parsing'
	| 'analyzing'
	| 'ready'
	| 'error';

export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ACTIVE_ATTACHMENT_TEXT_LENGTH = 80_000;
/** 全文注入（及检索失败时的兜底）使用的单文档文本上限；完整文本只进入本地检索索引。 */
export const MAX_DOCUMENT_CONTEXT_TEXT_LENGTH = 40_000;

export type { DocumentSegment };

/**
 * 文档检索索引状态：
 * - indexing：正在切块入库；
 * - lexical：已可用 BM25 检索，向量尚未就绪或向量化失败；
 * - ready：向量已就绪，可混合检索；
 * - failed：本地索引不可用，退回全文注入。
 */
export type DocumentIndexStatus = 'indexing' | 'lexical' | 'ready' | 'failed';

export interface DocumentIndexInfo {
	status: DocumentIndexStatus;
	chunkCount?: number;
	model?: string;
}

export interface ParsedDocument {
	name: string;
	mimeType: string;
	size: number;
	text: string;
	pageCount?: number;
	truncated: boolean;
	warnings: string[];
	segments?: DocumentSegment[];
}

export interface VisionResult {
	summary: string;
	extractedText: string;
	objects: string[];
	warnings: string[];
}

export interface DocumentAttachment {
	id: string;
	kind: 'document';
	status: AttachmentStatus;
	name: string;
	mimeType: string;
	size: number;
	/** 全文注入用文本，最多 MAX_DOCUMENT_CONTEXT_TEXT_LENGTH 字符。 */
	text: string;
	/** 解析出的完整文本长度（code point），可能大于 text 的长度。 */
	textLength?: number;
	pageCount?: number;
	truncated: boolean;
	warnings: string[];
	index?: DocumentIndexInfo;
	errorCode?: string;
	errorMessage?: string;
	createdAt: number;
	updatedAt: number;
}

export interface ImageAttachment {
	id: string;
	kind: 'image';
	status: AttachmentStatus;
	name: string;
	mimeType: string;
	size: number;
	previewUrl?: string;
	result?: VisionResult;
	warnings: string[];
	errorCode?: string;
	errorMessage?: string;
	createdAt: number;
	updatedAt: number;
}

export type ChatAttachment = DocumentAttachment | ImageAttachment;
