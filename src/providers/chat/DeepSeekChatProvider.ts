import { AppError } from '../../services/errors/AppError';
import type { TokenUsage } from '../../types/chat';
import type {
	ChatEvent,
	ChatProvider,
	ChatRequest,
} from '../../types/provider';

type JsonRecord = Record<string, unknown>;

interface ParsedEvent {
	events: ChatEvent[];
	done: boolean;
	failed?: boolean;
	finishReason?: string;
}

const CHAT_ENDPOINT = '/api/chat';

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
	typeof value === 'boolean' ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getRequestId = (response: Response): string | undefined =>
	response.headers.get('x-request-id') ??
	response.headers.get('x-debugdiva-request-id') ??
	undefined;

const isAbortError = (error: unknown): boolean =>
	(error instanceof Error || isRecord(error)) && error.name === 'AbortError';

const statusErrorCode = (status: number): string => {
	if (status === 401 || status === 403) return 'AUTH_FAILED';
	if (status === 402) return 'INSUFFICIENT_BALANCE';
	if (status === 408 || status === 504) return 'REQUEST_TIMEOUT';
	if (status === 429) return 'RATE_LIMITED';
	if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
	return 'INVALID_REQUEST';
};

const statusErrorMessage = (status: number): string => {
	if (status === 401 || status === 403) return 'AI 服务鉴权失败';
	if (status === 402) return 'AI 服务余额不足';
	if (status === 408 || status === 504) return 'AI 服务请求超时';
	if (status === 429) return '请求过于频繁，请稍后重试';
	if (status >= 500) return 'AI 服务暂时不可用';
	return '聊天请求无效';
};

const appErrorFromBody = (
	body: unknown,
	status: number,
	headerRequestId?: string,
): AppError => {
	const errorBody = isRecord(body) && isRecord(body.error) ? body.error : undefined;

	return new AppError({
		code: readString(errorBody?.code) ?? statusErrorCode(status),
		message: readString(errorBody?.message) ?? statusErrorMessage(status),
		status,
		requestId: readString(errorBody?.requestId) ?? headerRequestId,
		retryable:
			readBoolean(errorBody?.retryable) ??
			(status === 408 || status === 429 || status >= 500),
	});
};

const readHttpError = async (response: Response): Promise<AppError> => {
	let body: unknown;

	try {
		body = await response.json();
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		body = undefined;
	}

	return appErrorFromBody(body, response.status, getRequestId(response));
};

const mapUsage = (value: unknown): TokenUsage | undefined => {
	if (!isRecord(value)) return undefined;

	const usage: TokenUsage = {
		promptTokens: readNumber(value.prompt_tokens),
		completionTokens: readNumber(value.completion_tokens),
		totalTokens: readNumber(value.total_tokens),
		cacheHitTokens: readNumber(value.prompt_cache_hit_tokens),
		cacheMissTokens: readNumber(value.prompt_cache_miss_tokens),
	};

	return Object.values(usage).some(item => item !== undefined)
		? usage
		: undefined;
};

const providerErrorFromPayload = (
	payload: JsonRecord,
	fallbackRequestId?: string,
): AppError | undefined => {
	if (!isRecord(payload.error)) return undefined;

	const error = payload.error;
	return new AppError({
		code: readString(error.code) ?? 'UPSTREAM_UNAVAILABLE',
		message: readString(error.message) ?? 'AI 服务返回了错误',
		requestId:
			readString(error.requestId) ??
			readString(payload.request_id) ??
			fallbackRequestId,
		retryable: readBoolean(error.retryable) ?? false,
	});
};

/** Locate the next SSE event boundary while accepting LF, CRLF, or mixed lines. */
const findEventBoundary = (
	buffer: string,
): { index: number; length: number } | undefined => {
	const match = /\r?\n\r?\n/.exec(buffer);
	return match ? { index: match.index, length: match[0].length } : undefined;
};

const getEventData = (eventBlock: string): string | undefined => {
	const dataLines: string[] = [];

	for (const line of eventBlock.split(/\r?\n/)) {
		if (!line.startsWith('data:')) continue;

		const value = line.slice(5);
		dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
	}

	return dataLines.length > 0 ? dataLines.join('\n') : undefined;
};

const parseEventBlock = (
	eventBlock: string,
	requestId?: string,
): ParsedEvent => {
	const data = getEventData(eventBlock);
	if (data === undefined || data.trim().length === 0) {
		return { events: [], done: false };
	}

	if (data.trim() === '[DONE]') {
		return { events: [], done: true };
	}

	let payload: unknown;
	try {
		payload = JSON.parse(data);
	} catch (cause) {
		return {
			events: [
				{
					type: 'error',
					error: new AppError({
						code: 'STREAM_PARSE_FAILED',
						message: 'AI 服务返回了无法解析的流式数据',
						requestId,
						cause,
					}),
				},
			],
			done: true,
			failed: true,
		};
	}

	if (!isRecord(payload)) {
		return {
			events: [
				{
					type: 'error',
					error: new AppError({
						code: 'STREAM_PARSE_FAILED',
						message: 'AI 服务返回了无效的流式数据',
						requestId,
					}),
				},
			],
			done: true,
			failed: true,
		};
	}

	const providerError = providerErrorFromPayload(payload, requestId);
	if (providerError) {
		return {
			events: [{ type: 'error', error: providerError }],
			done: true,
			failed: true,
		};
	}

	const events: ChatEvent[] = [];
	const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0])
		? payload.choices[0]
		: undefined;
	const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
	const reasoningText = readString(delta?.reasoning_content);
	const contentText = readString(delta?.content);
	const finishReason = readString(choice?.finish_reason);
	const usage = mapUsage(payload.usage);

	if (reasoningText) events.push({ type: 'reasoning-delta', text: reasoningText });
	if (contentText) events.push({ type: 'text-delta', text: contentText });
	if (usage) events.push({ type: 'usage', usage });

	return { events, done: false, finishReason };
};

export class DeepSeekChatProvider implements ChatProvider {
	async *stream(request: ChatRequest): AsyncGenerator<ChatEvent> {
		let response: Response;

		try {
			response = await fetch(CHAT_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: request.messages,
					mode: request.mode,
					clientId: request.clientId,
				}),
				signal: request.signal,
			});
		} catch (cause) {
			if (isAbortError(cause)) throw cause;

			yield {
				type: 'error',
				error: new AppError({
					code: 'UPSTREAM_UNAVAILABLE',
					message: '无法连接 AI 服务，请检查网络后重试',
					retryable: true,
					cause,
				}),
			};
			return;
		}

		if (!response.ok) {
			yield { type: 'error', error: await readHttpError(response) };
			return;
		}

		const requestId = getRequestId(response);
		if (!response.body) {
			yield {
				type: 'error',
				error: new AppError({
					code: 'STREAM_PARSE_FAILED',
					message: 'AI 服务未返回可读取的数据流',
					requestId,
				}),
			};
			return;
		}

		yield { type: 'start', requestId };

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let finishReason: string | undefined;
		let streamFinished = false;
		let streamFailed = false;

		try {
			while (!streamFinished) {
				const { done, value } = await reader.read();
				if (value) buffer += decoder.decode(value, { stream: true });

				if (done) {
					buffer += decoder.decode();
				}

				let boundary = findEventBoundary(buffer);
				while (boundary) {
					const eventBlock = buffer.slice(0, boundary.index);
					buffer = buffer.slice(boundary.index + boundary.length);
					const parsed = parseEventBlock(eventBlock, requestId);

					finishReason = parsed.finishReason ?? finishReason;
					streamFailed = parsed.failed ?? streamFailed;
					for (const event of parsed.events) yield event;
					if (parsed.done) {
						streamFinished = true;
						break;
					}

					boundary = findEventBoundary(buffer);
				}

				if (streamFinished) break;
				if (!done) continue;

				if (buffer.trim().length > 0) {
					const parsed = parseEventBlock(buffer, requestId);
					finishReason = parsed.finishReason ?? finishReason;
					streamFailed = parsed.failed ?? streamFailed;
					for (const event of parsed.events) yield event;
					streamFinished = parsed.done;
				}

				break;
			}
		} catch (cause) {
			if (isAbortError(cause)) throw cause;

			yield {
				type: 'error',
				error:
					cause instanceof AppError
						? cause
						: new AppError({
								code: 'UPSTREAM_UNAVAILABLE',
								message: '读取 AI 响应流时连接中断',
								requestId,
								retryable: true,
								cause,
							}),
			};
			return;
		} finally {
			reader.releaseLock();
		}

		if (!streamFailed) {
			yield { type: 'done', finishReason };
		}
	}
}
