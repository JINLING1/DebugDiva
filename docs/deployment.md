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
- Secret：`SILICONFLOW_API_KEY`（文档检索向量化；未配置时检索自动退回 BM25）
- Variable：`DEEPSEEK_BASE_URL=https://api.deepseek.com`
- Variable：`DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- Variable（可选）：`RAG_EMBEDDING_PROVIDER=siliconflow`，可改为 `dashscope` 使用百炼 `text-embedding-v4`
- Variable（可选）：`RAG_RERANK_PROVIDER`，默认与 `RAG_EMBEDDING_PROVIDER` 相同；硅基流动使用 `BAAI/bge-reranker-v2-m3`，百炼使用 `qwen3-rerank`（重排序不可用时检索自动退回 RRF 顺序）
- Variable（可选）：`RAG_REWRITE_MODEL`，检索查询改写使用的硅基流动对话模型，默认 `THUDM/GLM-4-9B-0414`（免费）；复用 `SILICONFLOW_API_KEY`，改写失败或超时（2.5 秒）时只用原问题检索
- Variable（可选）：`DASHSCOPE_RERANK_URL`，百炼重排序接口地址，默认 `https://dashscope.aliyuncs.com/compatible-api/v1/reranks`

图片理解使用百炼 `qwen3.6-flash`，无需配置 Cloudflare Workers AI binding。百炼 API Key 必须与 Base URL 所属地域匹配。

所有服务端密钥都不应使用 `VITE_` 或 `PUBLIC_` 前缀。

修改 Variables 或 Secrets 后，需要重新部署项目。
