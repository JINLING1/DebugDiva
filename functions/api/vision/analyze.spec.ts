import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_VISION_MODEL,
	VISION_TIMEOUT_MS,
	type VisionFetch,
} from '../../_shared/visionAnalysis';
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

const createRequest = (file: File, task?: string, signal?: AbortSignal) => {
	const formData = new FormData();
	formData.append('file', file);
	if (task !== undefined) formData.append('task', task);
	return new Request('https://debugdiva.example/api/vision/analyze', {
		method: 'POST',
		body: formData,
		signal,
	});
};

const qwenPayload = (content: string, finishReason = 'stop') => ({
	choices: [
		{
			message: { role: 'assistant', content },
			finish_reason: finishReason,
		},
	],
});

const responseWithContent = (content: string, finishReason = 'stop') =>
	new Response(JSON.stringify(qwenPayload(content, finishReason)), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});

const env = {
	DASHSCOPE_API_KEY: 'SECRET_SERVER_KEY',
};

let fetchMock: ReturnType<typeof vi.fn<VisionFetch>>;

describe('POST /api/vision/analyze', () => {
	beforeEach(() => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
		fetchMock = vi
			.fn<VisionFetch>()
			.mockResolvedValue(responseWithContent('{"summary":"代码编辑器截图"}'));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each(['describe', 'ocr', 'auto'] as const)(
		'accepts task=%s and returns the stable success envelope',
		async task => {
			const response = await onRequestPost({
				request: createRequest(createPng(), task),
				env,
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('x-request-id')).toMatch(/\S+/);
			await expect(response.json()).resolves.toEqual({
				data: {
					summary: '代码编辑器截图',
					extractedText: '',
					objects: [],
					warnings: [],
				},
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
		},
	);

	it('defaults the task to auto and uses the fixed model', async () => {
		const response = await onRequestPost({
			request: createRequest(createPng()),
			env,
		});

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(requestBody.model).toBe(DEFAULT_VISION_MODEL);
		expect(requestBody.messages[0].content[1].text).toContain('综合分析整体场景');
	});

	it('validates multipart fields, task and file name before analysis', async () => {
		const wrongContentType = await onRequestPost({
			request: new Request('https://debugdiva.example/api/vision/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			}),
			env,
		});
		expect(wrongContentType.status).toBe(415);

		const invalidTask = await onRequestPost({
			request: createRequest(createPng(), 'detect'),
			env,
		});
		expect(invalidTask.status).toBe(400);
		await expect(invalidTask.json()).resolves.toMatchObject({
			error: { code: 'INVALID_TASK' },
		});

		const longName = await onRequestPost({
			request: createRequest(createPng(`${'a'.repeat(252)}.png`)),
			env,
		});
		expect(longName.status).toBe(400);
		await expect(longName.json()).resolves.toMatchObject({
			error: { code: 'INVALID_REQUEST' },
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns fenced JSON and non-JSON fallback results without extra calls', async () => {
		fetchMock
			.mockResolvedValueOnce(
				responseWithContent(
					'```json\n{"summary":"截图","extractedText":"Error"}\n```',
				),
			)
			.mockResolvedValueOnce(responseWithContent('一张包含终端的截图'));

		const fencedResponse = await onRequestPost({
			request: createRequest(createPng()),
			env,
		});
		await expect(fencedResponse.json()).resolves.toEqual({
			data: {
				summary: '截图',
				extractedText: 'Error',
				objects: [],
				warnings: [],
			},
		});

		const fallbackResponse = await onRequestPost({
			request: createRequest(createPng()),
			env,
		});
		await expect(fallbackResponse.json()).resolves.toEqual({
			data: {
				summary: '一张包含终端的截图',
				extractedText: '',
				objects: [],
				warnings: ['视觉模型未返回结构化结果，已使用原始摘要'],
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('reports missing credentials and invalid base URL without calling upstream', async () => {
		const missing = await onRequestPost({
			request: createRequest(createPng()),
			env: {},
		});
		expect(missing.status).toBe(500);
		await expect(missing.json()).resolves.toMatchObject({
			error: { code: 'VISION_NOT_CONFIGURED', retryable: false },
		});

		const invalidBaseUrl = await onRequestPost({
			request: createRequest(createPng()),
			env: {
				...env,
				DASHSCOPE_BASE_URL: 'https://example.com/compatible-mode/v1',
			},
		});
		expect(invalidBaseUrl.status).toBe(500);
		await expect(invalidBaseUrl.json()).resolves.toMatchObject({
			error: { code: 'VISION_NOT_CONFIGURED', retryable: false },
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		[401, 'VISION_AUTH_FAILED', 502, false],
		[429, 'VISION_RATE_LIMITED', 429, true],
		[500, 'VISION_SERVICE_UNAVAILABLE', 503, true],
	] as const)(
		'maps upstream status %s to the stable error envelope',
		async (upstreamStatus, code, status, retryable) => {
			fetchMock.mockResolvedValueOnce(
				new Response('SECRET_PROVIDER_RESPONSE', { status: upstreamStatus }),
			);
			const response = await onRequestPost({
				request: createRequest(createPng()),
				env,
			});
			expect(response.status).toBe(status);
			await expect(response.json()).resolves.toMatchObject({
				error: { code, retryable },
			});
		},
	);

	it('sanitizes empty and network error responses without leaking secrets', async () => {
		fetchMock.mockResolvedValueOnce(responseWithContent(''));
		const emptyResponse = await onRequestPost({
			request: createRequest(createPng()),
			env,
		});
		expect(emptyResponse.status).toBe(502);
		await expect(emptyResponse.json()).resolves.toMatchObject({
			error: { code: 'INVALID_VISION_RESPONSE', retryable: true },
		});

		fetchMock.mockRejectedValueOnce(new Error('SECRET_PROVIDER_STACK'));
		const failedResponse = await onRequestPost({
			request: createRequest(createPng('SECRET_IMAGE_MARKER.png')),
			env,
		});
		const body = await failedResponse.text();
		expect(failedResponse.status).toBe(503);
		expect(body).toContain('VISION_SERVICE_UNAVAILABLE');
		expect(body).not.toContain('SECRET_PROVIDER_STACK');
		expect(body).not.toContain('SECRET_IMAGE_MARKER');
		expect(body).not.toContain('SECRET_SERVER_KEY');
		const logs = String(vi.mocked(console.info).mock.calls);
		expect(logs).not.toContain('SECRET_IMAGE_MARKER');
		expect(logs).not.toContain('SECRET_SERVER_KEY');
		expect(logs).not.toContain('base64');
	});

	it('times out a stalled Qwen request with a retryable sanitized error', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce((_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(new DOMException('Aborted', 'AbortError')),
					{ once: true },
				);
			}),
		);
		const pending = onRequestPost({
			request: createRequest(createPng('SECRET_TIMEOUT_IMAGE.png')),
			env,
		});
		for (
			let index = 0;
			index < 20 && fetchMock.mock.calls.length === 0;
			index += 1
		) {
			await vi.advanceTimersByTimeAsync(0);
		}
		expect(fetchMock).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(VISION_TIMEOUT_MS);
		const response = await pending;
		expect(response.status).toBe(504);
		const body = await response.text();
		expect(body).toContain('REQUEST_TIMEOUT');
		expect(body).toContain('"retryable":true');
		expect(body).not.toContain('SECRET_TIMEOUT_IMAGE');
	});

	it('links client cancellation to the Qwen request', async () => {
		let rejectUpstream: ((reason: unknown) => void) | undefined;
		fetchMock.mockImplementationOnce(
			() =>
				new Promise<Response>((_resolve, reject) => {
					rejectUpstream = reject;
				}),
		);
		const controller = new AbortController();
		const pending = onRequestPost({
			request: createRequest(createPng(), undefined, controller.signal),
			env,
		});
		for (
			let index = 0;
			index < 50 && fetchMock.mock.calls.length === 0;
			index += 1
		) {
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		expect(fetchMock).toHaveBeenCalledOnce();
		controller.abort();
		await Promise.resolve();
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		rejectUpstream?.(new DOMException('Aborted', 'AbortError'));

		const response = await pending;
		expect(response.status).toBe(499);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: 'REQUEST_ABORTED', retryable: false },
		});
	});
});
