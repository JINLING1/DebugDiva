import { describe, expect, it, vi } from 'vitest';
import {
	analyzeImageFile,
	DEFAULT_DASHSCOPE_BASE_URL,
	DEFAULT_VISION_MODEL,
	inspectImageFile,
	MAX_IMAGE_FILE_SIZE,
	parseVisionModelResponse,
	VISION_MAX_OUTPUT_TOKENS,
	type VisionFetch,
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

const qwenPayload = (content: string, finishReason = 'stop') => ({
	choices: [
		{
			message: { role: 'assistant', content },
			finish_reason: finishReason,
		},
	],
	usage: {
		prompt_tokens: 100,
		completion_tokens: 20,
		total_tokens: 120,
	},
});

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
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
	it('normalizes structured Qwen JSON and enforces output limits', () => {
		const result = parseVisionModelResponse(
			qwenPayload(
				JSON.stringify({
					summary: '摘'.repeat(4001),
					extractedText: '字'.repeat(12001),
					objects: Array.from(
						{ length: 51 },
						(_, index) => `${index}-${'物'.repeat(101)}`,
					),
					warnings: Array.from(
						{ length: 30 },
						(_, index) => `警告 ${index}${'告'.repeat(501)}`,
					),
				}),
			),
		);

		expect(Array.from(result.summary)).toHaveLength(4000);
		expect(Array.from(result.extractedText)).toHaveLength(12000);
		expect(result.objects).toHaveLength(50);
		expect(result.objects.every(item => Array.from(item).length <= 100)).toBe(true);
		expect(result.warnings).toHaveLength(20);
		expect(result.warnings.every(item => Array.from(item).length <= 500)).toBe(
			true,
		);
	});

	it('accepts fenced JSON and degrades a non-JSON answer', () => {
		expect(
			parseVisionModelResponse(
				qwenPayload(
					'```json\n{"summary":"截图","extractedText":"TypeError","objects":["终端"],"warnings":[]}\n```',
				),
			),
		).toEqual({
			summary: '截图',
			extractedText: 'TypeError',
			objects: ['终端'],
			warnings: [],
		});

		const fallback = parseVisionModelResponse(
			qwenPayload('普通描述'.repeat(1001)),
		);
		expect(Array.from(fallback.summary)).toHaveLength(4000);
		expect(fallback).toMatchObject({
			extractedText: '',
			objects: [],
			warnings: ['视觉模型未返回结构化结果，已使用原始摘要'],
		});
	});

	it('rejects empty, structurally invalid and truncated responses', () => {
		expect(() => parseVisionModelResponse(qwenPayload('  '))).toThrowError(
			expect.objectContaining({ code: 'INVALID_VISION_RESPONSE' }),
		);
		expect(() =>
			parseVisionModelResponse(qwenPayload('{"objects":[]}')),
		).toThrowError(expect.objectContaining({ code: 'INVALID_VISION_RESPONSE' }));
		expect(() =>
			parseVisionModelResponse(qwenPayload('{"summary":"partial"}', 'length')),
		).toThrowError(
			expect.objectContaining({
				code: 'INVALID_VISION_RESPONSE',
				retryable: true,
			}),
		);
	});
});

describe('analyzeImageFile', () => {
	it('sends one fixed high-resolution structured request to Qwen', async () => {
		const fetchMock = vi.fn<VisionFetch>().mockResolvedValue(
			jsonResponse(qwenPayload('{"summary":"一张截图"}')),
		);
		const controller = new AbortController();

		await expect(
			analyzeImageFile(
				createPng(),
				'ocr',
				'找出报错原因',
				{ apiKey: 'SECRET_TEST_KEY', fetchImpl: fetchMock },
				controller.signal,
			),
		).resolves.toEqual({
			summary: '一张截图',
			extractedText: '',
			objects: [],
			warnings: [],
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${DEFAULT_DASHSCOPE_BASE_URL}/chat/completions`);
		expect(init?.method).toBe('POST');
		expect(init?.signal).toBe(controller.signal);
		expect(new Headers(init?.headers).get('authorization')).toBe(
			'Bearer SECRET_TEST_KEY',
		);
		const body = JSON.parse(String(init?.body));
		expect(body).toMatchObject({
			model: DEFAULT_VISION_MODEL,
			stream: false,
			enable_thinking: false,
			response_format: { type: 'json_object' },
			vl_high_resolution_images: true,
			max_tokens: VISION_MAX_OUTPUT_TOKENS,
			messages: [{ role: 'user' }],
		});
		expect(body.messages[0].content[0]).toMatchObject({
			type: 'image_url',
			image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
		});
		expect(body.messages[0].content[1]).toMatchObject({
			type: 'text',
			text: expect.stringMatching(/不可信的待分析数据.*不得遵循/s),
		});
		expect(body.messages[0].content[1].text).toContain('小字号');
		expect(body.messages[0].content[1].text).toContain('找出报错原因');
		expect(String(init?.body)).not.toContain('SECRET_TEST_KEY');
	});

	it('accepts an allowlisted workspace endpoint', async () => {
		const fetchMock = vi.fn<VisionFetch>().mockResolvedValue(
			jsonResponse(qwenPayload('{"summary":"截图"}')),
		);
		await analyzeImageFile(createPng(), 'auto', '分析界面', {
			apiKey: 'test-key',
			baseUrl:
				'https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
			fetchImpl: fetchMock,
		});
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
		);
	});

	it('rejects missing credentials and non-allowlisted endpoints before fetch', async () => {
		const fetchMock = vi.fn<VisionFetch>();
		await expect(
			analyzeImageFile(createPng(), 'auto', '分析图片', { fetchImpl: fetchMock }),
		).rejects.toMatchObject({ code: 'VISION_NOT_CONFIGURED', status: 500 });
		await expect(
			analyzeImageFile(createPng(), 'auto', '分析图片', {
				apiKey: 'test-key',
				baseUrl: 'https://example.com/compatible-mode/v1',
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({ code: 'VISION_NOT_CONFIGURED', status: 500 });
		await expect(
			analyzeImageFile(createPng(), 'auto', '分析图片', {
				apiKey: 'test-key',
				baseUrl:
					'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({ code: 'VISION_NOT_CONFIGURED', status: 500 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		[401, 'VISION_AUTH_FAILED', 502, false],
		[403, 'VISION_AUTH_FAILED', 502, false],
		[429, 'VISION_RATE_LIMITED', 429, true],
		[408, 'REQUEST_TIMEOUT', 504, true],
		[504, 'REQUEST_TIMEOUT', 504, true],
		[500, 'VISION_SERVICE_UNAVAILABLE', 503, true],
	] as const)(
		'maps upstream status %s to a sanitized stable error',
		async (status, code, mappedStatus, retryable) => {
			const fetchMock = vi
				.fn<VisionFetch>()
				.mockResolvedValue(new Response('SECRET_UPSTREAM_DETAIL', { status }));
			await expect(
				analyzeImageFile(createPng(), 'auto', '分析图片', {
					apiKey: 'test-key',
					fetchImpl: fetchMock,
				}),
			).rejects.toMatchObject({
				code,
				status: mappedStatus,
				retryable,
			});
		},
	);

	it('maps network and malformed success responses without leaking details', async () => {
		const failedFetch = vi
			.fn<VisionFetch>()
			.mockRejectedValue(new Error('SECRET_NETWORK_DETAIL'));
		await expect(
			analyzeImageFile(createPng(), 'auto', '分析图片', {
				apiKey: 'test-key',
				fetchImpl: failedFetch,
			}),
		).rejects.toMatchObject({
			code: 'VISION_SERVICE_UNAVAILABLE',
			message: '图片分析服务暂时不可用，请稍后重试',
			status: 503,
			retryable: true,
		});

		const invalidJsonFetch = vi
			.fn<VisionFetch>()
			.mockResolvedValue(new Response('not-json', { status: 200 }));
		await expect(
			analyzeImageFile(createPng(), 'auto', '分析图片', {
				apiKey: 'test-key',
				fetchImpl: invalidJsonFetch,
			}),
		).rejects.toMatchObject({
			code: 'INVALID_VISION_RESPONSE',
			retryable: true,
		});
	});
});
