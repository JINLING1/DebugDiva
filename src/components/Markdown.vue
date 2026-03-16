<template>
  <div class="message-container" :class="{
    'user-message': isUserMessage,
    'ai-message': !isUserMessage,
    isSearch: isSearch,
  }">
    <div class="message-content" @click="handleContentClick" element-loading-text="加载中">
      <div v-html="htmlContent"></div>

      <div v-if="isBigger" class="bigger-overlay" @click="isBigger = false">
        <img :src="enlargedImageUrl" class="bigger-image" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted } from "vue";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import { ElMessage } from "element-plus";
import multiMdTable from "markdown-it-multimd-table";

const props = defineProps({
  message: {
    type: String,
    default: "",
  },
  isUserMessage: Boolean,
  isSearch: {
    type: Boolean,
    default: false,
  },
});

const htmlContent = ref<string>("");

//用于控制放大的状态
const isBigger = ref<boolean>(false);
const enlargedImageUrl = ref<string>("");

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: function (str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        //在解析 Markdown时，直接把高亮的 HTML 标签加上
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch (__) { }
    }
    return '';
  }
}).use(multiMdTable);

//提取原生的 fence 渲染方法
const defaultRender = md.renderer.rules.fence || function (tokens: any, idx: any, options: any, env: any, self: { renderToken: (arg0: any, arg1: any, arg2: any) => any; }) {
  return self.renderToken(tokens, idx, options);
};

//拦截 fence，加上复制按钮
md.renderer.rules.fence = function (tokens: { [x: string]: any; }, idx: string | number, options: any, env: any, self: any) {
  const token = tokens[idx];
  const code = token.content;

  const escapedCode = md.utils.escapeHtml(code);

  const buttonHtml = `
    <div class="copy-icon" data-code="${escapedCode}">
      <svg viewBox="0 0 1024 1024" width="16" height="16">
        <path fill="currentColor" d="M768 832a128 128 0 0 1-128 128H192A128 128 0 0 1 64 832V384a128 128 0 0 1 128-128v64H192v448h448v64h128z"/>
        <path fill="currentColor" d="M384 128a64 64 0 0 0-64 64v656a64 64 0 0 0 64 64h448a64 64 0 0 0 64-64V338.88a64 64 0 0 0-18.88-45.28L657.28 146.88a64 64 0 0 0-45.28-18.88H384zm0-64h227.52a128 128 0 0 1 90.56 37.44l121.44 121.44a128 128 0 0 1 37.44 90.56V848a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V192a128 128 0 0 1 128-128z"/>
      </svg>
    </div>
  `;
  const renderedBlock = defaultRender(tokens, idx, options, env, self);


  return `<div class="code-block-wrapper hljs" style="position: relative;">${buttonHtml}${renderedBlock}</div>`;
};


//统一的事件委托处理函数
const handleContentClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;

  //复制按钮
  const copyBtn = target.closest(".copy-icon");
  if (copyBtn) {
    const code = copyBtn.getAttribute("data-code");
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        ElMessage.success("复制成功");
      }).catch(() => {
        ElMessage.error("复制失败");
      });
    }
    return;
  }

  //图片点击放大
  if (target.tagName === "IMG" && !target.classList.contains("bigger-image")) {
    const imgEl = target as HTMLImageElement;
    enlargedImageUrl.value = imgEl.src; // 使用独立的放大变量
    isBigger.value = true;
  }
};

//渲染markdown消息
const markdownRender = (message: string) => {
  if (!message) {
    htmlContent.value = "";
    return;
  }

  message = message.replace(/\[(.*?)\]\((.*?)\)[。.]/g, "![$1]($2)");
  message = message.replace(/\[(.*?)\]\((.*?)\)/g, "[$1]($2)");
  message = message.replace(/(!\[[^\]]*]\(.*?\))(\S)/g, "$1\n\n$2");

  htmlContent.value = md.render(message);
};

//监听message变化
watch(
  () => props.message,
  (newMessage) => {
    markdownRender(newMessage);
  }
);

onMounted(() => {
  markdownRender(props.message);
});
</script>

<style scoped>
.assistant-message-container p {
  display: inline;
  margin: 0;
  padding: 0;
}

.message-container {
  display: flex;
  margin-bottom: 10px;
  max-width: 100%;
  flex-direction: column;
}

/* 使表格宽度占满 */
:deep(table) {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 14px;
  text-align: center;
}

/* 设置表头和单元格的边框、背景色 */
:deep(th),
:deep(td) {
  border: 1px solid #c5e1a5;
  padding: 10px;
  width: fit-content;
}

:deep(th) {
  background-color: #d7f1b9;
  color: #555;
  font-weight: bold;
}

/* 设置偶数行和奇数行的背景色 */
:deep(.message-content tr:nth-child(odd)) {
  background-color: #ffffff;
}

:deep(.message-content tr:nth-child(even)) {
  background-color: #f1f8e9;
}

/* 用户消息靠右显示 */
.user-message {
  margin-left: auto;
  margin-right: 20px;
  background-color: #e0f7fa;
  border: 1px solid #b2ebf2;
  border-radius: 10px;
  padding: 0 20px;
  max-width: 70%;
  width: fit-content;
  text-align: left;
  word-break: break-word;
}

/* AI消息靠左显示 */
.ai-message {
  margin-right: auto;
  background-color: #f1f8e9;
  border: 1px solid #c5e1a5;
  border-radius: 10px;
  padding: 0 20px 15px 20px;
  max-width: 70%;
  margin: 5px 0;
  width: fit-content;
  text-align: left;
  word-break: break-word;
}

.isSearch {
  max-width: 100%;
  margin: 5px 0;
}

/* 放大图片时的遮罩 */
.bigger-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  z-index: 9999;
}

.bigger-image {
  max-width: 80%;
  max-height: 80%;
  object-fit: contain;
  z-index: 9999;
}

/* 复制按钮样式 */
:deep(.copy-icon) {
  position: absolute;
  top: 8px;
  right: 8px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  background-color: #f3f3f3;
  transition: all 0.2s;
  z-index: 10;
  display: flex;
  align-items: center;
}

:deep(.copy-icon:hover) {
  background-color: rgba(243, 243, 243, 0.95);
}

:deep(.copy-icon) svg {
  width: 16px;
  height: 16px;
  color: #666;
}

:deep(.copy-icon:hover) svg {
  color: #7ec290;
}
</style>