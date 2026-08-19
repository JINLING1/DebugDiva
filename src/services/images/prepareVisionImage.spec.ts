// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
	calculateAnalysisImageSize,
	prepareVisionImageForAnalysis,
	shouldPreserveVisionImage,
} from './prepareVisionImage';

describe('prepareVisionImage', () => {
	it('preserves OCR, code and interface images', () => {
		expect(shouldPreserveVisionImage('读取截图中的小字号报错', 'auto')).toBe(
			true,
		);
		expect(shouldPreserveVisionImage('描述网页按钮状态', 'describe')).toBe(true);
		expect(shouldPreserveVisionImage('describe this image', 'ocr')).toBe(true);
		expect(shouldPreserveVisionImage('描述一下这张风景照片', 'auto')).toBe(
			false,
		);
	});

	it('scales only images whose longest edge exceeds 2048 pixels', () => {
		expect(calculateAnalysisImageSize(1920, 1080)).toEqual({
			width: 1920,
			height: 1080,
		});
		expect(calculateAnalysisImageSize(3840, 2160)).toEqual({
			width: 2048,
			height: 1152,
		});
		expect(calculateAnalysisImageSize(2160, 3840)).toEqual({
			width: 1152,
			height: 2048,
		});
	});

	it('creates a temporary resized file for a large ordinary image', async () => {
		const close = vi.fn();
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn().mockResolvedValue({ width: 3840, height: 2160, close }),
		);
		const drawImage = vi.fn();
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage,
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
			callback => callback(new Blob(['resized'], { type: 'image/jpeg' })),
		);
		const original = new File(['original'], 'scene.jpg', {
			type: 'image/jpeg',
			lastModified: 7,
		});

		const prepared = await prepareVisionImageForAnalysis(original, {
			prompt: '描述一下这张照片',
			task: 'auto',
			signal: new AbortController().signal,
		});

		expect(prepared).not.toBe(original);
		expect(prepared.name).toBe(original.name);
		expect(prepared.type).toBe('image/jpeg');
		expect(drawImage).toHaveBeenCalledWith(
			expect.anything(),
			0,
			0,
			2048,
			1152,
		);
		expect(close).toHaveBeenCalledOnce();
	});

	it('does not decode a detail-sensitive image', async () => {
		const decode = vi.fn();
		vi.stubGlobal('createImageBitmap', decode);
		const original = new File(['original'], 'screen.png', { type: 'image/png' });

		await expect(
			prepareVisionImageForAnalysis(original, {
				prompt: '识别截图中的代码和报错',
				task: 'auto',
				signal: new AbortController().signal,
			}),
		).resolves.toBe(original);
		expect(decode).not.toHaveBeenCalled();
	});
});
