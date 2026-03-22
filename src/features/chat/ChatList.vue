<template>
  <div class="main-block">
    <div v-if="chatHistory.length === 0" class="welcome-wrapper">
      <div class="welcome-message">
        <div class="avatar-container">
          <img src="/vite.svg" alt="Assistant Avatar" class="avatar" />
        </div>
        <p>
          <strong>我是 DebugDiva！我是你的智能助手，很高兴见到你！</strong><br />
          <span class="small-text">可以帮你调试代码，解决问题，生成图片！</span>
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
                <el-icon style="font-size: 16px">
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
      if (scrollerRef.value && scrollerRef.value.$el) {
        //获取虚拟列表底层的DOM元素进行滚动
        const el = scrollerRef.value.$el;
        el.scrollTop = el.scrollHeight;
      }
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
  padding: 10px;
  overflow-y: auto;
  height: 100%;
  width: 100%;
}


.welcome-wrapper {
  display: flex;
  justify-content: center;
  height: 50%;
  width: 80%;
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
  border: 1px solid #000000;
}

.message-row {
  padding-bottom: 30px;
}

/* 头像 */
.avatar-container {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid #c5e1a5;
  background-color: #fff;
  overflow: hidden;
  /* 头像和文本之间的间距 */
  margin-right: 10px;
  flex-shrink: 0;
}

.avatar {
  width: 22px;
  height: 22px;
  margin: 4px;
}

.small-text {
  font-size: 18px;
  color: #666;
}

.assistant-message-container {
  display: flex;
  position: relative;
}

.copy-btn {
  position: absolute;
  left: 45px;
  bottom: 10px;
  padding: 4px;
  background-color: #f1f8e9 !important;
  border: none !important;
  z-index: 0;
}

.copy-btn .el-icon {
  color: #606266;
  font-size: 16px;
}

.copy-btn:hover .el-icon {
  color: #92c876;
}

.update-btn {
  position: absolute;
  left: 60px;
  bottom: 10px;
  padding: 4px;
  background-color: #f1f8e9 !important;
  border: none !important;
  z-index: 0;
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
}
</style>