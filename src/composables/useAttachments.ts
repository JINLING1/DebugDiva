import { computed, shallowRef } from 'vue';
import {
	MAX_ATTACHMENT_FILE_SIZE,
	parseDocumentFile,
	validateParsedDocument,
} from '../api/files';
import { AppError } from '../services/errors/AppError';
import {
	loadAttachmentResults,
	saveAttachmentResults,
	type AttachmentStorageLike,
	type LoadAttachmentResultsResult,
} from '../services/storage/attachmentStorage';
import type {
	ChatAttachment,
	DocumentAttachment,
	ImageAttachment,
	ParsedDocument,
	VisionResult,
} from '../types/attachment';
import type { VisionProvider } from '../providers/vision/VisionProvider';

export type AttachmentParser = (
	file: File,
	signal: AbortSignal,
) => Promise<ParsedDocument>;

export type ImageAnalyzer = (
	file: File,
	signal: AbortSignal,
) => Promise<VisionResult>;

export interface UseAttachmentsOptions {
	storage?: AttachmentStorageLike;
	parseFile?: AttachmentParser;
	visionProvider?: VisionProvider;
	analyzeImage?: ImageAnalyzer;
	analyzer?: ImageAnalyzer;
	createId?: () => string;
	now?: () => number;
	maxFileSize?: number;
	createObjectURL?: (file: File) => string;
	revokeObjectURL?: (url: string) => void;
}

export interface AttachmentOperationError {
	code: string;
	message: string;
}

const defaultCreateId = (): string => {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isAbortError = (error: unknown): boolean =>
	error instanceof Error && error.name === 'AbortError';

const defaultParser: AttachmentParser = (file, signal) =>
	parseDocumentFile(file, { signal });

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
]);

const isImageMimeType = (mimeType: string): boolean =>
	mimeType.toLowerCase().startsWith('image/');

const isSupportedImageMimeType = (mimeType: string): boolean =>
	SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());

const validateVisionResult = (value: VisionResult): VisionResult => {
	if (
		!value ||
		typeof value.summary !== 'string' ||
		typeof value.extractedText !== 'string' ||
		!Array.isArray(value.objects) ||
		!value.objects.every(item => typeof item === 'string') ||
		!Array.isArray(value.warnings) ||
		!value.warnings.every(item => typeof item === 'string')
	) {
		throw new AppError({
			code: 'INVALID_VISION_RESULT',
			message: '图片分析结果格式无效，请重试',
		});
	}

	return {
		summary: value.summary,
		extractedText: value.extractedText,
		objects: [...value.objects],
		warnings: [...value.warnings],
	};
};

const resolveBrowserStorage = (): AttachmentStorageLike | undefined =>
	typeof localStorage === 'undefined' ? undefined : localStorage;

export const useAttachments = (options: UseAttachmentsOptions = {}) => {
	const records = shallowRef<ChatAttachment[]>([]);
	const storageError = shallowRef<AttachmentOperationError>();
	const files = new Map<string, File>();
	const controllers = new Map<string, AbortController>();
	const previewUrls = new Map<string, string>();
	const storage = options.storage ?? resolveBrowserStorage();
	const parseFile = options.parseFile ?? defaultParser;
	const analyzeImage =
		options.analyzeImage ??
		options.analyzer ??
		(options.visionProvider
			? ((file: File, signal: AbortSignal) =>
					options.visionProvider!.analyze(file, signal))
			: undefined);
	const createId = options.createId ?? defaultCreateId;
	const now = options.now ?? Date.now;
	const maxFileSize = options.maxFileSize ?? MAX_ATTACHMENT_FILE_SIZE;
	const createObjectURL =
		options.createObjectURL ??
		(typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
			? (file: File) => URL.createObjectURL(file)
			: undefined);
	const revokeObjectURL =
		options.revokeObjectURL ??
		(typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function'
			? (url: string) => URL.revokeObjectURL(url)
			: undefined);

	const releasePreviewUrl = (id: string): void => {
		const previewUrl = previewUrls.get(id);
		previewUrls.delete(id);
		if (previewUrl === undefined || !revokeObjectURL) return;
		try {
			revokeObjectURL(previewUrl);
		} catch {
			// Revocation is best-effort. Deleting first guarantees at-most-once use.
		}
	};

	const releaseAllPreviewUrls = (): void => {
		[...previewUrls.keys()].forEach(releasePreviewUrl);
	};

	const persist = (): boolean => {
		if (!storage) return true;
		const result = saveAttachmentResults(storage, records.value);
		storageError.value = result.ok
			? undefined
			: {
					code: result.errorCode ?? 'ATTACHMENT_STORAGE_WRITE_FAILED',
					message: result.error ?? '附件记录保存失败',
			  };
		return result.ok;
	};

	const replaceRecord = (
		id: string,
		update: Partial<DocumentAttachment> | Partial<ImageAttachment>,
		shouldPersist = true,
	): ChatAttachment | undefined => {
		const index = records.value.findIndex(record => record.id === id);
		if (index < 0) return undefined;
		const next = {
			...records.value[index],
			...update,
			updatedAt: update.updatedAt ?? now(),
		} as ChatAttachment;
		records.value = [
			...records.value.slice(0, index),
			next,
			...records.value.slice(index + 1),
		];
		if (shouldPersist) persist();
		return next;
	};

	const fileValidationError = (
		file: File,
	): AttachmentOperationError | undefined => {
		if (file.size === 0) {
			return { code: 'EMPTY_FILE', message: '不能解析空文件' };
		}
		if (file.size > maxFileSize) {
			return { code: 'FILE_TOO_LARGE', message: '文件不能超过 10MB' };
		}
		if (isImageMimeType(file.type) && !isSupportedImageMimeType(file.type)) {
			return {
				code: 'UNSUPPORTED_IMAGE_TYPE',
				message: '仅支持 JPEG、PNG 或 WebP 图片',
			};
		}
		return undefined;
	};

	const updateWithError = (
		id: string,
		code: string,
		message: string,
	): void => {
		replaceRecord(id, {
			status: 'error',
			errorCode: code,
			errorMessage: message,
		});
	};

	const processAttachment = async (id: string): Promise<void> => {
		const file = files.get(id);
		const record = records.value.find(item => item.id === id);
		if (!file || !record || record.status !== 'uploading') return;

		const validationError = fileValidationError(file);
		if (validationError) {
			updateWithError(id, validationError.code, validationError.message);
			return;
		}
		if (record.kind === 'image' && !analyzeImage) {
			updateWithError(
				id,
				'VISION_PROVIDER_UNAVAILABLE',
				'图片分析服务暂不可用',
			);
			return;
		}

		const previous = controllers.get(id);
		if (previous) previous.abort();
		const controller = new AbortController();
		controllers.set(id, controller);
		replaceRecord(id, {
			status: record.kind === 'image' ? 'analyzing' : 'parsing',
			errorCode: undefined,
			errorMessage: undefined,
		});

		try {
			if (record.kind === 'image') {
				const result = validateVisionResult(
					await analyzeImage!(file, controller.signal),
				);
				if (controllers.get(id) !== controller) return;
				replaceRecord(id, {
					status: 'ready',
					result,
					warnings: [...record.warnings],
					errorCode: undefined,
					errorMessage: undefined,
				});
			} else {
				const result = validateParsedDocument(
					await parseFile(file, controller.signal),
				);
				if (controllers.get(id) !== controller) return;
				replaceRecord(id, {
					status: 'ready',
					name: result.name,
					mimeType: result.mimeType,
					size: result.size,
					text: result.text,
					pageCount: result.pageCount,
					truncated: result.truncated,
					warnings: [...result.warnings],
					errorCode: undefined,
					errorMessage: undefined,
				});
			}
		} catch (error) {
			if (controllers.get(id) !== controller) return;
			if (isAbortError(error)) {
				updateWithError(id, 'ATTACHMENT_CANCELLED', '已取消附件处理');
			} else if (error instanceof AppError) {
				updateWithError(id, error.code, error.message);
			} else {
				updateWithError(
					id,
					record.kind === 'image' ? 'VISION_ANALYSIS_FAILED' : 'PARSE_FAILED',
					record.kind === 'image'
						? '图片分析失败，请重试'
						: '文件解析失败，请重试',
				);
			}
		} finally {
			if (controllers.get(id) === controller) controllers.delete(id);
		}
	};

	const scheduleProcessing = (id: string): void => {
		queueMicrotask(() => {
			void processAttachment(id);
		});
	};

	const createUniqueId = (reserved: Set<string>): string => {
		let id = createId();
		let suffix = 1;
		while (reserved.has(id)) {
			id = `${createId()}-${suffix++}`;
		}
		reserved.add(id);
		return id;
	};

	/**
	 * Queue files synchronously. IDs are available to the composer immediately;
	 * parsing starts in a microtask and updates the corresponding records.
	 */
	const queueFiles = (selectedFiles: Iterable<File> | ArrayLike<File>): string[] => {
		const selected = Array.from(selectedFiles);
		const ids: string[] = [];
		const queued: string[] = [];
		const created: ChatAttachment[] = [];
		const reserved = new Set(records.value.map(record => record.id));

		for (const file of selected) {
			const id = createUniqueId(reserved);
			const createdAt = now();
			const validationError = fileValidationError(file);
			const isImage = isImageMimeType(file.type);
			files.set(id, file);
			ids.push(id);
			if (isImage) {
				let previewUrl: string | undefined;
				const warnings: string[] = [];
				if (!validationError && createObjectURL) {
					try {
						previewUrl = createObjectURL(file);
						previewUrls.set(id, previewUrl);
					} catch {
						warnings.push('图片预览不可用');
					}
				}
				created.push({
					id,
					kind: 'image',
					status: validationError ? 'error' : 'uploading',
					name: file.name,
					mimeType: file.type,
					size: file.size,
					previewUrl,
					warnings,
					errorCode: validationError?.code,
					errorMessage: validationError?.message,
					createdAt,
					updatedAt: createdAt,
				});
			} else {
				created.push({
					id,
					kind: 'document',
					status: validationError ? 'error' : 'uploading',
					name: file.name,
					mimeType: file.type || 'application/octet-stream',
					size: file.size,
					text: '',
					truncated: false,
					warnings: [],
					errorCode: validationError?.code,
					errorMessage: validationError?.message,
					createdAt,
					updatedAt: createdAt,
				});
			}
			if (!validationError) queued.push(id);
		}

		records.value = [...records.value, ...created];
		persist();
		queued.forEach(scheduleProcessing);
		return ids;
	};

	const retry = (id: string): boolean => {
		const record = records.value.find(item => item.id === id);
		if (!record) return false;
		const file = files.get(id);
		if (!file) {
			updateWithError(
				id,
				'ORIGINAL_FILE_UNAVAILABLE',
				'原始文件未保留，请重新选择文件',
			);
			return false;
		}

		const controller = controllers.get(id);
		controllers.delete(id);
		controller?.abort();
		const validationError = fileValidationError(file);
		if (validationError) {
			updateWithError(id, validationError.code, validationError.message);
			return false;
		}

		replaceRecord(id, {
			status: 'uploading',
			errorCode: undefined,
			errorMessage: undefined,
		});
		scheduleProcessing(id);
		return true;
	};

	const cancel = (id: string): boolean => {
		const record = records.value.find(item => item.id === id);
		if (
			!record ||
			(record.status !== 'uploading' &&
				record.status !== 'parsing' &&
				record.status !== 'analyzing')
		) {
			return false;
		}

		const controller = controllers.get(id);
		controllers.delete(id);
		controller?.abort();
		updateWithError(id, 'ATTACHMENT_CANCELLED', '已取消附件处理');
		return true;
	};

	const remove = (id: string): boolean => {
		const index = records.value.findIndex(record => record.id === id);
		if (index < 0) return false;
		const controller = controllers.get(id);
		controllers.delete(id);
		controller?.abort();
		files.delete(id);
		releasePreviewUrl(id);
		records.value = records.value.filter(record => record.id !== id);
		persist();
		return true;
	};

	const load = (): LoadAttachmentResultsResult => {
		controllers.forEach(controller => controller.abort());
		controllers.clear();
		files.clear();
		releaseAllPreviewUrls();

		if (!storage) {
			const result: LoadAttachmentResultsResult = {
				attachments: [],
				recoveredFromError: false,
			};
			records.value = [];
			return result;
		}

		const result = loadAttachmentResults(storage, now());
		records.value = result.attachments;
		storageError.value = result.errorCode
			? {
					code: result.errorCode,
					message: result.error ?? '附件记录读取失败',
			  }
			: undefined;
		return result;
	};

	const getReadyAttachments = (
		ids?: readonly string[],
	): ChatAttachment[] => {
		const selected = ids ? new Set(ids) : undefined;
		return records.value.filter(
			record => record.status === 'ready' && (!selected || selected.has(record.id)),
		);
	};

	const readyAttachments = computed(() => getReadyAttachments());
	const processing = computed(() =>
		records.value.some(
			record =>
				record.status === 'uploading' ||
				record.status === 'parsing' ||
				record.status === 'analyzing',
		),
	);

	const hasOriginalFile = (id: string): boolean => files.has(id);
	const releaseOriginalFiles = (ids: readonly string[]): void => {
		ids.forEach(id => files.delete(id));
	};

	const dispose = (): void => {
		controllers.forEach(controller => controller.abort());
		controllers.clear();
		files.clear();
		releaseAllPreviewUrls();
	};

	return {
		records,
		readyAttachments,
		processing,
		storageError,
		load,
		queueFiles,
		retry,
		cancel,
		remove,
		getReadyAttachments,
		hasOriginalFile,
		releaseOriginalFiles,
		dispose,
	};
};
