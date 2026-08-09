import { describe, expect, it } from 'vitest';
import { MAX_PARSED_DOCUMENT_TEXT_LENGTH } from '../../api/files';
import type {
	DocumentAttachment,
	ImageAttachment,
} from '../../types/attachment';
import {
	ATTACHMENT_RESULTS_STORAGE_KEY,
	IMAGE_ORIGINAL_NOT_STORED_WARNING,
	clearAttachmentResults,
	loadAttachmentResults,
	saveAttachmentResults,
	type AttachmentStorageLike,
} from './attachmentStorage';

class MemoryStorage implements AttachmentStorageLike {
	readonly values = new Map<string, string>();
	failRead = false;
	failWrite?: Error;

	getItem(key: string) {
		if (this.failRead) throw new Error('storage unavailable');
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		if (this.failWrite) throw this.failWrite;
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

const attachment = (
	overrides: Partial<DocumentAttachment> = {},
): DocumentAttachment => ({
	id: 'attachment-1',
	kind: 'document',
	status: 'ready',
	name: 'notes.txt',
	mimeType: 'text/plain',
	size: 5,
	text: 'hello',
	truncated: false,
	warnings: [],
	createdAt: 100,
	updatedAt: 200,
	...overrides,
});

const imageAttachment = (
	overrides: Partial<ImageAttachment> = {},
): ImageAttachment => ({
	id: 'image-1',
	kind: 'image',
	status: 'ready',
	name: 'error.png',
	mimeType: 'image/png',
	size: 128,
	previewUrl: 'blob:https://example.test/runtime-preview',
	result: {
		summary: '一张错误截图',
		extractedText: 'TypeError: boom',
		objects: ['代码编辑器'],
		warnings: [],
	},
	warnings: [],
	createdAt: 300,
	updatedAt: 400,
	...overrides,
});

describe('attachment storage', () => {
	it('round-trips only the persistable attachment field allowlist', () => {
		const storage = new MemoryStorage();
		const unsafe = {
			...attachment(),
			file: new Blob(['secret']),
			previewUrl: 'blob:https://example.test/private',
			base64: 'data:application/octet-stream;base64,c2VjcmV0',
		} as DocumentAttachment;

		expect(saveAttachmentResults(storage, [unsafe]).ok).toBe(true);
		const raw = storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY) || '';
		expect(raw).not.toContain('previewUrl');
		expect(raw).not.toContain('base64');
		expect(raw).not.toContain('blob:https');
		expect(raw).not.toContain('"file"');
		expect(loadAttachmentResults(storage).attachments).toEqual([attachment()]);
	});

	it('persists a vision result but never runtime image data or preview URLs', () => {
		const storage = new MemoryStorage();
		const unsafe = {
			...imageAttachment(),
			file: new File(['secret'], 'secret.png', { type: 'image/png' }),
			blob: new Blob(['secret']),
			base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
			dataUri: 'data:image/png;base64,iVBORw0KGgo=',
		} as ImageAttachment;

		expect(saveAttachmentResults(storage, [unsafe]).ok).toBe(true);
		const raw = storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY) || '';
		expect(raw).toContain('TypeError: boom');
		expect(raw).not.toContain('previewUrl');
		expect(raw).not.toContain('blob:https');
		expect(raw).not.toContain('base64');
		expect(raw).not.toContain('data:image');
		expect(raw).not.toContain('"file"');
		expect(raw).not.toContain('"blob"');
	});

	it('restores ready image analysis without a preview and shows the refresh warning', () => {
		const storage = new MemoryStorage();
		expect(saveAttachmentResults(storage, [imageAttachment()]).ok).toBe(true);

		const [loaded] = loadAttachmentResults(storage).attachments;

		expect(loaded.kind).toBe('image');
		if (loaded.kind !== 'image') throw new Error('expected image attachment');
		expect(loaded.previewUrl).toBeUndefined();
		expect(loaded.result).toEqual(imageAttachment().result);
		expect(loaded.warnings).toContain(IMAGE_ORIGINAL_NOT_STORED_WARNING);
	});

	it.each(['uploading', 'parsing', 'analyzing'] as const)(
		'restores a persisted %s record as an explicit interruption error',
		status => {
			const storage = new MemoryStorage();
			storage.setItem(
				ATTACHMENT_RESULTS_STORAGE_KEY,
				JSON.stringify({
					version: 1,
					attachments: [attachment({ status })],
				}),
			);

			const [loaded] = loadAttachmentResults(storage).attachments;
			expect(loaded).toMatchObject({
				status: 'error',
				errorCode: 'ATTACHMENT_PROCESSING_INTERRUPTED',
			});
			expect(loaded.errorMessage).toContain('重新选择文件');
		},
	);

	it('catches corrupt JSON without deleting the original value', () => {
		const storage = new MemoryStorage();
		storage.setItem(ATTACHMENT_RESULTS_STORAGE_KEY, '{broken');

		const result = loadAttachmentResults(storage);

		expect(result).toMatchObject({
			attachments: [],
			recoveredFromError: true,
			errorCode: 'ATTACHMENT_STORAGE_CORRUPTED',
		});
		expect(storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY)).toBe('{broken');
	});

	it('catches storage read and quota failures', () => {
		const readStorage = new MemoryStorage();
		readStorage.failRead = true;
		expect(loadAttachmentResults(readStorage)).toMatchObject({
			recoveredFromError: true,
			errorCode: 'ATTACHMENT_STORAGE_READ_FAILED',
		});

		const writeStorage = new MemoryStorage();
		const quotaError = new Error('Quota exceeded');
		quotaError.name = 'QuotaExceededError';
		writeStorage.failWrite = quotaError;
		expect(saveAttachmentResults(writeStorage, [attachment()])).toMatchObject({
			ok: false,
			errorCode: 'ATTACHMENT_STORAGE_QUOTA_EXCEEDED',
		});
	});

	it('enforces the configured storage soft limit without replacing old data', () => {
		const storage = new MemoryStorage();
		storage.setItem(ATTACHMENT_RESULTS_STORAGE_KEY, 'old-data');

		const result = saveAttachmentResults(
			storage,
			[attachment({ text: 'x'.repeat(1_000) })],
			100,
		);

		expect(result).toMatchObject({
			ok: false,
			errorCode: 'ATTACHMENT_STORAGE_LIMIT_EXCEEDED',
		});
		expect(result.bytes).toBeGreaterThan(100);
		expect(storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY)).toBe('old-data');
	});

	it('bounds overlong persisted text and adds a visible warning', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			ATTACHMENT_RESULTS_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				attachments: [
					attachment({
						text: 'x'.repeat(MAX_PARSED_DOCUMENT_TEXT_LENGTH + 10),
					}),
				],
			}),
		);

		const [loaded] = loadAttachmentResults(storage).attachments;
		if (loaded.kind !== 'document') throw new Error('expected document');
		expect(loaded.text).toHaveLength(MAX_PARSED_DOCUMENT_TEXT_LENGTH);
		expect(loaded.truncated).toBe(true);
		expect(loaded.warnings).toContain('提取文本已截断至 40,000 字符');
	});

	it('truncates stored text by Unicode characters without splitting emoji', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			ATTACHMENT_RESULTS_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				attachments: [
					attachment({
						text: '😀'.repeat(MAX_PARSED_DOCUMENT_TEXT_LENGTH + 1),
					}),
				],
			}),
		);

		const [loaded] = loadAttachmentResults(storage).attachments;
		if (loaded.kind !== 'document') throw new Error('expected document');
		expect(Array.from(loaded.text)).toHaveLength(
			MAX_PARSED_DOCUMENT_TEXT_LENGTH,
		);
		expect(loaded.text.endsWith('😀')).toBe(true);
	});

	it('keeps valid records and reports malformed individual records', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			ATTACHMENT_RESULTS_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				attachments: [attachment(), { id: '', kind: 'document' }],
			}),
		);

		const result = loadAttachmentResults(storage);
		expect(result.attachments).toEqual([attachment()]);
		expect(result).toMatchObject({
			recoveredFromError: true,
			errorCode: 'INVALID_ATTACHMENT_DATA',
		});
	});

	it('clears attachment results safely', () => {
		const storage = new MemoryStorage();
		storage.setItem(ATTACHMENT_RESULTS_STORAGE_KEY, 'value');
		expect(clearAttachmentResults(storage)).toBe(true);
		expect(storage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY)).toBeNull();
	});
});
