import { AppError } from '../services/errors/AppError';
import type { ParsedDocument } from '../types/attachment';

export const FILE_PARSE_ENDPOINT = '/api/files/parse';
export const MAX_ATTACHMENT_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_PARSED_DOCUMENT_TEXT_LENGTH = 40_000;

export type FileFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface ParseDocumentFileOptions {
	signal?: AbortSignal;
	fetchImpl?: FileFetch;
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

const getRequestId = (response: Response): string | undefined =>
	response.headers.get('x-request-id') ??
	response.headers.get('x-debugdiva-request-id') ??
	undefined;

const fallbackCodeForStatus = (status: number): string => {
	if (status === 413) return 'FILE_TOO_LARGE';
	if (status === 415) return 'UNSUPPORTED_FILE_TYPE';
	if (status === 408 || status === 504) return 'REQUEST_TIMEOUT';
	if (status === 429) return 'RATE_LIMITED';
	if (status >= 500) return 'FILE_SERVICE_UNAVAILABLE';
	return 'PARSE_FAILED';
};

const fallbackMessageForStatus = (status: number): string => {
	if (status === 413) return '文件不能超过 10MB';
	if (status === 415) return '暂不支持该文件类型';
	if (status === 408 || status === 504) return '文件解析超时，请重试';
	if (status === 429) return '文件解析请求过于频繁，请稍后重试';
	if (status >= 500) return '文件解析服务暂时不可用';
	return '文件解析失败';
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
		code: 'INVALID_FILE_RESPONSE',
		message,
		retryable: true,
	});

export const validateParsedDocument = (value: unknown): ParsedDocument => {
	if (!isRecord(value)) {
		throw invalidResponse('文件解析服务返回了无效数据');
	}

	const name = readString(value.name);
	const mimeType = readString(value.mimeType);
	const size = value.size;
	const text = value.text;
	const truncated = value.truncated;
	const warnings = value.warnings;
	const pageCount = value.pageCount;

	if (
		!name ||
		!mimeType ||
		typeof size !== 'number' ||
		!Number.isFinite(size) ||
		size < 0 ||
		typeof text !== 'string' ||
		typeof truncated !== 'boolean' ||
		!Array.isArray(warnings) ||
		!warnings.every(item => typeof item === 'string') ||
		(pageCount !== undefined &&
			(typeof pageCount !== 'number' ||
				!Number.isInteger(pageCount) ||
				pageCount < 1))
	) {
		throw invalidResponse('文件解析结果字段不完整');
	}

	if (Array.from(text).length > MAX_PARSED_DOCUMENT_TEXT_LENGTH) {
		throw new AppError({
			code: 'TEXT_LIMIT_EXCEEDED',
			message: '文件提取文本不能超过 40,000 字符',
			retryable: false,
		});
	}

	return {
		name,
		mimeType,
		size,
		text,
		pageCount: pageCount as number | undefined,
		truncated,
		warnings: [...warnings],
	};
};

/** Parse one document through the same-origin file API. */
export const parseDocumentFile = async (
	file: File,
	options: ParseDocumentFileOptions = {},
): Promise<ParsedDocument> => {
	if (file.size === 0) {
		throw new AppError({
			code: 'EMPTY_FILE',
			message: '不能解析空文件',
			retryable: false,
		});
	}
	if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
		throw new AppError({
			code: 'FILE_TOO_LARGE',
			message: '文件不能超过 10MB',
			retryable: false,
		});
	}

	const formData = new FormData();
	formData.append('file', file);
	const fetchImpl = options.fetchImpl ?? fetch;
	let response: Response;

	try {
		response = await fetchImpl(FILE_PARSE_ENDPOINT, {
			method: 'POST',
			body: formData,
			signal: options.signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new AppError({
			code: 'NETWORK_ERROR',
			message: '无法连接文件解析服务，请检查网络后重试',
			retryable: true,
			cause,
		});
	}

	if (!response.ok) throw await appErrorFromResponse(response);

	const body = await readResponseBody(response);
	if (!isRecord(body) || !('data' in body)) {
		throw invalidResponse('文件解析服务返回了无效响应');
	}

	return validateParsedDocument(body.data);
};

export const parseFile = parseDocumentFile;
