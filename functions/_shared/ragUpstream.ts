/**
 * Embedding 上游 Provider（无状态）。
 *
 * 浏览器不能选择 Provider 或模型；服务端按环境变量 RAG_EMBEDDING_PROVIDER 选择，
 * 默认使用硅基流动免费的 BAAI/bge-m3。离线评测脚本也直接复用本模块。
 */

import { ApiRequestError, mapDeepSeekUpstreamError } from './apiLifecycle';

export interface RagEnv {
	RAG_EMBEDDING_PROVIDER?: string;
	SILICONFLOW_API_KEY?: string;
	SILICONFLOW_BASE_URL?: string;
	DASHSCOPE_API_KEY?: string;
	DASHSCOPE_BASE_URL?: string;
}

export type EmbeddingProviderName = 'siliconflow' | 'dashscope';

export interface EmbeddingProviderConfig {
	name: EmbeddingProviderName;
	model: string;
	dims: number;
	baseUrl: string;
	apiKey: string;
	/** 上游单次请求的最大条数。 */
	maxBatch: number;
	/** 是否需要在请求中显式指定维度。 */
	sendDimensions: boolean;
}

export const EMBEDDING_DIMS = 1024;

const PROVIDERS: Record<
	EmbeddingProviderName,
	(env: RagEnv) => Omit<EmbeddingProviderConfig, 'name' | 'apiKey'> & { apiKey?: string }
> = {
	siliconflow: env => ({
		model: 'BAAI/bge-m3',
		dims: EMBEDDING_DIMS,
		baseUrl: env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
		apiKey: env.SILICONFLOW_API_KEY,
		maxBatch: 32,
		sendDimensions: false,
	}),
	dashscope: env => ({
		model: 'text-embedding-v4',
		dims: EMBEDDING_DIMS,
		baseUrl:
			env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		apiKey: env.DASHSCOPE_API_KEY,
		maxBatch: 10,
		sendDimensions: true,
	}),
};

export const resolveEmbeddingProvider = (env: RagEnv): EmbeddingProviderConfig => {
	const name = (env.RAG_EMBEDDING_PROVIDER || 'siliconflow').trim().toLowerCase();
	if (!Object.hasOwn(PROVIDERS, name)) {
		throw new ApiRequestError(
			'RAG_PROVIDER_MISCONFIGURED',
			'服务端向量化服务配置无效',
			500,
			false,
		);
	}
	const config = PROVIDERS[name as EmbeddingProviderName](env);
	if (!config.apiKey) {
		throw new ApiRequestError(
			'AUTH_FAILED',
			'服务端向量化服务 API Key 未配置',
			500,
			false,
		);
	}
	return {
		...config,
		name: name as EmbeddingProviderName,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl.replace(/\/$/, ''),
	};
};

const invalidResponse = () =>
	new ApiRequestError(
		'INVALID_EMBEDDING_RESPONSE',
		'向量化服务返回了无效结果，请稍后重试',
		502,
		true,
	);

/** 解析 OpenAI 兼容的 /embeddings 响应，按 index 排序并校验维度。 */
export const parseEmbeddingResponse = (
	payload: unknown,
	expectedCount: number,
	dims: number,
): number[][] => {
	if (typeof payload !== 'object' || payload === null) throw invalidResponse();
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data) || data.length !== expectedCount) throw invalidResponse();

	const vectors: number[][] = new Array(expectedCount);
	for (const item of data) {
		const { index, embedding } = (item ?? {}) as {
			index?: unknown;
			embedding?: unknown;
		};
		if (
			typeof index !== 'number' ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= expectedCount ||
			vectors[index] ||
			!Array.isArray(embedding) ||
			embedding.length !== dims ||
			!embedding.every(value => typeof value === 'number' && Number.isFinite(value))
		) {
			throw invalidResponse();
		}
		vectors[index] = embedding as number[];
	}
	return vectors;
};

/**
 * 调用上游生成向量；超过上游单次上限时自动分批。
 * 抛出 ApiRequestError，调用方负责映射为统一错误体。
 */
export const requestEmbeddings = async (
	config: EmbeddingProviderConfig,
	texts: readonly string[],
	signal: AbortSignal,
	fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<number[][]> => {
	const vectors: number[][] = [];
	for (let start = 0; start < texts.length; start += config.maxBatch) {
		const batch = texts.slice(start, start + config.maxBatch);
		const response = await fetchImpl(`${config.baseUrl}/embeddings`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: config.model,
				input: batch,
				encoding_format: 'float',
				...(config.sendDimensions ? { dimensions: config.dims } : {}),
			}),
			signal,
		});
		if (!response.ok) {
			const mapped = mapDeepSeekUpstreamError(response.status, '向量化服务');
			throw new ApiRequestError(
				mapped.code,
				mapped.message,
				mapped.status,
				mapped.retryable,
			);
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw invalidResponse();
		}
		vectors.push(...parseEmbeddingResponse(payload, batch.length, config.dims));
	}
	return vectors;
};

/* ------------------------------------------------------------------ */
/* Rerank                                                              */
/* ------------------------------------------------------------------ */

export interface RerankEnv extends RagEnv {
	RAG_RERANK_PROVIDER?: string;
	/** 百炼 rerank 使用独立的 compatible-api 路径，与 chat 的 compatible-mode 不同。 */
	DASHSCOPE_RERANK_URL?: string;
}

export type RerankProviderName = 'siliconflow' | 'dashscope';

export interface RerankProviderConfig {
	name: RerankProviderName;
	model: string;
	/** 完整的 rerank 接口地址。 */
	url: string;
	apiKey: string;
}

export interface RerankScore {
	index: number;
	score: number;
}

const RERANK_PROVIDERS: Record<
	RerankProviderName,
	(env: RerankEnv) => Omit<RerankProviderConfig, 'name' | 'apiKey'> & { apiKey?: string }
> = {
	siliconflow: env => ({
		model: 'BAAI/bge-reranker-v2-m3',
		url: `${(env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')}/rerank`,
		apiKey: env.SILICONFLOW_API_KEY,
	}),
	dashscope: env => ({
		model: 'qwen3-rerank',
		url:
			env.DASHSCOPE_RERANK_URL ||
			'https://dashscope.aliyuncs.com/compatible-api/v1/reranks',
		apiKey: env.DASHSCOPE_API_KEY,
	}),
};

/** rerank Provider 默认跟随 embedding Provider，也可以单独指定。 */
export const resolveRerankProvider = (env: RerankEnv): RerankProviderConfig => {
	const name = (env.RAG_RERANK_PROVIDER || env.RAG_EMBEDDING_PROVIDER || 'siliconflow')
		.trim()
		.toLowerCase();
	if (!Object.hasOwn(RERANK_PROVIDERS, name)) {
		throw new ApiRequestError(
			'RAG_PROVIDER_MISCONFIGURED',
			'服务端重排序服务配置无效',
			500,
			false,
		);
	}
	const config = RERANK_PROVIDERS[name as RerankProviderName](env);
	if (!config.apiKey) {
		throw new ApiRequestError('AUTH_FAILED', '服务端重排序服务 API Key 未配置', 500, false);
	}
	return { ...config, name: name as RerankProviderName, apiKey: config.apiKey };
};

const invalidRerankResponse = () =>
	new ApiRequestError(
		'INVALID_RERANK_RESPONSE',
		'重排序服务返回了无效结果，请稍后重试',
		502,
		true,
	);

/**
 * 解析 `{ results: [{ index, relevance_score }] }`（硅基流动与百炼 compatible-api 相同）。
 * 要求每个文档恰好出现一次，按分数从高到低返回。
 */
export const parseRerankResponse = (payload: unknown, expectedCount: number): RerankScore[] => {
	if (typeof payload !== 'object' || payload === null) throw invalidRerankResponse();
	const results = (payload as { results?: unknown }).results;
	if (!Array.isArray(results) || results.length !== expectedCount) throw invalidRerankResponse();
	const seen = new Set<number>();
	const scores: RerankScore[] = [];
	for (const item of results) {
		const { index, relevance_score: score } = (item ?? {}) as {
			index?: unknown;
			relevance_score?: unknown;
		};
		if (
			typeof index !== 'number' ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= expectedCount ||
			seen.has(index) ||
			typeof score !== 'number' ||
			!Number.isFinite(score)
		) {
			throw invalidRerankResponse();
		}
		seen.add(index);
		scores.push({ index, score });
	}
	return scores.sort((a, b) => b.score - a.score || a.index - b.index);
};

export const requestRerank = async (
	config: RerankProviderConfig,
	query: string,
	documents: readonly string[],
	signal: AbortSignal,
	fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<RerankScore[]> => {
	const response = await fetchImpl(config.url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: config.model,
			query,
			documents,
			top_n: documents.length,
			return_documents: false,
		}),
		signal,
	});
	if (!response.ok) {
		const mapped = mapDeepSeekUpstreamError(response.status, '重排序服务');
		throw new ApiRequestError(mapped.code, mapped.message, mapped.status, mapped.retryable);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw invalidRerankResponse();
	}
	return parseRerankResponse(payload, documents.length);
};

/* ------------------------------------------------------------------ */
/* Query rewrite                                                       */
/* ------------------------------------------------------------------ */

export interface RewriteEnv extends RagEnv {
	/** 查询改写使用的硅基流动对话模型。 */
	RAG_REWRITE_MODEL?: string;
}

export interface RewriteProviderConfig {
	model: string;
	url: string;
	apiKey: string;
}

/** 默认模型由评测 E5 选定，见 docs/rag-design.md 第 8 节。 */
export const DEFAULT_REWRITE_MODEL = 'THUDM/GLM-4-9B-0414';
export const MAX_REWRITTEN_QUERY_CHARACTERS = 300;

/**
 * 示例刻意选用评测语料之外的主题，避免把评测答案写进提示词。
 */
export const REWRITE_SYSTEM_PROMPT = [
	'你是技术文档检索的查询改写器。用户会用口语描述编程中遇到的问题，待检索的文档可能是中文或英文的技术参考资料。',
	'把问题改写成一行适合检索的查询：保留原意，补充文档里很可能出现的专业术语——错误名、错误码、API 名、HTTP 状态码及其英文短语，必要时同时给出中英文说法。',
	'不要编造问题里没有暗示的内容；问题本身已经包含准确术语时，原样保留这些术语即可。',
	'只输出这一行查询，不要解释，不要加引号。',
	'',
	'示例：',
	'问：数据库连接一直拿不到，说池子满了',
	'答：数据库连接池耗尽 connection pool exhausted too many connections 获取连接超时',
	'问：Git 推送的时候说远程有我本地没有的提交',
	'答：git push rejected non-fast-forward 远程分支有新提交 需要先 pull',
].join('\n');

export const resolveRewriteProvider = (env: RewriteEnv): RewriteProviderConfig => {
	if (!env.SILICONFLOW_API_KEY) {
		throw new ApiRequestError('AUTH_FAILED', '服务端查询改写服务 API Key 未配置', 500, false);
	}
	return {
		model: env.RAG_REWRITE_MODEL?.trim() || DEFAULT_REWRITE_MODEL,
		url: `${(env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')}/chat/completions`,
		apiKey: env.SILICONFLOW_API_KEY,
	};
};

/** 只取第一行非空文本，去掉模型常见的包裹符号与“答：”前缀，并限制长度。 */
export const sanitizeRewrittenQuery = (value: string): string => {
	const line =
		value
			.replace(/<think>[\s\S]*?<\/think>/g, '')
			.split(/\r?\n/)
			.map(item => item.trim())
			.find(Boolean) ?? '';
	const cleaned = line
		.replace(/^(?:答|查询|改写|query)\s*[:：]\s*/i, '')
		.replace(/^[`"'“”「」]+|[`"'“”「」]+$/g, '')
		.trim();
	return Array.from(cleaned).slice(0, MAX_REWRITTEN_QUERY_CHARACTERS).join('');
};

const invalidRewriteResponse = () =>
	new ApiRequestError('INVALID_REWRITE_RESPONSE', '查询改写服务返回了无效结果', 502, true);

export const requestRewrite = async (
	config: RewriteProviderConfig,
	query: string,
	signal: AbortSignal,
	fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<string> => {
	const response = await fetchImpl(config.url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: config.model,
			messages: [
				{ role: 'system', content: REWRITE_SYSTEM_PROMPT },
				{ role: 'user', content: query },
			],
			temperature: 0,
			max_tokens: 160,
			stream: false,
			enable_thinking: false,
		}),
		signal,
	});
	if (!response.ok) {
		const mapped = mapDeepSeekUpstreamError(response.status, '查询改写服务');
		throw new ApiRequestError(mapped.code, mapped.message, mapped.status, mapped.retryable);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw invalidRewriteResponse();
	}
	const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
		?.message?.content;
	if (typeof content !== 'string') throw invalidRewriteResponse();
	const rewritten = sanitizeRewrittenQuery(content);
	if (!rewritten) throw invalidRewriteResponse();
	return rewritten;
};
