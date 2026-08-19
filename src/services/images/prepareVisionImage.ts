import type { VisionTask } from '../../providers/vision/VisionProvider';

export const MAX_ANALYSIS_IMAGE_EDGE = 2048;
export const ANALYSIS_IMAGE_QUALITY = 0.88;

const DETAIL_SENSITIVE_PROMPT =
	/(?:ocr|文字|文本|小字|字体|代码|报错|错误|日志|终端|界面|页面|网页|表格|图表|按钮|菜单|控件|识别|读取|提取)/i;

export interface VisionImagePreparationOptions {
	prompt: string;
	task: VisionTask;
	signal: AbortSignal;
}

export const shouldPreserveVisionImage = (
	prompt: string,
	task: VisionTask,
): boolean => task === 'ocr' || DETAIL_SENSITIVE_PROMPT.test(prompt);

export const calculateAnalysisImageSize = (
	width: number,
	height: number,
	maxEdge = MAX_ANALYSIS_IMAGE_EDGE,
): { width: number; height: number } => {
	const longestEdge = Math.max(width, height);
	if (longestEdge <= maxEdge) return { width, height };
	const scale = maxEdge / longestEdge;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
};

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const canvasToBlob = (
	canvas: HTMLCanvasElement,
	mimeType: string,
	signal: AbortSignal,
): Promise<Blob> =>
	new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(abortError());
			return;
		}
		canvas.toBlob(
			blob => {
				if (signal.aborted) reject(abortError());
				else if (blob) resolve(blob);
				else reject(new Error('无法生成图片分析副本'));
			},
			mimeType,
			mimeType === 'image/png' ? undefined : ANALYSIS_IMAGE_QUALITY,
		);
	});

export const prepareVisionImageForAnalysis = async (
	file: File,
	options: VisionImagePreparationOptions,
): Promise<File> => {
	if (
		shouldPreserveVisionImage(options.prompt, options.task) ||
		typeof createImageBitmap !== 'function' ||
		typeof document === 'undefined'
	) {
		return file;
	}
	if (options.signal.aborted) throw abortError();

	let bitmap: ImageBitmap | undefined;
	try {
		bitmap = await createImageBitmap(file);
		if (options.signal.aborted) throw abortError();
		const target = calculateAnalysisImageSize(bitmap.width, bitmap.height);
		if (target.width === bitmap.width && target.height === bitmap.height) {
			return file;
		}

		const canvas = document.createElement('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const context = canvas.getContext('2d');
		if (!context) return file;
		context.drawImage(bitmap, 0, 0, target.width, target.height);
		const blob = await canvasToBlob(canvas, file.type, options.signal);
		return new File([blob], file.name, {
			type: blob.type || file.type,
			lastModified: file.lastModified,
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') throw error;
		return file;
	} finally {
		bitmap?.close();
	}
};
