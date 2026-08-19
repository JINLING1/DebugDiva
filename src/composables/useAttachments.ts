import { computed, shallowRef } from 'vue';
import {
	MAX_ATTACHMENT_FILE_SIZE,
	parseDocumentFile,
	validateParsedDocument,
} from '../api/files';
import { AppError } from '../services/errors/AppError';
import {
	IMAGE_ORIGINAL_NOT_STORED_WARNING,
	loadAttachmentResults,
	saveAttachmentResults,
	type AttachmentStorageLike,
	type LoadAttachmentResultsResult,
} from '../services/storage/attachmentStorage';
import {
	createIndexedDbImageBlobRepository,
	type ImageBlobRepository,
} from '../services/storage/imageBlobStorage';
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	type ChatAttachment,
	type DocumentAttachment,
	type ImageAttachment,
	type ParsedDocument,
	type VisionResult,
} from '../types/attachment';
import type { VisionProvider } from '../providers/vision/VisionProvider';

export type AttachmentParser = (
	file: File,
	signal: AbortSignal,
) => Promise<ParsedDocument>;

export type ImageAnalyzer = (
	file: File,
	prompt: string,
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
	createObjectURL?: (value: Blob) => string;
	revokeObjectURL?: (url: string) => void;
	imageBlobRepository?: ImageBlobRepository;
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

const resolveImageBlobRepository = (): ImageBlobRepository | undefined =>
	typeof indexedDB === 'undefined'
		? undefined
		: createIndexedDbImageBlobRepository(indexedDB);

export const useAttachments = (options: UseAttachmentsOptions = {}) => {
	const records = shallowRef<ChatAttachment[]>([]);
	const storageError = shallowRef<AttachmentOperationError>();
	const files = new Map<string, File>();
	const controllers = new Map<string, AbortController>();
	const previewUrls = new Map<string, string>();
	const storage = options.storage ?? resolveBrowserStorage();
	const imageBlobRepository =
		options.imageBlobRepository ?? resolveImageBlobRepository();
	const parseFile = options.parseFile ?? defaultParser;
	const analyzeImage =
		options.analyzeImage ??
		options.analyzer ??
		(options.visionProvider
			? ((file: File, prompt: string, signal: AbortSignal) =>
					options.visionProvider!.analyze(file, prompt, signal))
			: undefined);
	const createId = options.createId ?? defaultCreateId;
	const now = options.now ?? Date.now;
	const maxFileSize = options.maxFileSize ?? MAX_ATTACHMENT_FILE_SIZE;
	const createObjectURL =
		options.createObjectURL ??
		(typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
			? (value: Blob) => URL.createObjectURL(value)
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

	const processAttachment = async (
		id: string,
		prompt?: string,
		parentSignal?: AbortSignal,
	): Promise<void> => {
		const file = files.get(id);
		const record = records.value.find(item => item.id === id);
		if (!file || !record) return;
		if (record.kind === 'document' && record.status !== 'uploading') return;
		if (
			record.kind === 'image' &&
			record.status === 'ready' &&
			record.result
		) {
			return;
		}
		if (
			record.kind === 'image' &&
			record.status !== 'waiting' &&
			record.status !== 'error'
		) {
			return;
		}

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
		if (record.kind === 'image' && !prompt?.trim()) {
			updateWithError(id, 'INVALID_VISION_PROMPT', '请输入图片相关问题后再发送');
			return;
		}

		const previous = controllers.get(id);
		if (previous) previous.abort();
		const controller = new AbortController();
		controllers.set(id, controller);
		const abortFromParent = () => controller.abort();
		if (parentSignal?.aborted) controller.abort();
		else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
		replaceRecord(id, {
			status: record.kind === 'image' ? 'analyzing' : 'parsing',
			errorCode: undefined,
			errorMessage: undefined,
		});

		try {
			if (record.kind === 'image') {
				if (!imageBlobRepository) {
					throw new AppError({
						code: 'IMAGE_STORAGE_UNAVAILABLE',
						message: '浏览器图片存储不可用，请更换浏览器后重试',
						retryable: false,
					});
				}
				try {
					await imageBlobRepository.put({
						attachmentId: id,
						blob: file,
						name: file.name,
						mimeType: file.type,
						size: file.size,
						createdAt: record.createdAt,
					});
				} catch {
					throw new AppError({
						code: 'IMAGE_STORAGE_FAILED',
						message: '图片无法保存到本地，请检查浏览器存储空间后重试',
						retryable: true,
					});
				}
				const result = validateVisionResult(
					await analyzeImage!(file, prompt!.trim(), controller.signal),
				);
				if (controllers.get(id) !== controller) return;
				replaceRecord(id, {
					status: 'ready',
					result,
					warnings: [...record.warnings],
					errorCode: undefined,
					errorMessage: undefined,
				});
				files.delete(id);
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
			parentSignal?.removeEventListener('abort', abortFromParent);
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
					status: validationError ? 'error' : 'waiting',
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
			if (!validationError && !isImage) queued.push(id);
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
			status: record.kind === 'image' ? 'waiting' : 'uploading',
			errorCode: undefined,
			errorMessage: undefined,
		});
		if (record.kind === 'document') scheduleProcessing(id);
		return true;
	};

	const prepareForSend = async (
		ids: readonly string[],
		prompt: string,
		signal: AbortSignal,
	): Promise<ChatAttachment[]> => {
		const normalizedIds = [...new Set(ids)];
		if (normalizedIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
			throw new AppError({
				code: 'TOO_MANY_ATTACHMENTS',
				message: `每条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件`,
				retryable: false,
			});
		}
		const selectedIds = new Set(normalizedIds);
		const selected = records.value.filter(record => selectedIds.has(record.id));
		const missingId = normalizedIds.find(
			id => !selected.some(record => record.id === id),
		);
		if (missingId) {
			throw new AppError({
				code: 'ATTACHMENT_RESULT_MISSING',
				message: '附件处理结果已丢失，请重新选择文件',
				retryable: false,
			});
		}

		await Promise.all(
			selected
				.filter(
					(record): record is ImageAttachment =>
						record.kind === 'image' &&
						(record.status !== 'ready' || !record.result),
				)
				.map(record => processAttachment(record.id, prompt, signal)),
		);

		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
		for (const id of normalizedIds) {
			const record = records.value.find(item => item.id === id);
			if (!record || record.status !== 'ready') {
				throw new AppError({
					code: record?.errorCode ?? 'ATTACHMENT_NOT_READY',
					message: record?.errorMessage ?? '附件尚未处理完成',
					retryable: true,
				});
			}
		}

		return [...records.value];
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
		const removedRecord = records.value[index];
		const controller = controllers.get(id);
		controllers.delete(id);
		controller?.abort();
		files.delete(id);
		releasePreviewUrl(id);
		records.value = records.value.filter(record => record.id !== id);
		persist();
		if (removedRecord.kind === 'image') {
			void imageBlobRepository?.delete(id).catch(() => {
				storageError.value = {
					code: 'IMAGE_STORAGE_DELETE_FAILED',
					message: '本地图片清理失败',
				};
			});
		}
		return true;
	};

	const retain = (retainedIds: readonly string[]): string[] => {
		const retainedSet = new Set(retainedIds);
		const removedIds = records.value
			.filter(record => !retainedSet.has(record.id))
			.map(record => record.id);
		if (!removedIds.length) return [];

		for (const id of removedIds) {
			const controller = controllers.get(id);
			controllers.delete(id);
			controller?.abort();
			files.delete(id);
			releasePreviewUrl(id);
		}
		records.value = records.value.filter(record => retainedSet.has(record.id));
		persist();
		return removedIds;
	};

	const retainStoredImages = async (
		retainedIds: readonly string[],
	): Promise<string[]> => {
		if (!imageBlobRepository) return [];
		try {
			return await imageBlobRepository.retain(retainedIds);
		} catch {
			storageError.value = {
				code: 'IMAGE_STORAGE_DELETE_FAILED',
				message: '本地图片清理失败',
			};
			return [];
		}
	};

	const restoreImagePreviews = async (
		ids?: readonly string[],
	): Promise<{ restoredIds: string[]; missingIds: string[] }> => {
		const selected = ids ? new Set(ids) : undefined;
		const candidates = records.value.filter(
			(record): record is ImageAttachment =>
				record.kind === 'image' &&
				!record.previewUrl &&
				(!selected || selected.has(record.id)),
		);
		if (!candidates.length) return { restoredIds: [], missingIds: [] };
		if (!imageBlobRepository || !createObjectURL) {
			return { restoredIds: [], missingIds: candidates.map(record => record.id) };
		}

		try {
			const storedImages = await imageBlobRepository.getMany(
				candidates.map(record => record.id),
			);
			const byId = new Map(
				storedImages.map(record => [record.attachmentId, record]),
			);
			const restoredIds: string[] = [];
			for (const candidate of candidates) {
				const stored = byId.get(candidate.id);
				if (!stored) continue;
				try {
					const previewUrl = createObjectURL(stored.blob);
					previewUrls.set(candidate.id, previewUrl);
					if (candidate.status !== 'ready' || !candidate.result) {
						files.set(
							candidate.id,
							stored.blob instanceof File
								? stored.blob
								: new File([stored.blob], stored.name, {
										type: stored.mimeType,
								  }),
						);
					}
					replaceRecord(
						candidate.id,
						{
							previewUrl,
							warnings: candidate.warnings.filter(
								warning => warning !== IMAGE_ORIGINAL_NOT_STORED_WARNING,
							),
						},
						false,
					);
					restoredIds.push(candidate.id);
				} catch {
				}
			}
			const restored = new Set(restoredIds);
			return {
				restoredIds,
				missingIds: candidates
					.map(record => record.id)
					.filter(id => !restored.has(id)),
			};
		} catch {
			storageError.value = {
				code: 'IMAGE_STORAGE_READ_FAILED',
				message: '本地图片读取失败',
			};
			return { restoredIds: [], missingIds: candidates.map(record => record.id) };
		}
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
		ids.forEach(id => {
			const record = records.value.find(item => item.id === id);
			if (
				record?.status === 'ready' &&
				(record.kind === 'document' || Boolean(record.result))
			) {
				files.delete(id);
			}
		});
	};

	const dispose = (): void => {
		controllers.forEach(controller => controller.abort());
		controllers.clear();
		files.clear();
		releaseAllPreviewUrls();
		imageBlobRepository?.close();
	};

	return {
		records,
		readyAttachments,
		processing,
		storageError,
		load,
		queueFiles,
		prepareForSend,
		retry,
		cancel,
		remove,
		retain,
		retainStoredImages,
		restoreImagePreviews,
		getReadyAttachments,
		hasOriginalFile,
		releaseOriginalFiles,
		dispose,
	};
};
