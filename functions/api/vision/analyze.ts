import {
	analyzeImageFile,
	MAX_IMAGE_FILE_SIZE,
	type VisionTask,
	type WorkersAIBinding,
	VisionAnalysisError,
} from '../../_shared/visionAnalysis';

interface Env {
	AI?: WorkersAIBinding;
	VISION_MODEL?: string;
}

const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;
const RESPONSE_HEADERS = {
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
};

const jsonError = (code: string, message: string, status: number) =>
	Response.json(
		{ error: { code, message } },
		{ status, headers: RESPONSE_HEADERS },
	);

const isVisionTask = (value: string): value is VisionTask =>
	value === 'describe' || value === 'ocr' || value === 'auto';

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
		return jsonError(
			'INVALID_REQUEST',
			'Content-Type 必须是 multipart/form-data',
			415,
		);
	}

	const contentLength = Number(request.headers.get('content-length'));
	if (
		Number.isFinite(contentLength) &&
		contentLength > MAX_IMAGE_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE
	) {
		return jsonError('FILE_TOO_LARGE', '单张图片不能超过 10MB', 413);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return jsonError('INVALID_REQUEST', 'multipart 请求体格式无效', 400);
	}

	const files = formData.getAll('file');
	if (files.length !== 1 || !(files[0] instanceof File)) {
		return jsonError('INVALID_REQUEST', '必须且只能上传一个 file 字段', 400);
	}
	if (!files[0].name || files[0].name.length > 255) {
		return jsonError('INVALID_REQUEST', '文件名长度必须在 1 到 255 个字符之间', 400);
	}

	const taskFields = formData.getAll('task');
	if (taskFields.length > 1 || taskFields.some(value => typeof value !== 'string')) {
		return jsonError('INVALID_TASK', 'task 必须是 describe、ocr 或 auto', 400);
	}
	const taskValue = taskFields.length === 0 ? 'auto' : taskFields[0];
	if (typeof taskValue !== 'string' || !isVisionTask(taskValue)) {
		return jsonError('INVALID_TASK', 'task 必须是 describe、ocr 或 auto', 400);
	}

	try {
		const result = await analyzeImageFile(
			files[0],
			taskValue,
			env.AI,
			env.VISION_MODEL,
		);
		return Response.json({ data: result }, { headers: RESPONSE_HEADERS });
	} catch (error) {
		if (error instanceof VisionAnalysisError) {
			return jsonError(error.code, error.message, error.status);
		}
		return jsonError(
			'VISION_ANALYSIS_FAILED',
			'图片分析服务暂时不可用，请稍后重试',
			502,
		);
	}
};
