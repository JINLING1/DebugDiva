export const SAFE_API_HEADERS = {
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
} as const;

export interface ApiUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	cacheHitTokens?: number;
	cacheMissTokens?: number;
}

export interface ApiErrorDescriptor {
	code: string;
	message: string;
	status: number;
	retryable: boolean;
}

export type ApiAbortReason = 'client' | 'timeout';

export class ApiRequestError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status: number,
		public readonly retryable = false,
	) {
		super(message);
		this.name = 'ApiRequestError';
	}
}

const createRequestId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const safeTokenCount = (value: unknown) =>
	typeof value === 'number' &&
	Number.isSafeInteger(value) &&
	value >= 0
		? value
		: undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const extractApiUsage = (value: unknown): ApiUsage | undefined => {
	if (!isRecord(value)) return undefined;

	const usage: ApiUsage = {
		promptTokens: safeTokenCount(value.prompt_tokens),
		completionTokens: safeTokenCount(value.completion_tokens),
		totalTokens: safeTokenCount(value.total_tokens),
		cacheHitTokens: safeTokenCount(value.prompt_cache_hit_tokens),
		cacheMissTokens: safeTokenCount(value.prompt_cache_miss_tokens),
	};

	return Object.values(usage).some(item => item !== undefined)
		? usage
		: undefined;
};

export const isJsonContentType = (value: string | null) =>
	/^application\/json(?:\s*;|$)/i.test(value ?? '');

export const isMultipartContentType = (value: string | null) =>
	/^multipart\/form-data\s*;/i.test(value ?? '');

export const retryableForStatus = (status: number) =>
	status === 408 || status === 429 || status === 502 || status === 503 || status === 504;

export const mapDeepSeekUpstreamError = (
	status: number,
	serviceName = 'AI 服务',
): ApiErrorDescriptor => {
	if (status === 401 || status === 403) {
		return {
			code: 'AUTH_FAILED',
			message: `${serviceName}认证失败`,
			status: 502,
			retryable: false,
		};
	}
	if (status === 402) {
		return {
			code: 'INSUFFICIENT_BALANCE',
			message: `${serviceName}余额不足`,
			status: 402,
			retryable: false,
		};
	}
	if (status === 429) {
		return {
			code: 'RATE_LIMITED',
			message: '请求过于频繁，请稍后重试',
			status: 429,
			retryable: true,
		};
	}
	if (status === 408 || status === 504) {
		return {
			code: 'REQUEST_TIMEOUT',
			message: `${serviceName}请求超时，请稍后重试`,
			status: 504,
			retryable: true,
		};
	}
	return {
		code: 'UPSTREAM_UNAVAILABLE',
		message: `${serviceName}暂时不可用，请稍后重试`,
		status: 502,
		retryable: true,
	};
};

export const readBoundedRequestText = async (
	request: Request,
	maxBytes: number,
	tooLargeMessage: string,
) => {
	const contentLength = request.headers.get('content-length');
	if (
		contentLength !== null &&
		/^\d+$/.test(contentLength.trim()) &&
		Number(contentLength) > maxBytes
	) {
		throw new ApiRequestError('REQUEST_TOO_LARGE', tooLargeMessage, 413);
	}
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => undefined);
			throw new ApiRequestError('REQUEST_TOO_LARGE', tooLargeMessage, 413);
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
		throw new ApiRequestError(
			'INVALID_REQUEST',
			'请求体不是有效的 UTF-8 JSON',
			400,
		);
	}
};

export const raceWithAbort = <T>(promise: Promise<T>, signal: AbortSignal) =>
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

export const createAbortScope = (
	clientSignal: AbortSignal,
	timeoutMs: number,
) => {
	const controller = new AbortController();
	let reason: ApiAbortReason | undefined;
	const abort = (nextReason: ApiAbortReason) => {
		if (controller.signal.aborted) return;
		reason = nextReason;
		controller.abort();
	};
	const onClientAbort = () => abort('client');
	clientSignal.addEventListener('abort', onClientAbort, { once: true });
	if (clientSignal.aborted) abort('client');
	const timeout = setTimeout(() => abort('timeout'), timeoutMs);

	return {
		signal: controller.signal,
		abort,
		get reason() {
			return reason;
		},
		dispose() {
			clearTimeout(timeout);
			clientSignal.removeEventListener('abort', onClientAbort);
		},
	};
};

export const createApiLifecycle = (mode?: string) => {
	const requestId = createRequestId();
	const startedAt = Date.now();
	let logged = false;
	let safeMode = mode;

	const headers = (additional?: HeadersInit) => {
		const result = new Headers(additional);
		result.set('Cache-Control', SAFE_API_HEADERS['Cache-Control']);
		result.set(
			'X-Content-Type-Options',
			SAFE_API_HEADERS['X-Content-Type-Options'],
		);
		result.set('X-Request-Id', requestId);
		return result;
	};

const complete = (status: number, usage?: ApiUsage) => {
		if (logged) return;
		logged = true;
		const entry: {
			requestId: string;
			duration: number;
			status: number;
			mode?: string;
			usage?: ApiUsage;
		} = {
			requestId,
			duration: Math.max(0, Date.now() - startedAt),
			status,
		};
		if (safeMode) entry.mode = safeMode;
		if (usage) entry.usage = usage;
		try {
			console.info(JSON.stringify(entry));
		} catch {
		}
	};

	const json = (data: unknown, status = 200, usage?: ApiUsage) => {
		complete(status, usage);
		return Response.json(data, { status, headers: headers() });
	};

	const error = (
		code: string,
		message: string,
		status: number,
		retryable = retryableForStatus(status),
	) =>
		json(
			{
				error: {
					code,
					message,
					requestId,
					retryable,
				},
			},
			status,
		);

	const setMode = (nextMode: string) => {
		if (!logged) safeMode = nextMode;
	};

	return { requestId, headers, setMode, complete, json, error };
};
