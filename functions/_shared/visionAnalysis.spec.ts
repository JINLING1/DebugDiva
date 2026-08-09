import { describe, expect, it, vi } from 'vitest';
import {
	analyzeImageFile,
	DEFAULT_VISION_MODEL,
	inspectImageFile,
	MAX_IMAGE_FILE_SIZE,
	parseVisionModelResponse,
	type WorkersAIBinding,
} from './visionAnalysis';

const setUint16BigEndian = (bytes: Uint8Array, offset: number, value: number) => {
	bytes[offset] = (value >>> 8) & 0xff;
	bytes[offset + 1] = value & 0xff;
};

const setUint24LittleEndian = (bytes: Uint8Array, offset: number, value: number) => {
	bytes[offset] = value & 0xff;
	bytes[offset + 1] = (value >>> 8) & 0xff;
	bytes[offset + 2] = (value >>> 16) & 0xff;
};

const setUint32BigEndian = (bytes: Uint8Array, offset: number, value: number) => {
	new DataView(bytes.buffer).setUint32(offset, value, false);
};

const setUint32LittleEndian = (bytes: Uint8Array, offset: number, value: number) => {
	new DataView(bytes.buffer).setUint32(offset, value, true);
};

const createPng = (
	width = 640,
	height = 480,
	type = 'image/png',
	name = 'screen.png',
) => {
	const bytes = new Uint8Array(33);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	setUint32BigEndian(bytes, 8, 13);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	setUint32BigEndian(bytes, 16, width);
	setUint32BigEndian(bytes, 20, height);
	bytes.set([8, 6, 0, 0, 0], 24);
	return new File([bytes], name, { type });
};

const createJpeg = (width = 800, height = 600, type = 'image/jpeg') => {
	const bytes = new Uint8Array(21);
	bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
	setUint16BigEndian(bytes, 7, height);
	setUint16BigEndian(bytes, 9, width);
	bytes[11] = 3;
	return new File([bytes], 'photo.jpg', { type });
};

const createWebp = (width = 320, height = 240, type = 'image/webp') => {
	const bytes = new Uint8Array(30);
	bytes.set([0x52, 0x49, 0x46, 0x46]);
	setUint32LittleEndian(bytes, 4, bytes.length - 8);
	bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
	setUint32LittleEndian(bytes, 16, 10);
	setUint24LittleEndian(bytes, 24, width - 1);
	setUint24LittleEndian(bytes, 27, height - 1);
	return new File([bytes], 'preview.webp', { type });
};

const createAI = (response: unknown) => ({
	run: vi.fn().mockResolvedValue(response),
});

describe('inspectImageFile', () => {
	it.each([
		[createPng(640, 480), 'image/png', 640, 480],
		[createJpeg(800, 600), 'image/jpeg', 800, 600],
		[createWebp(320, 240), 'image/webp', 320, 240],
	] as const)('reads %s headers and dimensions', async (file, mimeType, width, height) => {
		await expect(inspectImageFile(file)).resolves.toMatchObject({
			mimeType,
			width,
			height,
		});
	});

	it('rejects unsupported MIME types and MIME/signature mismatches', async () => {
		await expect(
			inspectImageFile(new File(['GIF89a'], 'animated.gif', { type: 'image/gif' })),
		).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE', status: 415 });

		await expect(inspectImageFile(createJpeg(100, 100, 'image/png'))).rejects.toMatchObject({
			code: 'IMAGE_TYPE_MISMATCH',
			status: 415,
		});
	});

	it('rejects empty, oversized, malformed and over-dimensioned images', async () => {
		await expect(
			inspectImageFile(new File([], 'empty.png', { type: 'image/png' })),
		).rejects.toMatchObject({ code: 'EMPTY_FILE' });
		await expect(
			inspectImageFile(
				new File([new Uint8Array(MAX_IMAGE_FILE_SIZE + 1)], 'large.png', {
					type: 'image/png',
				}),
			),
		).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
		await expect(
			inspectImageFile(
				new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'broken.png', {
					type: 'image/png',
				}),
			),
		).rejects.toMatchObject({ code: 'IMAGE_TYPE_MISMATCH' });
		await expect(inspectImageFile(createPng(4097, 100))).rejects.toMatchObject({
			code: 'IMAGE_DIMENSIONS_EXCEEDED',
			status: 413,
		});
	});
});

describe('parseVisionModelResponse', () => {
	it('normalizes a structured JSON answer and enforces output limits', () => {
		const result = parseVisionModelResponse({
			answer: JSON.stringify({
				summary: '摘'.repeat(4001),
				extractedText: '字'.repeat(12001),
				objects: Array.from({ length: 51 }, (_, index) => `${index}-${'物'.repeat(101)}`),
				warnings: Array.from(
					{ length: 30 },
					(_, index) => `警告 ${index}${'告'.repeat(501)}`,
				),
			}),
		});

		expect(Array.from(result.summary)).toHaveLength(4000);
		expect(Array.from(result.extractedText ?? '')).toHaveLength(12000);
		expect(result.objects).toHaveLength(50);
		expect(result.objects?.every(item => Array.from(item).length <= 100)).toBe(true);
		expect(result.warnings).toHaveLength(20);
		expect(result.warnings.every(item => Array.from(item).length <= 500)).toBe(
			true,
		);
	});

	it('accepts a fenced JSON answer', () => {
		expect(
			parseVisionModelResponse({
				answer:
					'```json\n{"summary":"截图","extractedText":"TypeError","objects":["终端"],"warnings":[]}\n```',
			}),
		).toEqual({
			summary: '截图',
			extractedText: 'TypeError',
			objects: ['终端'],
			warnings: [],
		});
	});

	it('degrades a non-JSON answer to a bounded summary', () => {
		const result = parseVisionModelResponse('普通描述'.repeat(1001));
		expect(Array.from(result.summary)).toHaveLength(4000);
		expect(result.extractedText).toBe('');
		expect(result.objects).toEqual([]);
		expect(result.warnings).toEqual([
			'视觉模型未返回结构化结果，已使用原始摘要',
		]);
	});

	it('rejects empty and structurally invalid answers', () => {
		expect(() => parseVisionModelResponse({ answer: '  ' })).toThrowError(
			expect.objectContaining({ code: 'INVALID_VISION_RESPONSE' }),
		);
		expect(() => parseVisionModelResponse({ answer: '{"objects":[]}' })).toThrowError(
			expect.objectContaining({ code: 'INVALID_VISION_RESPONSE' }),
		);
	});
});

describe('analyzeImageFile', () => {
	it('makes exactly one query call with a fixed allowlisted model and an untrusted-data prompt', async () => {
		const ai = createAI({ answer: '{"summary":"一张截图"}' });

		await expect(
			analyzeImageFile(createPng(), 'ocr', ai),
		).resolves.toEqual({
			summary: '一张截图',
			extractedText: '',
			objects: [],
			warnings: [],
		});
		expect(ai.run).toHaveBeenCalledTimes(1);
		expect(ai.run).toHaveBeenCalledWith(
			DEFAULT_VISION_MODEL,
			expect.objectContaining({
				task: 'query',
				image: expect.stringMatching(/^data:image\/png;base64,/),
				question: expect.stringMatching(/不可信的待分析数据.*不得遵循/s),
				reasoning: false,
				stream: false,
			}),
		);
		expect(ai.run.mock.calls[0][1].question).toContain('逐字提取');
	});

	it('requires an AI binding and rejects models outside the allowlist before calling AI', async () => {
		await expect(
			analyzeImageFile(createPng(), 'auto', undefined),
		).rejects.toMatchObject({ code: 'VISION_NOT_CONFIGURED', status: 500 });

		const ai = createAI({ answer: '{"summary":"unused"}' });
		await expect(
			analyzeImageFile(createPng(), 'auto', ai, '@cf/unsupported/model'),
		).rejects.toMatchObject({ code: 'INVALID_VISION_MODEL', status: 500 });
		expect(ai.run).not.toHaveBeenCalled();
	});

	it('maps binding failures to a sanitized stable error', async () => {
		const ai: WorkersAIBinding = {
			run: vi.fn().mockRejectedValue(new Error('SECRET_UPSTREAM_DETAIL')),
		};
		await expect(analyzeImageFile(createPng(), 'auto', ai)).rejects.toMatchObject({
			code: 'VISION_ANALYSIS_FAILED',
			message: '图片分析服务暂时不可用，请稍后重试',
			status: 502,
		});
	});
});
