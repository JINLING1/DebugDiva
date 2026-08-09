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
	DocumentAttachment,
	ParsedDocument,
} from '../types/attachment';

export type AttachmentParser = (
	file: File,
	signal: AbortSignal,
) => Promise<ParsedDocument>;

export interface UseAttachmentsOptions {
	storage?: AttachmentStorageLike;
	parseFile?: AttachmentParser;
	createId?: () => string;
	now?: () => number;
	maxFileSize?: number;
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

const resolveBrowserStorage = (): AttachmentStorageLike | undefined =>
	typeof localStorage === 'undefined' ? undefined : localStorage;

export const useAttachments = (options: UseAttachmentsOptions = {}) => {
	const records = shallowRef<DocumentAttachment[]>([]);
	const storageError = shallowRef<AttachmentOperationError>();
	const files = new Map<string, File>();
	const controllers = new Map<string, AbortController>();
	const storage = options.storage ?? resolveBrowserStorage();
	const parseFile = options.parseFile ?? defaultParser;
	const createId = options.createId ?? defaultCreateId;
	const now = options.now ?? Date.now;
	const maxFileSize = options.maxFileSize ?? MAX_ATTACHMENT_FILE_SIZE;

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
		update: Partial<DocumentAttachment>,
		shouldPersist = true,
	): DocumentAttachment | undefined => {
		const index = records.value.findIndex(record => record.id === id);
		if (index < 0) return undefined;
		const next = {
			...records.value[index],
			...update,
			updatedAt: update.updatedAt ?? now(),
		};
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

		const previous = controllers.get(id);
		if (previous) previous.abort();
		const controller = new AbortController();
		controllers.set(id, controller);
		replaceRecord(id, {
			status: 'parsing',
			errorCode: undefined,
			errorMessage: undefined,
		});

		try {
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
		} catch (error) {
			if (controllers.get(id) !== controller) return;
			if (isAbortError(error)) {
				updateWithError(id, 'ATTACHMENT_CANCELLED', '已取消文件解析');
			} else if (error instanceof AppError) {
				updateWithError(id, error.code, error.message);
			} else {
				updateWithError(id, 'PARSE_FAILED', '文件解析失败，请重试');
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
		const created: DocumentAttachment[] = [];
		const reserved = new Set(records.value.map(record => record.id));

		for (const file of selected) {
			const id = createUniqueId(reserved);
			const createdAt = now();
			const validationError = fileValidationError(file);
			files.set(id, file);
			ids.push(id);
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
		updateWithError(id, 'ATTACHMENT_CANCELLED', '已取消文件解析');
		return true;
	};

	const remove = (id: string): boolean => {
		const index = records.value.findIndex(record => record.id === id);
		if (index < 0) return false;
		const controller = controllers.get(id);
		controllers.delete(id);
		controller?.abort();
		files.delete(id);
		records.value = records.value.filter(record => record.id !== id);
		persist();
		return true;
	};

	const load = (): LoadAttachmentResultsResult => {
		controllers.forEach(controller => controller.abort());
		controllers.clear();
		files.clear();

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
	): DocumentAttachment[] => {
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
