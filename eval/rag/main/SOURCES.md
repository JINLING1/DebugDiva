# 评测语料来源与许可

由 `pnpm eval:rag:prepare` 生成，请勿手工修改 `docs/`。

| 文件 | 来源 | 版本 | 许可证 |
| --- | --- | --- | --- |
| docs/mdn-js-errors.md | [MDN Web Docs 中文版：JavaScript 错误参考](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Errors)，Mozilla 贡献者 | mdn/translated-content@39967e9dca46 | [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)（代码示例 CC0） |
| docs/node-errors.md | [Node.js 文档：Errors](https://nodejs.org/api/errors.html)，Node.js 贡献者 | nodejs/node@371ac095ac20 | [MIT](https://github.com/nodejs/node/blob/main/LICENSE) |
| docs/mdn-http-status.pdf | [MDN Web Docs 中文版：HTTP 响应状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status)，Mozilla 贡献者 | mdn/translated-content@39967e9dca46 | [CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)（代码示例 CC0） |

## 改动说明

- MDN 页面：合并为单个文档；去掉 front matter、KumaScript 宏（保留宏的显示文字）、站内链接地址和清洗后为空的小节（如“规范”“浏览器兼容性”）；各页面标题降一级。
- Node.js：去掉 HTML 注释、锚点和链接地址，保留链接文字。
- HTTP 状态码 PDF 由合并后的 Markdown 经 Chromium 打印生成，版式比真实出版物规整，评测结果可能偏乐观。

依据 CC-BY-SA 2.5，基于 MDN 内容的衍生文件以相同许可证发布。
