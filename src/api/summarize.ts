import { AppError } from '../services/errors/AppError';
import type { ConversationSummary } from '../types/chat';

export const SUMMARIZE_ENDPOINT = '/api/summarize';
export const MAX_SUMMARY_ITEMS_PER_CATEGORY = 20;
export const MAX_SUMMARY_ITEM_LENGTH = 400;
export const MAX_SUMMARY_TOTAL_LENGTH = 16_000;
export const MAX_SUMMARY_MESSAGE_ID_LENGTH = 128;
export const MAX_SUMMARY_INPUT_MESSAGE_LENGTH = 8_000;
export const MAX_SUMMARY_INPUT_TOTAL_LENGTH = 64_000;
export const MAX_SUMMARY_REQUEST_BYTES = 128 * 1024;

export interface SummaryInputMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

export type SummaryFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface SummarizeConversationOptions {
	previousSummary?: ConversationSummary;
	messages: readonly SummaryInputMessage[];
	clientId: string;
	signal: AbortSignal;
	fetchImpl?: SummaryFetch;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
	typeof value === 'boolean' ? value : undefined;

const isAbortError = (error: unknown): boolean =>
	(error instanceof Error || isRecord(error)) && error.name === 'AbortError';

const unicodeLength = (value: string): number => Array.from(value).length;

const getRequestId = (response: Response): string | undefined =>
	response.headers.get('x-request-id') ??
	response.headers.get('x-debugdiva-request-id') ??
	undefined;

const fallbackCodeForStatus = (status: number): string => {
	if (status === 401 || status === 403) return 'AUTH_FAILED';
	if (status === 402) return 'INSUFFICIENT_BALANCE';
	if (status === 408 || status === 504) return 'REQUEST_TIMEOUT';
	if (status === 429) return 'RATE_LIMITED';
	if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
	return 'SUMMARY_REQUEST_FAILED';
};

const fallbackMessageForStatus = (status: number): string => {
	if (status === 401 || status === 403) return '摘要服务鉴权失败';
	if (status === 402) return '摘要服务余额不足';
	if (status === 408 || status === 504) return '生成对话摘要超时';
	if (status === 429) return '摘要请求过于频繁，请稍后重试';
	if (status >= 500) return '摘要服务暂时不可用';
	return '生成对话摘要失败';
};

const readResponseBody = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		return undefined;
	}
};

const appErrorFromResponse = async (response: Response): Promise<AppError> => {
	const body = await readResponseBody(response);
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	const status = response.status;

	return new AppError({
		code: readString(error?.code) ?? fallbackCodeForStatus(status),
		message: readString(error?.message) ?? fallbackMessageForStatus(status),
		status,
		requestId: readString(error?.requestId) ?? getRequestId(response),
		retryable:
			readBoolean(error?.retryable) ??
			(status === 408 || status === 429 || status >= 500),
	});
};

const invalidResponse = (message: string): AppError =>
	new AppError({
		code: 'INVALID_SUMMARY_RESPONSE',
		message,
		retryable: true,
	});

const validateSummaryList = (value: unknown, field: string): string[] => {
	if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
		throw invalidResponse(`摘要字段 ${field} 必须是字符串数组`);
	}
	if (value.length > MAX_SUMMARY_ITEMS_PER_CATEGORY) {
		throw invalidResponse(`摘要字段 ${field} 的条目数量超出限制`);
	}
	if (value.some(item => !item.trim() || unicodeLength(item) > MAX_SUMMARY_ITEM_LENGTH)) {
		throw invalidResponse(`摘要字段 ${field} 包含空白或过长条目`);
	}
	return [...value];
};

export const validateConversationSummary = (
	value: unknown,
	expectedCoveredUntilMessageId?: string,
): ConversationSummary => {
	if (!isRecord(value)) {
		throw invalidResponse('摘要服务返回了无效数据');
	}

	const userGoals = validateSummaryList(value.userGoals, 'userGoals');
	const confirmedFacts = validateSummaryList(
		value.confirmedFacts,
		'confirmedFacts',
	);
	const decisions = validateSummaryList(value.decisions, 'decisions');
	const unresolvedQuestions = validateSummaryList(
		value.unresolvedQuestions,
		'unresolvedQuestions',
	);
	const coveredUntilMessageId = readString(value.coveredUntilMessageId);
	const updatedAt = value.updatedAt;

	if (
		!coveredUntilMessageId ||
		unicodeLength(coveredUntilMessageId) > MAX_SUMMARY_MESSAGE_ID_LENGTH
	) {
		throw invalidResponse('摘要覆盖消息 ID 无效');
	}
	if (
		expectedCoveredUntilMessageId !== undefined &&
		coveredUntilMessageId !== expectedCoveredUntilMessageId
	) {
		throw invalidResponse('摘要覆盖边界与请求消息不一致');
	}
	if (
		typeof updatedAt !== 'number' ||
		!Number.isSafeInteger(updatedAt) ||
		updatedAt <= 0
	) {
		throw invalidResponse('摘要更新时间无效');
	}

	const totalLength = [
		...userGoals,
		...confirmedFacts,
		...decisions,
		...unresolvedQuestions,
	].reduce((total, item) => total + unicodeLength(item), 0);
	if (totalLength > MAX_SUMMARY_TOTAL_LENGTH) {
		throw invalidResponse('摘要总长度超出限制');
	}

	return {
		userGoals,
		confirmedFacts,
		decisions,
		unresolvedQuestions,
		coveredUntilMessageId,
		updatedAt,
	};
};

const pickSummaryFields = (
	summary: ConversationSummary,
): ConversationSummary => ({
	userGoals: [...summary.userGoals],
	confirmedFacts: [...summary.confirmedFacts],
	decisions: [...summary.decisions],
	unresolvedQuestions: [...summary.unresolvedQuestions],
	coveredUntilMessageId: summary.coveredUntilMessageId,
	updatedAt: summary.updatedAt,
});

export const serializeSummaryRequestPayload = (
	previousSummary: ConversationSummary | undefined,
	messages: readonly SummaryInputMessage[],
	clientId: string,
): string =>
	JSON.stringify({
		...(previousSummary
			? { previousSummary: pickSummaryFields(previousSummary) }
			: {}),
		messages: messages.map(({ id, role, content }) => ({ id, role, content })),
		clientId,
	});

/** Generate or incrementally update structured conversation memory. */
export const summarizeConversation = async ({
	previousSummary,
	messages,
	clientId,
	signal,
	fetchImpl = fetch,
}: SummarizeConversationOptions): Promise<ConversationSummary> => {
	const requestMessages = messages.map(({ id, role, content }) => ({
		id,
		role,
		content,
	}));
	const expectedCoveredUntilMessageId = requestMessages.at(-1)?.id;

	if (!expectedCoveredUntilMessageId) {
		throw new AppError({
			code: 'INVALID_REQUEST',
			message: '摘要请求必须包含至少一条消息',
			retryable: false,
		});
	}

	let response: Response;
	try {
		response = await fetchImpl(SUMMARIZE_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: serializeSummaryRequestPayload(
				previousSummary,
				requestMessages,
				clientId,
			),
			signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new AppError({
			code: 'SUMMARY_NETWORK_ERROR',
			message: '无法连接摘要服务，请检查网络后重试',
			retryable: true,
			cause,
		});
	}

	if (!response.ok) throw await appErrorFromResponse(response);

	const body = await readResponseBody(response);
	if (!isRecord(body) || !('data' in body)) {
		throw invalidResponse('摘要服务返回了无效响应');
	}

	return validateConversationSummary(body.data, expectedCoveredUntilMessageId);
};
