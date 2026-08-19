// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_FILE_SIZE } from '../api/files';
import { AppError } from '../services/errors/AppError';
import {
	IMAGE_ORIGINAL_NOT_STORED_WARNING,
	ATTACHMENT_RESULTS_STORAGE_KEY,
	saveAttachmentResults,
	type AttachmentStorageLike,
} from '../services/storage/attachmentStorage';
import type {
	DocumentAttachment,
	ImageAttachment,
	ParsedDocument,
	VisionResult,
} from '../types/attachment';
import {
	useAttachments,
	type AttachmentParser,
	type ImageAnalyzer,
} from './useAttachments';

class MemoryStorage implements AttachmentStorageLike {
	readonly values = new Map<string, string>();
	failWrite = false;

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		if (this.failWrite) {
			const error = new Error('Quota exceeded');
			error.name = 'QuotaExceededError';
			throw error;
		}
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

const resultFor = (file: File, text = 'parsed text'): ParsedDocument => ({
	name: file.name,
	mimeType: file.type || 'text/plain',
	size: file.size,
	text,
	truncated: false,
	warnings: [],
});

const persistedAttachment = (
	overrides: Partial<DocumentAttachment> = {},
): DocumentAttachment => ({
	id: 'stored-id',
	kind: 'document',
	status: 'ready',
	name: 'stored.txt',
	mimeType: 'text/plain',
	size: 6,
	text: 'stored',
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 2,
	...overrides,
});

const visionResult = (
	overrides: Partial<VisionResult> = {},
): VisionResult => ({
	summary: '一张包含代码编辑器的截图',
	extractedText: 'TypeError: boom',
	objects: ['代码编辑器', '终端'],
	warnings: [],
	...overrides,
});

const persistedImageAttachment = (
	overrides: Partial<ImageAttachment> = {},
): ImageAttachment => ({
	id: 'stored-image',
	kind: 'image',
	status: 'ready',
	name: 'stored.png',
	mimeType: 'image/png',
	size: 128,
	result: visionResult(),
	warnings: [],
	createdAt: 3,
	updatedAt: 4,
	...overrides,
});

const flushAsyncWork = async () => {
	await new Promise(resolve => setTimeout(resolve, 0));
	await Promise.resolve();
};

describe('useAttachments', () => {
	it('returns IDs synchronously and parses files asynchronously', async () => {
		const storage = new MemoryStorage();
		const parser = vi
			.fn<AttachmentParser>()
			.mockImplementation(async file => resultFor(file));
		let id = 0;
		const attachments = useAttachments({
			storage,
			parseFile: parser,
			createId: () => `id-${++id}`,
			now: () => 100,
		});
		const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

		const ids = attachments.queueFiles([file]);

		expect(ids).toEqual(['id-1']);
		expect(attachments.records.value[0]).toMatchObject({
			id: 'id-1',
			status: 'uploading',
			name: 'hello.txt',
		});
		expect(parser).not.toHaveBeenCalled();

		await flushAsyncWork();
		expect(parser).toHaveBeenCalledTimes(1);
		expect(parser.mock.calls[0][0]).toBe(file);
		expect(parser.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
		expect(attachments.records.value[0]).toMatchObject({
			status: 'ready',
			text: 'parsed text',
			errorCode: undefined,
		});
		expect(attachments.readyAttachments.value).toHaveLength(1);

		const raw = storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY) || '';
		expect(raw).toContain('parsed text');
		expect(raw).not.toContain('File');
		expect(raw).not.toContain('blob:');
	});

	it.each(['image/jpeg', 'image/png', 'image/webp'])(
		'dispatches %s to the vision analyzer instead of the document parser',
		async mimeType => {
			let finishAnalysis: ((result: VisionResult) => void) | undefined;
			const analyzer = vi.fn<ImageAnalyzer>().mockImplementation(
				() =>
					new Promise(resolve => {
						finishAnalysis = resolve;
					}),
			);
			const parser = vi.fn<AttachmentParser>();
			const createObjectURL = vi.fn(() => 'blob:runtime-preview');
			const attachments = useAttachments({
				storage: new MemoryStorage(),
				parseFile: parser,
				analyzeImage: analyzer,
				createObjectURL,
				revokeObjectURL: vi.fn(),
				createId: () => 'image-id',
			});
			const file = new File(['pixels'], 'screenshot.png', { type: mimeType });

			const ids = attachments.queueFiles([file]);
			expect(attachments.records.value[0]).toMatchObject({
				kind: 'image',
				status: 'waiting',
				previewUrl: 'blob:runtime-preview',
			});
			expect(analyzer).not.toHaveBeenCalled();
			const pending = attachments.prepareForSend(
				ids,
				'分析截图中的错误',
				new AbortController().signal,
			);
			await Promise.resolve();
			expect(attachments.records.value[0].status).toBe('analyzing');
			expect(analyzer).toHaveBeenCalledWith(
				file,
				'分析截图中的错误',
				expect.any(AbortSignal),
			);
			expect(parser).not.toHaveBeenCalled();

			finishAnalysis?.(visionResult());
			await pending;
			expect(attachments.records.value[0]).toMatchObject({
				kind: 'image',
				status: 'ready',
				result: visionResult(),
			});
			expect(createObjectURL).toHaveBeenCalledTimes(1);
		},
	);

	it('accepts a VisionProvider as the image analyzer dependency', async () => {
		const provider = {
			analyze: vi.fn().mockResolvedValue(visionResult()),
		};
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			visionProvider: provider,
			createId: () => 'provider-image',
			createObjectURL: () => 'blob:provider-image',
			revokeObjectURL: vi.fn(),
		});
		const file = new File(['pixels'], 'screen.png', { type: 'image/png' });

		const ids = attachments.queueFiles([file]);
		expect(provider.analyze).not.toHaveBeenCalled();
		await attachments.prepareForSend(
			ids,
			'解释截图',
			new AbortController().signal,
		);

		expect(provider.analyze).toHaveBeenCalledWith(
			file,
			'解释截图',
			expect.any(AbortSignal),
		);
		expect(attachments.records.value[0].status).toBe('ready');
	});

	it('reuses the first cached image result without another analysis call', async () => {
		const analyzer = vi.fn<ImageAnalyzer>().mockResolvedValue(visionResult());
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: analyzer,
			createId: () => 'cached-image',
		});
		const ids = attachments.queueFiles([
			new File(['pixels'], 'screen.png', { type: 'image/png' }),
		]);

		await attachments.prepareForSend(
			ids,
			'第一次问题',
			new AbortController().signal,
		);
		await attachments.prepareForSend(
			ids,
			'后续问题',
			new AbortController().signal,
		);

		expect(analyzer).toHaveBeenCalledTimes(1);
		expect(analyzer.mock.calls[0][1]).toBe('第一次问题');
	});

	it('starts all selected image analyses before waiting for their results', async () => {
		const resolvers: Array<(result: VisionResult) => void> = [];
		const analyzer = vi.fn<ImageAnalyzer>(
			() =>
				new Promise(resolve => {
					resolvers.push(resolve);
				}),
		);
		let nextId = 0;
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: analyzer,
			createId: () => `parallel-${++nextId}`,
		});
		const ids = attachments.queueFiles([
			new File(['one'], 'one.png', { type: 'image/png' }),
			new File(['two'], 'two.webp', { type: 'image/webp' }),
		]);

		const pending = attachments.prepareForSend(
			ids,
			'比较两张图片',
			new AbortController().signal,
		);
		await Promise.resolve();
		expect(analyzer).toHaveBeenCalledTimes(2);
		expect(attachments.records.value.map(record => record.status)).toEqual([
			'analyzing',
			'analyzing',
		]);

		resolvers.forEach(resolve => resolve(visionResult()));
		await pending;
		expect(attachments.records.value.map(record => record.status)).toEqual([
			'ready',
			'ready',
		]);
	});

	it('rejects more than three attachments before image analysis', async () => {
		const analyzer = vi.fn<ImageAnalyzer>().mockResolvedValue(visionResult());
		let nextId = 0;
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: analyzer,
			createId: () => `limit-${++nextId}`,
		});
		const ids = attachments.queueFiles(
			Array.from(
				{ length: 4 },
				(_, index) =>
					new File(['image'], `${index}.png`, { type: 'image/png' }),
			),
		);

		await expect(
			attachments.prepareForSend(
				ids,
				'分析图片',
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: 'TOO_MANY_ATTACHMENTS' });
		expect(analyzer).not.toHaveBeenCalled();
	});

	it('rejects unsupported image MIME types before analysis', async () => {
		const analyzer = vi.fn<ImageAnalyzer>();
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: analyzer,
			createId: () => 'gif-id',
		});

		attachments.queueFiles([
			new File(['gif'], 'animated.gif', { type: 'image/gif' }),
		]);
		await flushAsyncWork();

		expect(analyzer).not.toHaveBeenCalled();
		expect(attachments.records.value[0]).toMatchObject({
			kind: 'image',
			status: 'error',
			errorCode: 'UNSUPPORTED_IMAGE_TYPE',
		});
	});

	it('rejects empty and over-10MB images before invoking vision analysis', async () => {
		const analyzer = vi.fn<ImageAnalyzer>();
		let id = 0;
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: analyzer,
			createId: () => `invalid-image-${++id}`,
		});
		const oversized = {
			name: 'large.webp',
			type: 'image/webp',
			size: MAX_ATTACHMENT_FILE_SIZE + 1,
		} as File;

		attachments.queueFiles([
			new File([], 'empty.png', { type: 'image/png' }),
			oversized,
		]);
		await flushAsyncWork();

		expect(analyzer).not.toHaveBeenCalled();
		expect(attachments.records.value.map(record => record.errorCode)).toEqual([
			'EMPTY_FILE',
			'FILE_TOO_LARGE',
		]);
	});

	it('creates unique IDs even when the injected ID factory collides', () => {
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: vi.fn<AttachmentParser>(),
			createId: () => 'same-id',
		});
		const ids = attachments.queueFiles([
			new File(['a'], 'a.txt'),
			new File(['b'], 'b.txt'),
			new File(['c'], 'c.txt'),
		]);

		expect(ids).toEqual(['same-id', 'same-id-1', 'same-id-2']);
		attachments.dispose();
	});

	it('rejects empty and over-10MB files before invoking the parser', async () => {
		const parser = vi.fn<AttachmentParser>();
		let id = 0;
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: parser,
			createId: () => `invalid-${++id}`,
		});
		const oversized = {
			name: 'large.pdf',
			type: 'application/pdf',
			size: MAX_ATTACHMENT_FILE_SIZE + 1,
		} as File;

		attachments.queueFiles([new File([], 'empty.txt'), oversized]);
		await flushAsyncWork();

		expect(parser).not.toHaveBeenCalled();
		expect(attachments.records.value.map(record => record.errorCode)).toEqual([
			'EMPTY_FILE',
			'FILE_TOO_LARGE',
		]);
	});

	it('maps parser AppError details onto the attachment record', async () => {
		const parser = vi
			.fn<AttachmentParser>()
			.mockRejectedValue(
				new AppError({
					code: 'ENCRYPTED_DOCUMENT',
					message: '无法解析加密文档',
				}),
			);
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: parser,
			createId: () => 'encrypted-id',
		});

		attachments.queueFiles([new File(['pdf'], 'protected.pdf')]);
		await flushAsyncWork();

		expect(attachments.records.value[0]).toMatchObject({
			status: 'error',
			errorCode: 'ENCRYPTED_DOCUMENT',
			errorMessage: '无法解析加密文档',
		});
	});

	it('cancels an in-flight parse without allowing its rejection to overwrite state', async () => {
		let receivedSignal: AbortSignal | undefined;
		const parser: AttachmentParser = (_file, signal) => {
			receivedSignal = signal;
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					reject(new DOMException('Aborted', 'AbortError'));
				});
			});
		};
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: parser,
			createId: () => 'cancel-id',
		});
		attachments.queueFiles([new File(['data'], 'file.txt')]);
		await Promise.resolve();

		expect(attachments.records.value[0].status).toBe('parsing');
		expect(attachments.cancel('cancel-id')).toBe(true);
		expect(receivedSignal?.aborted).toBe(true);
		await flushAsyncWork();
		expect(attachments.records.value[0]).toMatchObject({
			status: 'error',
			errorCode: 'ATTACHMENT_CANCELLED',
		});
	});

	it('cancels an uploading record before its scheduled parser starts', async () => {
		const parser = vi.fn<AttachmentParser>();
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: parser,
			createId: () => 'early-cancel-id',
		});
		attachments.queueFiles([new File(['data'], 'file.txt')]);

		expect(attachments.cancel('early-cancel-id')).toBe(true);
		await flushAsyncWork();
		expect(parser).not.toHaveBeenCalled();
		expect(attachments.records.value[0].errorCode).toBe(
			'ATTACHMENT_CANCELLED',
		);
	});

	it('retries with the runtime File and reaches ready state', async () => {
		const parser = vi
			.fn<AttachmentParser>()
			.mockRejectedValueOnce(new AppError({ code: 'PARSE_FAILED', message: '失败' }))
			.mockImplementationOnce(async file => resultFor(file, 'retried'));
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: parser,
			createId: () => 'retry-id',
		});
		attachments.queueFiles([new File(['data'], 'file.txt')]);
		await flushAsyncWork();
		expect(attachments.records.value[0].status).toBe('error');

		expect(attachments.retry('retry-id')).toBe(true);
		expect(attachments.records.value[0].status).toBe('uploading');
		await flushAsyncWork();
		expect(parser).toHaveBeenCalledTimes(2);
		expect(attachments.records.value[0]).toMatchObject({
			status: 'ready',
			text: 'retried',
		});
	});

	it('retries an image with the same runtime File and Object URL', async () => {
		const analyzer = vi
			.fn<ImageAnalyzer>()
			.mockRejectedValueOnce(new Error('temporary failure'))
			.mockResolvedValueOnce(visionResult());
		const createObjectURL = vi.fn(() => 'blob:stable-preview');
		const revokeObjectURL = vi.fn();
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: analyzer,
			createObjectURL,
			revokeObjectURL,
			createId: () => 'retry-image',
		});
		const file = new File(['pixels'], 'screen.png', { type: 'image/png' });
		const ids = attachments.queueFiles([file]);
		await expect(
			attachments.prepareForSend(
				ids,
				'分析图片',
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: 'VISION_ANALYSIS_FAILED' });
		expect(attachments.records.value[0].status).toBe('error');

		expect(attachments.retry('retry-image')).toBe(true);
		expect(attachments.records.value[0].status).toBe('waiting');
		await attachments.prepareForSend(
			ids,
			'分析图片',
			new AbortController().signal,
		);

		expect(analyzer).toHaveBeenCalledTimes(2);
		expect(analyzer.mock.calls[0][0]).toBe(file);
		expect(analyzer.mock.calls[1][0]).toBe(file);
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).not.toHaveBeenCalled();
		expect(attachments.records.value[0]).toMatchObject({
			status: 'ready',
			previewUrl: 'blob:stable-preview',
		});
	});

	it('explains that a loaded attachment cannot retry without its original File', () => {
		const storage = new MemoryStorage();
		expect(saveAttachmentResults(storage, [persistedAttachment()]).ok).toBe(true);
		const attachments = useAttachments({ storage, now: () => 10 });
		attachments.load();

		expect(attachments.hasOriginalFile('stored-id')).toBe(false);
		expect(attachments.retry('stored-id')).toBe(false);
		expect(attachments.records.value[0]).toMatchObject({
			status: 'error',
			errorCode: 'ORIGINAL_FILE_UNAVAILABLE',
		});
		expect(attachments.records.value[0].errorMessage).toContain('重新选择文件');
	});

	it('removes a record, its runtime file and its persisted result', async () => {
		const storage = new MemoryStorage();
		const attachments = useAttachments({
			storage,
			parseFile: async file => resultFor(file),
			createId: () => 'remove-id',
		});
		attachments.queueFiles([new File(['data'], 'file.txt')]);
		await flushAsyncWork();

		expect(attachments.remove('remove-id')).toBe(true);
		expect(attachments.records.value).toEqual([]);
		expect(attachments.hasOriginalFile('remove-id')).toBe(false);
		expect(
			JSON.parse(storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY) || '{}')
				.attachments,
		).toEqual([]);
	});

	it('revokes every image Object URL exactly once across remove and dispose', async () => {
		const revokeObjectURL = vi.fn();
		let id = 0;
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: async () => visionResult(),
			createObjectURL: file => `blob:${file.name}`,
			revokeObjectURL,
			createId: () => `preview-${++id}`,
		});
		attachments.queueFiles([
			new File(['one'], 'one.png', { type: 'image/png' }),
			new File(['two'], 'two.webp', { type: 'image/webp' }),
		]);
		await flushAsyncWork();

		expect(attachments.remove('preview-1')).toBe(true);
		attachments.dispose();
		attachments.dispose();

		expect(revokeObjectURL.mock.calls).toEqual([
			['blob:one.png'],
			['blob:two.webp'],
		]);
	});

	it('filters ready records by requested IDs', () => {
		const storage = new MemoryStorage();
		saveAttachmentResults(storage, [
			persistedAttachment({ id: 'one' }),
			persistedAttachment({ id: 'two', name: 'two.txt' }),
			persistedAttachment({ id: 'failed', status: 'error' }),
		]);
		const attachments = useAttachments({ storage });
		attachments.load();

		expect(attachments.getReadyAttachments(['two', 'failed']).map(item => item.id)).toEqual([
			'two',
		]);
		expect(attachments.readyAttachments.value.map(item => item.id)).toEqual([
			'one',
			'two',
		]);
	});

	it('retains referenced images while revoking orphan previews', async () => {
		const storage = new MemoryStorage();
		const revokeObjectURL = vi.fn();
		let nextId = 0;
		const attachments = useAttachments({
			storage,
			analyzeImage: async () => visionResult(),
			createId: () => (nextId++ === 0 ? 'keep' : 'drop'),
			createObjectURL: file => `blob:${file.name}`,
			revokeObjectURL,
		});
		attachments.queueFiles([
			new File(['one'], 'keep.png', { type: 'image/png' }),
			new File(['two'], 'drop.png', { type: 'image/png' }),
		]);
		await flushAsyncWork();

		expect(attachments.retain(['keep'])).toEqual(['drop']);

		expect(attachments.records.value.map(record => record.id)).toEqual(['keep']);
		expect(revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:drop.png');
		expect(
			JSON.parse(storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY) || '{}')
				.attachments,
		).toHaveLength(1);
	});

	it('aborts processing when an orphan attachment is retained away', async () => {
		let aborted = false;
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: (_file, signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => {
						aborted = true;
						reject(new DOMException('aborted', 'AbortError'));
					});
				}),
			createId: () => 'processing-orphan',
		});
		attachments.queueFiles([new File(['data'], 'orphan.txt')]);
		await Promise.resolve();

		attachments.retain([]);
		await flushAsyncWork();

		expect(aborted).toBe(true);
		expect(attachments.records.value).toEqual([]);
	});

	it('releases original File references without deleting parsed results', async () => {
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			parseFile: async file => resultFor(file),
			createId: () => 'release-id',
		});
		attachments.queueFiles([new File(['data'], 'file.txt')]);
		await flushAsyncWork();

		attachments.releaseOriginalFiles(['release-id']);

		expect(attachments.hasOriginalFile('release-id')).toBe(false);
		expect(attachments.records.value[0]).toMatchObject({
			id: 'release-id',
			status: 'ready',
			text: 'parsed text',
		});
	});

	it('releases an image File without revoking its runtime preview URL', async () => {
		const revokeObjectURL = vi.fn();
		const attachments = useAttachments({
			storage: new MemoryStorage(),
			analyzeImage: async () => visionResult(),
			createObjectURL: () => 'blob:keep-preview',
			revokeObjectURL,
			createId: () => 'release-image',
		});
		const ids = attachments.queueFiles([
			new File(['pixels'], 'screen.png', { type: 'image/png' }),
		]);
		await attachments.prepareForSend(
			ids,
			'分析图片',
			new AbortController().signal,
		);

		attachments.releaseOriginalFiles(['release-image']);

		expect(attachments.hasOriginalFile('release-image')).toBe(false);
		expect(revokeObjectURL).not.toHaveBeenCalled();
		expect(attachments.records.value[0]).toMatchObject({
			status: 'ready',
			previewUrl: 'blob:keep-preview',
			result: visionResult(),
		});
	});

	it('loads persisted image analysis without recreating the original preview', () => {
		const storage = new MemoryStorage();
		expect(
			saveAttachmentResults(storage, [persistedImageAttachment()]).ok,
		).toBe(true);
		const createObjectURL = vi.fn(() => 'blob:should-not-be-created');
		const attachments = useAttachments({ storage, createObjectURL });

		attachments.load();

		const [record] = attachments.records.value;
		expect(record.kind).toBe('image');
		if (record.kind !== 'image') throw new Error('expected image');
		expect(record.status).toBe('ready');
		expect(record.result).toEqual(visionResult());
		expect(record.previewUrl).toBeUndefined();
		expect(record.warnings).toContain(IMAGE_ORIGINAL_NOT_STORED_WARNING);
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('surfaces persistence quota failures without losing the runtime result', async () => {
		const storage = new MemoryStorage();
		storage.failWrite = true;
		const attachments = useAttachments({
			storage,
			parseFile: async file => resultFor(file),
			createId: () => 'quota-id',
		});
		attachments.queueFiles([new File(['data'], 'file.txt')]);
		await flushAsyncWork();

		expect(attachments.records.value[0].status).toBe('ready');
		expect(attachments.storageError.value).toMatchObject({
			code: 'ATTACHMENT_STORAGE_QUOTA_EXCEEDED',
		});
	});
});
