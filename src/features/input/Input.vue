<template>
  <div class="footer-block">
    <transition name="chat-transition">
      <div class="chat-input-container" :class="dialogState">
        <!-- 输入区域 -->
        <div class="input-wrapper">
          <div class="custom-input-container">
            <el-input v-model="input" class="inner-input" :autosize="{ minRows: 1, maxRows: 8 }" type="textarea"
              resize="none" placeholder="Ask me everything... (Press Shift+Enter to newline, max 1000 words)"
              maxlength="1000" @keydown.enter="handleKeySubmit" @click="handleInputClick">
            </el-input>

            <div class="input-action-bar">
              <div class="action-left">
                <el-tooltip content="DeepSeek 文本模式暂不支持附件" placement="top">
                    <el-button text circle class="action-btn" disabled aria-label="附件功能暂不可用">
                      <el-icon :size="20">
                        <Paperclip />
                      </el-icon>
                    </el-button>
                </el-tooltip>
              </div>

              <div class="action-right">
                <span class="word-count">{{ input.length }} / 1000</span>
                <el-button class="send-btn custom-transparent-btn" :class="buttonClass" @click="handleButtonClick"
                  :disabled="!input.trim() && !isAssistantTyping">
                  <el-icon :size="24">
                    <VideoPause v-if="isAssistantTyping" />
                    <Promotion v-else />
                  </el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
        <!-- 建议问题 -->
        <div v-if="showSuggestions" class="suggestions">
          <div v-for="(question, index) in suggestedQuestions" :key="index" class="suggestion-item"
            @click="handleSuggestionClick(question)">
            {{ question }}
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { storeToRefs } from 'pinia';
import { Paperclip, Promotion, VideoPause } from "@element-plus/icons-vue";
import { useChatStore } from '../../store/chat';

const chatStore = useChatStore();
const { isAssistantTyping, chatHistory } = storeToRefs(chatStore);
const { loadDataFromLocalStorage, handleChat, pauseChat } = chatStore;

// 添加对话框状态类型
type DialogState = "collapsed" | "expanded" | "dialog";

const dialogState = ref<DialogState>("collapsed");

const suggestedQuestions = ref([
  "如何调试JavaScript内存泄漏？",
  "Python异步编程的最佳实践是什么？",
  "如何优化React应用性能？",
]);
const showSuggestions = ref(false);
// 保存状态到 localStorage
const saveDialogState = () => {
  localStorage.setItem("dialogState", dialogState.value);
};
//调用搜索前改变dialogState
const beforeChat = () => {
  if (dialogState.value !== 'dialog') {
    dialogState.value = 'dialog';
    showSuggestions.value = false; //隐藏建议
    saveDialogState();
  }
}
// 处理建议项点击
const handleSuggestionClick = (question: string) => {
  input.value = question;
  dialogState.value = 'dialog';
  showSuggestions.value = false;
  handleChat({
    input: question,
  });
  input.value = "";
};
//输入框文本
const input = ref("");

// 计算按钮样式
const buttonClass = computed(() => {
  return isAssistantTyping.value ? "light-button" : "";
});

const handleInputClick = () => {
  if (dialogState.value === "collapsed") {//输入框收缩状态
    dialogState.value = "expanded";//输入框展开（下方呈现建议）
    showSuggestions.value = true;
    saveDialogState();
  }
};

// 处理键盘提交逻辑
const handleKeySubmit = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    // Shift+Enter：允许浏览器默认换行行为（不阻止）
    return;
  } else {
    // 普通 Enter：阻止默认换行并提交内容
    event.preventDefault();
    beforeChat();
    handleChat({
      input: input.value,
    });
    input.value = "";
  }
};

// 处理按钮点击
const handleButtonClick = () => {
  if (isAssistantTyping.value) {
    //如果正在输出，暂停
    pauseChat();
  } else {
    beforeChat();
    //否则发送提问
    handleChat({
      input: input.value,
    });
    input.value = "";
  }
};


watch(
  () => chatHistory.value.length,
  (newLength) => {
    if (newLength > 0) {
      dialogState.value = 'dialog';
      showSuggestions.value = false;
    } else {
      dialogState.value = 'collapsed';
    }
    saveDialogState();
  },
  { immediate: true } //组件一加载就先判断一次
);


onMounted(() => {
  loadDataFromLocalStorage();
  dialogState.value = "collapsed";
  showSuggestions.value = false; // 初始隐藏建议项
});


</script>

<style scoped>
.input-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-bottom: 10px;
}

.custom-input-container {
  width: 100%;
  background-color: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 16px;
  padding: 10px 12px 8px 12px;
  box-shadow: 0 -4px 15px rgba(0, 0, 0, 0.06);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}

.custom-input-container:focus-within {
  border-color: #409eff;
  box-shadow: 0 -4px 18px rgba(64, 158, 255, 0.12);
}

:deep(.inner-input .el-textarea__inner) {
  box-shadow: none !important;
}

:deep(.inner-input .el-textarea__inner) {
  border: none !important;
  box-shadow: none !important;
  background-color: transparent !important;
  padding: 0 4px;
  font-size: 16px;
  resize: none !important;
  /* 取消右下角拉长把手 */

}

:deep(.inner-input .el-textarea__inner:focus) {
  outline: none;
  box-shadow: none !important;
}

:deep(.inner-input .el-textarea__inner::-webkit-scrollbar) {
  width: 6px;
}

:deep(.inner-input .el-textarea__inner::-webkit-scrollbar-thumb) {
  background: #dcdfe6;
  border-radius: 4px;
}

:deep(.inner-input .el-textarea__inner::-webkit-scrollbar-thumb:hover) {
  background: #c0c4cc;
}

/* 内部下方的操作栏 */
.input-action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 5px;
}

.action-left {
  display: flex;
  align-items: center;
}

.action-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-btn {
  color: #606266;
}

.action-btn:hover {
  color: #409eff;
  background-color: transparent !important;
}

.word-count {
  font-size: 12px;
  color: #c0c4cc;
  user-select: none;
}

.send-btn {
  transition: all 0.3s;
}

.custom-transparent-btn {
  background-color: transparent !important;
  border: none !important;
  padding: 0;
  margin-left: 10px;
}

.custom-transparent-btn:not(.is-disabled) {
  color: #409eff !important;
  cursor: pointer;
}

.custom-transparent-btn:not(.is-disabled):hover {
  color: #79bbff !important;
  background-color: transparent !important;
}

.custom-transparent-btn.is-disabled {
  color: #c0c4cc !important;
}

/* 过渡动画 */
.chat-transition-enter-active,
.chat-transition-leave-active {
  transition: all 0.3s ease;
}

.chat-transition-enter-from,
.chat-transition-leave-to {
  opacity: 0;
  transform: translateY(20px);
}


.chat-input-container {
  position: absolute;
  left: 50%;
  margin-top: 10px;
  transform: translateX(-50%);
  width: 80%;
  max-width: 800px;
  transition: all 0.3s ease;
}

@media (max-width: 768px) {
  .chat-input-container {
    width: 95%;
  }
}

/* 不同状态定位 */
.chat-input-container.collapsed {
  top: 50%;
  transform: translate(-50%, -50%);
}

.chat-input-container.expanded {
  top: 40%;
}

.chat-input-container.dialog {
  bottom: 10px;
  bottom: max(10px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
}

/* 建议项样式 */
.suggestions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
  margin-top: 20px;
}

.suggestion-item {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.suggestion-item:hover {
  background: var(--el-fill-color);
  transform: translateY(-2px);
}

.floating-file-list {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  padding: 8px;
  background: var(--el-bg-color);
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 2000;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.el-tag {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  display: inline-flex !important;
  /* 启用flex布局 */
  align-items: center;
  /* 垂直居中 */
  height: 32px;
  line-height: normal !important;
  vertical-align: middle !important;
}

.el-tag__content {
  padding: 0px 12px 0px 0px;
}

.el-tag .delete-icon {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  line-height: 1;
  transition: all 0.2s;
}

.delete-icon:hover {
  color: #f56c6c;
}

/* 动态转圈 */
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.light-button {
  opacity: 0.7;
}
</style>
