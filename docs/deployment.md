# Cloudflare Pages 部署

项目使用 Cloudflare Pages 托管前端，并通过 Pages Functions 提供聊天、文件解析、图片理解和会话摘要接口。

## 构建配置

- 构建命令：`pnpm build`
- 输出目录：`dist`
- Node.js：22 或更高版本

`wrangler.toml` 声明 Pages 构建产物目录和百炼 OpenAI 兼容接口地址。

## 服务端配置

在 Cloudflare Pages 的 Variables and Secrets 中配置：

- Secret：`DEEPSEEK_API_KEY`
- Secret：`DASHSCOPE_API_KEY`
- Variable：`DEEPSEEK_BASE_URL=https://api.deepseek.com`
- Variable：`DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`

图片理解使用百炼 `qwen3.6-flash`，无需配置 Cloudflare Workers AI binding。百炼 API Key 必须与 Base URL 所属地域匹配。

所有服务端密钥都不应使用 `VITE_` 或 `PUBLIC_` 前缀。

修改 Variables 或 Secrets 后，需要重新部署项目。
