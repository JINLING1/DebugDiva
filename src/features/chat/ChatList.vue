<template>
  <div class="main-block" ref="scrollContainer">
    <!-- 欢迎消息框（当 chatHistory 为空时显示） -->
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
    <!-- 聊天部分 -->
    <div v-for="(chat, index) in chatHistory" :key="index">
      <!-- ai消息 -->
      <div v-if="!chat.isUser" class="assistant-message-container">
        <!-- 添加头像 -->
        <div class="avatar-container">
          <img src="/vite.svg" alt="Assistant Avatar" class="avatar" />
        </div>
        <Markdown :message="chat.message" :isUserMessage="chat.isUser" />
        <el-button v-if="chat.isComplete" size="small" :data-clipboard-text="chat.message.replace('Assistant: ', '')"
          ref="copyButtonsRef" @click="handleCopySuccess" class="copy-btn">
          <el-icon>
            <CopyDocument />
          </el-icon>
        </el-button>
        <!-- 更新按钮 -->
        <el-button v-if="chat.isComplete" size="small" @click="handleUpdate(index)" class="update-btn">
          <el-icon style="font-size: 16px">
            <Refresh />
          </el-icon>
          <!-- 使用刷新图标 -->
        </el-button>
      </div>
      <Markdown v-else :message="chat.message" :isUserMessage="chat.isUser" />
    </div>
  </div>
</template>

<script setup lang="ts">

import { ref, watch, nextTick, onMounted } from "vue";
import { ElMessage } from "element-plus";
import Markdown from "../../components/Markdown.vue";
import ClipboardJS from "clipboard";
import { CopyDocument, Refresh } from "@element-plus/icons-vue";
import { useChat } from '../../hooks/useChat'

const {
  chatHistory,
  handleUpdate,
} = useChat();

const scrollContainer = ref<HTMLElement | null>(null);

// 处理复制成功提示
const handleCopySuccess = () => {
  ElMessage.success("复制成功");
};

//监听 chatHistory 的变化将界面滚动到底部
watch(
  chatHistory,
  () => {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
      }
    });
  },
  { deep: true } //开启深度监听
);

onMounted(() => {
  new ClipboardJS(".el-button[data-clipboard-text]");
});

</script>

<style>
.main-block {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 10px;
  overflow-y: auto;
  height: 100%;
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
  /* 调整格式所需，记得删除 */
  border: 1px solid #000000;
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
  margin-bottom: 50px;
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
