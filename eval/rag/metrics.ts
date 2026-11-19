/**
 * RAG 离线评测：数据集格式、证据定位与检索指标。
 *
 * 标注不使用 chunk id，而是“文档名 + 原文引文（quote）”。运行时在解析后的全文中
 * 定位引文得到字符区间，因此调整解析或切块参数后标注依然有效。
 */

export const QUESTION_TYPES = [
	'factual',
	'keyword',
	'multi_section',
	'follow_up',
	/** 口语化改写：不使用文档中的术语描述同一问题，检验跨用词检索。 */
	'paraphrase',
	'no_answer',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface EvidenceLabel {
	doc: string;
	quote: string;
	/** 引文在文档中出现多次时，指定第几次出现（从 1 开始）。 */
	occurrence?: number;
}

export interface EvalTurn {
	role: 'user' | 'assistant';
	content: string;
}

export interface EvalItem {
	id: string;
	type: QuestionType;
	question: string;
	/** 多轮追问题的前置对话。 */
	history?: EvalTurn[];
	/** 参考答案，供生成质量评分使用。 */
	answer?: string;
	/** `no_answer` 类型必须为空数组。 */
	evidence: EvidenceLabel[];
}

export interface Span {
	doc: string;
	charStart: number;
	charEnd: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

const fail = (line: number, message: string): never => {
	throw new Error(`数据集第 ${line} 行：${message}`);
};

/** 解析并校验 JSONL 数据集；空行和以 // 开头的行会被忽略。 */
export const parseDataset = (jsonl: string): EvalItem[] => {
	const items: EvalItem[] = [];
	const ids = new Set<string>();

	jsonl.split(/\r?\n/).forEach((raw, index) => {
		const line = index + 1;
		const source = raw.trim();
		if (!source || source.startsWith('//')) return;

		let value: unknown;
		try {
			value = JSON.parse(source);
		} catch {
			fail(line, 'JSON 格式无效');
		}
		if (!isRecord(value)) return fail(line, '必须是对象');

		const { id, type, question, history, answer, evidence } = value;
		if (!nonEmptyString(id)) fail(line, 'id 不能为空');
		if (ids.has(id as string)) fail(line, `id 重复：${id}`);
		if (!QUESTION_TYPES.includes(type as QuestionType)) {
			fail(line, `type 必须是 ${QUESTION_TYPES.join(' / ')}`);
		}
		if (!nonEmptyString(question)) fail(line, 'question 不能为空');
		if (answer !== undefined && typeof answer !== 'string') {
			fail(line, 'answer 必须是字符串');
		}
		if (
			history !== undefined &&
			(!Array.isArray(history) ||
				!history.every(
					turn =>
						isRecord(turn) &&
						(turn.role === 'user' || turn.role === 'assistant') &&
						nonEmptyString(turn.content),
				))
		) {
			fail(line, 'history 格式无效');
		}
		if (type === 'follow_up' && !(Array.isArray(history) && history.length)) {
			fail(line, 'follow_up 类型必须提供 history');
		}
		if (!Array.isArray(evidence)) return fail(line, 'evidence 必须是数组');
		if (type === 'no_answer' && evidence.length) {
			fail(line, 'no_answer 类型的 evidence 必须为空');
		}
		if (type !== 'no_answer' && !evidence.length) {
			fail(line, 'evidence 不能为空');
		}
		for (const label of evidence) {
			if (
				!isRecord(label) ||
				!nonEmptyString(label.doc) ||
				!nonEmptyString(label.quote) ||
				(label.occurrence !== undefined &&
					!(Number.isInteger(label.occurrence) && (label.occurrence as number) >= 1))
			) {
				fail(line, 'evidence 项必须包含 doc、quote，occurrence 为正整数');
			}
		}

		ids.add(id as string);
		items.push(value as unknown as EvalItem);
	});

	return items;
};

/**
 * 去掉全部空白后的文本及其到原文下标的映射。
 * PDF 提取结果会在中文句子中间断行（“并\n不受保证”），也会多出空格，
 * 只折叠空白不足以匹配，因此比较时完全忽略空白。
 */
const collapseWhitespace = (text: string) => {
	let collapsed = '';
	const origin: number[] = [];
	for (let i = 0; i < text.length; i += 1) {
		if (/\s/.test(text[i])) continue;
		collapsed += text[i];
		origin.push(i);
	}
	return { collapsed, origin };
};

/** 在文档全文中定位引文，返回原文字符区间。找不到或有歧义时抛错。 */
export const resolveEvidence = (label: EvidenceLabel, text: string): Span => {
	const haystack = collapseWhitespace(text);
	const needle = collapseWhitespace(label.quote).collapsed;
	const matches: number[] = [];
	for (
		let index = haystack.collapsed.indexOf(needle);
		index !== -1;
		index = haystack.collapsed.indexOf(needle, index + 1)
	) {
		matches.push(index);
	}

	if (!matches.length) {
		throw new Error(`在《${label.doc}》中找不到引文：${label.quote.slice(0, 40)}`);
	}
	if (matches.length > 1 && label.occurrence === undefined) {
		throw new Error(
			`引文在《${label.doc}》中出现 ${matches.length} 次，请指定 occurrence：${label.quote.slice(0, 40)}`,
		);
	}
	const start = matches[(label.occurrence ?? 1) - 1];
	if (start === undefined) {
		throw new Error(`引文在《${label.doc}》中只出现 ${matches.length} 次`);
	}

	const last = start + needle.length - 1;
	return {
		doc: label.doc,
		charStart: haystack.origin[start],
		charEnd: haystack.origin[last] + 1,
	};
};

const overlap = (a: Span, b: Span) =>
	a.doc === b.doc
		? Math.max(0, Math.min(a.charEnd, b.charEnd) - Math.max(a.charStart, b.charStart))
		: 0;

/**
 * chunk 是否命中证据区间：重叠长度不少于两者中较短者的一半。
 * 既允许“大 chunk 包含小引文”，也允许“长证据被切进多个 chunk”。
 */
export const spanHit = (chunk: Span, evidence: Span, threshold = 0.5): boolean => {
	const shorter = Math.min(
		chunk.charEnd - chunk.charStart,
		evidence.charEnd - evidence.charStart,
	);
	return shorter > 0 && overlap(chunk, evidence) / shorter >= threshold;
};

/** 前 k 个结果覆盖了多少比例的证据区间。没有证据时返回 undefined。 */
export const recallAtK = (
	ranked: readonly Span[],
	evidence: readonly Span[],
	k: number,
): number | undefined => {
	if (!evidence.length) return undefined;
	const top = ranked.slice(0, k);
	const covered = evidence.filter(span => top.some(chunk => spanHit(chunk, span)));
	return covered.length / evidence.length;
};

/** 第一个命中任一证据的结果排名的倒数；没有命中为 0。 */
export const reciprocalRank = (
	ranked: readonly Span[],
	evidence: readonly Span[],
): number | undefined => {
	if (!evidence.length) return undefined;
	const index = ranked.findIndex(chunk => evidence.some(span => spanHit(chunk, span)));
	return index === -1 ? 0 : 1 / (index + 1);
};

/** 二值相关性的 nDCG@k；理想排序假设每条证据各对应一个相关结果。 */
export const ndcgAtK = (
	ranked: readonly Span[],
	evidence: readonly Span[],
	k: number,
): number | undefined => {
	if (!evidence.length) return undefined;
	const gain = (rank: number) => 1 / Math.log2(rank + 2);
	let dcg = 0;
	ranked.slice(0, k).forEach((chunk, rank) => {
		if (evidence.some(span => spanHit(chunk, span))) dcg += gain(rank);
	});
	let ideal = 0;
	for (let rank = 0; rank < Math.min(k, evidence.length); rank += 1) ideal += gain(rank);
	return Math.min(1, dcg / ideal);
};

/** 忽略 undefined 的平均值；没有样本时返回 undefined。 */
export const mean = (values: readonly (number | undefined)[]): number | undefined => {
	const defined = values.filter((value): value is number => value !== undefined);
	return defined.length
		? defined.reduce((sum, value) => sum + value, 0) / defined.length
		: undefined;
};

export const percentile = (values: readonly number[], p: number): number | undefined => {
	if (!values.length) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
	return sorted[Math.max(0, index)];
};
