<template>
  <div class="message-container" :class="{
    'user-message': isUserMessage,
    'ai-message': !isUserMessage,
  }">
    <div class="message-content" @click="handleContentClick">
      <div v-html="htmlContent"></div>

      <!-- 用于图片放大展示 -->
      <teleport to="body">
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

const props = defineProps({
  message: {
    type: String,
    default: "",
  },
  isUserMessage: Boolean,
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
  margin-bottom: 2px;
  max-width: 100%;
  min-width: 0;
  flex-direction: column;
}

/* 使表格宽度占满 */
:deep(table) {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 14px;
  text-align: center;
}

/* 设置表头和单元格的边框、背景色 */
:deep(th),
:deep(td) {
  border: 1px solid var(--dd-border);
  padding: 10px;
  width: fit-content;
}

:deep(th) {
  background-color: var(--dd-surface-muted);
  color: var(--dd-text);
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
  max-width: 100%;
  background-color: var(--dd-surface-muted);
  border: none;
  border-radius: var(--dd-radius-lg);
  padding: 10px 16px;
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
  padding: 6px 0;
  max-width: 100%;
  margin: 5px 0;
  width: fit-content;
  text-align: left;
  word-break: break-word;
}

/* 放大图片时的遮罩 */
.bigger-overlay {
  position: fixed;
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
  background-color: var(--dd-surface-muted) !important;
  border: 1px solid var(--dd-border);
  border-radius: var(--dd-radius-md);
  padding: 14px;
}

:deep(pre) {
  margin: 10px 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

:deep(.message-content) {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

:deep(.message-content > div) {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

:deep(.message-content code) {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

/* 复制按钮样式 */
:deep(.copy-icon) {
  position: absolute;
  top: 8px;
  right: 8px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  background-color: var(--dd-surface);
  transition: all 0.2s;
  z-index: 10;
  display: flex;
  align-items: center;
}

:deep(.copy-icon:hover) {
  background-color: var(--dd-surface-hover);
}

:deep(.copy-icon) svg {
  width: 16px;
  height: 16px;
  color: var(--dd-text-secondary);
}

:deep(.copy-icon:hover) svg {
  color: var(--dd-accent);
}

@media (max-width: 480px) {
  .user-message {
    padding: 9px 13px;
  }

  .ai-message {
    width: 100%;
  }

  :deep(table) {
    font-size: 13px;
  }

  :deep(th),
  :deep(td) {
    padding: 8px;
  }
}
</style>
