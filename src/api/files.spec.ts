// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../services/errors/AppError';
import {
	FILE_PARSE_ENDPOINT,
	MAX_ATTACHMENT_FILE_SIZE,
	MAX_PARSED_DOCUMENT_TEXT_LENGTH,
	parseDocumentFile,
	type FileFetch,
} from './files';

const parsedDocument = {
	name: 'notes.md',
	mimeType: 'text/markdown',
	size: 12,
	text: '# Notes',
	truncated: false,
	warnings: [],
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers },
	});

describe('file parser API', () => {
	it('posts a multipart file field to the same-origin endpoint', async () => {
		const fetchMock = vi.fn<FileFetch>().mockResolvedValue(
			jsonResponse({ data: parsedDocument }),
		);
		const file = new File(['# Notes'], 'notes.md', {
			type: 'text/markdown',
		});
		const controller = new AbortController();

		await expect(
			parseDocumentFile(file, {
				fetchImpl: fetchMock,
				signal: controller.signal,
			}),
		).resolves.toEqual(parsedDocument);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(FILE_PARSE_ENDPOINT);
		expect(init?.method).toBe('POST');
		expect(init?.signal).toBe(controller.signal);
		expect(init?.headers).toBeUndefined();
		expect(init?.body).toBeInstanceOf(FormData);
		expect((init?.body as FormData).get('file')).toBe(file);
	});

	it('maps a structured server error to AppError', async () => {
		const fetchMock = vi.fn<FileFetch>().mockResolvedValue(
			jsonResponse(
				{
					error: {
						code: 'UNSUPPORTED_FILE_TYPE',
						message: '暂不支持该文件类型',
						requestId: 'req-body',
						retryable: false,
					},
				},
				{ status: 415, headers: { 'x-request-id': 'req-header' } },
			),
		);

		const promise = parseDocumentFile(
			new File(['data'], 'data.bin'),
			{ fetchImpl: fetchMock },
		);
		await expect(promise).rejects.toBeInstanceOf(AppError);
		await expect(promise).rejects.toMatchObject({
			code: 'UNSUPPORTED_FILE_TYPE',
			message: '暂不支持该文件类型',
			status: 415,
			requestId: 'req-body',
			retryable: false,
		});
	});

	it('rejects empty and oversized files before making a request', async () => {
		const fetchMock = vi.fn<FileFetch>();
		const empty = new File([], 'empty.txt', { type: 'text/plain' });
		const oversized = {
			name: 'large.pdf',
			type: 'application/pdf',
			size: MAX_ATTACHMENT_FILE_SIZE + 1,
		} as File;

		await expect(
			parseDocumentFile(empty, { fetchImpl: fetchMock }),
		).rejects.toMatchObject({ code: 'EMPTY_FILE' });
		await expect(
			parseDocumentFile(oversized, { fetchImpl: fetchMock }),
		).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects malformed success data and overlong extracted text', async () => {
		const invalidFetch = vi
			.fn<FileFetch>()
			.mockResolvedValue(jsonResponse({ data: { name: 'bad.txt' } }));
		await expect(
			parseDocumentFile(new File(['x'], 'bad.txt'), {
				fetchImpl: invalidFetch,
			}),
		).rejects.toMatchObject({ code: 'INVALID_FILE_RESPONSE' });

		const longFetch = vi.fn<FileFetch>().mockResolvedValue(
			jsonResponse({
				data: {
					...parsedDocument,
					text: 'x'.repeat(MAX_PARSED_DOCUMENT_TEXT_LENGTH + 1),
				},
			}),
		);
		await expect(
			parseDocumentFile(new File(['x'], 'long.txt'), {
				fetchImpl: longFetch,
			}),
		).rejects.toMatchObject({ code: 'TEXT_LIMIT_EXCEEDED' });
	});

	it('counts extracted text by Unicode characters without splitting emoji', async () => {
		const emojiText = '😀'.repeat(MAX_PARSED_DOCUMENT_TEXT_LENGTH);
		const fetchMock = vi.fn<FileFetch>().mockResolvedValue(
			jsonResponse({ data: { ...parsedDocument, text: emojiText } }),
		);

		await expect(
			parseDocumentFile(new File(['x'], 'emoji.txt'), {
				fetchImpl: fetchMock,
			}),
		).resolves.toMatchObject({ text: emojiText });
	});

	it('maps network failures while preserving abort errors', async () => {
		const networkFetch = vi
			.fn<FileFetch>()
			.mockRejectedValue(new TypeError('offline'));
		await expect(
			parseDocumentFile(new File(['x'], 'file.txt'), {
				fetchImpl: networkFetch,
			}),
		).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });

		const abort = new DOMException('Aborted', 'AbortError');
		const abortFetch = vi.fn<FileFetch>().mockRejectedValue(abort);
		await expect(
			parseDocumentFile(new File(['x'], 'file.txt'), {
				fetchImpl: abortFetch,
			}),
		).rejects.toBe(abort);
	});

	it('uses status fallbacks when an error body is not JSON', async () => {
		const fetchMock = vi
			.fn<FileFetch>()
			.mockResolvedValue(
				new Response('temporarily unavailable', { status: 503 }),
			);

		await expect(
			parseDocumentFile(new File(['x'], 'file.txt'), {
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({
			code: 'FILE_SERVICE_UNAVAILABLE',
			status: 503,
			retryable: true,
		});
	});
});
