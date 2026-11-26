/**
 * 文档结构分段。
 *
 * segment 用偏移量描述最终 `text` 中的一段连续区间，而不是复制一份文本，
 * 这样解析响应不会变大，chunker 与评测标注也能共享同一套坐标。
 * 偏移量单位是 UTF-16 code unit，与 `String.prototype.slice` 一致。
 */

export type SegmentKind = 'prose' | 'code';

export interface DocumentSegment {
	start: number;
	end: number;
	page?: number;
	headingPath?: string[];
	kind: SegmentKind;
}

export interface TextBlock {
	text: string;
	page?: number;
	headingPath?: string[];
	kind: SegmentKind;
}

export interface ComposedDocument {
	text: string;
	segments: DocumentSegment[];
}

const isWhitespace = (char: string | undefined) =>
	char !== undefined && /\s/.test(char);

/** 收缩区间，去掉两端空白；区间为空时返回 null。 */
export const trimRange = (
	text: string,
	start: number,
	end: number,
): { start: number; end: number } | null => {
	let from = start;
	let to = end;
	while (from < to && isWhitespace(text[from])) from += 1;
	while (to > from && isWhitespace(text[to - 1])) to -= 1;
	return from < to ? { start: from, end: to } : null;
};

const samePath = (a?: string[], b?: string[]) =>
	(a ?? []).length === (b ?? []).length &&
	(a ?? []).every((item, index) => item === b?.[index]);

const sameMetadata = (a: TextBlock | DocumentSegment, b: TextBlock) =>
	a.page === b.page && a.kind === b.kind && samePath(a.headingPath, b.headingPath);

const withMetadata = (
	start: number,
	end: number,
	source: Pick<TextBlock, 'page' | 'headingPath' | 'kind'>,
): DocumentSegment => ({
	start,
	end,
	kind: source.kind,
	...(source.page !== undefined ? { page: source.page } : {}),
	...(source.headingPath?.length ? { headingPath: [...source.headingPath] } : {}),
});

/**
 * 把带元数据的文本块拼接成最终文本，并生成 segment。
 * 相邻且元数据相同的块合并为一个 segment（例如同一标题下的多个段落）。
 * 块文本应当已经规范化；空块会被跳过。
 */
export const composeBlocks = (
	blocks: readonly TextBlock[],
	separator: string,
): ComposedDocument => {
	let text = '';
	const segments: DocumentSegment[] = [];

	for (const block of blocks) {
		if (!block.text.trim()) continue;
		if (text) text += separator;
		const start = text.length;
		text += block.text;
		const end = text.length;

		const previous = segments.at(-1);
		if (previous && sameMetadata(previous, block)) {
			previous.end = end;
		} else {
			segments.push(withMetadata(start, end, block));
		}
	}

	return { text, segments };
};

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * 按 Markdown 的 ATX 标题和围栏代码块切分。
 * 标题行归属于它开启的小节；代码块单独成为 `code` 段。
 */
export const segmentMarkdown = (text: string): DocumentSegment[] => {
	const segments: DocumentSegment[] = [];
	const headingStack: string[] = [];
	let sectionStart = 0;
	let sectionKind: 'prose' | 'code' = 'prose';
	let sectionPath: string[] = [];
	let fenceMarker: string | null = null;

	const close = (end: number) => {
		const range = trimRange(text, sectionStart, end);
		if (range) {
			segments.push(
				withMetadata(range.start, range.end, {
					kind: sectionKind,
					headingPath: sectionPath,
				}),
			);
		}
	};

	let lineStart = 0;
	while (lineStart <= text.length) {
		const newline = text.indexOf('\n', lineStart);
		const lineEnd = newline === -1 ? text.length : newline;
		const line = text.slice(lineStart, lineEnd);
		const nextLineStart = lineEnd + 1;

		if (fenceMarker) {
			const closing = FENCE_PATTERN.exec(line);
			if (
				closing &&
				closing[1][0] === fenceMarker[0] &&
				closing[1].length >= fenceMarker.length &&
				!line.trim().slice(closing[1].length).trim()
			) {
				close(lineEnd);
				fenceMarker = null;
				sectionStart = nextLineStart;
				sectionKind = 'prose';
			}
		} else {
			const fence = FENCE_PATTERN.exec(line);
			const heading = fence ? null : HEADING_PATTERN.exec(line);
			if (fence) {
				close(lineStart);
				fenceMarker = fence[1];
				sectionStart = lineStart;
				sectionKind = 'code';
			} else if (heading) {
				close(lineStart);
				const level = heading[1].length;
				headingStack.length = Math.min(headingStack.length, level - 1);
				while (headingStack.length < level - 1) headingStack.push('');
				headingStack.push(heading[2].trim());
				sectionStart = lineStart;
				sectionKind = 'prose';
				sectionPath = headingStack.filter(Boolean);
			}
		}

		if (newline === -1) break;
		lineStart = nextLineStart;
	}

	close(text.length);
	return segments;
};

/** 整个文本作为一个 segment（普通文本或代码文件）。 */
export const wholeTextSegment = (
	text: string,
	kind: SegmentKind,
): DocumentSegment[] => {
	const range = trimRange(text, 0, text.length);
	return range ? [withMetadata(range.start, range.end, { kind })] : [];
};

/** 把 code point 数量换算成 UTF-16 下标，避免截断代理对。 */
const codePointLimitToIndex = (text: string, maxCodePoints: number): number => {
	let count = 0;
	let index = 0;
	while (index < text.length) {
		if (count === maxCodePoints) return index;
		const code = text.charCodeAt(index);
		index += code >= 0xd800 && code <= 0xdbff && index + 1 < text.length ? 2 : 1;
		count += 1;
	}
	return text.length;
};

/** 按 code point 上限截断文本，同时裁剪 segment。 */
export const truncateComposed = (
	document: ComposedDocument,
	maxCodePoints: number,
): ComposedDocument & { truncated: boolean } => {
	const cut = codePointLimitToIndex(document.text, maxCodePoints);
	if (cut >= document.text.length) return { ...document, truncated: false };

	const text = document.text.slice(0, cut);
	const segments: DocumentSegment[] = [];
	for (const segment of document.segments) {
		if (segment.start >= cut) break;
		const range = trimRange(text, segment.start, Math.min(segment.end, cut));
		if (range) segments.push({ ...segment, ...range });
	}
	return { text, segments, truncated: true };
};
