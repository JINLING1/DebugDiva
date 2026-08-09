// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_FILE_SIZE } from '../api/files';
import { AppError } from '../services/errors/AppError';
import {
	ATTACHMENT_RESULTS_STORAGE_KEY,
	saveAttachmentResults,
	type AttachmentStorageLike,
} from '../services/storage/attachmentStorage';
import type {
	DocumentAttachment,
	ParsedDocument,
} from '../types/attachment';
import { useAttachments, type AttachmentParser } from './useAttachments';

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
