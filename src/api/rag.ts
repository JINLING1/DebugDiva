import { AppError } from '../services/errors/AppError';

export const RAG_EMBED_ENDPOINT = '/api/rag/embed';
/** 与服务端 MAX_EMBED_TEXTS 一致。 */
export const MAX_EMBED_BATCH = 32;

export type RagFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface EmbedResult {
	model: string;
	dims: number;
	vectors: number[][];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isAbortError = (error: unknown) =>
	(error instanceof Error || isRecord(error)) && (error as { name?: unknown }).name === 'AbortError';

const invalidResponse = () =>
	new AppError({
		code: 'INVALID_EMBEDDING_RESPONSE',
		message: '向量化服务返回了无效数据',
		retryable: true,
	});

export const validateEmbedResult = (value: unknown, expectedCount: number): EmbedResult => {
	if (!isRecord(value)) throw invalidResponse();
	const { model, dims, vectors } = value;
	if (
		typeof model !== 'string' ||
		!model ||
		typeof dims !== 'number' ||
		!Number.isInteger(dims) ||
		dims <= 0 ||
		!Array.isArray(vectors) ||
		vectors.length !== expectedCount ||
		!vectors.every(
			vector =>
				Array.isArray(vector) &&
				vector.length === dims &&
				vector.every(item => typeof item === 'number' && Number.isFinite(item)),
		)
	) {
		throw invalidResponse();
	}
	return { model, dims, vectors: vectors as number[][] };
};

/** 调用服务端向量化接口；单次最多 MAX_EMBED_BATCH 条，调用方负责分批。 */
export const embedTexts = async (
	texts: readonly string[],
	{ signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: RagFetch } = {},
): Promise<EmbedResult> => {
	let response: Response;
	try {
		response = await fetchImpl(RAG_EMBED_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ texts }),
			signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new AppError({
			code: 'NETWORK_ERROR',
			message: '无法连接向量化服务',
			retryable: true,
			cause,
		});
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		body = undefined;
	}

	if (!response.ok) {
		const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
		throw new AppError({
			code: typeof error?.code === 'string' ? error.code : 'EMBEDDING_FAILED',
			message: typeof error?.message === 'string' ? error.message : '向量化服务暂时不可用',
			status: response.status,
			requestId: typeof error?.requestId === 'string' ? error.requestId : undefined,
			retryable:
				typeof error?.retryable === 'boolean'
					? error.retryable
					: response.status === 429 || response.status >= 500,
		});
	}
	if (!isRecord(body) || !('data' in body)) throw invalidResponse();
	return validateEmbedResult(body.data, texts.length);
};

export const RAG_RERANK_ENDPOINT = '/api/rag/rerank';
/** 与服务端 MAX_RERANK_DOCUMENTS / MAX_RERANK_DOCUMENT_CHARACTERS 一致。 */
export const MAX_RERANK_DOCUMENTS = 40;
export const MAX_RERANK_DOCUMENT_CHARACTERS = 4_000;

export interface RerankResult {
	model: string;
	/** 按分数从高到低；index 指向请求中的 documents。 */
	results: { index: number; score: number }[];
}

const invalidRerankResponse = () =>
	new AppError({
		code: 'INVALID_RERANK_RESPONSE',
		message: '重排序服务返回了无效数据',
		retryable: true,
	});

export const validateRerankResult = (value: unknown, expectedCount: number): RerankResult => {
	if (!isRecord(value)) throw invalidRerankResponse();
	const { model, results } = value;
	if (typeof model !== 'string' || !model || !Array.isArray(results)) {
		throw invalidRerankResponse();
	}
	const seen = new Set<number>();
	for (const item of results) {
		if (
			!isRecord(item) ||
			typeof item.index !== 'number' ||
			!Number.isInteger(item.index) ||
			item.index < 0 ||
			item.index >= expectedCount ||
			seen.has(item.index) ||
			typeof item.score !== 'number' ||
			!Number.isFinite(item.score)
		) {
			throw invalidRerankResponse();
		}
		seen.add(item.index);
	}
	if (seen.size !== expectedCount) throw invalidRerankResponse();
	return {
		model,
		results: (results as RerankResult['results'])
			.map(({ index, score }) => ({ index, score }))
			.sort((a, b) => b.score - a.score || a.index - b.index),
	};
};

/** 调用服务端重排序接口；调用方负责截断文档长度和数量。 */
export const rerankTexts = async (
	query: string,
	documents: readonly string[],
	{ signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: RagFetch } = {},
): Promise<RerankResult> => {
	let response: Response;
	try {
		response = await fetchImpl(RAG_RERANK_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, documents }),
			signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new AppError({
			code: 'NETWORK_ERROR',
			message: '无法连接重排序服务',
			retryable: true,
			cause,
		});
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		body = undefined;
	}

	if (!response.ok) {
		const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
		throw new AppError({
			code: typeof error?.code === 'string' ? error.code : 'RERANK_FAILED',
			message: typeof error?.message === 'string' ? error.message : '重排序服务暂时不可用',
			status: response.status,
			requestId: typeof error?.requestId === 'string' ? error.requestId : undefined,
			retryable:
				typeof error?.retryable === 'boolean'
					? error.retryable
					: response.status === 429 || response.status >= 500,
		});
	}
	if (!isRecord(body) || !('data' in body)) throw invalidRerankResponse();
	return validateRerankResult(body.data, documents.length);
};

export const RAG_REWRITE_ENDPOINT = '/api/rag/rewrite';

export interface RewriteResult {
	model: string;
	query: string;
}

/** 调用服务端查询改写接口；返回一行检索查询。 */
export const rewriteQuery = async (
	query: string,
	{ signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: RagFetch } = {},
): Promise<RewriteResult> => {
	let response: Response;
	try {
		response = await fetchImpl(RAG_REWRITE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query }),
			signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new AppError({ code: 'NETWORK_ERROR', message: '无法连接查询改写服务', retryable: true, cause });
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		body = undefined;
	}
	if (!response.ok) {
		const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
		throw new AppError({
			code: typeof error?.code === 'string' ? error.code : 'REWRITE_FAILED',
			message: typeof error?.message === 'string' ? error.message : '查询改写服务暂时不可用',
			status: response.status,
			retryable: response.status === 429 || response.status >= 500,
		});
	}
	const data = isRecord(body) && isRecord(body.data) ? body.data : undefined;
	if (typeof data?.model !== 'string' || typeof data.query !== 'string' || !data.query.trim()) {
		throw new AppError({
			code: 'INVALID_REWRITE_RESPONSE',
			message: '查询改写服务返回了无效数据',
			retryable: true,
		});
	}
	return { model: data.model, query: data.query.trim() };
};
