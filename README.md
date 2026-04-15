# DebugDiva - LLM对话组件

## 项目概述

DebugDiva 是一个功能强大的LLM对话组件，基于 Vue 3 和 Coze API 构建，提供流畅的对话体验和多模态。
项目在线体验网址[https://debugdiva.pages.dev/]

## 技术栈

- **前端框架**：Vue 3 + TypeScript
- **构建工具**：Vite
- **状态管理**：Pinia
- **UI 组件库**：Element Plus
- **Markdown 渲染**：MarkdownIt + Highlight.js
- **API 集成**：Coze API
- **样式**：原生 CSS

## 功能特性

- **多模式输入**：支持文本、图片、PDF 等多种格式输入
- **流式响应**：实时展示 AI 回复，提供流畅的对话体验
- **文件上传**：支持多种文件类型上传，包括图片、文档、压缩包等
- **代码高亮**：支持代码块语法高亮，提升代码可读性
- **代码复制**：一键复制代码块内容
- **图片放大**：点击图片可放大查看
- **会话管理**：支持多会话创建、切换和删除
- **本地存储**：聊天记录自动保存到本地存储
- **响应式设计**：适配不同屏幕尺寸

## 项目结构

```
src/
├── api/            # API 调用相关代码
│   └── coze.ts     # Coze API 集成
├── assets/         # 静态资源
│   └── vue.svg     # Vue 图标
├── components/     # 通用组件
│   ├── Markdown.vue # Markdown 渲染组件
│   └── Nav.vue     # 导航组件
├── features/       # 功能模块
│   ├── chat/       # 聊天相关组件
│   │   └── ChatList.vue
│   ├── history/    # 历史记录组件
│   │   └── History.vue
│   └── input/      # 输入相关组件
│       └── Input.vue
├── hooks/          # 自定义钩子
│   └── useFile.ts  # 文件处理钩子
├── store/          # 状态管理
│   └── chat.ts     # 聊天状态管理
├── styles/         # 全局样式
│   └── index.scss  # SCSS 样式文件
├── types/          # 类型定义
│   └── chatType.ts # 聊天相关类型
├── utils/          # 工具函数
│   ├── configHelper.ts # 配置助手
│   └── markdownHelper.ts # Markdown 处理工具
├── App.vue         # 应用入口组件
└── main.ts         # 应用启动文件
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置 API 密钥

在 项目目录下新建`.env` 文件,在其中配置以下内容：

```bash
VITE_COZE_API_KEY=your_api_key
VITE_COZE_BOT_ID=your_bot_id
VITE_COZE_CHAT_URL=https://api.coze.cn/v3/chat
VITE_COZE_FILE_URL=https://api.coze.cn/v1/files/upload
```

其中api key和bot id的获取请在coze官网[https://code.coze.cn/]中进行:
新建你的智能体,并且安装文件上传插件和图片理解插件
智能体id即url中bot/后面的数字
api key请在API&SDK中的个人访问令牌[https://code.coze.cn/playground]中添加获取

### 运行项目

```bash
npm run dev
```

### 构建项目

```bash
npm run build
```

## 核心功能

### 1. 聊天功能

- 支持文本消息发送和接收
- 支持流式响应，实时展示 AI 回复
- 支持多轮对话，上下文保持

### 2. 文件处理

- **图片上传**：支持 JPG、PNG 等格式，最大 10MB
- **文档上传**：支持 PDF、DOCX 等格式，最大 200MB

### 3. Markdown 渲染

- 支持标准 Markdown 语法
- 支持代码块语法高亮
- 支持表格增强
- 支持图片和链接

### 4. 会话管理

- 创建新会话
- 切换历史会话
- 删除会话
- 重命名会话

## 性能优化

- **虚拟滚动**：使用 DynamicScroller 组件实现长列表的高效渲染
- **防抖处理**：优化高频响应式更新，减少 DOM 重绘
- **流式处理**：高效处理 AI 流式响应数据

## 贡献

欢迎提交 Issue 和 Pull Request 来贡献该项目!
