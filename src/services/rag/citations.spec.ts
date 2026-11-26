import { describe, expect, it } from 'vitest';
import { collectCitations, MAX_CITATION_EXCERPT_CHARACTERS } from './citations';
import type { RetrievedPassage } from './documentIndex';

const passage = (n: number, extra: Partial<RetrievedPassage> = {}): RetrievedPassage => ({
	chunkId: `doc:${n}`,
	attachmentId: `doc-${n}`,
	name: `文档${n}.md`,
	text: `第 ${n} 段正文`,
	score: 0.9,
	...extra,
});

const passages = [
	passage(1, { page: 3, pageEnd: 4, headingPath: ['错误', 'EADDRINUSE'] }),
	passage(2),
	passage(3),
];

describe('collectCitations', () => {
	it('turns valid markers into citations ordered by number', () => {
		const result = collectCitations('端口被占用 [3]。可以换端口 [1]，或停止进程 [1]。', passages);
		expect(result.cited).toEqual([3, 1]);
		expect(result.invalid).toEqual([]);
		expect(result.text).toBe('端口被占用 [3]。可以换端口 [1]，或停止进程 [1]。');
		expect(result.citations.map(citation => citation.index)).toEqual([1, 3]);
		expect(result.citations[0]).toEqual({
			type: 'citation',
			attachmentId: 'doc-1',
			name: '文档1.md',
			index: 1,
			excerpt: '第 1 段正文',
			page: 3,
			pageEnd: 4,
			headingPath: ['错误', 'EADDRINUSE'],
		});
	});

	it('handles grouped and chained markers, including after ASCII words', () => {
		const result = collectCitations('见 EADDRINUSE[1]，以及 [2, 3] 和 [1][2]。', passages);
		expect(result.cited).toEqual([1, 2, 3]);
		expect(result.text).toBe('见 EADDRINUSE[1]，以及 [2][3] 和 [1][2]。');
	});

	it('removes hallucinated numbers and reports them', () => {
		const result = collectCitations('结论 [9]。另见 [2, 7]。', passages);
		expect(result.invalid).toEqual([9, 7]);
		expect(result.cited).toEqual([2]);
		expect(result.text).toBe('结论。另见 [2]。');
	});

	it('ignores code, array indexes and markdown links', () => {
		const text = [
			'用 `arr[1]` 访问，或者 list[10] 和 [1](https://example.com)。',
			'```js',
			'const x = data[2];',
			'```',
		].join('\n');
		const result = collectCitations(text, passages);
		expect(result.cited).toEqual([]);
		expect(result.invalid).toEqual([]);
		expect(result.text).toBe(text);
	});

	it('truncates long excerpts', () => {
		const long = passage(1, { text: '字'.repeat(MAX_CITATION_EXCERPT_CHARACTERS + 50) });
		const [citation] = collectCitations('见 [1]', [long]).citations;
		expect(Array.from(citation.excerpt)).toHaveLength(MAX_CITATION_EXCERPT_CHARACTERS + 1);
		expect(citation.excerpt.endsWith('…')).toBe(true);
	});
});

describe('citation excerpts', () => {
	it('starts the excerpt at the heading of the query term inside a long merged passage', () => {
		const text = [
			'### `ERR_HTTP2_TOO_MANY_ORIGINS`',
			'无关内容。'.repeat(150),
			'',
			'### `ERR_HTTP_HEADERS_SENT`',
			'',
			'An attempt was made to add more headers after the headers had already been sent.',
		].join('\n');
		const [citation] = collectCitations('见 [1]', [passage(1, { text })], 'ERR_HTTP_HEADERS_SENT 是什么').citations;
		expect(citation.excerpt.startsWith('…### `ERR_HTTP_HEADERS_SENT`')).toBe(true);
		expect(citation.excerpt).toContain('already been sent');
	});

	it('falls back to the beginning when no query term occurs in the passage', () => {
		const [citation] = collectCitations('见 [1]', [passage(1)], '完全无关的问题').citations;
		expect(citation.excerpt).toBe('第 1 段正文');
	});
});
