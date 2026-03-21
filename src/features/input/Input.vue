<template>
  <div class="footer-block">
    <transition name="chat-transition">
      <div class="chat-input-container" :class="dialogState">
        <!-- 浮动文件列表 -->
        <div class="floating-file-list" v-if="fileList.length > 0">
          <div class="file-item" v-for="(file, index) in fileList" :key="file.uid">
            <el-tag>
              {{
                file.name.slice(0, 8) +
                (file.name.length > 8 ? "..." : "")
              }}
              <el-icon class="delete-icon" @click.stop="handleFileDelete(index)">
                <Close />
              </el-icon>
            </el-tag>
          </div>
        </div>
        <!-- 输入区域 -->
        <div class="input-wrapper">
          <el-input v-model="input" class="input-block" :autosize="{ minRows: 3, maxRows: 3 }" type="textarea"
            size="large" placeholder="Ask me everything... (Press Shift+Enter to newline, max 1000 words)"
            maxlength="1000" show-word-limit @keydown.enter="handleKeySubmit" @click="handleInputClick">
          </el-input>

          <el-button type="primary" :class="['search-btn', buttonClass]" @click="handleButtonClick">
            {{ buttonText }}
          </el-button>

          <!-- 上传按钮 -->
          <div class="upload-btn">
            <el-upload v-model:file-list="fileList" class="upload-demo"
              action="https://run.mocky.io/v3/9e781058-dc5e-49b9-b782-86c6f5713813" multiple :auto-upload="false"
              :on-preview="handlePreview" :on-remove="handleRemove" :before-remove="beforeRemove" :limit="3"
              :on-exceed="handleExceed" @change="handleFileChange"
              accept=".jpg,.jpeg,.png,.gif,.bmp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar"
              :show-file-list="false">
              <el-popover effect="light" trigger="hover" placement="top">
                <template #default>
                  <div>
                    Images
                    < 10MB <br />
                    Files < 200MB </div>
                </template>
                <template #reference>
                  <el-button type="primary">Upload</el-button>
                </template>
              </el-popover>
            </el-upload>
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
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadProps } from "element-plus";
import { useChatStore } from '../../store/chat';


import { useFile } from '../../hooks/useFile'

const chatStore = useChatStore();
const { isAssistantTyping, chatHistory } = storeToRefs(chatStore);
const { loadDataFromLocalStorage, handleSearch, pauseSearch } = chatStore;

const { fileList, handleFileDelete, handleFileChange } = useFile();

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
const beforeSearch = () => {
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
  handleSearch({
    input: question,
  });
  input.value = "";
};
//输入框文本
const input = ref("");

// 计算按钮文本
const buttonText = computed(() => {
  return isAssistantTyping.value ? "Pause" : "Send";
});

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
    beforeSearch();
    handleSearch({
      input: input.value,
      fileList: fileList.value,
    });
    fileList.value = [];
    input.value = "";
  }
};

// 处理按钮点击
const handleButtonClick = () => {
  if (isAssistantTyping.value) {
    // 如果正在输出，执行暂停逻辑
    pauseSearch();
  } else {
    beforeSearch();
    // 否则执行搜索逻辑
    handleSearch({
      input: input.value,
      fileList: fileList.value,
    });
    fileList.value = [];
    input.value = "";
  }
};


const handlePreview: UploadProps['onPreview'] = uploadFile => {
  console.log(uploadFile);
};

const handleExceed: UploadProps['onExceed'] = (files, uploadFiles) => {
  ElMessage.warning(
    `The limit is 3, you selected ${files.length} files this time, add up to ${files.length + uploadFiles.length
    } totally`,
  );
};

const handleRemove: UploadProps['onRemove'] = (file, uploadFiles) => {
  console.log(file, uploadFiles);
};

//用于二次确认删除文件
const beforeRemove: UploadProps["beforeRemove"] = (uploadFile, uploadFiles) => {
  return ElMessageBox.confirm(
    `Cancel the transfer of ${uploadFile.name} ?`
  ).then(
    () => true,
    () => false
  );
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

<style>
.input-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 80%;
  margin: 0 auto;
  max-width: 800px;
}

.input-block {
  height: 80%;
  font-size: 18px;
  border-radius: 20px;
}

.upload-btn {
  position: absolute;
  left: -125px;
  top: 0px;
  z-index: 1;
}

.search-btn {
  position: relative;
  top: 0px;
  right: -15px;
  z-index: 1;
}

.oper-btn {
  position: relative;
}

#delete-btn {
  position: absolute;
  width: 40%;
}

.user-message,
.assistant-message {
  word-break: break-word;
}

.streamed-output-container {
  display: flex;
  flex-direction: column;
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
  background: #f5f7fa;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.suggestion-item:hover {
  background: #e4e7ed;
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