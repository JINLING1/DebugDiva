import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import multiMdTable from 'markdown-it-multimd-table';
import DOMPurify from 'dompurify';

export const codeCacheMap = new Map<string, string>();

//初始化单例
const md = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
	breaks: true,
	highlight: function (str: string, lang: string) {
		if (lang && hljs.getLanguage(lang)) {
			try {
				return hljs.highlight(str, { language: lang, ignoreIllegals: true })
					.value;
			} catch (__) {}
		}
		return '';
	},
}).use(multiMdTable);

//提取原生的 fence 渲染方法
const defaultRender =
	md.renderer.rules.fence ||
	function (
		tokens: any,
		idx: any,
		options: any,
		env: any,
		self: { renderToken: (arg0: any, arg1: any, arg2: any) => any },
	) {
		return self.renderToken(tokens, idx, options);
	};

//拦截 fence，加上复制按钮
md.renderer.rules.fence = function (
	tokens: { [x: string]: any },
	idx: string | number,
	options: any,
	env: any,
	self: any,
) {
	const token = tokens[idx];
	const code = token.content;

	//生成唯一ID存入Map
	const codeId = `code-block-${Math.random().toString(36).substring(2, 11)}`;
	codeCacheMap.set(codeId, code);
	// DOM 中仅保留 data-id
	const buttonHtml = `
    <div class="copy-icon" data-id="${codeId}">
      <svg viewBox="0 0 1024 1024" width="16" height="16">
        <path fill="currentColor" d="M768 832a128 128 0 0 1-128 128H192A128 128 0 0 1 64 832V384a128 128 0 0 1 128-128v64H192v448h448v64h128z"/>
        <path fill="currentColor" d="M384 128a64 64 0 0 0-64 64v656a64 64 0 0 0 64 64h448a64 64 0 0 0 64-64V338.88a64 64 0 0 0-18.88-45.28L657.28 146.88a64 64 0 0 0-45.28-18.88H384zm0-64h227.52a128 128 0 0 1 90.56 37.44l121.44 121.44a128 128 0 0 1 37.44 90.56V848a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V192a128 128 0 0 1 128-128z"/>
      </svg>
    </div>
  `;
	const renderedBlock = defaultRender(tokens, idx, options, env, self);

	return `<div class="code-block-wrapper hljs" style="position: relative;">${buttonHtml}${renderedBlock}</div>`;
};

export const renderSafeMarkdown = (message: string): string => {
	if (!message) return '';

	message = message.replace(/\[(.*?)\]\((.*?)\)[。.]/g, '![$1]($2)');
	message = message.replace(/\[(.*?)\]\((.*?)\)/g, '[$1]($2)');
	message = message.replace(/(!\[[^\]]*]\(.*?\))(\S)/g, '$1\n\n$2');

	const rawHtml = md.render(message);
	//返回经过 DOMPurify 洗除危险脚本后的安全 DOM 字符串
	return DOMPurify.sanitize(rawHtml);
};
