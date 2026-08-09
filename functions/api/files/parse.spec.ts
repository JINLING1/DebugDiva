import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './parse';

const createMultipartRequest = (files: File[]) => {
	const formData = new FormData();
	for (const file of files) formData.append('file', file);
	return new Request('https://debugdiva.example/api/files/parse', {
		method: 'POST',
		body: formData,
	});
};

describe('POST /api/files/parse', () => {
	beforeEach(() => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the documented success envelope', async () => {
		const response = await onRequestPost({
			request: createMultipartRequest([
				new File(['hello 文档'], 'hello.txt', { type: 'text/plain' }),
			]),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('x-request-id')).toMatch(/\S+/);
		expect(await response.json()).toEqual({
			data: {
				name: 'hello.txt',
				mimeType: 'text/plain',
				size: 12,
				text: 'hello 文档',
				truncated: false,
				warnings: [],
			},
		});
	});

	it('requires multipart form data with exactly one file', async () => {
		const wrongType = await onRequestPost({
			request: new Request('https://debugdiva.example/api/files/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			}),
		});
		expect(wrongType.status).toBe(415);

		const multiple = await onRequestPost({
			request: createMultipartRequest([
				new File(['one'], 'one.txt', { type: 'text/plain' }),
				new File(['two'], 'two.txt', { type: 'text/plain' }),
			]),
		});
		expect(multiple.status).toBe(400);
		expect(await multiple.json()).toMatchObject({
			error: {
				code: 'INVALID_REQUEST',
				message: '必须且只能上传一个 file 字段',
				requestId: expect.any(String),
				retryable: false,
			},
		});
	});

	it('returns stable errors without leaking file bytes', async () => {
		const response = await onRequestPost({
			request: createMultipartRequest([
				new File(['SECRET_BINARY_MARKER'], 'archive.zip', {
					type: 'application/zip',
				}),
			]),
		});
		const body = await response.text();

		expect(response.status).toBe(415);
		expect(body).toContain('UNSUPPORTED_FILE_TYPE');
		expect(body).not.toContain('SECRET_BINARY_MARKER');
		expect(String(vi.mocked(console.info).mock.calls)).not.toContain(
			'SECRET_BINARY_MARKER',
		);
	});

	it('rejects overlong file names before parsing', async () => {
		const response = await onRequestPost({
			request: createMultipartRequest([
				new File(['hello'], `${'a'.repeat(252)}.txt`, { type: 'text/plain' }),
			]),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'INVALID_REQUEST' },
		});
	});
});
