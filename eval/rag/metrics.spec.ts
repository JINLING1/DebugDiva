import { describe, expect, it } from 'vitest';
import {
	mean,
	ndcgAtK,
	parseDataset,
	percentile,
	recallAtK,
	reciprocalRank,
	resolveEvidence,
	spanHit,
	type Span,
} from './metrics';

const span = (charStart: number, charEnd: number, doc = 'a.md'): Span => ({
	doc,
	charStart,
	charEnd,
});

describe('parseDataset', () => {
	const valid = {
		id: 'q1',
		type: 'factual',
		question: '超时多少秒？',
		evidence: [{ doc: 'a.md', quote: '60 秒' }],
	};

	it('parses JSONL and skips blank and comment lines', () => {
		const items = parseDataset(
			['// 注释', '', JSON.stringify(valid), JSON.stringify({ ...valid, id: 'q2', type: 'no_answer', evidence: [] })].join('\n'),
		);
		expect(items.map(item => item.id)).toEqual(['q1', 'q2']);
	});

	it.each([
		[{ ...valid, id: '' }, 'id'],
		[{ ...valid, type: 'other' }, 'type'],
		[{ ...valid, evidence: [] }, 'evidence 不能为空'],
		[{ ...valid, type: 'no_answer' }, 'no_answer'],
		[{ ...valid, type: 'follow_up' }, 'history'],
		[{ ...valid, evidence: [{ doc: 'a.md', quote: 'x', occurrence: 0 }] }, 'occurrence'],
	])('rejects invalid item %#', (item, message) => {
		expect(() => parseDataset(JSON.stringify(item))).toThrow(message);
	});

	it('reports duplicate ids with the line number', () => {
		expect(() =>
			parseDataset([JSON.stringify(valid), JSON.stringify(valid)].join('\n')),
		).toThrow('第 2 行');
	});
});

describe('resolveEvidence', () => {
	const text = '第一段：超时时间为\n60 秒。\n\n第二段：超时时间为 60 秒。';

	it('matches quotes regardless of whitespace, including line breaks inside CJK text', () => {
		const result = resolveEvidence(
			{ doc: 'a.md', quote: '第一段：超时时间为 60 秒', occurrence: undefined },
			text,
		);
		expect(text.slice(result.charStart, result.charEnd)).toBe('第一段：超时时间为\n60 秒');
	});

	it('requires occurrence for ambiguous quotes and honours it', () => {
		expect(() => resolveEvidence({ doc: 'a.md', quote: '超时时间为 60 秒' }, text)).toThrow(
			'occurrence',
		);
		const second = resolveEvidence(
			{ doc: 'a.md', quote: '超时时间为 60 秒', occurrence: 2 },
			text,
		);
		expect(second.charStart).toBeGreaterThan(text.indexOf('第二段'));
	});

	it('throws when the quote is missing', () => {
		expect(() => resolveEvidence({ doc: 'a.md', quote: '不存在' }, text)).toThrow(
			'找不到',
		);
	});
});

describe('spanHit', () => {
	it('accepts a large chunk containing a small quote', () => {
		expect(spanHit(span(0, 600), span(100, 120))).toBe(true);
	});

	it('requires the overlap to cover at least half of the shorter span', () => {
		expect(spanHit(span(0, 300), span(100, 1000))).toBe(true);
		expect(spanHit(span(0, 300), span(260, 1000))).toBe(false);
	});

	it('never matches across documents', () => {
		expect(spanHit(span(0, 100, 'a.md'), span(0, 100, 'b.md'))).toBe(false);
	});
});

describe('ranking metrics', () => {
	const evidence = [span(100, 150), span(900, 950)];
	const ranked = [span(0, 50), span(80, 200), span(400, 500), span(880, 1000)];

	it('computes recall@k', () => {
		expect(recallAtK(ranked, evidence, 1)).toBe(0);
		expect(recallAtK(ranked, evidence, 2)).toBe(0.5);
		expect(recallAtK(ranked, evidence, 4)).toBe(1);
	});

	it('computes reciprocal rank', () => {
		expect(reciprocalRank(ranked, evidence)).toBe(0.5);
		expect(reciprocalRank([span(0, 10)], evidence)).toBe(0);
	});

	it('computes nDCG@k against an ideal ranking', () => {
		expect(ndcgAtK([span(80, 200), span(880, 1000)], evidence, 2)).toBeCloseTo(1);
		expect(ndcgAtK(ranked, evidence, 4)).toBeGreaterThan(0);
		expect(ndcgAtK(ranked, evidence, 4)).toBeLessThan(1);
	});

	it('returns undefined for questions without evidence', () => {
		expect(recallAtK(ranked, [], 5)).toBeUndefined();
		expect(reciprocalRank(ranked, [])).toBeUndefined();
		expect(ndcgAtK(ranked, [], 5)).toBeUndefined();
	});
});

describe('aggregates', () => {
	it('averages defined values and computes percentiles', () => {
		expect(mean([1, undefined, 3])).toBe(2);
		expect(mean([undefined])).toBeUndefined();
		expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
		expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
	});
});
