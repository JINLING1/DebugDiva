import { describe, expect, it } from 'vitest';
import { buildEmbedText, chunkDocument, type DocumentChunk } from './chunker';
import {
	composeBlocks,
	segmentMarkdown,
	wholeTextSegment,
} from './documentSegments';

const expectSliceInvariant = (text: string, chunks: DocumentChunk[]) => {
	for (const chunk of chunks) {
		expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd));
		expect(chunk.text).toBe(chunk.text.trim());
	}
	expect(chunks.map(chunk => chunk.ordinal)).toEqual(chunks.map((_, i) => i));
};

const sentence = (index: number) => `这是第${index}句话，用于测试切块逻辑是否稳定。`;
const paragraph = (from: number, count: number) =>
	Array.from({ length: count }, (_, i) => sentence(from + i)).join('');

describe('chunkDocument', () => {
	it('keeps a short segment as one chunk', () => {
		const text = '短文本';
		const chunks = chunkDocument(text, wholeTextSegment(text, 'prose'));
		expect(chunks).toEqual([
			{ ordinal: 0, text: '短文本', charStart: 0, charEnd: 3, kind: 'prose' },
		]);
	});

	it('splits long prose at sentence boundaries within the size limit', () => {
		const text = paragraph(1, 60);
		const chunks = chunkDocument(text, wholeTextSegment(text, 'prose'), {
			targetSize: 200,
			overlap: 40,
		});

		expect(chunks.length).toBeGreaterThan(5);
		expectSliceInvariant(text, chunks);
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeLessThanOrEqual(200);
		}
		for (const chunk of chunks.slice(0, -1)) {
			expect(chunk.text.endsWith('。')).toBe(true);
		}
	});

	it('overlaps neighbouring chunks and starts them at a sentence boundary', () => {
		const text = paragraph(1, 40);
		const chunks = chunkDocument(text, wholeTextSegment(text, 'prose'), {
			targetSize: 200,
			overlap: 60,
		});

		for (let i = 1; i < chunks.length; i += 1) {
			expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
			expect(chunks[i].text.startsWith('这是第')).toBe(true);
		}
	});

	it('covers the whole segment without gaps', () => {
		const text = paragraph(1, 50);
		const chunks = chunkDocument(text, wholeTextSegment(text, 'prose'), {
			targetSize: 150,
			overlap: 30,
		});

		expect(chunks[0].charStart).toBe(0);
		expect(chunks.at(-1)?.charEnd).toBe(text.length);
		for (let i = 1; i < chunks.length; i += 1) {
			expect(chunks[i].charStart).toBeLessThanOrEqual(chunks[i - 1].charEnd);
		}
	});

	it('hard-cuts text without separators and never splits surrogate pairs', () => {
		const text = '😀'.repeat(300);
		const chunks = chunkDocument(text, wholeTextSegment(text, 'prose'), {
			targetSize: 101,
			overlap: 0,
		});

		expectSliceInvariant(text, chunks);
		for (const chunk of chunks) {
			expect(chunk.text.length % 2).toBe(0);
		}
		expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
	});

	it('does not cross page boundaries and records the page', () => {
		const composed = composeBlocks(
			[
				{ text: paragraph(1, 8), page: 1, kind: 'prose' },
				{ text: paragraph(100, 8), page: 2, kind: 'prose' },
			],
			'\n\n',
		);
		const chunks = chunkDocument(composed.text, composed.segments, {
			targetSize: 1000,
			overlap: 100,
		});

		expect(chunks).toHaveLength(2);
		expect(chunks.map(chunk => chunk.page)).toEqual([1, 2]);
		expect(chunks[1].text.startsWith('这是第100句')).toBe(true);
	});

	it('merges a heading-only section into the following section', () => {
		const text = ['# 指南', '## 安装', paragraph(1, 3)].join('\n');
		const chunks = chunkDocument(text, segmentMarkdown(text));

		expect(chunks).toHaveLength(1);
		expect(chunks[0].text.startsWith('# 指南')).toBe(true);
		// 父标题与子小节打包后取公共前缀；子标题“## 安装”仍保留在正文里。
		expect(chunks[0].headingPath).toEqual(['指南']);
	});

	it('records pageEnd when a merged short segment spans pages', () => {
		const composed = composeBlocks(
			[
				{ text: '第一页页脚', page: 1, kind: 'prose' },
				{ text: paragraph(1, 3), page: 2, kind: 'prose' },
			],
			'\n\n',
		);
		const [chunk] = chunkDocument(composed.text, composed.segments);
		expect(chunk.page).toBe(1);
		expect(chunk.pageEnd).toBe(2);
	});

	it('keeps code blocks whole up to maxCodeSize and splits them on lines', () => {
		const lines = Array.from({ length: 80 }, (_, i) => `const value${i} = ${i};`);
		const text = lines.join('\n');
		const whole = chunkDocument(text, wholeTextSegment(text, 'code'), {
			maxCodeSize: 5000,
		});
		expect(whole).toHaveLength(1);
		expect(whole[0].kind).toBe('code');

		const split = chunkDocument(text, wholeTextSegment(text, 'code'), {
			maxCodeSize: 400,
		});
		expect(split.length).toBeGreaterThan(1);
		expectSliceInvariant(text, split);
		for (const chunk of split) {
			expect(chunk.text.startsWith('const value')).toBe(true);
			expect(chunk.text.endsWith(';')).toBe(true);
		}
	});

	it('packs short sibling sections and their code examples up to the target size', () => {
		const text = [
			'# 指南',
			'## TypeError',
			'### 信息',
			'TypeError: x is not a function',
			'### 原因',
			'调用了不是函数的值。',
			'### 示例',
			'```js',
			'obj.map(x => x);',
			'```',
		].join('\n');

		const chunks = chunkDocument(text, segmentMarkdown(text), { targetSize: 600, overlap: 100 });

		expect(chunks).toHaveLength(1);
		expect(chunks[0].kind).toBe('prose');
		expect(chunks[0].text).toContain('obj.map');
		expect(chunks[0].headingPath).toEqual(['指南']);
	});

	it('stops packing at the target size', () => {
		const sections = Array.from(
			{ length: 6 },
			(_, i) => `### 错误码 E${i}\n${paragraph(i * 10, 4)}`,
		);
		const text = ['## 错误码列表', ...sections].join('\n');
		const chunks = chunkDocument(text, segmentMarkdown(text), {
			targetSize: 300,
			overlap: 50,
		});

		expect(chunks.length).toBeGreaterThan(1);
		expectSliceInvariant(text, chunks);
		for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(300);
	});

	it('does not pack sections from different pages', () => {
		const composed = composeBlocks(
			[
				{ text: paragraph(1, 5), page: 1, kind: 'prose' },
				{ text: paragraph(10, 5), page: 2, kind: 'prose' },
			],
			'\n\n',
		);
		const chunks = chunkDocument(composed.text, composed.segments, {
			targetSize: 2000,
			overlap: 100,
		});
		expect(chunks.map(chunk => chunk.page)).toEqual([1, 2]);
	});

	it('does not pack a section into an unrelated deeper branch', () => {
		const text = [
			'# A',
			'## A1',
			'### A1a',
			'正文一',
			'# B',
			'## B1',
			'### B1a',
			'正文二',
		].join('\n');
		const chunks = chunkDocument(text, segmentMarkdown(text), {
			targetSize: 600,
			overlap: 100,
			minSegmentSize: 1,
		});
		expect(chunks.map(chunk => chunk.headingPath?.[0])).toEqual(['A', 'B']);
	});

	it('rejects an overlap that would prevent progress', () => {
		expect(() =>
			chunkDocument('abc', wholeTextSegment('abc', 'prose'), {
				targetSize: 100,
				overlap: 50,
			}),
		).toThrow(RangeError);
	});
});

describe('buildEmbedText', () => {
	it('prefixes the document name and heading path', () => {
		expect(
			buildEmbedText('Vue\n指南.pdf', {
				text: '正文',
				headingPath: ['响应式', '常见陷阱'],
			}),
		).toBe('《Vue 指南.pdf》 > 响应式 > 常见陷阱\n正文');
		expect(buildEmbedText('a.txt', { text: '正文' })).toBe('《a.txt》\n正文');
	});
});
