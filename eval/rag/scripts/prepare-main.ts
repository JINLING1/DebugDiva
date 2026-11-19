/**
 * 构建真实评测语料 eval/rag/main/docs/（可重复执行）。
 *
 *   pnpm eval:rag:prepare
 *
 * 来源（详见生成的 eval/rag/main/SOURCES.md）：
 *   1. MDN 中文《JavaScript 错误参考》合并为 Markdown          CC-BY-SA 2.5
 *   2. Node.js doc/api/errors.md 清理后保存为 Markdown         MIT
 *   3. MDN 中文《HTTP 响应状态码》合并后用 Chromium 打印成 PDF  CC-BY-SA 2.5
 *
 * 所有来源固定到具体 commit，结果可复现。原始下载缓存在 eval/rag/main/.cache/（已 gitignore）。
 *
 * 环境变量：
 *   MDN_REF / NODE_REF   指定 commit（默认取 main 分支当前 commit）
 *   BROWSER_PATH         Chromium 内核浏览器路径（默认 Windows 上的 Edge）
 *   GITHUB_TOKEN         可选，避免 GitHub API 匿名限流
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import MarkdownIt from 'markdown-it';
import { getDocumentProxy } from 'unpdf';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const suiteDir = join(root, 'eval/rag/main');
const docsDir = join(suiteDir, 'docs');
const cacheDir = join(suiteDir, '.cache');

const MAX_PDF_PAGES = 50;
/** 按顺序尝试；本机 Edge 无头打印可能被策略禁用，所以优先 Chrome。 */
const DEFAULT_BROWSERS = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
];

const githubHeaders = (): HeadersInit => ({
	Accept: 'application/vnd.github+json',
	'User-Agent': 'rag-eval-corpus-builder',
	...(process.env.GITHUB_TOKEN
		? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
		: {}),
});

const fetchText = async (url: string, headers?: HeadersInit) => {
	for (let attempt = 1; ; attempt += 1) {
		const response = await fetch(url, { headers });
		if (response.ok) return response.text();
		if (attempt >= 3 || response.status < 500) {
			throw new Error(`下载失败 ${response.status}：${url}`);
		}
		await new Promise(done => setTimeout(done, 1000 * attempt));
	}
};

const resolveRef = async (repo: string, override?: string) =>
	override ??
	(
		JSON.parse(
			await fetchText(`https://api.github.com/repos/${repo}/commits/main`, githubHeaders()),
		) as { sha: string }
	).sha;

/** 带磁盘缓存的下载；缓存键包含 commit，换 commit 自动重新下载。 */
const cachedFetch = async (key: string, url: string) => {
	const path = join(cacheDir, key);
	if (existsSync(path)) return readFile(path, 'utf8');
	const text = await fetchText(url);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text, 'utf8');
	return text;
};

const mapLimit = async <T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) => {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await task(items[index]);
			}
		}),
	);
	return results;
};

// ---------------------------------------------------------------------------
// MDN 清洗
// ---------------------------------------------------------------------------

const parseMacroArgs = (raw: string) =>
	[...raw.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,\s][^,]*)/g)]
		.map(match => (match[1] ?? match[2] ?? match[3] ?? '').trim())
		.filter(Boolean);

/** 带显示文本参数的宏：第二个参数是显示文本，否则用第一个参数。 */
const TEXT_MACROS = new Set([
	'jsxref',
	'glossary',
	'httpheader',
	'httpstatus',
	'httpmethod',
	'domxref',
	'cssxref',
	'htmlelement',
	'htmlattrxref',
	'rfc',
	'jsxref2',
	'csp',
	'webextapiref',
]);

const replaceMacros = (text: string) =>
	// 参数里的引号字符串作为整体匹配，例如 jsxref("Array.prototype.map()") 中的括号。
	text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*(?:\(((?:"[^"]*"|'[^']*'|[^)"'])*)\))?\s*\}\}/g,(_, name: string, rawArgs?: string) => {
		const key = name.toLowerCase();
		if (!TEXT_MACROS.has(key) || !rawArgs) return '';
		const args = parseMacroArgs(rawArgs);
		if (key === 'rfc') return `RFC ${args[0]}`;
		if (key === 'httpstatus') return args[1] ?? args[0];
		return args[1] ?? args[0] ?? '';
	});

/** 去掉“规范”“浏览器兼容性”等清洗后为空的小节。 */
const dropEmptySections = (markdown: string) => {
	const lines = markdown.split('\n');
	const output: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const heading = /^(#{2,6})\s/.exec(lines[i]);
		if (heading) {
			let j = i + 1;
			while (j < lines.length && !lines[j].trim()) j += 1;
			const next = /^(#{1,6})\s/.exec(lines[j] ?? '');
			const empty =
				j >= lines.length || (next !== null && next[1].length <= heading[1].length);
			if (empty) {
				i = j - 1;
				continue;
			}
		}
		output.push(lines[i]);
	}
	return output.join('\n');
};

const cleanMdnPage = (source: string) => {
	const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(source);
	const titleLine = frontMatter?.[1].split('\n').find(line => line.startsWith('title:'));
	const title = titleLine
		?.slice('title:'.length)
		.trim()
		.replace(/^(['"])(.*)\1$/, '$2')
		.replace(/''/g, "'");
	let body = frontMatter ? source.slice(frontMatter[0].length) : source;

	body = replaceMacros(body)
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\[([^\]]+)\]\((?:\/[^)]*|#[^)]*)\)/g, '$1') // 站内链接只保留文字
		.replace(/^```(\w+)[^\n]*$/gm, '```$1') // 去掉 example-bad 等标记
		.replace(/^(#{1,5})(\s)/gm, '#$1$2'); // 每页内部标题整体降一级

	return { title: title ?? '未命名', body: dropEmptySections(body).replace(/\n{3,}/g, '\n\n').trim() };
};

const listMdnDir = async (ref: string, path: string) => {
	const entries = JSON.parse(
		await fetchText(
			`https://api.github.com/repos/mdn/translated-content/contents/${path}?ref=${ref}`,
			githubHeaders(),
		),
	) as { name: string; type: string }[];
	return entries.filter(entry => entry.type === 'dir').map(entry => entry.name);
};

const buildMdnBook = async (
	ref: string,
	path: string,
	title: string,
	intro: string,
	sortKey: (pageTitle: string, slug: string) => string,
) => {
	const slugs = await listMdnDir(ref, path);
	const pages = await mapLimit(slugs, 8, async slug => {
		const raw = await cachedFetch(
			`mdn-${ref}/${path}/${slug}.md`,
			`https://raw.githubusercontent.com/mdn/translated-content/${ref}/${path}/${slug}/index.md`,
		);
		return { slug, ...cleanMdnPage(raw) };
	});
	pages.sort((a, b) => sortKey(a.title, a.slug).localeCompare(sortKey(b.title, b.slug), 'en'));

	const markdown = [
		`# ${title}`,
		'',
		intro,
		'',
		...pages.flatMap(page => [`## ${page.title}`, '', page.body, '']),
	].join('\n');
	return { markdown, pageCount: pages.length };
};

// ---------------------------------------------------------------------------
// Node.js errors.md 清洗
// ---------------------------------------------------------------------------

const cleanNodeErrors = (source: string) =>
	source
		.replace(/<!--[\s\S]*?-->\n?/g, '')
		.replace(/<a id="[^"]*"><\/a>\n?/g, '')
		.replace(/^\[[^\]]+\]:\s+\S+.*$/gm, '') // 引用式链接定义
		.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // 引用式链接只保留文字
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\{([A-Z][A-Za-z.]*(?:\[\])?)\}/g, '$1') // {TypeError} 类型标注
		.replace(/\n{3,}/g, '\n\n')
		.trim();

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const PRINT_CSS = `
@page { size: A4; margin: 16mm 14mm; }
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 9.5pt; line-height: 1.45; color: #111; }
h1 { font-size: 18pt; } h2 { font-size: 13pt; margin-top: 1.2em; border-bottom: 1px solid #ccc; }
h3 { font-size: 11pt; } pre, code { font-family: Consolas, monospace; font-size: 8.5pt; }
pre { background: #f4f4f4; padding: 6px; white-space: pre-wrap; }
table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 2px 4px; }
`;

const printPdf = async (markdown: string, title: string, outPath: string) => {
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style></head><body>${new MarkdownIt({ html: false }).render(markdown)}</body></html>`;
	const htmlPath = join(cacheDir, 'print.html');
	await writeFile(htmlPath, html, 'utf8');

	const browser =
		process.env.BROWSER_PATH ?? DEFAULT_BROWSERS.find(path => existsSync(path));
	if (!browser || !existsSync(browser)) {
		throw new Error('找不到 Chromium 内核浏览器，请设置 BROWSER_PATH');
	}
	await rm(outPath, { force: true });
	await promisify(execFile)(browser, [
		'--headless',
		'--disable-gpu',
		'--no-pdf-header-footer',
		`--user-data-dir=${join(cacheDir, 'browser-profile')}`,
		`--print-to-pdf=${outPath}`,
		pathToFileURL(htmlPath).href,
	]);
	if (!existsSync(outPath)) throw new Error('浏览器没有生成 PDF');

	const pdf = await getDocumentProxy(new Uint8Array(await readFile(outPath)));
	const pages = pdf.numPages;
	await pdf.cleanup();
	if (pages > MAX_PDF_PAGES) {
		throw new Error(`PDF 共 ${pages} 页，超过解析上限 ${MAX_PDF_PAGES} 页，请调小字号`);
	}
	return pages;
};

// ---------------------------------------------------------------------------

const main = async () => {
	await mkdir(docsDir, { recursive: true });
	await mkdir(cacheDir, { recursive: true });

	const mdnRef = await resolveRef('mdn/translated-content', process.env.MDN_REF);
	const nodeRef = await resolveRef('nodejs/node', process.env.NODE_REF);
	console.log(`MDN @ ${mdnRef}\nNode.js @ ${nodeRef}`);

	const jsErrors = await buildMdnBook(
		mdnRef,
		'files/zh-cn/web/javascript/reference/errors',
		'JavaScript 错误参考',
		'本文档由 MDN 中文版“JavaScript 错误参考”各页面合并整理而成，用于 RAG 评测。',
		title => title,
	);
	await writeFile(join(docsDir, 'mdn-js-errors.md'), jsErrors.markdown, 'utf8');
	console.log(`mdn-js-errors.md：${jsErrors.pageCount} 页，${jsErrors.markdown.length} 字符`);

	const nodeErrors = cleanNodeErrors(
		await cachedFetch(
			`node-${nodeRef}/errors.md`,
			`https://raw.githubusercontent.com/nodejs/node/${nodeRef}/doc/api/errors.md`,
		),
	);
	await writeFile(join(docsDir, 'node-errors.md'), `${nodeErrors}\n`, 'utf8');
	console.log(`node-errors.md：${nodeErrors.length} 字符`);

	const httpStatus = await buildMdnBook(
		mdnRef,
		'files/zh-cn/web/http/reference/status',
		'HTTP 响应状态码',
		'本文档由 MDN 中文版“HTTP 响应状态码”各页面合并整理而成，用于 RAG 评测。',
		(_, slug) => slug.padStart(3, '0'),
	);
	const pdfPages = await printPdf(
		httpStatus.markdown,
		'HTTP 响应状态码',
		join(docsDir, 'mdn-http-status.pdf'),
	);
	console.log(`mdn-http-status.pdf：${httpStatus.pageCount} 个状态码，${pdfPages} 页`);

	await writeFile(
		join(suiteDir, 'SOURCES.md'),
		[
			'# 评测语料来源与许可',
			'',
			'由 `pnpm eval:rag:prepare` 生成，请勿手工修改 `docs/`。',
			'',
			'| 文件 | 来源 | 版本 | 许可证 |',
			'| --- | --- | --- | --- |',
			`| docs/mdn-js-errors.md | [MDN Web Docs 中文版：JavaScript 错误参考](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Errors)，Mozilla 贡献者 | mdn/translated-content@${mdnRef.slice(0, 12)} | [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)（代码示例 CC0） |`,
			`| docs/node-errors.md | [Node.js 文档：Errors](https://nodejs.org/api/errors.html)，Node.js 贡献者 | nodejs/node@${nodeRef.slice(0, 12)} | [MIT](https://github.com/nodejs/node/blob/main/LICENSE) |`,
			`| docs/mdn-http-status.pdf | [MDN Web Docs 中文版：HTTP 响应状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status)，Mozilla 贡献者 | mdn/translated-content@${mdnRef.slice(0, 12)} | [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)（代码示例 CC0） |`,
			'',
			'## 改动说明',
			'',
			'- MDN 页面：合并为单个文档；去掉 front matter、KumaScript 宏（保留宏的显示文字）、站内链接地址和清洗后为空的小节（如“规范”“浏览器兼容性”）；各页面标题降一级。',
			'- Node.js：去掉 HTML 注释、锚点和链接地址，保留链接文字。',
			'- HTTP 状态码 PDF 由合并后的 Markdown 经 Chromium 打印生成，版式比真实出版物规整，评测结果可能偏乐观。',
			'',
			'依据 CC-BY-SA 2.5，基于 MDN 内容的衍生文件以相同许可证发布。',
			'',
		].join('\n'),
		'utf8',
	);
	console.log('完成，来源记录见 eval/rag/main/SOURCES.md');
};

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
