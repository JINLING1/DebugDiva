import { describe, expect, it } from 'vitest';
import { mergeAdjacent, selectPassages, type SelectionCandidate } from './selection';

const SOURCE = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 从 SOURCE 截取 [start, end) 作为 chunk。 */
const chunk = (
	ordinal: number,
	start: number,
	end: number,
	score: number,
	extra: Partial<SelectionCandidate> = {},
): SelectionCandidate => ({
	id: `a:${ordinal}`,
	attachmentId: 'a',
	ordinal,
	charStart: start,
	charEnd: end,
	text: SOURCE.slice(start, end),
	score,
	...extra,
});

describe('mergeAdjacent', () => {
	it('merges consecutive ordinals and removes the overlapping text', () => {
		const merged = mergeAdjacent([chunk(1, 8, 16, 0.9), chunk(0, 0, 10, 0.5)]);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			chunkIds: ['a:0', 'a:1'],
			charStart: 0,
			charEnd: 16,
			text: SOURCE.slice(0, 16),
			score: 0.9,
		});
	});

	it('keeps non-adjacent chunks and other documents separate, ordered by best position', () => {
		const merged = mergeAdjacent([
			chunk(5, 20, 25, 0.9),
			{ ...chunk(0, 0, 5, 0.8), id: 'b:0', attachmentId: 'b' },
			chunk(1, 5, 10, 0.7),
			chunk(2, 10, 15, 0.6),
		]);
		expect(merged.map(passage => passage.chunkIds)).toEqual([
			['a:5'],
			['b:0'],
			['a:1', 'a:2'],
		]);
	});

	it('joins chunks separated by a gap with a newline and spans their pages', () => {
		const [merged] = mergeAdjacent([
			chunk(0, 0, 5, 0.5, { page: 1 }),
			chunk(1, 6, 10, 0.4, { page: 2, headingPath: ['第二章'] }),
		]);
		expect(merged.text).toBe(`${SOURCE.slice(0, 5)}\n${SOURCE.slice(6, 10)}`);
		expect(merged.page).toBe(1);
		expect(merged.pageEnd).toBe(2);
		expect(merged.headingPath).toEqual(['第二章']);
	});
});

describe('selectPassages', () => {
	const candidates = [chunk(3, 0, 10, 0.8), chunk(7, 10, 20, 0.3), chunk(9, 20, 30, 0.005)];

	it('drops candidates below the threshold', () => {
		const result = selectPassages(candidates, { limit: 8, budget: 1_000, threshold: 0.01 });
		expect(result.noAnswer).toBe(false);
		expect(result.passages.map(passage => passage.chunkIds[0])).toEqual(['a:3', 'a:7']);
	});

	it('flags noAnswer only when there were candidates and all were below the threshold', () => {
		expect(selectPassages(candidates, { limit: 8, budget: 1_000, threshold: 0.9 })).toEqual({
			passages: [],
			noAnswer: true,
		});
		expect(selectPassages([], { limit: 8, budget: 1_000, threshold: 0.9 }).noAnswer).toBe(false);
	});

	it('skips passages whose text duplicates a higher-ranked one (same file uploaded twice)', () => {
		const duplicate = { ...chunk(3, 0, 10, 0.79), id: 'b:3', attachmentId: 'b' };
		const result = selectPassages([candidates[0], duplicate, candidates[1]], {
			limit: 8,
			budget: 1_000,
		});
		expect(result.passages.map(passage => passage.chunkIds[0])).toEqual(['a:3', 'a:7']);
	});

	it('applies the limit and the character budget, always keeping the first passage', () => {
		expect(selectPassages(candidates, { limit: 1, budget: 1_000 }).passages).toHaveLength(1);
		expect(selectPassages(candidates, { limit: 8, budget: 15 }).passages).toHaveLength(1);
		expect(selectPassages(candidates, { limit: 8, budget: 1 }).passages).toHaveLength(1);
	});
});
