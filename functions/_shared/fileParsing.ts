import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { getDocumentProxy } from 'unpdf';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_LENGTH = 40_000;
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

const truncateText = (input: string) => {
	const characters = Array.from(input);
	if (characters.length <= MAX_EXTRACTED_TEXT_LENGTH) {
		return { text: input, truncated: false };
	}
	return {
		text: characters.slice(0, MAX_EXTRACTED_TEXT_LENGTH).join(''),
		truncated: true,
	};
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

const parsePdfText = async (bytes: Uint8Array) => {
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

		let text = '';
		let characterCount = 0;
		let truncated = false;
		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
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
					const remaining = MAX_EXTRACTED_TEXT_LENGTH - characterCount;
					if (characters.length > remaining) {
						text += characters.slice(0, remaining).join('');
						characterCount = MAX_EXTRACTED_TEXT_LENGTH;
						truncated = true;
						break;
					}
					text += itemText;
					characterCount += characters.length;
				}
				if (!truncated && characterCount < MAX_EXTRACTED_TEXT_LENGTH) {
					text += '\n';
					characterCount += 1;
				}
			} finally {
				page.cleanup();
			}
			if (truncated) break;
		}

		text = normalizeExtractedText(text);
		if (!text) {
			throw new FileParseError(
				'PARSE_FAILED',
				'未提取到可用文本，扫描版 PDF 暂不支持 OCR',
				422,
			);
		}
		if (truncated) warnings.push('内容超过 40,000 字符，已截断');

		return { text, pageCount: pdf.numPages, truncated, warnings };
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

	let output = '';
	let textDepth = 0;
	const parser = new SaxesParser({ xmlns: true, position: false });
	parser.on('opentag', tag => {
		switch (tag.local) {
			case 't':
				textDepth += 1;
				break;
			case 'tab':
				output += '\t';
				break;
			case 'br':
			case 'cr':
				output += '\n';
				break;
		}
	});
	parser.on('text', text => {
		if (textDepth > 0) output += text;
	});
	parser.on('closetag', tag => {
		if (tag.local === 't') textDepth = Math.max(0, textDepth - 1);
		if (tag.local === 'p') output += '\n';
		if (tag.local === 'tc') output += '\t';
	});
	parser.on('error', () => {
		throw new FileParseError('PARSE_FAILED', 'DOCX XML 格式无效', 422);
	});
	parser.write(xml).close();
	return normalizeExtractedText(output);
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
	const text = parseWordXml(xml);
	if (!text) throw new FileParseError('EMPTY_FILE', '文档中没有可读取的文本', 422);
	return text;
};

export const parseDocumentFile = async (
	file: File,
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
		const result = await parsePdfText(bytes);
		return { name: file.name, mimeType, size: file.size, ...result };
	}

	const extracted = kind === 'docx' ? parseDocxText(bytes) : parsePlainText(bytes);
	const normalized = normalizeExtractedText(extracted);
	if (!normalized) throw new FileParseError('EMPTY_FILE', '文件中没有可读取的文本', 422);
	const limited = truncateText(normalized);
	return {
		name: file.name,
		mimeType,
		size: file.size,
		text: limited.text,
		truncated: limited.truncated,
		warnings: limited.truncated ? ['内容超过 40,000 字符，已截断'] : [],
	};
};
