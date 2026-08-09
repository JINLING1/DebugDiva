# Cloudflare Pages 部署

项目使用 Cloudflare Pages 托管前端，并通过 Pages Functions 提供聊天、文件解析、图片理解和会话摘要接口。

## 构建配置

- 构建命令：`pnpm build`
- 输出目录：`dist`
- Node.js：22 或更高版本

`wrangler.toml` 声明 Pages 构建产物目录、Workers AI binding 和默认视觉模型。

## 服务端配置

在 Cloudflare Pages 的 Variables and Secrets 中配置：

- Secret：`DEEPSEEK_API_KEY`
- Variable：`DEEPSEEK_BASE_URL=https://api.deepseek.com`

图片理解使用 `wrangler.toml` 中名称为 `AI` 的 Workers AI binding。服务端密钥和绑定信息不应使用 `VITE_` 或 `PUBLIC_` 前缀。

修改 Variables、Secrets 或 binding 后，需要重新部署项目。
