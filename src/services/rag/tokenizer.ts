/**
 * BM25 分词：中英文混合、对报错码和标识符友好。
 *
 * - 中文：连续汉字切成二元组（bigram），单字串保留单字。确定性强，浏览器与 Node 结果一致，
 *   是中文 BM25 的常用做法；不依赖 Intl.Segmenter 的 ICU 版本差异。
 * - 英文与标识符：整体保留（如 err_http_headers_sent、array.prototype.map），
 *   同时按 `_ . - /` 和驼峰拆出子词（如 getElementById → get / element / by / id），
 *   这样“ERR_HTTP_HEADERS_SENT”和“headers sent”都能命中。
 * - 全部转小写；过短的纯英文子词（1 个字符）丢弃。
 */

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
const TOKEN_PATTERN = new RegExp(
	`[${CJK}]+|[A-Za-z0-9_$]+(?:[.\\-/][A-Za-z0-9_$]+)*`,
	'g',
);
const CJK_RUN = new RegExp(`^[${CJK}]+$`);

const splitIdentifier = (word: string): string[] =>
	word
		.split(/[._\-/$]+/)
		.flatMap(part => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
		.map(part => part.toLowerCase())
		.filter(part => part.length > 1);

const cjkBigrams = (run: string): string[] => {
	const chars = Array.from(run);
	if (chars.length === 1) return chars;
	const grams: string[] = [];
	for (let i = 0; i < chars.length - 1; i += 1) grams.push(chars[i] + chars[i + 1]);
	return grams;
};

export const tokenize = (text: string): string[] => {
	const tokens: string[] = [];
	for (const [match] of text.matchAll(TOKEN_PATTERN)) {
		if (CJK_RUN.test(match)) {
			tokens.push(...cjkBigrams(match));
			continue;
		}
		const whole = match.toLowerCase();
		const parts = splitIdentifier(match);
		if (whole.length > 1) tokens.push(whole);
		for (const part of parts) {
			if (part !== whole) tokens.push(part);
		}
	}
	return tokens;
};
