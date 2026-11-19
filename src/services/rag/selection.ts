/**
 * 检索结果的最终挑选：阈值拒答 → 条数与字符预算 → 相邻块合并。
 *
 * 纯函数，应用（documentIndex）与离线评测（eval/rag/retrievalEval）共用，
 * 保证评测衡量的就是实际注入给模型的内容。
 */

export interface SelectionCandidate {
	id: string;
	attachmentId: string;
	ordinal: number;
	/** chunk 在原文中的 UTF-16 区间，满足 text === source.slice(charStart, charEnd)。 */
	charStart: number;
	charEnd: number;
	text: string;
	/** 排序分数：有 rerank 时为 rerank 分数，否则为 RRF 分数。 */
	score: number;
	page?: number;
	pageEnd?: number;
	headingPath?: string[];
}

export interface SelectedPassage {
	/** 合并前的 chunk id，按 ordinal 升序。 */
	chunkIds: string[];
	attachmentId: string;
	charStart: number;
	charEnd: number;
	text: string;
	/** 组内最高分。 */
	score: number;
	page?: number;
	pageEnd?: number;
	headingPath?: string[];
}

export interface SelectionOptions {
	limit: number;
	/** 合并前按 chunk 原文长度累计的字符预算；第一条总会保留。 */
	budget: number;
	/** 低于该分数的候选丢弃；全部低于阈值时视为“资料中没有答案”。 */
	threshold?: number;
}

export interface SelectionResult {
	passages: SelectedPassage[];
	/** 有候选，但全部低于阈值。 */
	noAnswer: boolean;
}

/**
 * 同一文档 ordinal 连续的 chunk 合并成一段，去掉 chunk 之间的重叠文字。
 * 输出顺序按组内最靠前的候选位置，保持“最相关的在前”。
 */
export const mergeAdjacent = (
	candidates: readonly SelectionCandidate[],
): SelectedPassage[] => {
	const position = new Map(candidates.map((candidate, index) => [candidate.id, index]));
	const sorted = [...candidates].sort((a, b) =>
		a.attachmentId === b.attachmentId
			? a.ordinal - b.ordinal
			: a.attachmentId < b.attachmentId
				? -1
				: 1,
	);

	const groups: { members: SelectionCandidate[]; first: number }[] = [];
	for (const candidate of sorted) {
		const group = groups.at(-1);
		const last = group?.members.at(-1);
		if (
			group &&
			last &&
			last.attachmentId === candidate.attachmentId &&
			candidate.ordinal === last.ordinal + 1
		) {
			group.members.push(candidate);
			group.first = Math.min(group.first, position.get(candidate.id)!);
		} else {
			groups.push({ members: [candidate], first: position.get(candidate.id)! });
		}
	}

	return groups
		.sort((a, b) => a.first - b.first)
		.map(({ members }) => {
			let text = members[0].text;
			let charEnd = members[0].charEnd;
			for (const member of members.slice(1)) {
				if (member.charStart < charEnd) {
					text += member.text.slice(Math.min(charEnd - member.charStart, member.text.length));
				} else {
					text += `\n${member.text}`;
				}
				charEnd = Math.max(charEnd, member.charEnd);
			}
			const pages = members.flatMap(member =>
				member.page === undefined ? [] : [member.page, member.pageEnd ?? member.page],
			);
			const page = pages.length ? Math.min(...pages) : undefined;
			const pageEnd = pages.length ? Math.max(...pages) : undefined;
			const headingPath = members.find(member => member.headingPath?.length)?.headingPath;
			return {
				chunkIds: members.map(member => member.id),
				attachmentId: members[0].attachmentId,
				charStart: members[0].charStart,
				charEnd,
				text,
				score: Math.max(...members.map(member => member.score)),
				...(page !== undefined ? { page } : {}),
				...(pageEnd !== undefined && pageEnd !== page ? { pageEnd } : {}),
				...(headingPath ? { headingPath } : {}),
			};
		});
};

/** candidates 须已按相关性从高到低排列。 */
export const selectPassages = (
	candidates: readonly SelectionCandidate[],
	{ limit, budget, threshold }: SelectionOptions,
): SelectionResult => {
	const eligible =
		threshold === undefined
			? candidates
			: candidates.filter(candidate => candidate.score >= threshold);
	if (!eligible.length) {
		return { passages: [], noAnswer: candidates.length > 0 };
	}

	const chosen: SelectionCandidate[] = [];
	// 同一文件重复上传时，不同附件会产生正文完全相同的 chunk，只保留排名最高的一份。
	const seenText = new Set<string>();
	let used = 0;
	for (const candidate of eligible) {
		if (chosen.length >= limit) break;
		const key = candidate.text.replace(/\s+/g, ' ').trim();
		if (seenText.has(key)) continue;
		seenText.add(key);
		if (chosen.length && used + candidate.text.length > budget) break;
		used += candidate.text.length;
		chosen.push(candidate);
	}
	return { passages: mergeAdjacent(chosen), noAnswer: false };
};
