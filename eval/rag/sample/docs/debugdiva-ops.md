# DebugDiva 运维与排错手册

本手册面向部署和维护 DebugDiva 的开发者，内容根据项目 README 与部署说明整理，作为 RAG 评测的示例语料。

## 部署

### 构建配置

DebugDiva 使用 Cloudflare Pages 托管前端，并通过 Pages Functions 提供聊天、文件解析、图片理解和会话摘要接口。构建命令为 pnpm build，输出目录为 dist，要求 Node.js 22 或更高版本，因为 unpdf 当前版本要求 Node.js 22。

### 服务端配置

在 Cloudflare Pages 的 Variables and Secrets 中配置以下内容：DEEPSEEK_API_KEY 与 DASHSCOPE_API_KEY 必须作为 Secret 保存；DEEPSEEK_BASE_URL 与 DASHSCOPE_BASE_URL 作为普通 Variable 保存。百炼 API Key 必须与 Base URL 所属地域匹配，否则会返回鉴权错误。

所有服务端密钥都不应使用 VITE_ 或 PUBLIC_ 前缀。项目的 envPrefix 设置为 PUBLIC_，任何带该前缀的变量都会被打包进浏览器代码。修改 Variables 或 Secrets 后，需要重新部署项目才会生效。

```bash
# 本地开发
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

## 模型模式

浏览器只能提交 fast、deep、quality 三种模式，模型名、thinking 参数和 reasoning effort 都在服务端白名单中映射。快速回答使用 deepseek-v4-flash 且关闭思考；深度思考同样使用 deepseek-v4-flash，但开启思考并把 reasoning effort 设为 high；高质量模式使用 deepseek-v4-pro。提交其他模式会得到 INVALID_MODEL_MODE 错误。

## 错误排查

### 统一错误体

所有接口出错时都返回统一的 JSON 错误体，包含 code、message、requestId 和 retryable 四个字段，并且响应头 X-Request-Id 与错误体中的 requestId 一致。排查线上问题时，先让用户提供界面上显示的 requestId，再到日志中按 requestId 检索。

服务端日志只允许记录 requestId、耗时、状态、模式和 usage，不记录提示词、文件内容、密钥、堆栈或供应商完整错误正文。

### 常见错误码

UPSTREAM_UNAVAILABLE 表示 AI 服务暂时不可用，属于可重试错误。如果尚未输出任何内容，前端会对可重试的 5xx 错误自动重试一次；一旦已经有输出，断流后会保留已生成的部分文本并显示错误。

STREAM_PARSE_FAILED 表示流式响应在收到 [DONE] 之前意外结束。SSE 只有收到 [DONE] 才视为完成，所以网络中断、代理超时都会表现为这个错误。

REQUEST_TOO_LARGE 表示请求体超过限制：聊天请求体不能超过 256KB，摘要请求体不能超过 128KB。

FILE_TOO_LARGE 表示上传的单个文件超过 10MB。

### 超时

聊天与图片理解请求最长 60 秒，摘要请求最长 20 秒，文件解析另有页级截止时间，PDF 解析整体超过 8 秒会提示“PDF 解析超时，请尝试更小的文件”。

## 文档与图片限制

每条消息最多 3 个附件，单文件最大 10MB。文档单文件最多提取 40,000 字符，所有激活附件的文本合计最多 80,000 字符。PDF 最多 50 页，扫描版 PDF 没有专业 OCR；加密文档、XLSX、PPTX、ZIP 和 RAR 都不支持。

图片仅支持 JPEG、PNG 和 WebP，不支持 GIF。图片最大边长 4096 像素，总像素不超过 16,777,216。照片和普通场景的长边超过 2048 像素时，只为视觉请求生成临时缩放副本；文字、代码、界面和 OCR 类问题保留原始分辨率。

## 本地数据

项目使用版本化的 localStorage 键保存会话、设置、附件解析结果和摘要，原始图片 Blob 只保存在名为 debugdiva 的 IndexedDB 数据库的 image-blobs 仓库中。会话约 4MB、附件解析结果约 2MB、摘要约 512KB、设置约 16KB，达到上限后需要先导出再清理。

“清除全部本地数据”只删除 DebugDiva 自己的 localStorage 键并清空图片仓库，不会调用 localStorage.clear()，并且该操作不可撤销。
