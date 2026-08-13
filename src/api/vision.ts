import { AppError } from '../services/errors/AppError';
import type { VisionResult } from '../types/attachment';
import type { VisionTask } from '../providers/vision/VisionProvider';

export const VISION_ANALYZE_ENDPOINT = '/api/vision/analyze';
export const MAX_VISION_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_VISION_SUMMARY_LENGTH = 4_000;
export const MAX_VISION_EXTRACTED_TEXT_LENGTH = 12_000;
export const MAX_VISION_OBJECTS = 50;
export const MAX_VISION_OBJECT_LENGTH = 100;
export const MAX_VISION_WARNINGS = 20;
export const MAX_VISION_WARNING_LENGTH = 500;

export const SUPPORTED_VISION_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const;

export type VisionFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface AnalyzeVisionImageOptions {
	signal?: AbortSignal;
	task?: VisionTask;
	fetchImpl?: VisionFetch;
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
	if (status === 413) return 'FILE_TOO_LARGE';
	if (status === 415) return 'UNSUPPORTED_IMAGE_TYPE';
	if (status === 422) return 'INVALID_IMAGE';
	if (status === 408 || status === 504) return 'REQUEST_TIMEOUT';
	if (status === 429) return 'RATE_LIMITED';
	if (status >= 500) return 'VISION_SERVICE_UNAVAILABLE';
	return 'VISION_ANALYSIS_FAILED';
};

const fallbackMessageForStatus = (status: number): string => {
	if (status === 413) return '图片不能超过 10MB';
	if (status === 415) return '仅支持 JPEG、PNG 和 WebP 图片';
	if (status === 408 || status === 504) return '图片分析超时，请重试';
	if (status === 429) return '图片分析请求过于频繁，请稍后重试';
	if (status >= 500) return '图片分析服务暂时不可用';
	return '图片分析请求失败';
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
		code: 'INVALID_VISION_RESPONSE',
		message,
		retryable: true,
	});

const validateStringList = (
	value: unknown,
	label: string,
	maxItems: number,
	maxItemLength: number,
): string[] => {
	if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
		throw invalidResponse(`图片分析结果中的${label}格式无效`);
	}
	if (value.length > maxItems) {
		throw invalidResponse(`图片分析结果中的${label}数量超出限制`);
	}
	if (value.some(item => unicodeLength(item) > maxItemLength)) {
		throw invalidResponse(`图片分析结果中的${label}内容过长`);
	}

	return [...value];
};

export const validateVisionResult = (value: unknown): VisionResult => {
	if (!isRecord(value)) {
		throw invalidResponse('图片分析服务返回了无效数据');
	}

	const summary = readString(value.summary);
	const extractedText = value.extractedText ?? '';
	if (!summary || typeof extractedText !== 'string') {
		throw invalidResponse('图片分析结果字段不完整');
	}
	if (unicodeLength(summary) > MAX_VISION_SUMMARY_LENGTH) {
		throw invalidResponse('图片描述内容超出长度限制');
	}
	if (unicodeLength(extractedText) > MAX_VISION_EXTRACTED_TEXT_LENGTH) {
		throw invalidResponse('图片 OCR 文本超出长度限制');
	}

	return {
		summary,
		extractedText,
		objects: validateStringList(
			value.objects ?? [],
			'可见对象',
			MAX_VISION_OBJECTS,
			MAX_VISION_OBJECT_LENGTH,
		),
		warnings: validateStringList(
			value.warnings ?? [],
			'警告',
			MAX_VISION_WARNINGS,
			MAX_VISION_WARNING_LENGTH,
		),
	};
};

export const analyzeVisionImage = async (
	file: File,
	options: AnalyzeVisionImageOptions = {},
): Promise<VisionResult> => {
	if (file.size === 0) {
		throw new AppError({
			code: 'EMPTY_FILE',
			message: '不能分析空图片',
			retryable: false,
		});
	}
	if (file.size > MAX_VISION_FILE_SIZE) {
		throw new AppError({
			code: 'FILE_TOO_LARGE',
			message: '图片不能超过 10MB',
			retryable: false,
		});
	}
	if (!(SUPPORTED_VISION_MIME_TYPES as readonly string[]).includes(file.type)) {
		throw new AppError({
			code: 'UNSUPPORTED_IMAGE_TYPE',
			message: '仅支持 JPEG、PNG 和 WebP 图片',
			retryable: false,
		});
	}

	const task = options.task ?? 'auto';
	if (task !== 'auto' && task !== 'describe' && task !== 'ocr') {
		throw new AppError({
			code: 'INVALID_TASK',
			message: '图片分析任务类型无效',
			retryable: false,
		});
	}

	const formData = new FormData();
	formData.append('file', file);
	formData.append('task', task);
	const fetchImpl = options.fetchImpl ?? fetch;
	let response: Response;

	try {
		response = await fetchImpl(VISION_ANALYZE_ENDPOINT, {
			method: 'POST',
			body: formData,
			signal: options.signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new AppError({
			code: 'VISION_NETWORK_ERROR',
			message: '无法连接图片分析服务，请检查网络后重试',
			retryable: true,
			cause,
		});
	}

	if (!response.ok) throw await appErrorFromResponse(response);

	const body = await readResponseBody(response);
	if (!isRecord(body) || !('data' in body)) {
		throw invalidResponse('图片分析服务返回了无效响应');
	}

	return validateVisionResult(body.data);
};
