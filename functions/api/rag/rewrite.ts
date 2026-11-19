import {
	ApiRequestError,
	createAbortScope,
	createApiLifecycle,
	isJsonContentType,
	raceWithAbort,
	readBoundedRequestText,
} from '../../_shared/apiLifecycle';
import {
	requestRewrite,
	resolveRewriteProvider,
	type RewriteEnv,
} from '../../_shared/ragUpstream';

export const MAX_REWRITE_REQUEST_BYTES = 16 * 1024;
export const MAX_REWRITE_QUERY_CHARACTERS = 2_000;
export const REWRITE_TIMEOUT_MS = 8_000;

const invalidRequest = (message: string) =>
	new ApiRequestError('INVALID_REQUEST', message, 400, false);

export const parseRewriteRequest = (value: unknown): { query: string } => {
	const query = (value as { query?: unknown } | null)?.query;
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		typeof query !== 'string' ||
		!query.trim() ||
		Array.from(query).length > MAX_REWRITE_QUERY_CHARACTERS
	) {
		throw invalidRequest(`query 必须非空且不超过 ${MAX_REWRITE_QUERY_CHARACTERS} 个字符`);
	}
	return { query };
};

/** 检索查询改写：把口语问题改写成带术语的检索查询。只用于检索，不进入对话上下文。 */
export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: RewriteEnv;
}) => {
	const lifecycle = createApiLifecycle('rag-rewrite');
	const fail = (error: ApiRequestError) =>
		lifecycle.error(error.code, error.message, error.status, error.retryable);

	let provider;
	try {
		provider = resolveRewriteProvider(env);
	} catch (error) {
		if (error instanceof ApiRequestError) return fail(error);
		throw error;
	}
	if (!isJsonContentType(request.headers.get('content-type'))) {
		return lifecycle.error('INVALID_REQUEST', 'Content-Type 必须是 application/json', 415, false);
	}
	if (request.signal.aborted) {
		return lifecycle.error('REQUEST_ABORTED', '查询改写请求已取消', 499, false);
	}

	let query: string;
	try {
		const text = await readBoundedRequestText(
			request,
			MAX_REWRITE_REQUEST_BYTES,
			'查询改写请求体不能超过 16KB',
		);
		let payload: unknown;
		try {
			payload = JSON.parse(text);
		} catch {
			throw invalidRequest('请求体不是有效的 JSON');
		}
		({ query } = parseRewriteRequest(payload));
	} catch (error) {
		if (error instanceof ApiRequestError) return fail(error);
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '查询改写请求已取消', 499, false);
		}
		return lifecycle.error('INVALID_REQUEST', '查询改写请求格式无效', 400, false);
	}

	const scope = createAbortScope(request.signal, REWRITE_TIMEOUT_MS);
	try {
		const rewritten = await raceWithAbort(
			requestRewrite(provider, query, scope.signal),
			scope.signal,
		);
		return lifecycle.json({ data: { model: provider.model, query: rewritten } });
	} catch (error) {
		if (scope.reason === 'timeout') {
			return lifecycle.error('REQUEST_TIMEOUT', '查询改写请求超时', 504, true);
		}
		if (scope.reason === 'client' || request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '查询改写请求已取消', 499, false);
		}
		if (error instanceof ApiRequestError) return fail(error);
		return lifecycle.error('UPSTREAM_UNAVAILABLE', '查询改写服务暂时不可用', 502, true);
	} finally {
		scope.dispose();
	}
};
