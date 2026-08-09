import {
	ApiRequestError,
	createAbortScope,
	createApiLifecycle,
	extractApiUsage,
	isJsonContentType,
	mapDeepSeekUpstreamError,
	raceWithAbort,
	readBoundedRequestText,
} from '../_shared/apiLifecycle';
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

const invalidSummaryResponse = () =>
	new ConversationSummaryError(
		'INVALID_SUMMARY_RESPONSE',
		'摘要服务返回了无效结果，请稍后重试',
		502,
	);

const readUpstreamJson = async (response: Response, signal: AbortSignal) => {
	if (!response.body) throw invalidSummaryResponse();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await raceWithAbort(reader.read(), signal);
		if (done) break;
		total += value.byteLength;
		if (total > MAX_SUMMARY_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw invalidSummaryResponse();
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
		throw invalidSummaryResponse();
	}
};

const usageFromPayload = (value: unknown) => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	return extractApiUsage((value as Record<string, unknown>).usage);
};

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	const lifecycle = createApiLifecycle('summary');
	if (!env.DEEPSEEK_API_KEY) {
		return lifecycle.error(
			'AUTH_FAILED',
			'服务端 DeepSeek API Key 未配置',
			500,
			false,
		);
	}
	if (!isJsonContentType(request.headers.get('content-type'))) {
		return lifecycle.error(
			'INVALID_REQUEST',
			'Content-Type 必须是 application/json',
			415,
			false,
		);
	}
	if (request.signal.aborted) {
		return lifecycle.error('REQUEST_ABORTED', '摘要请求已取消', 499, false);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(
			await readBoundedRequestText(
				request,
				MAX_SUMMARY_REQUEST_BYTES,
				'摘要请求体不能超过 128KB',
			),
		);
	} catch (error) {
		if (error instanceof ApiRequestError) {
			return lifecycle.error(
				error.code,
				error.message,
				error.status,
				error.retryable,
			);
		}
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '摘要请求已取消', 499, false);
		}
		return lifecycle.error(
			'INVALID_REQUEST',
			'请求体不是有效的 JSON',
			400,
			false,
		);
	}

	let summaryRequest;
	try {
		summaryRequest = parseSummaryRequestPayload(payload);
	} catch (error) {
		if (error instanceof ConversationSummaryError) {
			return lifecycle.error(
				error.code,
				error.message,
				error.status,
				false,
			);
		}
		return lifecycle.error('INVALID_REQUEST', '摘要请求格式无效', 400, false);
	}

	const scope = createAbortScope(request.signal, SUMMARY_TIMEOUT_MS);
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
				signal: scope.signal,
			}),
			scope.signal,
		);
		if (!upstream.ok) {
			const mapped = mapDeepSeekUpstreamError(upstream.status, '摘要服务');
			return lifecycle.error(
				mapped.code,
				mapped.message,
				mapped.status,
				mapped.retryable,
			);
		}

		const providerPayload = await readUpstreamJson(upstream, scope.signal);
		const lastMessage = summaryRequest.messages[summaryRequest.messages.length - 1];
		const summary = parseSummaryModelResponse(providerPayload, lastMessage.id);
		return lifecycle.json(
			{ data: summary },
			200,
			usageFromPayload(providerPayload),
		);
	} catch (error) {
		if (scope.reason === 'timeout') {
			return lifecycle.error(
				'REQUEST_TIMEOUT',
				'摘要请求超时，请稍后重试',
				504,
				true,
			);
		}
		if (scope.reason === 'client' || request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '摘要请求已取消', 499, false);
		}
		if (error instanceof ConversationSummaryError) {
			return lifecycle.error(
				error.code,
				error.message,
				error.status,
				error.status >= 500,
			);
		}
		return lifecycle.error(
			'UPSTREAM_UNAVAILABLE',
			'摘要服务暂时不可用，请稍后重试',
			502,
			true,
		);
	} finally {
		scope.dispose();
	}
};
