export type AttachmentStatus =
	| 'waiting'
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
