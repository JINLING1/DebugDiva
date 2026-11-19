import {
	ApiRequestError,
	createAbortScope,
	createApiLifecycle,
	isJsonContentType,
	raceWithAbort,
	readBoundedRequestText,
} from '../../_shared/apiLifecycle';
import {
	requestRerank,
	resolveRerankProvider,
	type RerankEnv,
} from '../../_shared/ragUpstream';

export const MAX_RERANK_REQUEST_BYTES = 256 * 1024;
export const MAX_RERANK_DOCUMENTS = 40;
export const MAX_RERANK_QUERY_CHARACTERS = 2_000;
export const MAX_RERANK_DOCUMENT_CHARACTERS = 4_000;
export const RERANK_TIMEOUT_MS = 10_000;

interface RerankRequest {
	query: string;
	documents: string[];
}

const invalidRequest = (message: string) =>
	new ApiRequestError('INVALID_REQUEST', message, 400, false);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedText = (value: unknown, max: number): value is string =>
	typeof value === 'string' && Boolean(value.trim()) && Array.from(value).length <= max;

export const parseRerankRequest = (value: unknown): RerankRequest => {
	if (!isRecord(value)) throw invalidRequest('请求体必须是对象');
	if (!isBoundedText(value.query, MAX_RERANK_QUERY_CHARACTERS)) {
		throw invalidRequest(`query 必须非空且不超过 ${MAX_RERANK_QUERY_CHARACTERS} 个字符`);
	}
	if (
		!Array.isArray(value.documents) ||
		value.documents.length === 0 ||
		value.documents.length > MAX_RERANK_DOCUMENTS
	) {
		throw invalidRequest(`documents 数量必须在 1 到 ${MAX_RERANK_DOCUMENTS} 之间`);
	}
	if (!value.documents.every(item => isBoundedText(item, MAX_RERANK_DOCUMENT_CHARACTERS))) {
		throw invalidRequest(
			`每个文档必须非空且不超过 ${MAX_RERANK_DOCUMENT_CHARACTERS} 个字符`,
		);
	}
	return { query: value.query, documents: value.documents as string[] };
};

/** 分数保留 6 位小数。 */
const compactScore = (score: number) => Math.round(score * 1e6) / 1e6;

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: RerankEnv;
}) => {
	const lifecycle = createApiLifecycle('rag-rerank');
	const fail = (error: ApiRequestError) =>
		lifecycle.error(error.code, error.message, error.status, error.retryable);

	let provider;
	try {
		provider = resolveRerankProvider(env);
	} catch (error) {
		if (error instanceof ApiRequestError) return fail(error);
		throw error;
	}
	if (!isJsonContentType(request.headers.get('content-type'))) {
		return lifecycle.error('INVALID_REQUEST', 'Content-Type 必须是 application/json', 415, false);
	}
	if (request.signal.aborted) {
		return lifecycle.error('REQUEST_ABORTED', '重排序请求已取消', 499, false);
	}

	let rerankRequest: RerankRequest;
	try {
		const text = await readBoundedRequestText(
			request,
			MAX_RERANK_REQUEST_BYTES,
			'重排序请求体不能超过 256KB',
		);
		let payload: unknown;
		try {
			payload = JSON.parse(text);
		} catch {
			throw invalidRequest('请求体不是有效的 JSON');
		}
		rerankRequest = parseRerankRequest(payload);
	} catch (error) {
		if (error instanceof ApiRequestError) return fail(error);
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '重排序请求已取消', 499, false);
		}
		return lifecycle.error('INVALID_REQUEST', '重排序请求格式无效', 400, false);
	}

	const scope = createAbortScope(request.signal, RERANK_TIMEOUT_MS);
	try {
		const results = await raceWithAbort(
			requestRerank(provider, rerankRequest.query, rerankRequest.documents, scope.signal),
			scope.signal,
		);
		return lifecycle.json({
			data: {
				model: provider.model,
				results: results.map(({ index, score }) => ({ index, score: compactScore(score) })),
			},
		});
	} catch (error) {
		if (scope.reason === 'timeout') {
			return lifecycle.error('REQUEST_TIMEOUT', '重排序请求超时，请稍后重试', 504, true);
		}
		if (scope.reason === 'client' || request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '重排序请求已取消', 499, false);
		}
		if (error instanceof ApiRequestError) return fail(error);
		return lifecycle.error('UPSTREAM_UNAVAILABLE', '重排序服务暂时不可用，请稍后重试', 502, true);
	} finally {
		scope.dispose();
	}
};
