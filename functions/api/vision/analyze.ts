import {
	createAbortScope,
	createApiLifecycle,
	isMultipartContentType,
} from '../../_shared/apiLifecycle';
import {
	analyzeImageFile,
	MAX_IMAGE_FILE_SIZE,
	VISION_TIMEOUT_MS,
	type VisionTask,
	VisionAnalysisError,
} from '../../_shared/visionAnalysis';

interface Env {
	DASHSCOPE_API_KEY?: string;
	DASHSCOPE_BASE_URL?: string;
}

const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;

const isVisionTask = (value: string): value is VisionTask =>
	value === 'describe' || value === 'ocr' || value === 'auto';

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	const lifecycle = createApiLifecycle();
	if (!isMultipartContentType(request.headers.get('content-type'))) {
		return lifecycle.error(
			'INVALID_REQUEST',
			'Content-Type 必须是 multipart/form-data',
			415,
			false,
		);
	}
	if (request.signal.aborted) {
		return lifecycle.error('REQUEST_ABORTED', '图片分析请求已取消', 499, false);
	}

	const contentLength = Number(request.headers.get('content-length'));
	if (
		Number.isFinite(contentLength) &&
		contentLength > MAX_IMAGE_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE
	) {
		return lifecycle.error(
			'FILE_TOO_LARGE',
			'单张图片不能超过 10MB',
			413,
			false,
		);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '图片分析请求已取消', 499, false);
		}
		return lifecycle.error(
			'INVALID_REQUEST',
			'multipart 请求体格式无效',
			400,
			false,
		);
	}

	const files = formData.getAll('file');
	if (files.length !== 1 || !(files[0] instanceof File)) {
		return lifecycle.error(
			'INVALID_REQUEST',
			'必须且只能上传一个 file 字段',
			400,
			false,
		);
	}
	if (!files[0].name || files[0].name.length > 255) {
		return lifecycle.error(
			'INVALID_REQUEST',
			'文件名长度必须在 1 到 255 个字符之间',
			400,
			false,
		);
	}

	const taskFields = formData.getAll('task');
	if (taskFields.length > 1 || taskFields.some(value => typeof value !== 'string')) {
		return lifecycle.error(
			'INVALID_TASK',
			'task 必须是 describe、ocr 或 auto',
			400,
			false,
		);
	}
	const taskValue = taskFields.length === 0 ? 'auto' : taskFields[0];
	if (typeof taskValue !== 'string' || !isVisionTask(taskValue)) {
		return lifecycle.error(
			'INVALID_TASK',
			'task 必须是 describe、ocr 或 auto',
			400,
			false,
		);
	}
	lifecycle.setMode(`vision-${taskValue}`);

	const scope = createAbortScope(request.signal, VISION_TIMEOUT_MS);
	try {
		const result = await analyzeImageFile(
			files[0],
			taskValue,
			{
				apiKey: env.DASHSCOPE_API_KEY,
				baseUrl: env.DASHSCOPE_BASE_URL,
			},
			scope.signal,
		);
		return lifecycle.json({ data: result });
	} catch (error) {
		if (scope.reason === 'timeout') {
			return lifecycle.error(
				'REQUEST_TIMEOUT',
				'图片分析请求超时，请稍后重试',
				504,
				true,
			);
		}
		if (scope.reason === 'client' || request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '图片分析请求已取消', 499, false);
		}
		if (error instanceof VisionAnalysisError) {
			return lifecycle.error(
				error.code,
				error.message,
				error.status,
				error.retryable,
			);
		}
		return lifecycle.error(
			'VISION_SERVICE_UNAVAILABLE',
			'图片分析服务暂时不可用，请稍后重试',
			503,
			true,
		);
	} finally {
		scope.dispose();
	}
};
