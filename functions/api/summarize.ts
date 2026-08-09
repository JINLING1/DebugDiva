import {
	buildSummaryUpstreamBody,
	ConversationSummaryError,
	MAX_SUMMARY_REQUEST_BYTES,
	MAX_SUMMARY_RESPONSE_BYTES,
	parseSummaryModelResponse,
	parseSummaryRequestPayload,
	SUMMARY_TIMEOUT_MS,
} from '../_shared/conversationSummary';

interface Env {
	DEEPSEEK_API_KEY?: string;
	DEEPSEEK_BASE_URL?: string;
}

type AbortReason = 'client' | 'timeout';

const createRequestId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `summary-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const responseHeaders = (requestId: string) => ({
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
	'X-Request-Id': requestId,
});

const jsonError = (
	requestId: string,
	code: string,
	message: string,
	status: number,
) =>
	Response.json(
		{ error: { code, message } },
		{ status, headers: responseHeaders(requestId) },
	);

const requestTooLarge = () =>
	new ConversationSummaryError(
		'REQUEST_TOO_LARGE',
		'摘要请求体不能超过 128KB',
		413,
	);

const readRequestText = async (request: Request) => {
	const contentLength = request.headers.get('content-length');
	if (
		contentLength !== null &&
		/^\d+$/.test(contentLength.trim()) &&
		Number(contentLength) > MAX_SUMMARY_REQUEST_BYTES
	) {
		throw requestTooLarge();
	}
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_SUMMARY_REQUEST_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw requestTooLarge();
		}
		chunks.push(value);
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(body);
	} catch {
		throw new ConversationSummaryError(
			'INVALID_REQUEST',
			'请求体不是有效的 JSON',
			400,
		);
	}
};

const raceWithAbort = <T>(promise: Promise<T>, signal: AbortSignal) =>
	new Promise<T>((resolve, reject) => {
		const rejectForAbort = () =>
			reject(new DOMException('The operation was aborted', 'AbortError'));
		if (signal.aborted) {
			rejectForAbort();
			return;
		}
		signal.addEventListener('abort', rejectForAbort, { once: true });
		promise.then(
			value => {
				signal.removeEventListener('abort', rejectForAbort);
				resolve(value);
			},
			error => {
				signal.removeEventListener('abort', rejectForAbort);
				reject(error);
			},
		);
	});

const readUpstreamJson = async (response: Response, signal: AbortSignal) => {
	if (!response.body) {
		throw new ConversationSummaryError(
			'INVALID_SUMMARY_RESPONSE',
			'摘要服务返回了无效结果，请稍后重试',
			502,
		);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await raceWithAbort(reader.read(), signal);
		if (done) break;
		total += value.byteLength;
		if (total > MAX_SUMMARY_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new ConversationSummaryError(
				'INVALID_SUMMARY_RESPONSE',
				'摘要服务返回了无效结果，请稍后重试',
				502,
			);
		}
		chunks.push(value);
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
		return JSON.parse(text) as unknown;
	} catch {
		throw new ConversationSummaryError(
			'INVALID_SUMMARY_RESPONSE',
			'摘要服务返回了无效结果，请稍后重试',
			502,
		);
	}
};

const upstreamError = (status: number) => {
	if (status === 401 || status === 403) {
		return { code: 'AUTH_FAILED', message: '摘要服务认证失败', status: 502 };
	}
	if (status === 402) {
		return {
			code: 'INSUFFICIENT_BALANCE',
			message: '摘要服务余额不足',
			status: 402,
		};
	}
	if (status === 429) {
		return { code: 'RATE_LIMITED', message: '摘要请求过于频繁，请稍后重试', status: 429 };
	}
	if (status === 408 || status === 504) {
		return { code: 'REQUEST_TIMEOUT', message: '摘要请求超时，请稍后重试', status: 504 };
	}
	return {
		code: 'UPSTREAM_UNAVAILABLE',
		message: '摘要服务暂时不可用，请稍后重试',
		status: 502,
	};
};

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	const requestId = createRequestId();
	if (!env.DEEPSEEK_API_KEY) {
		return jsonError(
			requestId,
			'AUTH_FAILED',
			'服务端 DeepSeek API Key 未配置',
			500,
		);
	}
	if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
		return jsonError(
			requestId,
			'INVALID_REQUEST',
			'Content-Type 必须是 application/json',
			415,
		);
	}
	if (request.signal.aborted) {
		return jsonError(requestId, 'REQUEST_ABORTED', '摘要请求已取消', 499);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(await readRequestText(request));
	} catch (error) {
		if (error instanceof ConversationSummaryError) {
			return jsonError(requestId, error.code, error.message, error.status);
		}
		if (request.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
			return jsonError(requestId, 'REQUEST_ABORTED', '摘要请求已取消', 499);
		}
		return jsonError(requestId, 'INVALID_REQUEST', '请求体不是有效的 JSON', 400);
	}

	let summaryRequest;
	try {
		summaryRequest = parseSummaryRequestPayload(payload);
	} catch (error) {
		if (error instanceof ConversationSummaryError) {
			return jsonError(requestId, error.code, error.message, error.status);
		}
		return jsonError(requestId, 'INVALID_REQUEST', '摘要请求格式无效', 400);
	}

	const controller = new AbortController();
	let abortReason: AbortReason | undefined;
	const abort = (reason: AbortReason) => {
		if (controller.signal.aborted) return;
		abortReason = reason;
		controller.abort();
	};
	const onClientAbort = () => abort('client');
	request.signal.addEventListener('abort', onClientAbort, { once: true });
	const timeout = setTimeout(() => abort('timeout'), SUMMARY_TIMEOUT_MS);

	try {
		const baseUrl = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(
			/\/$/,
			'',
		);
		const upstream = await raceWithAbort(
			fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(buildSummaryUpstreamBody(summaryRequest)),
				signal: controller.signal,
			}),
			controller.signal,
		);
		if (!upstream.ok) {
			const mapped = upstreamError(upstream.status);
			return jsonError(requestId, mapped.code, mapped.message, mapped.status);
		}

		const providerPayload = await readUpstreamJson(upstream, controller.signal);
		const lastMessage = summaryRequest.messages[summaryRequest.messages.length - 1];
		const summary = parseSummaryModelResponse(providerPayload, lastMessage.id);
		return Response.json(
			{ data: summary },
			{ headers: responseHeaders(requestId) },
		);
	} catch (error) {
		if (abortReason === 'timeout') {
			return jsonError(
				requestId,
				'REQUEST_TIMEOUT',
				'摘要请求超时，请稍后重试',
				504,
			);
		}
		if (abortReason === 'client' || request.signal.aborted) {
			return jsonError(requestId, 'REQUEST_ABORTED', '摘要请求已取消', 499);
		}
		if (error instanceof ConversationSummaryError) {
			return jsonError(requestId, error.code, error.message, error.status);
		}
		return jsonError(
			requestId,
			'UPSTREAM_UNAVAILABLE',
			'摘要服务暂时不可用，请稍后重试',
			502,
		);
	} finally {
		clearTimeout(timeout);
		request.signal.removeEventListener('abort', onClientAbort);
	}
};
