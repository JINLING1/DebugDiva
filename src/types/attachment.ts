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
