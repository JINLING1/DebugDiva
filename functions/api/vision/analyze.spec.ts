import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VISION_MODEL, type WorkersAIBinding } from '../../_shared/visionAnalysis';
import { onRequestPost } from './analyze';

const setUint32BigEndian = (bytes: Uint8Array, offset: number, value: number) => {
	new DataView(bytes.buffer).setUint32(offset, value, false);
};

const createPng = (name = 'screen.png') => {
	const bytes = new Uint8Array(33);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	setUint32BigEndian(bytes, 8, 13);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	setUint32BigEndian(bytes, 16, 640);
	setUint32BigEndian(bytes, 20, 480);
	bytes.set([8, 6, 0, 0, 0], 24);
	return new File([bytes], name, { type: 'image/png' });
};

const createRequest = (file: File, task?: string) => {
	const formData = new FormData();
	formData.append('file', file);
	if (task !== undefined) formData.append('task', task);
	return new Request('https://debugdiva.example/api/vision/analyze', {
		method: 'POST',
		body: formData,
	});
};

const createAI = (answer: unknown = { answer: '{"summary":"代码编辑器截图"}' }) => ({
	run: vi.fn().mockResolvedValue(answer),
});

describe('POST /api/vision/analyze', () => {
	it.each(['describe', 'ocr', 'auto'] as const)(
		'accepts task=%s and returns the stable success envelope',
		async task => {
			const ai = createAI();
			const response = await onRequestPost({
				request: createRequest(createPng(), task),
				env: { AI: ai },
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			await expect(response.json()).resolves.toEqual({
				data: {
					summary: '代码编辑器截图',
					extractedText: '',
					objects: [],
					warnings: [],
				},
			});
			expect(ai.run).toHaveBeenCalledTimes(1);
		},
	);

	it('defaults the task to auto and uses the fixed model', async () => {
		const ai = createAI();
		const response = await onRequestPost({
			request: createRequest(createPng()),
			env: { AI: ai, VISION_MODEL: DEFAULT_VISION_MODEL },
		});

		expect(response.status).toBe(200);
		expect(ai.run).toHaveBeenCalledWith(
			DEFAULT_VISION_MODEL,
			expect.objectContaining({ question: expect.stringContaining('综合描述图片') }),
		);
	});

	it('validates multipart fields, task and file name before analysis', async () => {
		const wrongContentType = await onRequestPost({
			request: new Request('https://debugdiva.example/api/vision/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			}),
			env: {},
		});
		expect(wrongContentType.status).toBe(415);

		const invalidTask = await onRequestPost({
			request: createRequest(createPng(), 'detect'),
			env: {},
		});
		expect(invalidTask.status).toBe(400);
		await expect(invalidTask.json()).resolves.toMatchObject({
			error: { code: 'INVALID_TASK' },
		});

		const longName = await onRequestPost({
			request: createRequest(createPng(`${'a'.repeat(252)}.png`)),
			env: {},
		});
		expect(longName.status).toBe(400);
		await expect(longName.json()).resolves.toMatchObject({
			error: { code: 'INVALID_REQUEST' },
		});
	});

	it('returns fenced JSON and non-JSON fallback results without extra AI calls', async () => {
		const fencedAI = createAI({
			answer: '```json\n{"summary":"截图","extractedText":"Error"}\n```',
		});
		const fencedResponse = await onRequestPost({
			request: createRequest(createPng()),
			env: { AI: fencedAI },
		});
		await expect(fencedResponse.json()).resolves.toEqual({
			data: {
				summary: '截图',
				extractedText: 'Error',
				objects: [],
				warnings: [],
			},
		});
		expect(fencedAI.run).toHaveBeenCalledTimes(1);

		const fallbackAI = createAI({ answer: '一张包含终端的截图' });
		const fallbackResponse = await onRequestPost({
			request: createRequest(createPng()),
			env: { AI: fallbackAI },
		});
		await expect(fallbackResponse.json()).resolves.toEqual({
			data: {
				summary: '一张包含终端的截图',
				extractedText: '',
				objects: [],
				warnings: ['视觉模型未返回结构化结果，已使用原始摘要'],
			},
		});
		expect(fallbackAI.run).toHaveBeenCalledTimes(1);
	});

	it('reports missing binding and disallowed server model without calling AI', async () => {
		const missing = await onRequestPost({
			request: createRequest(createPng()),
			env: {},
		});
		expect(missing.status).toBe(500);
		await expect(missing.json()).resolves.toMatchObject({
			error: { code: 'VISION_NOT_CONFIGURED' },
		});

		const ai = createAI();
		const disallowed = await onRequestPost({
			request: createRequest(createPng()),
			env: { AI: ai, VISION_MODEL: '@cf/not-allowed' },
		});
		expect(disallowed.status).toBe(500);
		await expect(disallowed.json()).resolves.toMatchObject({
			error: { code: 'INVALID_VISION_MODEL' },
		});
		expect(ai.run).not.toHaveBeenCalled();
	});

	it('sanitizes empty and upstream error responses without leaking binary or provider details', async () => {
		const emptyResponse = await onRequestPost({
			request: createRequest(createPng()),
			env: { AI: createAI({ answer: '' }) },
		});
		expect(emptyResponse.status).toBe(502);
		await expect(emptyResponse.json()).resolves.toMatchObject({
			error: { code: 'INVALID_VISION_RESPONSE' },
		});

		const ai: WorkersAIBinding = {
			run: vi.fn().mockRejectedValue(new Error('SECRET_PROVIDER_STACK')),
		};
		const failedResponse = await onRequestPost({
			request: createRequest(createPng('SECRET_IMAGE_MARKER.png')),
			env: { AI: ai },
		});
		const body = await failedResponse.text();
		expect(failedResponse.status).toBe(502);
		expect(body).toContain('VISION_ANALYSIS_FAILED');
		expect(body).not.toContain('SECRET_PROVIDER_STACK');
		expect(body).not.toContain('SECRET_IMAGE_MARKER');
	});
});
