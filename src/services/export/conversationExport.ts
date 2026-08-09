import {
	normalizeDocumentAttachment,
	normalizeImageAttachment,
} from '../storage/attachmentStorage';
import { normalizeConversationSummary } from '../storage/summaryStorage';
import type {
	ChatAttachment,
	DocumentAttachment,
	ImageAttachment,
	VisionResult,
} from '../../types/attachment';
import type {
	ChatMessage,
	ChatSession,
	ConversationSummary,
	MessageContent,
	TokenUsage,
} from '../../types/chat';

export const CONVERSATION_EXPORT_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_EXPORT_APP = 'DebugDiva' as const;

type ExportedMessageContent =
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
			alt?: string;
	  }
	| {
			type: 'citation';
			attachmentId: string;
			name: string;
			page?: number;
			excerpt: string;
	  };

export interface ExportedChatMessage {
	id: string;
	role: ChatMessage['role'];
	status: ChatMessage['status'];
	contents: ExportedMessageContent[];
	reasoning?: string;
	errorCode?: string;
	usage?: TokenUsage;
	createdAt: number;
}

export interface ExportedChatSession {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ExportedChatMessage[];
	summary?: ConversationSummary;
	activeAttachmentIds: string[];
}

type ExportedDocumentAttachment = DocumentAttachment;
type ExportedImageAttachment = Omit<ImageAttachment, 'previewUrl'>;
export type ExportedAttachment =
	| ExportedDocumentAttachment
	| ExportedImageAttachment;

export interface ConversationExportDocument {
	schemaVersion: typeof CONVERSATION_EXPORT_SCHEMA_VERSION;
	app: typeof CONVERSATION_EXPORT_APP;
	exportedAt: string;
	session: ExportedChatSession;
	attachments: ExportedAttachment[];
}

export interface ConversationDownloadEnvironment {
	documentRef?: Document;
	urlApi?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export interface ConversationDownloadResult {
	filename: string;
	bytes: number;
}

const projectContent = (
	content: MessageContent,
): ExportedMessageContent | null => {
	switch (content.type) {
		case 'text':
			return { type: 'text', text: content.text };
		case 'file':
			return {
				type: 'file',
				attachmentId: content.attachmentId,
				name: content.name,
				mimeType: content.mimeType,
				size: content.size,
			};
		case 'image':
			return {
				type: 'image',
				attachmentId: content.attachmentId,
				...(typeof content.alt === 'string' ? { alt: content.alt } : {}),
			};
		case 'citation':
			return {
				type: 'citation',
				attachmentId: content.attachmentId,
				name: content.name,
				...(typeof content.page === 'number' ? { page: content.page } : {}),
				excerpt: content.excerpt,
			};
		default:
			return null;
	}
};

const projectUsage = (usage: TokenUsage | undefined): TokenUsage | undefined => {
	if (!usage) return undefined;
	const projected: TokenUsage = {};
	for (const key of [
		'promptTokens',
		'completionTokens',
		'totalTokens',
		'cacheHitTokens',
		'cacheMissTokens',
	] as const) {
		const value = usage[key];
		if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
			projected[key] = value;
		}
	}
	return Object.keys(projected).length ? projected : undefined;
};

const projectMessage = (message: ChatMessage): ExportedChatMessage => {
	const usage = projectUsage(message.usage);
	return {
		id: message.id,
		role: message.role,
		status: message.status,
		contents: message.contents
			.map(projectContent)
			.filter(
				(content): content is ExportedMessageContent => content !== null,
			),
		...(typeof message.reasoning === 'string'
			? { reasoning: message.reasoning }
			: {}),
		...(typeof message.errorCode === 'string'
			? { errorCode: message.errorCode }
			: {}),
		...(usage ? { usage } : {}),
		createdAt: message.createdAt,
	};
};

const projectVisionResult = (result: VisionResult): VisionResult => ({
	summary: result.summary,
	extractedText: result.extractedText,
	objects: [...result.objects],
	warnings: [...result.warnings],
});

const projectAttachment = (
	attachment: ChatAttachment,
): ExportedAttachment | null => {
	if (attachment.kind === 'document') {
		const normalized = normalizeDocumentAttachment(attachment);
		if (!normalized) return null;
		return {
			id: normalized.id,
			kind: 'document',
			status: normalized.status,
			name: normalized.name,
			mimeType: normalized.mimeType,
			size: normalized.size,
			text: normalized.text,
			...(normalized.pageCount !== undefined
				? { pageCount: normalized.pageCount }
				: {}),
			truncated: normalized.truncated,
			warnings: [...normalized.warnings],
			...(normalized.errorCode ? { errorCode: normalized.errorCode } : {}),
			...(normalized.errorMessage
				? { errorMessage: normalized.errorMessage }
				: {}),
			createdAt: normalized.createdAt,
			updatedAt: normalized.updatedAt,
		};
	}

	const normalized = normalizeImageAttachment(attachment);
	if (!normalized) return null;
	return {
		id: normalized.id,
		kind: 'image',
		status: normalized.status,
		name: normalized.name,
		mimeType: normalized.mimeType,
		size: normalized.size,
		...(normalized.result
			? { result: projectVisionResult(normalized.result) }
			: {}),
		warnings: [...normalized.warnings],
		...(normalized.errorCode ? { errorCode: normalized.errorCode } : {}),
		...(normalized.errorMessage
			? { errorMessage: normalized.errorMessage }
			: {}),
		createdAt: normalized.createdAt,
		updatedAt: normalized.updatedAt,
	};
};

export const collectSessionAttachmentIds = (
	session: ChatSession,
): string[] => {
	const ids = new Set<string>();
	for (const message of session.messages) {
		for (const content of message.contents) {
			if (
				(content.type === 'file' ||
					content.type === 'image' ||
					content.type === 'citation') &&
				content.attachmentId
			) {
				ids.add(content.attachmentId);
			}
		}
	}
	for (const id of session.activeAttachmentIds) {
		if (id) ids.add(id);
	}
	return [...ids];
};

export const createConversationExport = (
	session: ChatSession,
	attachments: readonly ChatAttachment[],
	exportedAt = new Date(),
): ConversationExportDocument => {
	const referencedIds = new Set(collectSessionAttachmentIds(session));
	const summary = normalizeConversationSummary(session.summary);
	const exportedAttachmentIds = new Set<string>();
	const projectedAttachments: ExportedAttachment[] = [];
	for (const attachment of attachments) {
		if (
			!referencedIds.has(attachment.id) ||
			exportedAttachmentIds.has(attachment.id)
		) {
			continue;
		}
		const projected = projectAttachment(attachment);
		if (!projected) continue;
		exportedAttachmentIds.add(projected.id);
		projectedAttachments.push(projected);
	}

	return {
		schemaVersion: CONVERSATION_EXPORT_SCHEMA_VERSION,
		app: CONVERSATION_EXPORT_APP,
		exportedAt: exportedAt.toISOString(),
		session: {
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			messages: session.messages.map(projectMessage),
			...(summary ? { summary } : {}),
			activeAttachmentIds: [...new Set(session.activeAttachmentIds)],
		},
		attachments: projectedAttachments,
	};
};

export const serializeConversationExport = (
	document: ConversationExportDocument,
): string => `${JSON.stringify(document, null, 2)}\n`;

const WINDOWS_RESERVED_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const createConversationExportFilename = (
	title: string,
	exportedAt = new Date(),
): string => {
	let safeTitle = title
		.normalize('NFKC')
		.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/-+/g, '-')
		.replace(/^[ .-]+|[ .-]+$/g, '')
		.slice(0, 60)
		.trim()
		.replace(/[ .]+$/g, '');
	if (!safeTitle || WINDOWS_RESERVED_FILENAME.test(safeTitle)) {
		safeTitle = 'conversation';
	}
	const date = Number.isFinite(exportedAt.getTime())
		? exportedAt.toISOString().slice(0, 10)
		: 'export';
	return `DebugDiva-${safeTitle}-${date}.json`;
};

export const downloadConversationExport = (
	session: ChatSession,
	attachments: readonly ChatAttachment[],
	exportedAt = new Date(),
	environment: ConversationDownloadEnvironment = {},
): ConversationDownloadResult => {
	const documentRef = environment.documentRef ?? document;
	const urlApi = environment.urlApi ?? URL;
	const serialized = serializeConversationExport(
		createConversationExport(session, attachments, exportedAt),
	);
	const blob = new Blob([serialized], {
		type: 'application/json;charset=utf-8',
	});
	const objectUrl = urlApi.createObjectURL(blob);
	const filename = createConversationExportFilename(session.title, exportedAt);
	const anchor = documentRef.createElement('a');
	anchor.href = objectUrl;
	anchor.download = filename;
	anchor.hidden = true;
	documentRef.body.appendChild(anchor);

	try {
		anchor.click();
	} finally {
		anchor.remove();
		urlApi.revokeObjectURL(objectUrl);
	}

	return { filename, bytes: blob.size };
};
