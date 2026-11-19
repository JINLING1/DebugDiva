import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	FileParseError,
	MAX_EXTRACTED_TEXT_LENGTH,
	MAX_FILE_SIZE,
	parseDocumentFile,
} from './fileParsing';

const DOCX_MIME =
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const createDocx = (documentXml: string) =>
	new File(
		[
			zipSync({
				'[Content_Types].xml': strToU8(
					'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
				),
				'word/document.xml': strToU8(documentXml),
			}),
		],
		'test.docx',
		{ type: DOCX_MIME },
	);

const createPdf = (contentStream: string) => {
	const objects = [
		'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
		'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
		'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
		'4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
		`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
	];

	let pdf = '%PDF-1.4\n';
	const offsets = [0];
	for (const object of objects) {
		offsets.push(pdf.length);
		pdf += object;
	}
	const xrefOffset = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n`;
	pdf += '0000000000 65535 f \n';
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
	return new File([pdf], 'test.pdf', { type: 'application/pdf' });
};

describe('parseDocumentFile', () => {
	it('parses UTF-8 text and strips a BOM', async () => {
		const parsed = await parseDocumentFile(
			new File(['\uFEFF第一行\r\n第二行'], 'notes.md', {
				type: 'text/markdown',
			}),
		);

		expect(parsed.text).toBe('第一行\n第二行');
		expect(parsed.truncated).toBe(false);
		expect(parsed.warnings).toEqual([]);
	});

	it('supports code files with an empty browser MIME type', async () => {
		const parsed = await parseDocumentFile(
			new File(['const answer: number = 42;'], 'answer.ts'),
		);

		expect(parsed.mimeType).toBe('text/plain');
		expect(parsed.text).toContain('answer');

		await expect(
			parseDocumentFile(new File(['puts "hello"'], 'hello.rb')),
		).resolves.toMatchObject({ text: 'puts "hello"' });
	});

	it('truncates extracted text by Unicode character count', async () => {
		const input = '文'.repeat(MAX_EXTRACTED_TEXT_LENGTH + 1);
		const parsed = await parseDocumentFile(
			new File([input], 'long.txt', { type: 'text/plain' }),
		);

		expect(Array.from(parsed.text)).toHaveLength(MAX_EXTRACTED_TEXT_LENGTH);
		expect(parsed.truncated).toBe(true);
		expect(parsed.warnings.join('')).toContain('已截断');
	});

	it('extracts DOCX paragraphs, tabs and line breaks', async () => {
		const file = createDocx(`
			<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
				<w:body>
					<w:p><w:r><w:t>第一段</w:t><w:tab/><w:t>同一段</w:t></w:r></w:p>
					<w:p><w:r><w:t>第二段</w:t><w:br/><w:t>换行</w:t></w:r></w:p>
				</w:body>
			</w:document>
		`);

		const parsed = await parseDocumentFile(file);

		expect(parsed.text).toContain('第一段\t同一段');
		expect(parsed.text).toContain('第二段\n换行');
	});

	it('extracts text and page count from a text PDF', async () => {
		const parsed = await parseDocumentFile(
			createPdf('BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET'),
		);

		expect(parsed.pageCount).toBe(1);
		expect(parsed.text).toContain('Hello PDF');
	});

	it('returns a clear error for a PDF without extractable text', async () => {
		await expect(parseDocumentFile(createPdf(''))).rejects.toMatchObject({
			code: 'PARSE_FAILED',
			message: expect.stringContaining('扫描版 PDF'),
		});
	});

	it('rejects empty, oversized and unsupported files before parsing', async () => {
		await expect(
			parseDocumentFile(new File([], 'empty.txt', { type: 'text/plain' })),
		).rejects.toMatchObject({ code: 'EMPTY_FILE' });

		await expect(
			parseDocumentFile(
				new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'large.txt', {
					type: 'text/plain',
				}),
			),
		).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

		await expect(
			parseDocumentFile(
				new File(['zip'], 'archive.zip', { type: 'application/zip' }),
			),
		).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
	});

	it('uses file signatures to reject disguised and encrypted documents', async () => {
		await expect(
			parseDocumentFile(
				new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' }),
			),
		).rejects.toMatchObject({ code: 'PARSE_FAILED' });

		const oleHeader = new Uint8Array([
			0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
		]);
		await expect(
			parseDocumentFile(new File([oleHeader], 'locked.docx', { type: DOCX_MIME })),
		).rejects.toMatchObject({ code: 'ENCRYPTED_DOCUMENT' });

		await expect(
			parseDocumentFile(
				new File([new Uint8Array([0x61, 0, 0x62])], 'fake.ts'),
			),
		).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });

		await expect(
			parseDocumentFile(
				new File(['%PDF-1.4\n%%EOF'], 'fake.pdf', { type: 'image/png' }),
			),
		).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
	});

	it('exposes stable error metadata', () => {
		const error = new FileParseError('PARSE_FAILED', 'bad file', 422);
		expect(error).toMatchObject({
			name: 'FileParseError',
			code: 'PARSE_FAILED',
			status: 422,
			message: 'bad file',
		});
	});
});

const createMultiPagePdf = (pageTexts: string[]) => {
	const pageCount = pageTexts.length;
	const fontId = 3;
	const objects: string[] = [
		'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
		`2 0 obj\n<< /Type /Pages /Kids [${pageTexts
			.map((_, i) => `${4 + i * 2} 0 R`)
			.join(' ')}] /Count ${pageCount} >>\nendobj\n`,
		`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
	];
	pageTexts.forEach((text, i) => {
		const pageId = 4 + i * 2;
		const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
		objects.push(
			`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageId + 1} 0 R >>\nendobj\n`,
			`${pageId + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
		);
	});

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (const object of objects) {
		offsets.push(pdf.length);
		pdf += object;
	}
	const xrefOffset = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
	return new File([pdf], 'pages.pdf', { type: 'application/pdf' });
};

const segmentTexts = (parsed: { text: string; segments: { start: number; end: number }[] }) =>
	parsed.segments.map(segment => parsed.text.slice(segment.start, segment.end));

describe('parseDocumentFile segments', () => {
	it('emits one segment per non-empty PDF page with its page number', async () => {
		const parsed = await parseDocumentFile(
			createMultiPagePdf(['Alpha page', '', 'Gamma page']),
		);

		expect(parsed.pageCount).toBe(3);
		expect(segmentTexts(parsed)).toEqual(['Alpha page', 'Gamma page']);
		expect(parsed.segments.map(segment => segment.page)).toEqual([1, 3]);
	});

	it('tracks DOCX heading styles and outline levels as a heading path', async () => {
		const parsed = await parseDocumentFile(
			createDocx(`
				<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
					<w:body>
						<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>部署</w:t></w:r></w:p>
						<w:p><w:r><w:t>部署说明</w:t></w:r></w:p>
						<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>环境变量</w:t></w:r></w:p>
						<w:p><w:r><w:t>配置 API Key</w:t></w:r></w:p>
						<w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>回滚</w:t></w:r></w:p>
					</w:body>
				</w:document>
			`),
		);

		expect(parsed.text).toBe('部署\n部署说明\n环境变量\n配置 API Key\n回滚');
		expect(segmentTexts(parsed)).toEqual([
			'部署\n部署说明',
			'环境变量\n配置 API Key',
			'回滚',
		]);
		expect(parsed.segments.map(segment => segment.headingPath)).toEqual([
			['部署'],
			['部署', '环境变量'],
			['部署', '回滚'],
		]);
	});

	it('flattens DOCX table rows into tab-separated lines', async () => {
		const parsed = await parseDocumentFile(
			createDocx(`
				<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
					<w:body>
						<w:tbl>
							<w:tr>
								<w:tc><w:p><w:r><w:t>错误码</w:t></w:r></w:p></w:tc>
								<w:tc><w:p><w:r><w:t>含义</w:t></w:r></w:p></w:tc>
							</w:tr>
							<w:tr>
								<w:tc><w:p><w:r><w:t>E401</w:t></w:r></w:p></w:tc>
								<w:tc><w:p><w:r><w:t>未授权</w:t></w:r></w:p><w:p><w:r><w:t>请重新登录</w:t></w:r></w:p></w:tc>
							</w:tr>
						</w:tbl>
					</w:body>
				</w:document>
			`),
		);

		expect(parsed.text).toBe('错误码\t含义\nE401\t未授权 请重新登录');
	});

	it('segments Markdown by heading and fenced code', async () => {
		const parsed = await parseDocumentFile(
			new File(
				['# 指南\n说明\n\n```js\nconsole.log(1)\n```\n\n## FAQ\n问答'],
				'guide.md',
			),
		);

		expect(parsed.segments.map(segment => segment.kind)).toEqual([
			'prose',
			'code',
			'prose',
		]);
		expect(parsed.segments.at(-1)?.headingPath).toEqual(['指南', 'FAQ']);
	});

	it('marks source files as code and plain text as prose', async () => {
		const code = await parseDocumentFile(new File(['const a = 1;'], 'a.ts'));
		const prose = await parseDocumentFile(
			new File(['普通文本'], 'notes.txt', { type: 'text/plain' }),
		);

		expect(code.segments).toEqual([{ start: 0, end: 12, kind: 'code' }]);
		expect(prose.segments).toEqual([{ start: 0, end: 4, kind: 'prose' }]);
	});

	it('keeps segments inside the truncated text', async () => {
		const parsed = await parseDocumentFile(
			new File(['文'.repeat(MAX_EXTRACTED_TEXT_LENGTH + 10)], 'long.txt', {
				type: 'text/plain',
			}),
		);

		expect(parsed.truncated).toBe(true);
		expect(parsed.segments.at(-1)?.end).toBe(parsed.text.length);
	});
});
