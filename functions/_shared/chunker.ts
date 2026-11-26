/**
 * 结构感知切块（纯函数，服务端、浏览器与离线评测共用）。
 *
 * 规则：
 * 1. 以 segment 为边界切分，不跨页；同一页内相邻的兄弟/父子小节会打包到接近目标长度，
 *    很短的 segment（例如只有一个标题）会并入下一个 segment。
 * 2. segment 内按“空行 → 换行 → 句末标点 → 空白 → 硬切”的优先级寻找切点。
 * 3. 相邻 chunk 之间保留重叠，下一个 chunk 的起点尽量对齐到句子或行首。
 * 4. 不变量：`chunk.text === text.slice(chunk.charStart, chunk.charEnd)`。
 *
 * 长度单位是 UTF-16 code unit（中文字符各占 1）。
 */

import {
	trimRange,
	type DocumentSegment,
	type SegmentKind,
} from './documentSegments';

export interface ChunkOptions {
	/** 正文 chunk 的目标最大长度。 */
	targetSize?: number;
	/** 相邻 chunk 的重叠长度。 */
	overlap?: number;
	/** 代码 chunk 的最大长度；代码尽量整块保留。 */
	maxCodeSize?: number;
	/** 短于该长度的正文 segment 会并入下一个正文 segment。 */
	minSegmentSize?: number;
}

export interface DocumentChunk {
	ordinal: number;
	text: string;
	charStart: number;
	charEnd: number;
	/** chunk 起始所在页。 */
	page?: number;
	/** chunk 跨页时的结束页。 */
	pageEnd?: number;
	headingPath?: string[];
	kind: SegmentKind;
}

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
	targetSize: 600,
	overlap: 100,
	maxCodeSize: 1500,
	minSegmentSize: 80,
};

type Separator = string | RegExp;

const PROSE_SEPARATORS: Separator[] = [
	'\n\n',
	'\n',
	/[。！？；!?;]|\.(?=\s)/g,
	/[，、,]/g,
	/\s/g,
];
const CODE_SEPARATORS: Separator[] = ['\n\n', '\n'];

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** 避免在代理对中间切开。 */
const safeIndex = (text: string, index: number) =>
	index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1))
		? index - 1
		: index;

/** 返回 [from, to) 中最后一个分隔符之后的位置；找不到返回 -1。 */
const lastBreakAfter = (
	text: string,
	from: number,
	to: number,
	separator: Separator,
): number => {
	const window = text.slice(from, to);
	if (typeof separator === 'string') {
		const index = window.lastIndexOf(separator);
		return index === -1 ? -1 : from + index + separator.length;
	}
	let last = -1;
	separator.lastIndex = 0;
	for (let match = separator.exec(window); match; match = separator.exec(window)) {
		last = from + match.index + match[0].length;
		if (match[0].length === 0) separator.lastIndex += 1;
	}
	return last;
};

/** 返回 [from, to) 中第一个分隔符之后的位置；找不到返回 -1。 */
const firstBreakAfter = (
	text: string,
	from: number,
	to: number,
	separator: Separator,
): number => {
	const window = text.slice(from, to);
	if (typeof separator === 'string') {
		const index = window.indexOf(separator);
		return index === -1 ? -1 : from + index + separator.length;
	}
	separator.lastIndex = 0;
	const match = separator.exec(window);
	return match ? from + match.index + match[0].length : -1;
};

const findChunkEnd = (
	text: string,
	start: number,
	maxSize: number,
	separators: Separator[],
): number => {
	const minEnd = start + Math.floor(maxSize / 2);
	const maxEnd = start + maxSize;
	for (const separator of separators) {
		const end = lastBreakAfter(text, minEnd, maxEnd, separator);
		if (end > minEnd) return end;
	}
	return safeIndex(text, maxEnd);
};

const findNextStart = (
	text: string,
	previousStart: number,
	end: number,
	overlap: number,
	separators: Separator[],
): number => {
	if (overlap <= 0) return end;
	const from = Math.max(previousStart + 1, end - overlap);
	for (const separator of separators) {
		const start = firstBreakAfter(text, from, end, separator);
		if (start > previousStart && start < end) return start;
	}
	return safeIndex(text, from);
};

type WorkingSegment = DocumentSegment;

const commonPrefix = (a: readonly string[] = [], b: readonly string[] = []) => {
	const prefix: string[] = [];
	for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i += 1) {
		prefix.push(a[i]);
	}
	return prefix;
};

/**
 * 打包范围：组内第一个小节的父小节；一级标题以自身为界，避免把整篇文档并成一组。
 * 例如从“### 信息”开始的组只能吸收同一个“## 页面”下的小节。
 */
const packingAnchor = (segment: DocumentSegment) => {
	const path = segment.headingPath ?? [];
	return path.slice(0, Math.max(1, path.length - 1));
};

const startsWith = (path: readonly string[] = [], prefix: readonly string[]) =>
	prefix.every((item, index) => path[index] === item);

/**
 * 把同一页、同一父小节下相邻的小节打包，直到接近目标长度。
 *
 * 只按标题切分会产生大量很短的 chunk：MDN 每页有“信息 / 错误类型 / 示例”等小节，
 * Node.js 文档每个错误码一个小节，代码示例也会和解释文字分开。
 * 打包后的 headingPath 取成员的公共前缀；全部是代码时才保留 code 类型。
 */
const packNeighbourSegments = (
	segments: readonly DocumentSegment[],
	targetSize: number,
): WorkingSegment[] => {
	const packed: WorkingSegment[] = [];
	let anchor: string[] = [];
	for (const segment of segments) {
		const current = packed.at(-1);
		if (
			current &&
			current.page === segment.page &&
			segment.end - current.start <= targetSize &&
			startsWith(segment.headingPath, anchor)
		) {
			const headingPath = commonPrefix(current.headingPath, segment.headingPath);
			packed[packed.length - 1] = {
				start: current.start,
				end: segment.end,
				kind: current.kind === 'code' && segment.kind === 'code' ? 'code' : 'prose',
				...(current.page !== undefined ? { page: current.page } : {}),
				...(headingPath.length ? { headingPath } : {}),
			};
		} else {
			packed.push({ ...segment });
			anchor = packingAnchor(segment);
		}
	}
	return packed;
};

/** 把过短的正文 segment（例如只有标题的空小节）并入下一个正文 segment。 */
const mergeShortSegments = (
	segments: readonly DocumentSegment[],
	minSize: number,
): WorkingSegment[] => {
	const merged: WorkingSegment[] = [];
	let pending: WorkingSegment | undefined;

	for (const segment of segments) {
		if (pending && segment.kind === 'prose') {
			merged.push({ ...segment, start: pending.start });
			pending = undefined;
			continue;
		}
		if (pending) {
			merged.push(pending);
			pending = undefined;
		}
		if (segment.kind === 'prose' && segment.end - segment.start < minSize) {
			pending = { ...segment };
		} else {
			merged.push({ ...segment });
		}
	}
	if (pending) merged.push(pending);

	// 合并后可能仍然过短（连续多个空标题），再合并一轮直到稳定。
	return merged.length < segments.length
		? mergeShortSegments(merged, minSize)
		: merged;
};

const pageAt = (segments: readonly DocumentSegment[], offset: number) => {
	for (const segment of segments) {
		if (offset < segment.end) return segment.page;
	}
	return segments.at(-1)?.page;
};

export const chunkDocument = (
	text: string,
	segments: readonly DocumentSegment[],
	options: ChunkOptions = {},
): DocumentChunk[] => {
	const config = { ...DEFAULT_CHUNK_OPTIONS, ...options };
	if (config.overlap >= config.targetSize / 2) {
		throw new RangeError('overlap 必须小于 targetSize 的一半');
	}

	const sorted = [...segments].sort((a, b) => a.start - b.start);
	const chunks: DocumentChunk[] = [];

	const push = (
		start: number,
		end: number,
		segment: WorkingSegment,
	) => {
		const range = trimRange(text, start, end);
		if (!range) return;
		const page = pageAt(sorted, range.start);
		const pageEnd = pageAt(sorted, range.end - 1);
		chunks.push({
			ordinal: chunks.length,
			text: text.slice(range.start, range.end),
			charStart: range.start,
			charEnd: range.end,
			kind: segment.kind,
			...(page !== undefined ? { page } : {}),
			...(pageEnd !== undefined && pageEnd !== page ? { pageEnd } : {}),
			...(segment.headingPath?.length
				? { headingPath: [...segment.headingPath] }
				: {}),
		});
	};

	const working = mergeShortSegments(
		packNeighbourSegments(sorted, config.targetSize),
		config.minSegmentSize,
	);
	for (const segment of working) {
		const range = trimRange(text, segment.start, Math.min(segment.end, text.length));
		if (!range) continue;
		const isCode = segment.kind === 'code';
		const maxSize = isCode ? config.maxCodeSize : config.targetSize;
		const separators = isCode ? CODE_SEPARATORS : PROSE_SEPARATORS;

		let start = range.start;
		while (start < range.end) {
			if (range.end - start <= maxSize) {
				push(start, range.end, segment);
				break;
			}
			const end = findChunkEnd(text, start, maxSize, separators);
			push(start, end, segment);
			const next = findNextStart(text, start, end, isCode ? 0 : config.overlap, separators);
			start = next > start ? next : end;
		}
	}

	return chunks;
};

const sanitizeInline = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * 生成用于向量化的文本：在正文前加上“文件名 > 标题路径”前缀（轻量版 contextual retrieval），
 * 让“某一节讲了什么”这类问题也能匹配到正文。展示和注入上下文时使用 `chunk.text`。
 */
export const buildEmbedText = (
	documentName: string,
	chunk: Pick<DocumentChunk, 'text' | 'headingPath'>,
): string => {
	const path = chunk.headingPath?.map(sanitizeInline).filter(Boolean) ?? [];
	const prefix = [`《${sanitizeInline(documentName)}》`, ...path].join(' > ');
	return `${prefix}\n${chunk.text}`;
};
