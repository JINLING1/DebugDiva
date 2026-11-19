import {
	ApiRequestError,
	createAbortScope,
	createApiLifecycle,
	isJsonContentType,
	raceWithAbort,
	readBoundedRequestText,
} from '../../_shared/apiLifecycle';
import {
	requestEmbeddings,
	resolveEmbeddingProvider,
	type RagEnv,
} from '../../_shared/ragUpstream';

export const MAX_EMBED_REQUEST_BYTES = 256 * 1024;
export const MAX_EMBED_TEXTS = 32;
export const MAX_EMBED_TEXT_CHARACTERS = 2_000;
export const EMBED_TIMEOUT_MS = 20_000;

interface EmbedRequest {
	texts: string[];
}

const invalidRequest = (message: string) =>
	new ApiRequestError('INVALID_REQUEST', message, 400, false);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseEmbedRequest = (value: unknown): EmbedRequest => {
	if (!isRecord(value) || !Array.isArray(value.texts)) {
		throw invalidRequest('texts 必须是字符串数组');
	}
	if (value.texts.length === 0 || value.texts.length > MAX_EMBED_TEXTS) {
		throw invalidRequest(`texts 数量必须在 1 到 ${MAX_EMBED_TEXTS} 之间`);
	}
	for (const text of value.texts) {
		if (
			typeof text !== 'string' ||
			!text.trim() ||
			Array.from(text).length > MAX_EMBED_TEXT_CHARACTERS
		) {
			throw invalidRequest(
				`每条文本必须非空且不超过 ${MAX_EMBED_TEXT_CHARACTERS} 个字符`,
			);
		}
	}
	return { texts: value.texts as string[] };
};

/** 向量保留 6 位小数，响应体约减半，对余弦相似度的影响可以忽略。 */
const compactVector = (vector: number[]) =>
	vector.map(value => Math.round(value * 1e6) / 1e6);

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: RagEnv;
}) => {
	const lifecycle = createApiLifecycle('rag-embed');
	const fail = (error: ApiRequestError) =>
		lifecycle.error(error.code, error.message, error.status, error.retryable);

	let provider;
	try {
		provider = resolveEmbeddingProvider(env);
	} catch (error) {
		if (error instanceof ApiRequestError) return fail(error);
		throw error;
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
		return lifecycle.error('REQUEST_ABORTED', '向量化请求已取消', 499, false);
	}

	let embedRequest: EmbedRequest;
	try {
		const text = await readBoundedRequestText(
			request,
			MAX_EMBED_REQUEST_BYTES,
			'向量化请求体不能超过 256KB',
		);
		let payload: unknown;
		try {
			payload = JSON.parse(text);
		} catch {
			throw invalidRequest('请求体不是有效的 JSON');
		}
		embedRequest = parseEmbedRequest(payload);
	} catch (error) {
		if (error instanceof ApiRequestError) return fail(error);
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '向量化请求已取消', 499, false);
		}
		return lifecycle.error('INVALID_REQUEST', '向量化请求格式无效', 400, false);
	}

	const scope = createAbortScope(request.signal, EMBED_TIMEOUT_MS);
	try {
		const vectors = await raceWithAbort(
			requestEmbeddings(provider, embedRequest.texts, scope.signal),
			scope.signal,
		);
		return lifecycle.json({
			data: {
				model: provider.model,
				dims: provider.dims,
				vectors: vectors.map(compactVector),
			},
		});
	} catch (error) {
		if (scope.reason === 'timeout') {
			return lifecycle.error(
				'REQUEST_TIMEOUT',
				'向量化请求超时，请稍后重试',
				504,
				true,
			);
		}
		if (scope.reason === 'client' || request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '向量化请求已取消', 499, false);
		}
		if (error instanceof ApiRequestError) return fail(error);
		return lifecycle.error(
			'UPSTREAM_UNAVAILABLE',
			'向量化服务暂时不可用，请稍后重试',
			502,
			true,
		);
	} finally {
		scope.dispose();
	}
};
