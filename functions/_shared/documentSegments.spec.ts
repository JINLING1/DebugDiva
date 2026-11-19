import { describe, expect, it } from 'vitest';
import {
	composeBlocks,
	segmentMarkdown,
	trimRange,
	truncateComposed,
	wholeTextSegment,
} from './documentSegments';

const slices = (text: string, segments: { start: number; end: number }[]) =>
	segments.map(segment => text.slice(segment.start, segment.end));

describe('trimRange', () => {
	it('shrinks to non-whitespace and returns null for blank ranges', () => {
		expect(trimRange('  ab \n', 0, 6)).toEqual({ start: 2, end: 4 });
		expect(trimRange(' \n\t ', 0, 4)).toBeNull();
	});
});

describe('composeBlocks', () => {
	it('joins blocks, skips empty ones and records offsets with metadata', () => {
		const composed = composeBlocks(
			[
				{ text: '第一页', page: 1, kind: 'prose' },
				{ text: '   ', page: 2, kind: 'prose' },
				{ text: '第三页', page: 3, kind: 'prose' },
			],
			'\n\n',
		);

		expect(composed.text).toBe('第一页\n\n第三页');
		expect(composed.segments).toEqual([
			{ start: 0, end: 3, page: 1, kind: 'prose' },
			{ start: 5, end: 8, page: 3, kind: 'prose' },
		]);
	});

	it('merges adjacent blocks with identical metadata', () => {
		const composed = composeBlocks(
			[
				{ text: '安装', headingPath: ['安装'], kind: 'prose' },
				{ text: '运行 pnpm install', headingPath: ['安装'], kind: 'prose' },
				{ text: '配置', headingPath: ['配置'], kind: 'prose' },
			],
			'\n',
		);

		expect(slices(composed.text, composed.segments)).toEqual([
			'安装\n运行 pnpm install',
			'配置',
		]);
		expect(composed.segments[0].headingPath).toEqual(['安装']);
	});
});

describe('segmentMarkdown', () => {
	it('splits by ATX headings and tracks the heading path', () => {
		const text = [
			'前言内容',
			'# 指南',
			'总览',
			'## 安装',
			'安装步骤',
			'### 常见错误',
			'错误说明',
			'## 配置',
			'配置说明',
		].join('\n');

		const segments = segmentMarkdown(text);

		expect(slices(text, segments)).toEqual([
			'前言内容',
			'# 指南\n总览',
			'## 安装\n安装步骤',
			'### 常见错误\n错误说明',
			'## 配置\n配置说明',
		]);
		expect(segments.map(segment => segment.headingPath)).toEqual([
			undefined,
			['指南'],
			['指南', '安装'],
			['指南', '安装', '常见错误'],
			['指南', '配置'],
		]);
	});

	it('keeps fenced code as its own segment and ignores # inside fences', () => {
		const text = [
			'## 示例',
			'说明文字',
			'```bash',
			'# 这是注释，不是标题',
			'pnpm dev',
			'```',
			'后续说明',
		].join('\n');

		const segments = segmentMarkdown(text);

		expect(segments.map(segment => segment.kind)).toEqual([
			'prose',
			'code',
			'prose',
		]);
		expect(slices(text, segments)[1]).toBe(
			'```bash\n# 这是注释，不是标题\npnpm dev\n```',
		);
		expect(segments.every(segment => segment.headingPath?.[0] === '示例')).toBe(
			true,
		);
	});

	it('treats an unterminated fence as code until the end', () => {
		const text = '说明\n~~~\ncode line';
		expect(segmentMarkdown(text).map(segment => segment.kind)).toEqual([
			'prose',
			'code',
		]);
	});

	it('skips heading levels without leaving empty path entries', () => {
		const text = '# A\n### C\n正文';
		expect(segmentMarkdown(text).at(-1)?.headingPath).toEqual(['A', 'C']);
	});
});

describe('wholeTextSegment', () => {
	it('creates one trimmed segment or none for blank text', () => {
		expect(wholeTextSegment('\n code \n', 'code')).toEqual([
			{ start: 2, end: 6, kind: 'code' },
		]);
		expect(wholeTextSegment('   ', 'prose')).toEqual([]);
	});
});

describe('truncateComposed', () => {
	it('cuts by code points and clips segments past the limit', () => {
		const composed = composeBlocks(
			[
				{ text: 'abc', page: 1, kind: 'prose' },
				{ text: 'def', page: 2, kind: 'prose' },
				{ text: 'ghi', page: 3, kind: 'prose' },
			],
			'\n',
		);

		const result = truncateComposed(composed, 6);

		expect(result.truncated).toBe(true);
		expect(result.text).toBe('abc\nde');
		expect(result.segments).toEqual([
			{ start: 0, end: 3, page: 1, kind: 'prose' },
			{ start: 4, end: 6, page: 2, kind: 'prose' },
		]);
	});

	it('never splits a surrogate pair', () => {
		const result = truncateComposed(
			{ text: '😀😀😀', segments: wholeTextSegment('😀😀😀', 'prose') },
			2,
		);
		expect(result.text).toBe('😀😀');
		expect(result.segments[0].end).toBe(4);
	});

	it('returns the document unchanged when under the limit', () => {
		const composed = { text: 'short', segments: wholeTextSegment('short', 'prose') };
		expect(truncateComposed(composed, 10)).toEqual({ ...composed, truncated: false });
	});
});
