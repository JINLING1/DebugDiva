<template>
  <div class="main-block">
    <div v-if="chatHistory.length === 0" class="welcome-wrapper">
      <div class="welcome-message">
        <div class="avatar-container">
          <img src="/vite.svg" alt="Assistant Avatar" class="avatar" />
        </div>
        <p>
          <strong>我是 DebugDiva！你的智能助手，很高兴见到你！</strong><br />
          <span class="small-text">我可以帮你调试代码，解决问题！</span>
        </p>
      </div>
    </div>

    <DynamicScroller v-else ref="scrollerRef" class="scroller" :items="chatHistory" :min-item-size="80" key-field="id">
      <template #default="{ item: chat, index, active }">
        <DynamicScrollerItem :item="chat" :active="active" :size-dependencies="[chat.message]" :data-index="index">
          <div class="message-row">
            <!-- AI消息 -->
            <div v-if="!chat.isUser" class="assistant-message-container">
              <div class="avatar-container">
                <img src="/vite.svg" alt="Assistant Avatar" class="avatar" />
              </div>

              <Markdown :message="chat.message" :isUserMessage="chat.isUser" />

              <el-button v-if="chat.isComplete" size="small" @click="copyFullMessage(chat.message)" class="copy-btn">
                <el-icon>
                  <CopyDocument />
                </el-icon>
              </el-button>
              <el-button v-if="chat.isComplete && index === chatHistory.length - 1" size="small"
                @click="handleUpdate(index)" class="update-btn">
                <el-icon>
                  <Refresh />
                </el-icon>
              </el-button>
            </div>
            <!-- 用户消息 -->
            <Markdown v-else :message="chat.message" :isUserMessage="chat.isUser" />
          </div>
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>
  </div>
</template>

<script setup lang="ts">

import { ref, watch, nextTick } from "vue";
import { storeToRefs } from 'pinia';
import { ElMessage } from "element-plus";
import { CopyDocument, Refresh } from "@element-plus/icons-vue";
import Markdown from "../../components/Markdown.vue";
import { useChatStore } from '../../store/chat';

const chatStore = useChatStore();
const { chatHistory } = storeToRefs(chatStore);
const { handleUpdate } = chatStore;

const scrollerRef = ref<any>(null);

const copyFullMessage = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success("复制成功");
  } catch (error) {
    ElMessage.error("复制失败");
    console.error("Clipboard error:", error);
  }
};

//监听 chatHistory 的变化将界面滚动到底部
watch(
  () => chatHistory.value,
  () => {
    nextTick(() => {
      setTimeout(() => {
        if (scrollerRef.value) {
          if (typeof scrollerRef.value.scrollToBottom === 'function') {
            scrollerRef.value.scrollToBottom();
          } else if (scrollerRef.value.$el) {
            const el = scrollerRef.value.$el;
            el.scrollTop = el.scrollHeight;
          }
        }
      }, 50);
    });
  },
  { deep: true }
);

</script>

<style>
.main-block {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 0px 0px 40px;
  overflow-y: auto;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
}


.welcome-wrapper {
  display: flex;
  justify-content: center;
  height: 50%;
  width: 100%;
}

/* 欢迎页 */
.welcome-message {
  display: flex;
  align-items: center;
  color: #333;
  padding: 15px;
  border-radius: 8px;
  text-align: left;
  font-size: 30px;
  margin-bottom: 15px;
}

.message-row {
  padding-bottom: 30px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

/* 头像 */
.avatar-container {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  margin: 10px;
}

.avatar {
  width: 30px;
  height: 30px;
}

.small-text {
  font-size: 18px;
  color: var(--el-text-color-secondary);
}

.assistant-message-container {
  display: flex;
  position: relative;
  padding-bottom: 25px;
}

.el-icon {
  font-size: 1rem !important;
}

.copy-btn,
.update-btn {
  position: absolute;
  bottom: 10px;
  padding: 4px;
  background-color: transparent !important;
  border: none !important;
  z-index: 0;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
}

.copy-btn {
  left: 45px;
}

.update-btn {
  left: 60px;
}

.assistant-message-container:hover .copy-btn,
.assistant-message-container:hover .update-btn {
  opacity: 1;
  visibility: visible;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.loading-spinner {
  border: 2px solid #f3f3f3;
  border-top: 2px solid gray;
  border-radius: 50%;
  width: 15px;
  height: 15px;
  animation: spin 1s linear infinite;
  margin-top: 20px;
  margin-bottom: 5px;
}

strong {
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.scroller::-webkit-scrollbar {
  width: 6px;
  display: block;
}

.scroller::-webkit-scrollbar-button {
  display: none !important;
  width: 0;
  height: 0;
}

.scroller::-webkit-scrollbar-track {
  background: transparent;
}

.scroller::-webkit-scrollbar-thumb {
  background: #d2d3d6;
  border-radius: 4px;
}

.scroller::-webkit-scrollbar-thumb:hover {
  background: #a9adb4;
}

@media (max-width: 768px) {
  .welcome-message {
    font-size: 20px;
    padding: 10px;
    flex-direction: column;
    text-align: center;
  }
  
  .small-text {
    font-size: 14px;
  }
  
  .message-row {
    padding-left: 10px;
    padding-right: 10px;
    box-sizing: border-box;
  }
  
  .copy-btn {
    left: 20px;
  }
  
  .update-btn {
    left: 40px;
  }
}
</style>