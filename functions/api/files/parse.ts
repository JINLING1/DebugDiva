import {
	FileParseError,
	MAX_FILE_SIZE,
	parseDocumentFile,
} from '../../_shared/fileParsing';
import {
	createApiLifecycle,
	isMultipartContentType,
} from '../../_shared/apiLifecycle';

const MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024;

export const onRequestPost = async ({ request }: { request: Request }) => {
	const lifecycle = createApiLifecycle('file-parse');
	if (!isMultipartContentType(request.headers.get('content-type'))) {
		return lifecycle.error(
			'INVALID_REQUEST',
			'Content-Type 必须是 multipart/form-data',
			415,
			false,
		);
	}
	if (request.signal.aborted) {
		return lifecycle.error('REQUEST_ABORTED', '文件解析请求已取消', 499, false);
	}

	const contentLength = Number(request.headers.get('content-length'));
	if (
		Number.isFinite(contentLength) &&
		contentLength > MAX_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE
	) {
		return lifecycle.error(
			'FILE_TOO_LARGE',
			'单个文件不能超过 10MB',
			413,
			false,
		);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '文件解析请求已取消', 499, false);
		}
		return lifecycle.error(
			'INVALID_REQUEST',
			'multipart 请求体格式无效',
			400,
			false,
		);
	}

	try {
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

		const parsed = await parseDocumentFile(files[0]);
		if (request.signal.aborted) {
			return lifecycle.error('REQUEST_ABORTED', '文件解析请求已取消', 499, false);
		}
		return lifecycle.json({ data: parsed });
	} catch (error) {
		if (error instanceof FileParseError) {
			return lifecycle.error(
				error.code,
				error.message,
				error.status,
				false,
			);
		}
		return lifecycle.error('PARSE_FAILED', '文件解析失败', 422, false);
	}
};
