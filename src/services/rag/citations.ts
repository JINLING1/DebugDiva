/**
 * 引用回填：回答结束后扫描正文中的 `[n]`，把对应的检索片段转成 citation 内容。
 *
 * - 只识别代码之外的 `[n]`、`[1, 2]`、`[1][2]`；`arr[1]` 这类下标和 Markdown 链接 `[1](url)` 不算。
 * - 超出片段编号范围的引用（模型编造的 `[9]`）从正文中删除，并计入 invalid，用于评测“引用幻觉率”。
 */

import type { RetrievedPassage } from './documentIndex';

export const MAX_CITATION_EXCERPT_CHARACTERS = 600;

export interface CitationContent {
	type: 'citation';
	attachmentId: string;
	name: string;
	page?: number;
	pageEnd?: number;
	headingPath?: string[];
	/** 对应回答正文中的 `[index]`。 */
	index: number;
	excerpt: string;
}

export interface CitationResult {
	text: string;
	citations: CitationContent[];
	/** 正文中出现的有效编号（去重、按出现顺序）。 */
	cited: number[];
	/** 被删除的越界编号（含重复出现）。 */
	invalid: number[];
}

/** 一串连续的引用标记：`[1]`、`[1, 2]`、`[1][2]`、`[1，2、3]`；后面紧跟 `(` 的是 Markdown 链接。 */
const MARKER_RUN = /(?:\[\d{1,3}(?:\s*[,，、]\s*\d{1,3})*\])+(?!\()/g;
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/**
 * 片段较长（尤其是相邻块合并后）时，开头不一定是回答依据的部分。
 * 以查询中最长的英文标识符（如 ERR_HTTP_HEADERS_SENT）在片段中出现的位置为锚点，
 * 从该行开始截取；若前面不远处有 Markdown 标题，则从标题开始。找不到锚点时从开头截取。
 */
const anchorOffset = (text: string, query: string) => {
	const terms = [...new Set(query.match(/[A-Za-z_$][\w$.]{2,}/g) ?? [])].sort(
		(a, b) => b.length - a.length,
	);
	const lower = text.toLowerCase();
	for (const term of terms) {
		const position = lower.indexOf(term.toLowerCase());
		if (position < 0) continue;
		const lineStart = text.lastIndexOf('\n', position) + 1;
		if (text.startsWith('#', lineStart)) return lineStart;
		const heading = text.lastIndexOf('\n#', lineStart - 1);
		if (heading >= 0 && lineStart - heading < 200) return heading + 1;
		return text.startsWith('#') && lineStart < 200 ? 0 : lineStart;
	}
	return 0;
};

const buildExcerpt = (text: string, query: string) => {
	const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
	const start = anchorOffset(normalized, query);
	const codePoints = Array.from(normalized.slice(start));
	const body =
		codePoints.length > MAX_CITATION_EXCERPT_CHARACTERS
			? `${codePoints.slice(0, MAX_CITATION_EXCERPT_CHARACTERS).join('')}…`
			: codePoints.join('');
	return start > 0 ? `…${body}` : body;
};

/** 把正文按代码（围栏代码块与行内代码）切开，只处理代码之外的部分。 */
const mapProse = (text: string, transform: (prose: string) => string) =>
	text
		.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
		.map((part, index) => (index % 2 === 1 ? part : transform(part)))
		.join('');

export const collectCitations = (
	text: string,
	passages: readonly RetrievedPassage[],
	/** 检索查询，用于把引用摘录定位到最相关的位置。 */
	query = '',
): CitationResult => {
	const cited: number[] = [];
	const invalid: number[] = [];

	const rewritten = mapProse(text, prose =>
		prose.replace(MARKER_RUN, (run: string, offset: number, whole: string) => {
			const numbers = (run.match(/\d{1,3}/g) ?? []).map(Number);
			const isValid = (n: number) => n >= 1 && n <= passages.length;
			// 紧跟在标识符后面（如 arr[10]）且含越界编号时，更像代码下标，原样保留
			if (IDENTIFIER_CHAR.test(whole[offset - 1] ?? '') && !numbers.every(isValid)) {
				return run;
			}
			const valid = numbers.filter(isValid);
			invalid.push(...numbers.filter(n => !isValid(n)));
			for (const n of valid) if (!cited.includes(n)) cited.push(n);
			return [...new Set(valid)].map(n => `[${n}]`).join('');
		}),
	);

	const citations = [...cited]
		.sort((a, b) => a - b)
		.map((index): CitationContent => {
			const passage = passages[index - 1];
			return {
				type: 'citation',
				attachmentId: passage.attachmentId,
				name: passage.name,
				index,
				excerpt: buildExcerpt(passage.text, query),
				...(passage.page !== undefined ? { page: passage.page } : {}),
				...(passage.pageEnd !== undefined ? { pageEnd: passage.pageEnd } : {}),
				...(passage.headingPath?.length ? { headingPath: [...passage.headingPath] } : {}),
			};
		});

	return {
		// 删除越界编号后可能留下多余空格，例如“结论 [9]。”→“结论 。”
		text: invalid.length ? rewritten.replace(/[ \t]+([。，、；：！？.,;:!?])/g, '$1') : rewritten,
		citations,
		cited,
		invalid,
	};
};
