import {
	FileParseError,
	MAX_FILE_SIZE,
	parseDocumentFile,
} from '../../_shared/fileParsing';

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

export const onRequestPost = async ({ request }: { request: Request }) => {
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
		contentLength > MAX_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE
	) {
		return jsonError('FILE_TOO_LARGE', '单个文件不能超过 10MB', 413);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return jsonError('INVALID_REQUEST', 'multipart 请求体格式无效', 400);
	}

	try {
		const files = formData.getAll('file');
		if (files.length !== 1 || !(files[0] instanceof File)) {
			return jsonError('INVALID_REQUEST', '必须且只能上传一个 file 字段', 400);
		}
		if (!files[0].name || files[0].name.length > 255) {
			return jsonError('INVALID_REQUEST', '文件名长度必须在 1 到 255 个字符之间', 400);
		}

		const parsed = await parseDocumentFile(files[0]);
		return Response.json({ data: parsed }, { headers: RESPONSE_HEADERS });
	} catch (error) {
		if (error instanceof FileParseError) {
			return jsonError(error.code, error.message, error.status);
		}
		return jsonError('PARSE_FAILED', '文件解析失败', 422);
	}
};
