import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { getDocumentProxy } from 'unpdf';
import {
	composeBlocks,
	segmentMarkdown,
	truncateComposed,
	wholeTextSegment,
	type ComposedDocument,
	type DocumentSegment,
	type TextBlock,
} from './documentSegments';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 解析阶段的文本上限；完整文本用于本地检索索引，注入上下文时另有 40,000 字符上限。 */
export const MAX_EXTRACTED_TEXT_LENGTH = 300_000;
export const MAX_PDF_PAGES = 50;
export const MAX_DOCX_XML_SIZE = 5 * 1024 * 1024;

export type FileParseErrorCode =
	| 'FILE_TOO_LARGE'
	| 'UNSUPPORTED_FILE_TYPE'
	| 'EMPTY_FILE'
	| 'PARSE_FAILED'
	| 'ENCRYPTED_DOCUMENT';

export interface ParsedDocumentData {
	name: string;
	mimeType: string;
	size: number;
	text: string;
	pageCount?: number;
	truncated: boolean;
	warnings: string[];
	/** 结构分段（页码、标题路径、代码块），偏移量指向 `text`。 */
	segments: DocumentSegment[];
}

export class FileParseError extends Error {
	readonly code: FileParseErrorCode;
	readonly status: number;

	constructor(code: FileParseErrorCode, message: string, status = 400) {
		super(message);
		this.name = 'FileParseError';
		this.code = code;
		this.status = status;
	}
}

type DocumentKind = 'text' | 'pdf' | 'docx';

const TEXT_APPLICATION_MIME_TYPES = new Set([
	'application/json',
	'application/ld+json',
	'application/javascript',
	'application/typescript',
	'application/xml',
	'application/x-httpd-php',
	'application/x-sh',
	'application/x-yaml',
]);

const TEXT_EXTENSIONS = new Set([
	'txt',
	'md',
	'markdown',
	'json',
	'js',
	'mjs',
	'cjs',
	'jsx',
	'ts',
	'mts',
	'cts',
	'tsx',
	'vue',
	'css',
	'scss',
	'sass',
	'less',
	'html',
	'htm',
	'xml',
	'yaml',
	'yml',
	'py',
	'java',
	'c',
	'cc',
	'cpp',
	'h',
	'hpp',
	'go',
	'rs',
	'cs',
	'php',
	'rb',
	'sql',
	'sh',
	'bash',
]);

const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE =
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const getExtension = (name: string) =>
	name.toLowerCase().split('.').at(-1) ?? '';

const hasPrefix = (bytes: Uint8Array, prefix: number[]) =>
	prefix.every((value, index) => bytes[index] === value);

const hasPdfMagic = (bytes: Uint8Array) =>
	hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
const hasZipMagic = (bytes: Uint8Array) =>
	hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
	hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
	hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08]);
const hasOleMagic = (bytes: Uint8Array) =>
	hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const assertLooksLikeText = (bytes: Uint8Array) => {
	const sample = bytes.subarray(0, Math.min(bytes.length, 8 * 1024));
	let controlCharacters = 0;
	for (const byte of sample) {
		if (byte === 0) {
			throw new FileParseError(
				'UNSUPPORTED_FILE_TYPE',
				'文件内容看起来是二进制数据，无法按文本解析',
				415,
			);
		}
		if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f) {
			controlCharacters += 1;
		}
	}
	if (sample.length > 0 && controlCharacters / sample.length > 0.01) {
		throw new FileParseError(
			'UNSUPPORTED_FILE_TYPE',
			'文件内容看起来是二进制数据，无法按文本解析',
			415,
		);
	}
};

const detectDocumentKind = (
	file: File,
	bytes: Uint8Array,
): DocumentKind => {
	const mimeType = file.type.toLowerCase().split(';')[0].trim();
	const extension = getExtension(file.name);
	const genericMimeType =
		!mimeType || mimeType === 'application/octet-stream';
	const pdfCandidate =
		mimeType === PDF_MIME_TYPE || (genericMimeType && extension === 'pdf');
	const docxCandidate =
		mimeType === DOCX_MIME_TYPE ||
		((genericMimeType || mimeType === 'application/zip') &&
			extension === 'docx');

	if (hasOleMagic(bytes) && docxCandidate) {
		throw new FileParseError(
			'ENCRYPTED_DOCUMENT',
			'该 Office 文档已加密或不是有效的 DOCX 文件',
			422,
		);
	}

	if (pdfCandidate) {
		if (!hasPdfMagic(bytes)) {
			throw new FileParseError('PARSE_FAILED', '文件内容不是有效的 PDF', 422);
		}
		return 'pdf';
	}

	if (docxCandidate) {
		if (!hasZipMagic(bytes)) {
			throw new FileParseError('PARSE_FAILED', '文件内容不是有效的 DOCX', 422);
		}
		return 'docx';
	}

	if (hasPdfMagic(bytes) || hasZipMagic(bytes) || hasOleMagic(bytes)) {
		throw new FileParseError(
			'UNSUPPORTED_FILE_TYPE',
			'文件声明类型与实际内容不一致',
			415,
		);
	}

	if (
		mimeType.startsWith('text/') ||
		TEXT_APPLICATION_MIME_TYPES.has(mimeType) ||
		(genericMimeType && TEXT_EXTENSIONS.has(extension))
	) {
		assertLooksLikeText(bytes);
		return 'text';
	}

	throw new FileParseError('UNSUPPORTED_FILE_TYPE', '暂不支持该文件类型', 415);
};

const truncationWarning = (maxLength: number) =>
	`内容超过 ${maxLength.toLocaleString('en-US')} 字符，已截断`;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const PROSE_TEXT_EXTENSIONS = new Set(['txt', ...MARKDOWN_EXTENSIONS]);

const segmentPlainText = (
	text: string,
	fileName: string,
	mimeType: string,
): DocumentSegment[] => {
	const extension = getExtension(fileName);
	const baseType = mimeType.toLowerCase().split(';')[0].trim();
	if (MARKDOWN_EXTENSIONS.has(extension) || baseType === 'text/markdown') {
		return segmentMarkdown(text);
	}
	const isCode =
		TEXT_EXTENSIONS.has(extension) && !PROSE_TEXT_EXTENSIONS.has(extension);
	return wholeTextSegment(text, isCode ? 'code' : 'prose');
};

const normalizeExtractedText = (input: string) =>
	input
		.replace(/\r\n?/g, '\n')
		.replace(/[\t ]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

const parsePlainText = (bytes: Uint8Array) => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (cause) {
		throw new FileParseError(
			'PARSE_FAILED',
			'文本文件不是有效的 UTF-8 编码',
			422,
		);
	}
};

const parsePdfText = async (bytes: Uint8Array, maxLength: number) => {
	const warnings: string[] = [];
	const deadline = Date.now() + 8_000;
	let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;

	try {
		pdf = await getDocumentProxy(bytes, {
			maxImageSize: 16_777_216,
		});
		if (pdf.numPages > MAX_PDF_PAGES) {
			throw new FileParseError(
				'PARSE_FAILED',
				`PDF 页数超过 ${MAX_PDF_PAGES} 页，暂时无法解析`,
				422,
			);
		}

		const pages: TextBlock[] = [];
		let characterCount = 0;
		let truncated = false;
		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
			let text = '';
			if (Date.now() > deadline) {
				throw new FileParseError('PARSE_FAILED', 'PDF 解析超时，请尝试更小的文件', 422);
			}

			const page = await pdf.getPage(pageNumber);
			try {
				const content = await page.getTextContent();
				if (Date.now() > deadline) {
					throw new FileParseError(
						'PARSE_FAILED',
						'PDF 解析超时，请尝试更小的文件',
						422,
					);
				}
				for (const item of content.items) {
					if (!('str' in item) || typeof item.str !== 'string') continue;
					const itemText = item.hasEOL ? `${item.str}\n` : `${item.str} `;
					const characters = Array.from(itemText);
					const remaining = maxLength - characterCount;
					if (characters.length > remaining) {
						text += characters.slice(0, remaining).join('');
						characterCount = maxLength;
						truncated = true;
						break;
					}
					text += itemText;
					characterCount += characters.length;
				}
			} finally {
				page.cleanup();
			}
			pages.push({
				text: normalizeExtractedText(text),
				page: pageNumber,
				kind: 'prose',
			});
			if (truncated) break;
		}

		// 页与页之间用空行分隔；每页一个 segment，保留页码供引用使用。
		const composed = truncateComposed(
			composeBlocks(pages, '\n\n'),
			maxLength,
		);
		if (!composed.text) {
			throw new FileParseError(
				'PARSE_FAILED',
				'未提取到可用文本，扫描版 PDF 暂不支持 OCR',
				422,
			);
		}
		truncated ||= composed.truncated;
		if (truncated) warnings.push(truncationWarning(maxLength));

		return {
			text: composed.text,
			segments: composed.segments,
			pageCount: pdf.numPages,
			truncated,
			warnings,
		};
	} catch (cause) {
		if (cause instanceof FileParseError) throw cause;
		const message = cause instanceof Error ? cause.message : '';
		if (/password|encrypted/i.test(message)) {
			throw new FileParseError('ENCRYPTED_DOCUMENT', '暂不支持加密 PDF', 422);
		}
		throw new FileParseError('PARSE_FAILED', 'PDF 解析失败', 422);
	} finally {
		await pdf?.cleanup();
	}
};

const parseWordXml = (xml: string) => {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
		throw new FileParseError('PARSE_FAILED', 'DOCX 包含不安全的 XML 声明', 422);
	}

	const blocks: TextBlock[] = [];
	const headingStack: string[] = [];
	let paragraph = '';
	let headingLevel: number | undefined;
	let textDepth = 0;
	let tableDepth = 0;
	let cell: string[] = [];
	let row: string[] = [];

	const readVal = (tag: { attributes: Record<string, unknown> }) => {
		for (const attribute of Object.values(tag.attributes)) {
			const { local, value } = attribute as { local?: string; value?: string };
			if (local === 'val') return value;
		}
		return undefined;
	};

	const pushBlock = (text: string) => {
		blocks.push({ text, headingPath: [...headingStack], kind: 'prose' });
	};

	const parser = new SaxesParser({ xmlns: true, position: false });
	parser.on('opentag', tag => {
		switch (tag.local) {
			case 't':
				textDepth += 1;
				break;
			case 'tab':
				paragraph += '\t';
				break;
			case 'br':
			case 'cr':
				paragraph += '\n';
				break;
			case 'tbl':
				tableDepth += 1;
				break;
			case 'pStyle':
				headingLevel ??= headingLevelFromStyle(readVal(tag));
				break;
			case 'outlineLvl': {
				const level = Number(readVal(tag));
				if (Number.isInteger(level) && level >= 0 && level <= 5) {
					headingLevel = level + 1;
				}
				break;
			}
		}
	});
	parser.on('text', text => {
		if (textDepth > 0) paragraph += text;
	});
	parser.on('closetag', tag => {
		switch (tag.local) {
			case 't':
				textDepth = Math.max(0, textDepth - 1);
				break;
			case 'p': {
				const text = normalizeExtractedText(paragraph);
				if (tableDepth > 0) {
					if (text) cell.push(text.replace(/\s*\n\s*/g, ' '));
				} else if (text) {
					if (headingLevel !== undefined) {
						headingStack.length = Math.min(headingStack.length, headingLevel - 1);
						headingStack.push(text.replace(/\s+/g, ' '));
					}
					pushBlock(text);
				}
				paragraph = '';
				headingLevel = undefined;
				break;
			}
			case 'tc':
				row.push(cell.join(' '));
				cell = [];
				break;
			case 'tr': {
				const text = row.join('\t').trim();
				if (text) pushBlock(text);
				row = [];
				break;
			}
			case 'tbl':
				tableDepth = Math.max(0, tableDepth - 1);
				break;
		}
	});
	parser.on('error', () => {
		throw new FileParseError('PARSE_FAILED', 'DOCX XML 格式无效', 422);
	});
	parser.write(xml).close();
	return composeBlocks(blocks, '\n');
};

/** Word 内置标题样式：英文 Heading1–6、中文“标题 1–6”（styleId 常为纯数字）、Title。 */
const headingLevelFromStyle = (styleId: string | undefined) => {
	if (!styleId) return undefined;
	if (/^title$/i.test(styleId)) return 1;
	const match = /^(?:heading|标题)?\s*([1-6])$/i.exec(styleId);
	return match ? Number(match[1]) : undefined;
};

const parseDocxText = (bytes: Uint8Array) => {
	let expandedSize = 0;
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes, {
			filter: file => {
				const wanted =
					file.name === '[Content_Types].xml' ||
					file.name === 'word/document.xml';
				if (!wanted) return false;
				expandedSize += file.originalSize;
				if (expandedSize > MAX_DOCX_XML_SIZE) {
					throw new FileParseError(
						'PARSE_FAILED',
						'DOCX 解压后的 XML 过大，暂时无法解析',
						422,
					);
				}
				return true;
			},
		});
	} catch (cause) {
		if (cause instanceof FileParseError) throw cause;
		throw new FileParseError('PARSE_FAILED', 'DOCX 解压失败', 422);
	}

	if (!entries['[Content_Types].xml'] || !entries['word/document.xml']) {
		throw new FileParseError('PARSE_FAILED', 'DOCX 缺少必要的文档内容', 422);
	}

	const xml = new TextDecoder('utf-8', { fatal: true }).decode(
		entries['word/document.xml'],
	);
	const composed = parseWordXml(xml);
	if (!composed.text) {
		throw new FileParseError('EMPTY_FILE', '文档中没有可读取的文本', 422);
	}
	return composed;
};

const limitDocument = (composed: ComposedDocument, maxLength: number) => {
	const limited = truncateComposed(composed, maxLength);
	return {
		text: limited.text,
		segments: limited.segments,
		truncated: limited.truncated,
		warnings: limited.truncated ? [truncationWarning(maxLength)] : [],
	};
};

export interface ParseDocumentOptions {
	/** 提取文本的最大字符数（code point），默认 MAX_EXTRACTED_TEXT_LENGTH。离线评测会调大它。 */
	maxTextLength?: number;
}

export const parseDocumentFile = async (
	file: File,
	{ maxTextLength: maxLength = MAX_EXTRACTED_TEXT_LENGTH }: ParseDocumentOptions = {},
): Promise<ParsedDocumentData> => {
	if (file.size === 0) throw new FileParseError('EMPTY_FILE', '文件内容为空');
	if (file.size > MAX_FILE_SIZE) {
		throw new FileParseError(
			'FILE_TOO_LARGE',
			'单个文件不能超过 10MB',
			413,
		);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const kind = detectDocumentKind(file, bytes);
	const mimeType = file.type ||
		(kind === 'pdf' ? PDF_MIME_TYPE : kind === 'docx' ? DOCX_MIME_TYPE : 'text/plain');

	if (kind === 'pdf') {
		const result = await parsePdfText(bytes, maxLength);
		return { name: file.name, mimeType, size: file.size, ...result };
	}

	if (kind === 'docx') {
		return {
			name: file.name,
			mimeType,
			size: file.size,
			...limitDocument(parseDocxText(bytes), maxLength),
		};
	}

	const normalized = normalizeExtractedText(parsePlainText(bytes));
	if (!normalized) throw new FileParseError('EMPTY_FILE', '文件中没有可读取的文本', 422);
	return {
		name: file.name,
		mimeType,
		size: file.size,
		...limitDocument({
			text: normalized,
			segments: segmentPlainText(normalized, file.name, mimeType),
		}, maxLength),
	};
};
