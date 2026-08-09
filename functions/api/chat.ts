import {
	ApiRequestError,
	createAbortScope,
	createApiLifecycle,
	extractApiUsage,
	isJsonContentType,
	mapDeepSeekUpstreamError,
	raceWithAbort,
	readBoundedRequestText,
	type ApiUsage,
} from '../_shared/apiLifecycle';
import { resolveModelMode, type ServerModelMode } from '../_shared/modelMode';

interface Env {
	DEEPSEEK_API_KEY: string;
	DEEPSEEK_BASE_URL?: string;
}

interface ProviderMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ChatRequest {
	messages: ProviderMessage[];
	mode: ServerModelMode;
	clientId?: string;
}

export const MAX_CHAT_REQUEST_BYTES = 256 * 1024;
export const MAX_CHAT_MESSAGES = 128;
export const MAX_CHAT_MESSAGE_CHARACTERS = 100_000;
export const MAX_CHAT_MESSAGE_CHARACTERS_TOTAL = 200_000;
export const CHAT_TIMEOUT_MS = 60_000;

const CLIENT_ID_PATTERN = /^anonymous-[A-Za-z0-9-]{8,118}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const countCharacters = (value: string) => Array.from(value).length;

const invalidRequest = (message: string) =>
	new ApiRequestError('INVALID_REQUEST', message, 400);

const parseChatRequest = (value: unknown): ChatRequest => {
	if (!isRecord(value) || !Array.isArray(value.messages)) {
		throw invalidRequest('messages 不能为空');
	}
	if (value.messages.length === 0 || value.messages.length > MAX_CHAT_MESSAGES) {
		throw invalidRequest(`messages 数量必须在 1 到 ${MAX_CHAT_MESSAGES} 之间`);
	}

	let totalCharacters = 0;
	const messages = value.messages.map((message): ProviderMessage => {
		if (
			!isRecord(message) ||
			(message.role !== 'system' &&
				message.role !== 'user' &&
				message.role !== 'assistant') ||
			typeof message.content !== 'string'
		) {
			throw invalidRequest('messages 格式无效');
		}

		const characters = countCharacters(message.content);
		if (
			characters === 0 ||
			characters > MAX_CHAT_MESSAGE_CHARACTERS ||
			message.content.trim().length === 0
		) {
			throw invalidRequest(
				`单条消息内容必须在 1 到 ${MAX_CHAT_MESSAGE_CHARACTERS} 个字符之间`,
			);
		}
		totalCharacters += characters;
		if (totalCharacters > MAX_CHAT_MESSAGE_CHARACTERS_TOTAL) {
			throw invalidRequest(
				`消息内容合计不能超过 ${MAX_CHAT_MESSAGE_CHARACTERS_TOTAL} 个字符`,
			);
		}

		// Only validated provider fields cross the server trust boundary.
		return { role: message.role, content: message.content };
	});

	const modeConfig = resolveModelMode(value.mode);
	if (!modeConfig) {
		throw new ApiRequestError(
			'INVALID_MODEL_MODE',
			'不支持的模型模式',
			400,
		);
	}

	let clientId: string | undefined;
	if (value.clientId !== undefined) {
		if (typeof value.clientId !== 'string' || !CLIENT_ID_PATTERN.test(value.clientId)) {
			throw invalidRequest('clientId 格式无效');
		}
		clientId = value.clientId;
	}

	return {
		messages,
		mode: value.mode as ServerModelMode,
		clientId,
	};
};

const parseUsageEvents = (
	buffer: string,
	flush = false,
): { remainder: string; usage?: ApiUsage } => {
	let remainder = buffer;
	let usage: ApiUsage | undefined;
	let boundary = /\r?\n\r?\n/.exec(remainder);
	while (boundary) {
		const block = remainder.slice(0, boundary.index);
		remainder = remainder.slice(boundary.index + boundary[0].length);
		for (const line of block.split(/\r?\n/)) {
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (!data || data === '[DONE]') continue;
			try {
				const payload = JSON.parse(data) as unknown;
				if (isRecord(payload)) usage = extractApiUsage(payload.usage) ?? usage;
			} catch {
				// The client owns stream validation; logging never changes provider bytes.
			}
		}
		boundary = /\r?\n\r?\n/.exec(remainder);
	}

	if (flush && remainder) {
		for (const line of remainder.split(/\r?\n/)) {
			if (!line.startsWith('data:')) continue;
			try {
				const payload = JSON.parse(line.slice(5).trim()) as unknown;
				if (isRecord(payload)) usage = extractApiUsage(payload.usage) ?? usage;
			} catch {
				// Ignore incomplete or non-JSON terminal data.
			}
		}
		remainder = '';
	}

	// Usage events are small. Drop an unterminated maliciously large event from logs.
	if (remainder.length > 64 * 1024) remainder = '';
	return { remainder, usage };
};

const sseError = (
	code: string,
	message: string,
	requestId: string,
	retryable: boolean,
) =>
	new TextEncoder().encode(
		`data: ${JSON.stringify({ error: { code, message, requestId, retryable } })}\n\n` +
			'data: [DONE]\n\n',
	);

const observeChatStream = (
	source: ReadableStream<Uint8Array>,
	scope: ReturnType<typeof createAbortScope>,
	lifecycle: ReturnType<typeof createApiLifecycle>,
) => {
	const reader = source.getReader();
	const decoder = new TextDecoder();
	let logBuffer = '';
	let usage: ApiUsage | undefined;
	let finished = false;
	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		scope.dispose();
		try {
			reader.releaseLock();
		} catch {
			// A provider read may still be settling after cancellation.
		}
	};
	const safelyClose = (controller: ReadableStreamDefaultController<Uint8Array>) => {
		try {
			controller.close();
		} catch {
			// The consumer may already have cancelled the response stream.
		}
	};
	const safelyEnqueue = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		value: Uint8Array,
	) => {
		try {
			controller.enqueue(value);
			return true;
		} catch {
			return false;
		}
	};

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (finished) return;
			try {
				const { done, value } = await raceWithAbort(reader.read(), scope.signal);
				if (!done) {
					if (!safelyEnqueue(controller, value)) return;
					logBuffer += decoder.decode(value, { stream: true });
					const parsed = parseUsageEvents(logBuffer);
					logBuffer = parsed.remainder;
					usage = parsed.usage ?? usage;
					return;
				}
				logBuffer += decoder.decode();
				usage = parseUsageEvents(logBuffer, true).usage ?? usage;
				finished = true;
				safelyClose(controller);
				lifecycle.complete(200, usage);
			} catch {
				if (finished) return;
				finished = true;
				if (scope.reason === 'client') {
					safelyClose(controller);
					lifecycle.complete(499, usage);
				} else if (scope.reason === 'timeout') {
					safelyEnqueue(
						controller,
						sseError(
							'REQUEST_TIMEOUT',
							'AI 服务请求超时，请稍后重试',
							lifecycle.requestId,
							true,
						),
					);
					safelyClose(controller);
					lifecycle.complete(504, usage);
				} else {
					safelyEnqueue(
						controller,
						sseError(
							'UPSTREAM_UNAVAILABLE',
							'AI 服务响应中断，请稍后重试',
							lifecycle.requestId,
							true,
						),
					);
					safelyClose(controller);
					lifecycle.complete(502, usage);
				}
			} finally {
				if (finished) cleanup();
			}
		},
		async cancel() {
			if (finished) return;
			finished = true;
			scope.abort('client');
			await reader.cancel().catch(() => undefined);
			cleanup();
			lifecycle.complete(499, usage);
		},
	});
};

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	const lifecycle = createApiLifecycle();
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
		return lifecycle.error('REQUEST_ABORTED', '聊天请求已取消', 499, false);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(
			await readBoundedRequestText(
				request,
				MAX_CHAT_REQUEST_BYTES,
				'聊天请求体不能超过 256KB',
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
			return lifecycle.error('REQUEST_ABORTED', '聊天请求已取消', 499, false);
		}
		return lifecycle.error(
			'INVALID_REQUEST',
			'请求体不是有效的 JSON',
			400,
			false,
		);
	}

	let chatRequest: ChatRequest;
	try {
		chatRequest = parseChatRequest(payload);
	} catch (error) {
		if (error instanceof ApiRequestError) {
			return lifecycle.error(
				error.code,
				error.message,
				error.status,
				error.retryable,
			);
		}
		return lifecycle.error('INVALID_REQUEST', '聊天请求格式无效', 400, false);
	}

	lifecycle.setMode(chatRequest.mode);
	const modeConfig = resolveModelMode(chatRequest.mode)!;
	const scope = createAbortScope(request.signal, CHAT_TIMEOUT_MS);
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
				body: JSON.stringify({
					model: modeConfig.model,
					messages: chatRequest.messages,
					thinking: modeConfig.thinking,
					...('reasoning_effort' in modeConfig
						? { reasoning_effort: modeConfig.reasoning_effort }
						: {}),
					stream: true,
					stream_options: { include_usage: true },
				}),
				signal: scope.signal,
			}),
			scope.signal,
		);

		if (!upstream.ok) {
			scope.dispose();
			const mapped = mapDeepSeekUpstreamError(upstream.status);
			return lifecycle.error(
				mapped.code,
				mapped.message,
				mapped.status,
				mapped.retryable,
			);
		}
		if (
			!upstream.body ||
			!upstream.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
		) {
			scope.dispose();
			return lifecycle.error(
				'STREAM_PARSE_FAILED',
				'AI 服务未返回有效的数据流',
				502,
				true,
			);
		}

		return new Response(observeChatStream(upstream.body, scope, lifecycle), {
			status: 200,
			headers: lifecycle.headers({
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
			}),
		});
	} catch {
		scope.dispose();
		if (scope.reason === 'timeout') {
			return lifecycle.error(
				'REQUEST_TIMEOUT',
				'AI 服务请求超时，请稍后重试',
				504,
				true,
			);
		}
		if (scope.reason === 'client' || request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '聊天请求已取消', 499, false);
		}
		return lifecycle.error(
			'UPSTREAM_UNAVAILABLE',
			'AI 服务暂时不可用，请稍后重试',
			502,
			true,
		);
	}
};
