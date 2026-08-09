export type AttachmentStatus =
	| 'uploading'
	| 'parsing'
	| 'analyzing'
	| 'ready'
	| 'error';

export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ACTIVE_ATTACHMENT_TEXT_LENGTH = 80_000;

export interface ParsedDocument {
	name: string;
	mimeType: string;
	size: number;
	text: string;
	pageCount?: number;
	truncated: boolean;
	warnings: string[];
}

export interface VisionResult {
	summary: string;
	extractedText: string;
	objects: string[];
	warnings: string[];
}

/**
 * Persistable document attachment data. The original File deliberately does
 * not belong to this type and is retained only by useAttachments at runtime.
 */
export interface DocumentAttachment {
	id: string;
	kind: 'document';
	status: AttachmentStatus;
	name: string;
	mimeType: string;
	size: number;
	text: string;
	pageCount?: number;
	truncated: boolean;
	warnings: string[];
	errorCode?: string;
	errorMessage?: string;
	createdAt: number;
	updatedAt: number;
}

/**
 * An image attachment keeps the original File and its Object URL outside the
 * persisted payload. `previewUrl` is intentionally runtime-only, while the
 * textual vision result can safely survive a refresh.
 */
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
