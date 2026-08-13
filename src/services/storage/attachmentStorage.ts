import { MAX_PARSED_DOCUMENT_TEXT_LENGTH } from '../../api/files';
import {
	MAX_VISION_EXTRACTED_TEXT_LENGTH,
	MAX_VISION_OBJECT_LENGTH,
	MAX_VISION_OBJECTS,
	MAX_VISION_SUMMARY_LENGTH,
	MAX_VISION_WARNING_LENGTH,
	MAX_VISION_WARNINGS,
} from '../../api/vision';
import type {
	AttachmentStatus,
	ChatAttachment,
	DocumentAttachment,
	ImageAttachment,
	VisionResult,
} from '../../types/attachment';

export const ATTACHMENT_RESULTS_STORAGE_KEY =
	'debugdiva:attachment-results:v1';
export const ATTACHMENT_RESULTS_SOFT_LIMIT_BYTES = 2 * 1024 * 1024;
export const MAX_PERSISTED_ATTACHMENTS = 200;

const MAX_ATTACHMENT_ID_LENGTH = 200;
const MAX_ATTACHMENT_NAME_LENGTH = 512;
const MAX_ATTACHMENT_MIME_LENGTH = 128;
const MAX_ATTACHMENT_WARNING_LENGTH = 500;
const MAX_ATTACHMENT_WARNINGS = 50;
const MAX_ATTACHMENT_ERROR_CODE_LENGTH = 128;
const MAX_ATTACHMENT_ERROR_MESSAGE_LENGTH = 1_000;

const INTERRUPTED_ERROR_CODE = 'ATTACHMENT_PROCESSING_INTERRUPTED';
const INTERRUPTED_ERROR_MESSAGE =
	'页面刷新导致文件处理被中断，请重新选择文件后重试';
const TEXT_TRUNCATED_WARNING = '提取文本已截断至 40,000 字符';
export const IMAGE_ORIGINAL_NOT_STORED_WARNING =
	'原图未保存，已保留分析结果';

export interface AttachmentStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface LoadAttachmentResultsResult {
	attachments: ChatAttachment[];
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

export interface RetainAttachmentResultsResult
	extends SaveAttachmentResultsResult {
	changed: number;
}

interface PersistedAttachmentEnvelope {
	version: 1;
	attachments: ChatAttachment[];
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
const truncate = (value: string, maxCharacters: number): string =>
	Array.from(value).slice(0, maxCharacters).join('');

const optionalBoundedString = (
	value: unknown,
	maxCharacters: number,
): string | undefined =>
	typeof value === 'string' ? truncate(value, maxCharacters) : undefined;

const normalizeStringList = (
	value: unknown,
	maxItems: number,
	maxCharacters: number,
): string[] =>
	Array.isArray(value)
		? value
				.filter((item): item is string => typeof item === 'string')
				.slice(0, maxItems)
				.map(item => truncate(item, maxCharacters))
		: [];

const normalizeWarnings = (value: unknown): string[] =>
	normalizeStringList(
		value,
		MAX_ATTACHMENT_WARNINGS,
		MAX_ATTACHMENT_WARNING_LENGTH,
	);

const normalizeVisionResult = (value: unknown): VisionResult | undefined => {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.summary !== 'string' ||
		typeof value.extractedText !== 'string' ||
		!Array.isArray(value.objects) ||
		!Array.isArray(value.warnings)
	) {
		return undefined;
	}

	return {
		summary: truncate(value.summary, MAX_VISION_SUMMARY_LENGTH),
		extractedText: truncate(
			value.extractedText,
			MAX_VISION_EXTRACTED_TEXT_LENGTH,
		),
		objects: normalizeStringList(
			value.objects,
			MAX_VISION_OBJECTS,
			MAX_VISION_OBJECT_LENGTH,
		),
		warnings: normalizeStringList(
			value.warnings,
			MAX_VISION_WARNINGS,
			MAX_VISION_WARNING_LENGTH,
		),
	};
};

export const normalizeDocumentAttachment = (
	value: unknown,
	now = Date.now(),
): DocumentAttachment | null => {
	if (!isRecord(value)) return null;
	if (
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		Array.from(value.id).length > MAX_ATTACHMENT_ID_LENGTH ||
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
		name: truncate(value.name, MAX_ATTACHMENT_NAME_LENGTH),
		mimeType: truncate(value.mimeType, MAX_ATTACHMENT_MIME_LENGTH),
		size,
		text,
		pageCount,
		truncated,
		warnings,
		errorCode: optionalBoundedString(
			errorCode,
			MAX_ATTACHMENT_ERROR_CODE_LENGTH,
		),
		errorMessage: optionalBoundedString(
			errorMessage,
			MAX_ATTACHMENT_ERROR_MESSAGE_LENGTH,
		),
		createdAt,
		updatedAt,
	};
};

export const normalizeImageAttachment = (
	value: unknown,
	now = Date.now(),
	wasRestored = false,
): ImageAttachment | null => {
	if (!isRecord(value)) return null;
	if (
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		Array.from(value.id).length > MAX_ATTACHMENT_ID_LENGTH ||
		value.kind !== 'image' ||
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

	const result = normalizeVisionResult(value.result);
	if (status === 'ready' && !result) {
		status = 'error';
		errorCode = 'INVALID_VISION_RESULT';
		errorMessage = '图片分析结果无效，请重新选择图片';
	}

	const warnings = normalizeWarnings(value.warnings);
	if (
		wasRestored &&
		status === 'ready' &&
		result &&
		!warnings.includes(IMAGE_ORIGINAL_NOT_STORED_WARNING)
	) {
		warnings.push(IMAGE_ORIGINAL_NOT_STORED_WARNING);
	}

	const createdAt = validTimestamp(value.createdAt, now);
	const updatedAt = validTimestamp(value.updatedAt, createdAt);

	return {
		id: value.id,
		kind: 'image',
		status,
		name: truncate(value.name, MAX_ATTACHMENT_NAME_LENGTH),
		mimeType: truncate(value.mimeType, MAX_ATTACHMENT_MIME_LENGTH),
		size,
		result,
		warnings,
		errorCode: optionalBoundedString(
			errorCode,
			MAX_ATTACHMENT_ERROR_CODE_LENGTH,
		),
		errorMessage: optionalBoundedString(
			errorMessage,
			MAX_ATTACHMENT_ERROR_MESSAGE_LENGTH,
		),
		createdAt,
		updatedAt,
	};
};

const normalizeChatAttachment = (
	value: unknown,
	now = Date.now(),
	wasRestored = false,
): ChatAttachment | null => {
	if (!isRecord(value)) return null;
	return value.kind === 'image'
		? normalizeImageAttachment(value, now, wasRestored)
		: normalizeDocumentAttachment(value, now);
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
	if (byteLength(raw) > ATTACHMENT_RESULTS_SOFT_LIMIT_BYTES) {
		return {
			attachments: [],
			recoveredFromError: true,
			errorCode: 'ATTACHMENT_STORAGE_TOO_LARGE',
			error: '附件记录超过 2MB 安全读取上限，请导出会话后清理本地数据',
		};
	}

	try {
		const values = getPersistedArray(JSON.parse(raw));
		if (!values) throw new Error('附件记录格式无效');
		const boundedValues = values.slice(0, MAX_PERSISTED_ATTACHMENTS);
		const attachments = boundedValues
			.map(value => normalizeChatAttachment(value, now, true))
			.filter((value): value is ChatAttachment => value !== null);
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
	attachments: readonly ChatAttachment[],
	softLimitBytes = ATTACHMENT_RESULTS_SOFT_LIMIT_BYTES,
): SaveAttachmentResultsResult => {
	if (attachments.length > MAX_PERSISTED_ATTACHMENTS) {
		return {
			ok: false,
			bytes: 0,
			errorCode: 'TOO_MANY_ATTACHMENT_RESULTS',
			error: `附件记录不能超过 ${MAX_PERSISTED_ATTACHMENTS} 条`,
		};
	}
	const normalized = attachments
		.map(value => normalizeChatAttachment(value))
		.filter((value): value is ChatAttachment => value !== null);
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

export const retainAttachmentResults = (
	storage: AttachmentStorageLike,
	retainedIds: readonly string[],
): RetainAttachmentResultsResult => {
	const loaded = loadAttachmentResults(storage);
	if (
		loaded.errorCode === 'ATTACHMENT_STORAGE_READ_FAILED' ||
		loaded.errorCode === 'ATTACHMENT_STORAGE_CORRUPTED' ||
		loaded.errorCode === 'ATTACHMENT_STORAGE_TOO_LARGE'
	) {
		return {
			ok: false,
			bytes: 0,
			changed: 0,
			errorCode: loaded.errorCode,
			error: loaded.error,
		};
	}

	const retainedSet = new Set(retainedIds);
	const retained = loaded.attachments.filter(attachment =>
		retainedSet.has(attachment.id),
	);
	const changed = loaded.attachments.length - retained.length;
	if (changed === 0) {
		return {
			ok: true,
			bytes: byteLength(
				JSON.stringify({ version: 1, attachments: retained }),
			),
			changed: 0,
		};
	}

	return { ...saveAttachmentResults(storage, retained), changed };
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
