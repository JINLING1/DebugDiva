// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../services/errors/AppError';
import {
	analyzeVisionImage,
	MAX_VISION_EXTRACTED_TEXT_LENGTH,
	MAX_VISION_FILE_SIZE,
	MAX_VISION_OBJECT_LENGTH,
	MAX_VISION_OBJECTS,
	MAX_VISION_SUMMARY_LENGTH,
	MAX_VISION_WARNING_LENGTH,
	MAX_VISION_WARNINGS,
	VISION_ANALYZE_ENDPOINT,
	type VisionFetch,
} from './vision';

const validResult = {
	summary: '一张代码编辑器截图',
	extractedText: 'TypeError: failed',
	objects: ['代码编辑器', '终端'],
	warnings: [],
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers },
	});

describe('vision API', () => {
	it('posts file and default task as multipart without setting Content-Type', async () => {
		const fetchMock = vi
			.fn<VisionFetch>()
			.mockResolvedValue(jsonResponse({ data: validResult }));
		const file = new File(['image'], 'error.png', { type: 'image/png' });
		const controller = new AbortController();

		await expect(
			analyzeVisionImage(file, {
				fetchImpl: fetchMock,
				signal: controller.signal,
			}),
		).resolves.toEqual(validResult);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(VISION_ANALYZE_ENDPOINT);
		expect(init?.method).toBe('POST');
		expect(init?.signal).toBe(controller.signal);
		expect(init?.headers).toBeUndefined();
		expect(init?.body).toBeInstanceOf(FormData);
		expect((init?.body as FormData).get('file')).toBe(file);
		expect((init?.body as FormData).get('task')).toBe('auto');
	});

	it('forwards an explicit analysis task', async () => {
		const fetchMock = vi
			.fn<VisionFetch>()
			.mockResolvedValue(jsonResponse({ data: validResult }));
		const file = new File(['image'], 'error.webp', { type: 'image/webp' });

		await analyzeVisionImage(file, { fetchImpl: fetchMock, task: 'ocr' });

		const body = fetchMock.mock.calls[0][1]?.body as FormData;
		expect(body.get('task')).toBe('ocr');
	});

	it('rejects empty, oversized, and unsupported files before fetch', async () => {
		const fetchMock = vi.fn<VisionFetch>();
		const oversized = {
			name: 'large.png',
			type: 'image/png',
			size: MAX_VISION_FILE_SIZE + 1,
		} as File;

		await expect(
			analyzeVisionImage(new File([], 'empty.png', { type: 'image/png' }), {
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({ code: 'EMPTY_FILE' });
		await expect(
			analyzeVisionImage(oversized, { fetchImpl: fetchMock }),
		).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
		await expect(
			analyzeVisionImage(
				new File(['gif'], 'animated.gif', { type: 'image/gif' }),
				{ fetchImpl: fetchMock },
			),
		).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('maps structured and status-fallback server errors', async () => {
		const file = new File(['image'], 'error.jpg', { type: 'image/jpeg' });
		const structuredFetch = vi.fn<VisionFetch>().mockResolvedValue(
			jsonResponse(
				{
					error: {
						code: 'VISION_RATE_LIMITED',
						message: 'Slow down',
						requestId: 'req-body',
						retryable: true,
					},
				},
				{ status: 429, headers: { 'x-request-id': 'req-header' } },
			),
		);

		const structuredPromise = analyzeVisionImage(file, {
			fetchImpl: structuredFetch,
		});
		await expect(structuredPromise).rejects.toBeInstanceOf(AppError);
		await expect(structuredPromise).rejects.toMatchObject({
			code: 'VISION_RATE_LIMITED',
			message: 'Slow down',
			status: 429,
			requestId: 'req-body',
			retryable: true,
		});

		const fallbackFetch = vi
			.fn<VisionFetch>()
			.mockResolvedValue(new Response('unavailable', { status: 503 }));
		await expect(
			analyzeVisionImage(file, { fetchImpl: fallbackFetch }),
		).rejects.toMatchObject({
			code: 'VISION_SERVICE_UNAVAILABLE',
			status: 503,
			retryable: true,
		});
	});

	it('rejects malformed and over-limit success payloads', async () => {
		const file = new File(['image'], 'error.png', { type: 'image/png' });
		const invalidPayloads: unknown[] = [
			{ summary: '', extractedText: '', objects: [], warnings: [] },
			{ ...validResult, objects: 'editor' },
			{ ...validResult, warnings: [1] },
			{ ...validResult, summary: 'x'.repeat(MAX_VISION_SUMMARY_LENGTH + 1) },
			{
				...validResult,
				extractedText: 'x'.repeat(MAX_VISION_EXTRACTED_TEXT_LENGTH + 1),
			},
			{ ...validResult, objects: Array(MAX_VISION_OBJECTS + 1).fill('x') },
			{ ...validResult, objects: ['x'.repeat(MAX_VISION_OBJECT_LENGTH + 1)] },
			{ ...validResult, warnings: Array(MAX_VISION_WARNINGS + 1).fill('x') },
			{ ...validResult, warnings: ['x'.repeat(MAX_VISION_WARNING_LENGTH + 1)] },
		];

		for (const payload of invalidPayloads) {
			const fetchMock = vi
				.fn<VisionFetch>()
				.mockResolvedValue(jsonResponse({ data: payload }));
			await expect(
				analyzeVisionImage(file, { fetchImpl: fetchMock }),
			).rejects.toMatchObject({ code: 'INVALID_VISION_RESPONSE' });
		}
	});

	it('normalizes optional vision fields into the stable client result', async () => {
		const fetchMock = vi.fn<VisionFetch>().mockResolvedValue(
			jsonResponse({ data: { summary: 'A simple image' } }),
		);

		await expect(
			analyzeVisionImage(
				new File(['image'], 'simple.png', { type: 'image/png' }),
				{ fetchImpl: fetchMock },
			),
		).resolves.toEqual({
			summary: 'A simple image',
			extractedText: '',
			objects: [],
			warnings: [],
		});
	});

	it('counts field limits by Unicode code points', async () => {
		const summary = '😀'.repeat(MAX_VISION_SUMMARY_LENGTH);
		const fetchMock = vi.fn<VisionFetch>().mockResolvedValue(
			jsonResponse({ data: { ...validResult, summary } }),
		);

		await expect(
			analyzeVisionImage(
				new File(['image'], 'emoji.png', { type: 'image/png' }),
				{ fetchImpl: fetchMock },
			),
		).resolves.toMatchObject({ summary });
	});

	it('maps network failures while preserving AbortError unchanged', async () => {
		const file = new File(['image'], 'error.png', { type: 'image/png' });
		const networkFetch = vi
			.fn<VisionFetch>()
			.mockRejectedValue(new TypeError('offline'));
		await expect(
			analyzeVisionImage(file, { fetchImpl: networkFetch }),
		).rejects.toMatchObject({ code: 'VISION_NETWORK_ERROR', retryable: true });

		const abort = new DOMException('Aborted', 'AbortError');
		const abortFetch = vi.fn<VisionFetch>().mockRejectedValue(abort);
		await expect(
			analyzeVisionImage(file, { fetchImpl: abortFetch }),
		).rejects.toBe(abort);
	});
});
