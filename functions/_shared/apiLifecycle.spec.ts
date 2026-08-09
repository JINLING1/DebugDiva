import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createAbortScope,
	createApiLifecycle,
	extractApiUsage,
	mapDeepSeekUpstreamError,
	readBoundedRequestText,
} from './apiLifecycle';

describe('API lifecycle helpers', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('returns a consistent safe error envelope and a strict safe log', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const lifecycle = createApiLifecycle('fast');
		const response = lifecycle.error(
			'UPSTREAM_UNAVAILABLE',
			'服务暂时不可用',
			502,
			true,
		);

		expect(response.headers.get('x-request-id')).toBe(lifecycle.requestId);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		await expect(response.json()).resolves.toEqual({
			error: {
				code: 'UPSTREAM_UNAVAILABLE',
				message: '服务暂时不可用',
				requestId: lifecycle.requestId,
				retryable: true,
			},
		});

		const entry = JSON.parse(String(info.mock.calls[0][0]));
		expect(Object.keys(entry).sort()).toEqual([
			'duration',
			'mode',
			'requestId',
			'status',
		]);
		expect(entry).toMatchObject({
			requestId: lifecycle.requestId,
			status: 502,
			mode: 'fast',
		});
		expect(info).toHaveBeenCalledOnce();
	});

	it('maps upstream statuses without retaining provider data', () => {
		expect(mapDeepSeekUpstreamError(401)).toMatchObject({
			code: 'AUTH_FAILED',
			status: 502,
			retryable: false,
		});
		expect(mapDeepSeekUpstreamError(402)).toMatchObject({
			code: 'INSUFFICIENT_BALANCE',
			status: 402,
			retryable: false,
		});
		expect(mapDeepSeekUpstreamError(429)).toMatchObject({
			code: 'RATE_LIMITED',
			status: 429,
			retryable: true,
		});
		expect(mapDeepSeekUpstreamError(504)).toMatchObject({
			code: 'REQUEST_TIMEOUT',
			status: 504,
			retryable: true,
		});
		expect(mapDeepSeekUpstreamError(503)).toMatchObject({
			code: 'UPSTREAM_UNAVAILABLE',
			status: 502,
			retryable: true,
		});
	});

	it('bounds streamed request bodies even without Content-Length', async () => {
		const request = new Request('https://debugdiva.example/api/test', {
			method: 'POST',
			body: '12345',
		});
		await expect(
			readBoundedRequestText(request, 4, '请求过大'),
		).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', status: 413 });
	});

	it('links client cancellation and deadlines to one signal', async () => {
		vi.useFakeTimers();
		const client = new AbortController();
		const scope = createAbortScope(client.signal, 100);
		expect(scope.signal.aborted).toBe(false);

		await vi.advanceTimersByTimeAsync(100);
		expect(scope.signal.aborted).toBe(true);
		expect(scope.reason).toBe('timeout');
		scope.dispose();
	});

	it('allows only finite non-negative token counts into logs', () => {
		expect(
			extractApiUsage({
				prompt_tokens: 12,
				completion_tokens: -1,
				total_tokens: Number.POSITIVE_INFINITY,
				secret: 'PROMPT_MARKER',
			}),
		).toEqual({ promptTokens: 12 });
	});
});
