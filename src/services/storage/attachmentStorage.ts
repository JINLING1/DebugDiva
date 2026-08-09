import { MAX_PARSED_DOCUMENT_TEXT_LENGTH } from '../../api/files';
import type {
	AttachmentStatus,
	DocumentAttachment,
} from '../../types/attachment';

export const ATTACHMENT_RESULTS_STORAGE_KEY =
	'debugdiva:attachment-results:v1';
export const ATTACHMENT_RESULTS_SOFT_LIMIT_BYTES = 2 * 1024 * 1024;

const INTERRUPTED_ERROR_CODE = 'ATTACHMENT_PROCESSING_INTERRUPTED';
const INTERRUPTED_ERROR_MESSAGE =
	'页面刷新导致文件处理被中断，请重新选择文件后重试';
const TEXT_TRUNCATED_WARNING = '提取文本已截断至 40,000 字符';

export interface AttachmentStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface LoadAttachmentResultsResult {
	attachments: DocumentAttachment[];
	recoveredFromError: boolean;
	errorCode?: string;
	error?: string;
}

export interface SaveAttachmentResultsResult {
	ok: boolean;
	bytes: number;
	errorCode?: string;
	error?: string;
}

interface PersistedAttachmentEnvelope {
	version: 1;
	attachments: DocumentAttachment[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isAttachmentStatus = (value: unknown): value is AttachmentStatus =>
	value === 'uploading' ||
	value === 'parsing' ||
	value === 'analyzing' ||
	value === 'ready' ||
	value === 'error';

const isProcessingStatus = (status: AttachmentStatus): boolean =>
	status === 'uploading' || status === 'parsing' || status === 'analyzing';

const finiteNonNegativeNumber = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: undefined;

const validTimestamp = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) && value > 0
		? value
		: fallback;

const normalizeWarnings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];

/**
 * Rebuild an attachment from an explicit field allowlist. Runtime-only File,
 * Blob, Base64 and Object URL values are therefore never serialized.
 */
export const normalizeDocumentAttachment = (
	value: unknown,
	now = Date.now(),
): DocumentAttachment | null => {
	if (!isRecord(value)) return null;
	if (
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		value.kind !== 'document' ||
		typeof value.name !== 'string' ||
		value.name.length === 0 ||
		typeof value.mimeType !== 'string'
	) {
		return null;
	}

	const size = finiteNonNegativeNumber(value.size);
	if (size === undefined) return null;

	let status: AttachmentStatus = isAttachmentStatus(value.status)
		? value.status
		: 'error';
	let errorCode =
		typeof value.errorCode === 'string' ? value.errorCode : undefined;
	let errorMessage =
		typeof value.errorMessage === 'string' ? value.errorMessage : undefined;

	if (isProcessingStatus(status)) {
		status = 'error';
		errorCode = INTERRUPTED_ERROR_CODE;
		errorMessage = INTERRUPTED_ERROR_MESSAGE;
	} else if (!isAttachmentStatus(value.status)) {
		errorCode = 'INVALID_ATTACHMENT_STATUS';
		errorMessage = '附件状态无效，请重新选择文件';
	}

	let text = typeof value.text === 'string' ? value.text : '';
	let truncated = value.truncated === true;
	const warnings = normalizeWarnings(value.warnings);
	const textCharacters = Array.from(text);
	if (textCharacters.length > MAX_PARSED_DOCUMENT_TEXT_LENGTH) {
		text = textCharacters.slice(0, MAX_PARSED_DOCUMENT_TEXT_LENGTH).join('');
		truncated = true;
		if (!warnings.includes(TEXT_TRUNCATED_WARNING)) {
			warnings.push(TEXT_TRUNCATED_WARNING);
		}
	}

	const pageCount =
		typeof value.pageCount === 'number' &&
		Number.isInteger(value.pageCount) &&
		value.pageCount > 0
			? value.pageCount
			: undefined;
	const createdAt = validTimestamp(value.createdAt, now);
	const updatedAt = validTimestamp(value.updatedAt, createdAt);

	return {
		id: value.id,
		kind: 'document',
		status,
		name: value.name,
		mimeType: value.mimeType,
		size,
		text,
		pageCount,
		truncated,
		warnings,
		errorCode,
		errorMessage,
		createdAt,
		updatedAt,
	};
};

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const isQuotaError = (error: unknown): boolean => {
	if (!isRecord(error) && !(error instanceof Error)) return false;
	const name = 'name' in error ? String(error.name) : '';
	const message = 'message' in error ? String(error.message) : '';
	return (
		name === 'QuotaExceededError' ||
		name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		/quota/i.test(message)
	);
};

const getPersistedArray = (value: unknown): unknown[] | null => {
	if (Array.isArray(value)) return value;
	if (
		isRecord(value) &&
		value.version === 1 &&
		Array.isArray(value.attachments)
	) {
		return value.attachments;
	}
	return null;
};

export const loadAttachmentResults = (
	storage: AttachmentStorageLike,
	now = Date.now(),
): LoadAttachmentResultsResult => {
	let raw: string | null;
	try {
		raw = storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY);
	} catch (error) {
		return {
			attachments: [],
			recoveredFromError: true,
			errorCode: 'ATTACHMENT_STORAGE_READ_FAILED',
			error: error instanceof Error ? error.message : '附件记录读取失败',
		};
	}

	if (raw === null) {
		return { attachments: [], recoveredFromError: false };
	}

	try {
		const values = getPersistedArray(JSON.parse(raw));
		if (!values) throw new Error('附件记录格式无效');
		const attachments = values
			.map(value => normalizeDocumentAttachment(value, now))
			.filter((value): value is DocumentAttachment => value !== null);
		const skipped = values.length - attachments.length;

		return {
			attachments,
			recoveredFromError: skipped > 0,
			errorCode: skipped > 0 ? 'INVALID_ATTACHMENT_DATA' : undefined,
			error:
				skipped > 0 ? `已忽略 ${skipped} 条无效附件记录` : undefined,
		};
	} catch (error) {
		return {
			attachments: [],
			recoveredFromError: true,
			errorCode: 'ATTACHMENT_STORAGE_CORRUPTED',
			error: error instanceof Error ? error.message : '附件记录解析失败',
		};
	}
};

export const saveAttachmentResults = (
	storage: AttachmentStorageLike,
	attachments: readonly DocumentAttachment[],
	softLimitBytes = ATTACHMENT_RESULTS_SOFT_LIMIT_BYTES,
): SaveAttachmentResultsResult => {
	const normalized = attachments
		.map(value => normalizeDocumentAttachment(value))
		.filter((value): value is DocumentAttachment => value !== null);
	const envelope: PersistedAttachmentEnvelope = {
		version: 1,
		attachments: normalized,
	};
	const serialized = JSON.stringify(envelope);
	const bytes = byteLength(serialized);

	if (bytes > softLimitBytes) {
		return {
			ok: false,
			bytes,
			errorCode: 'ATTACHMENT_STORAGE_LIMIT_EXCEEDED',
			error: '附件解析结果已达到约 2MB 的本地存储软上限，请删除旧附件',
		};
	}

	try {
		storage.setItem(ATTACHMENT_RESULTS_STORAGE_KEY, serialized);
		return { ok: true, bytes };
	} catch (error) {
		return {
			ok: false,
			bytes,
			errorCode: isQuotaError(error)
				? 'ATTACHMENT_STORAGE_QUOTA_EXCEEDED'
				: 'ATTACHMENT_STORAGE_WRITE_FAILED',
			error:
				error instanceof Error ? error.message : '附件记录保存失败',
		};
	}
};

export const clearAttachmentResults = (
	storage: AttachmentStorageLike,
): boolean => {
	try {
		storage.removeItem(ATTACHMENT_RESULTS_STORAGE_KEY);
		return true;
	} catch {
		return false;
	}
};
