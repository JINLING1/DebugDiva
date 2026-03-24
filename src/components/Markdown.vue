<template>
  <div class="message-container" :class="{
    'user-message': isUserMessage,
    'ai-message': !isUserMessage,
    isSearch: isSearch,
  }">
    <div class="message-content" @click="handleContentClick" element-loading-text="加载中">
      <div v-html="htmlContent"></div>

      <teleport to=".right-container">
        <transition name="fade">
          <div v-if="isBigger" class="bigger-overlay" @click="isBigger = false">
            <div class="blur-background" :style="{ backgroundImage: `url(${enlargedImageUrl})` }"></div>
            <img :src="enlargedImageUrl" class="bigger-image" />
          </div>
        </transition>
      </teleport>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { renderSafeMarkdown, codeCacheMap } from "../utils/markdownHelper.ts";
import "highlight.js/styles/github.css";

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
    const codeId = copyBtn.getAttribute("data-id");
    //从Map中获取代码
    if (codeId && codeCacheMap.has(codeId)) {
      const rawCode = codeCacheMap.get(codeId);
      navigator.clipboard.writeText(rawCode!).then(() => {
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

:deep(.message-content img:not(.bigger-image)) {
  max-width: 100%;
  border-radius: 8px;
  cursor: zoom-in;
  margin: 10px 0;
  display: block;
}

.user-message {
  margin-left: auto;
  margin-right: 0;
  max-width: 85%;
  background-color: #f4f6f8;
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  width: fit-content;
  text-align: left;
  word-break: break-word;
  line-height: 1.5;
}

/* 去除 Markdown 渲染默认的段落外边距，防止撑高气泡 */
.user-message :deep(p) {
  margin: 0;
  padding: 0;
}

.ai-message {
  margin-left: 0;
  margin-right: auto;
  background-color: transparent;
  border-radius: 10px;
  padding: 12px 20px;
  max-width: 100%;
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
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: #000;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: zoom-out;
  z-index: 9999;
  overflow: hidden;
}

.blur-background {
  position: absolute;
  top: -5%;
  left: -5%;
  width: 110%;
  height: 110%;
  background-size: cover;
  background-position: center;
  filter: blur(40px) brightness(0.4);
  z-index: 1;
}

.bigger-image {
  width: 100%;
  height: 100%;
  padding: 40px;
  box-sizing: border-box;
  object-fit: contain;
  z-index: 2;
  filter: drop-shadow(0 10px 40px rgba(0, 0, 0, 0.5));
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

:deep(.hljs) {
  background-color: #cfcfcf2f !important;
  border-radius: 8px;
  padding: 12px;
}

:deep(pre) {
  margin: 10px 0;
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