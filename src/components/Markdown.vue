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
import { ElMessage } from "element-plus";
import { renderSafeMarkdown } from "../utils/markdownHelper.ts";
import "highlight.js/styles/atom-one-dark.css";

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
const isBigger = ref<boolean>(false);
const enlargedImageUrl = ref<string>("");

//负责处理图片点击放大和复制代码
const handleContentClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;

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

  if (target.tagName === "IMG" && !target.classList.contains("bigger-image")) {
    const imgEl = target as HTMLImageElement;
    enlargedImageUrl.value = imgEl.src;
    isBigger.value = true;
  }
};

//监听 message 变化，进行渲染
watch(
  () => props.message,
  (newMessage) => {
    htmlContent.value = renderSafeMarkdown(newMessage);
  }
);

onMounted(() => {
  htmlContent.value = renderSafeMarkdown(props.message);
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