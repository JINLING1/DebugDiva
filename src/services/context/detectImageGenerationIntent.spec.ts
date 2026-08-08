import { describe, expect, it } from 'vitest';
import { detectImageGenerationIntent } from './detectImageGenerationIntent';

describe('detectImageGenerationIntent', () => {
	it.each([
		'帮我生成一张图片',
		'请画一幅猫咪插画',
		'为活动绘制一张海报',
		'设计一个极简头像',
		'把这张照片修改成复古风格',
		'Please generate an image of a moon base.',
		'Create a poster for our launch event.',
		'Edit this photo and make the sky brighter.',
	])('blocks an explicit image creation request: %s', input => {
		expect(detectImageGenerationIntent(input)).toBe(true);
	});

	it.each([
		'图片生成的原理是什么？',
		'怎么写文生图提示词？',
		'你为什么不能生成图片？',
		'用 Vue 做图片生成页面需要什么？',
		'帮我分析这张报错截图',
		'解释一下 Canvas 绘图 API',
		'How does image generation work?',
		'Why can’t you generate images?',
		'Build a Vue image generator component architecture.',
		'介绍这张照片的构图特点',
		'',
	])('keeps knowledge and image-understanding questions: %s', input => {
		expect(detectImageGenerationIntent(input)).toBe(false);
	});
});
