# DebugDiva

DebugDiva 是一个基于 Vue 3、TypeScript、Pinia 和 Element Plus 的流式 AI 对话组件项目，模型服务使用 DeepSeek API。

## 功能

- DeepSeek 流式回复
- 多轮会话上下文
- 创建、切换、重命名和删除本地会话
- Markdown、表格与代码高亮
- 复制和重新生成回答
- 主动停止生成
- 响应式布局

DeepSeek V4 是纯文本模型，因此当前版本暂时禁用了原有的 Coze 文件上传入口。PDF、Office 文档和图片需要通过独立的文本提取、视觉代理或 RAG 服务接入。

## 本地开发

安装依赖：

```bash
pnpm install
```

复制 `.env.example` 为 `.env`，并填写服务端配置：

```env
DEEPSEEK_API_KEY=your_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
VITE_CHAT_API_URL=/api/chat
```

启动项目：

```bash
pnpm dev
```

开发服务器通过 Vite 中间件代理 `/api/chat`。DeepSeek API Key 只由本地 Node 进程读取，不会被 Vue 应用源码引用。为兼容旧的本地 `.env`，开发代理也能读取已有的 `VITE_DEEPSEEK_*` 名称，但建议迁移为上面的无 `VITE_` 配置。

构建：

```bash
pnpm build
```

## Cloudflare Pages 部署

项目包含 `functions/api/chat.ts`，部署到 Cloudflare Pages 后由 Pages Function 将 `/api/chat` 请求转发到 DeepSeek。

在 Pages 项目的 Variables and Secrets 中配置：

- Secret：`DEEPSEEK_API_KEY`
- Variable：`DEEPSEEK_BASE_URL=https://api.deepseek.com`
- Variable：`DEEPSEEK_MODEL=deepseek-v4-flash`

不要创建 `VITE_DEEPSEEK_API_KEY`。所有 `VITE_*` 变量都有可能进入浏览器构建产物，不适合保存密钥。

## 调用流程

```text
Vue / Pinia
  -> POST /api/chat
  -> Vite 本地代理或 Cloudflare Pages Function
  -> DeepSeek /chat/completions
  -> SSE 流式响应
  -> Vue 增量渲染
```

前端每次请求都会把当前会话的有效历史消息转换成 `user` / `assistant` 消息数组。重新生成回答时，只提交目标回答之前的上下文。

## 项目结构

```text
functions/api/chat.ts       # Cloudflare Pages 服务端代理
src/api/chat.ts             # 浏览器请求与 DeepSeek SSE 解析
src/store/chat.ts           # 会话、多轮上下文和生成状态
src/features/chat/          # 消息列表
src/features/history/       # 会话历史
src/features/input/         # 文本输入
src/components/Markdown.vue # Markdown 渲染
```
