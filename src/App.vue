```
<template>
  <!--布局容器：common-layout里嵌着aside/header/main/footer
  这一点在class命名有表现-->
  <div class="common-layout">
    <el-container>
      <!--栅格布局-->
      <el-col :xs="0" :sm="6" :md="6" :lg="6"
        ><el-aside class="aside-block">
          <!--自定义表格-->
          <el-table :data="tableData" style="width: 100%; height: 100%">
            <el-table-column label="Work" width="180">
              <template #default="scope">
                <el-popover
                  effect="light"
                  trigger="hover"
                  placement="top"
                  width="auto"
                >
                  <template #default>
                    <div>work: {{ scope.row.work }}</div>
                    <div>time: {{ scope.row.date }}</div>
                  </template>
                  <template #reference>
                    <el-tag>{{
                      scope.row.work.length > 12
                        ? scope.row.work.slice(0, 12) + "..."
                        : scope.row.work
                    }}</el-tag>
                  </template>
                </el-popover>
              </template>
            </el-table-column>
            <el-table-column label="Operations" class="oper-btn">
              <template #default="scope">
                <el-button
                  size="small"
                  @click="handleEdit(scope.$index, scope.row)"
                >
                  Edit
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  @click="handleDelete(scope.$index, scope.row)"
                  id="delete-btn"
                >
                  Delete
                </el-button>
                <!-- 编辑时展示输入框和保存按钮 -->
                <div v-if="isRowEditing(scope.$index)">
                  <el-input
                    v-model="scope.row.work"
                    class="input-block"
                    :autosize="{ minRows: 1, maxRows: 3 }"
                    type="textarea"
                    style="font-size: 12px"
                  />
                  <!-- 在模板中绑定按钮 -->
                  <el-button
                    size="small"
                    type="primary"
                    @click="handleEdit(scope.$index, scope.row)"
                    >Save</el-button
                  >
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-aside></el-col
      >
      <!--以下为网页上除了表格的整个右半部分-->
      <el-col :span="18"
        ><el-container class="right-container">
          <el-header class="header-block">
            <p class="title">Chat with DebugDiva</p>
          </el-header>
          <el-main class="main-block">
            <!-- <div
              v-html="streamedOutput"
              class="streamed-output-container"
            ></div> -->
            <!-- 欢迎消息框（当 chatHistory 为空时显示） -->
            <div v-if="chatHistory.length === 0" class="welcome-message">
              <div class="avatar-container">
                <img src="/vite.svg" alt="Assistant Avatar" class="avatar" />
              </div>
              <p>
                <strong>我是 DebugDiva！我是你的智能助手，很高兴见到你！</strong
                ><br />
                <span class="small-text"
                  >可以帮你调试代码，解决问题，生成图片！</span
                >
              </p>
            </div>
            <div v-for="(chat, index) in chatHistory" :key="index">
              <div v-if="!chat.isUser" class="assistant-message-container">
                <!-- 添加头像 -->
                <div class="avatar-container">
                  <img src="/vite.svg" alt="Assistant Avatar" class="avatar" />
                </div>
                <Markdown
                  :message="chat.message"
                  :isUserMessage="chat.isUser"
                  :isImage="isImageMessage(chat.message)"
                  :fileUrl="extractImageUrl(chat.message)"
                />
                <el-button
                  v-if="chat.isComplete"
                  size="small"
                  :data-clipboard-text="chat.message.replace('Assistant: ', '')"
                  ref="copyButtonsRef"
                  @click="handleCopySuccess"
                  class="copy-btn"
                >
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
                <!-- 更新按钮 -->
                <el-button
                  v-if="chat.isComplete"
                  size="small"
                  @click="handleUpdate(index)"
                  class="update-btn"
                >
                  <el-icon style="font-size: 16px"><Refresh /></el-icon>
                  <!-- 使用刷新图标 -->
                </el-button>
              </div>
              <Markdown
                v-else
                :message="chat.message"
                :isUserMessage="chat.isUser"
              />
            </div>
          </el-main>
          <el-footer class="footer-block">
            <transition name="chat-transition">
              <div class="chat-input-container" :class="dialogState">
                <!-- 浮动文件列表 -->
                <div class="floating-file-list" v-if="fileList.length > 0">
                  <div
                    class="file-item"
                    v-for="(file, index) in fileList"
                    :key="file.uid"
                  >
                    <el-tag>
                      {{
                        file.name.slice(0, 8) +
                        (file.name.length > 8 ? "..." : "")
                      }}
                      <el-icon
                        class="delete-icon"
                        @click.stop="handleFileDelete(index)"
                      >
                        <Close />
                      </el-icon>
                    </el-tag>
                  </div>
                </div>
                <!-- 输入区域 -->
                <div class="input-wrapper">
                  <el-input
                    v-model="input"
                    class="input-block"
                    :autosize="{ minRows: 3, maxRows: 3 }"
                    type="textarea"
                    size="large"
                    placeholder="Ask me everything... (Press Shift+Enter to newline, max 1000 words)"
                    maxlength="1000"
                    show-word-limit
                    @keydown.enter="handleKeySubmit"
                    @click="handleInputClick"
                  >
                  </el-input>
                  <el-button
                    type="primary"
                    :class="['search-btn', buttonClass]"
                    @click="handleButtonClick"
                  >
                    {{ buttonText }}
                  </el-button>

                  <!-- 上传按钮 -->
                  <div class="upload-btn">
                    <el-upload
                      v-model:file-list="fileList"
                      class="upload-demo"
                      action="https://run.mocky.io/v3/9e781058-dc5e-49b9-b782-86c6f5713813"
                      multiple
                      :auto-upload="false"
                      :on-preview="handlePreview"
                      :on-remove="handleRemove"
                      :before-remove="beforeRemove"
                      :limit="3"
                      :on-exceed="handleExceed"
                      @change="handleFileChange"
                      accept=".jpg,.jpeg,.png,.gif,.bmp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar"
                      :show-file-list="false"
                    >
                      <el-popover
                        effect="light"
                        trigger="hover"
                        placement="top"
                      >
                        <template #default>
                          <div>
                            Images < 10MB <br />
                            Files < 200MB
                          </div>
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
                  <div
                    v-for="(question, index) in suggestedQuestions"
                    :key="index"
                    class="suggestion-item"
                    @click="handleSuggestionClick(question)"
                  >
                    {{ question }}
                  </div>
                </div>
              </div>
            </transition>
          </el-footer>
        </el-container>
      </el-col>
    </el-container>
  </div>
</template>


<script lang="ts" setup>
import { ref, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import Markdown from "./components/Markdown.vue";
import type { UploadProps, UploadUserFile } from "element-plus";
import ClipboardJS from "clipboard";
import { CopyDocument, Refresh } from "@element-plus/icons-vue";
// import { CopyDocument, Close } from "@element-plus/icons-vue";
import "highlight.js/styles/default.css"; // 引入默认的高亮样式

// 添加对话框状态类型
type DialogState = "collapsed" | "expanded" | "dialog";

const dialogState = ref<DialogState>("collapsed");
const suggestedQuestions = ref([
  "如何调试JavaScript内存泄漏？",
  "Python异步编程的最佳实践是什么？",
  "如何优化React应用性能？",
]);
const showSuggestions = ref(false);
const isAssistantTyping = ref(false);
// 保存状态到 localStorage
const saveDialogState = () => {
  localStorage.setItem("dialogState", dialogState.value);
};
const isImageMessage = (message: string) => {
  // 检查是否包含 Markdown 格式的 `[点击查看](URL)`
  return /\[.*?\]\((https?:\/\/.*?\.(jpg|jpeg|png|gif|bmp|webp|svg))\)/.test(
    message
  );
};

const extractImageUrl = (message: string) => {
  // 使用正则提取 Markdown 图片 URL
  const match = message.match(/\[.*?\]\((https?:\/\/.*?)\)/);
  return match ? match[1] : "";
};
// 加载保存的状态
onMounted(() => {
  loadDataFromLocalStorage();
  dialogState.value = "collapsed";
  showSuggestions.value = false; // 初始隐藏建议项
});
//

const input = ref("");
const isEditing = ref<number | null>(null); // 当前正在编辑的行的索引
const tableData = ref<User[]>([]);
const chatHistory = ref<
  { message: string; isUser: boolean; isComplete: boolean }[]
>([]);
const imageUrl = ref<string>(""); // 新增响应式变量
interface User {
  date: string;
  work: string;
}

// 处理删除操作
const handleDelete = (index: number, row: User) => {
  if (index >= 0 && index < tableData.value.length) {
    tableData.value.splice(index, 1); // 删除指定行
    saveDataToLocalStorage(); // 删除后保存数据
  } else {
    console.error("Invalid index for delete operation");
  }
};

// 处理复制成功提示
const handleCopySuccess = () => {
  ElMessage.success("复制成功");
};

onMounted(() => {
  new ClipboardJS(".el-button[data-clipboard-text]");
});

// 处理编辑按钮点击事件
const handleEdit = (index: number, row: User) => {
  if (isEditing.value === index) {
    // 如果当前行已经处于编辑状态，保存编辑内容
    row.work = row.work.substring(0, 10); // 限制为最多10个字
    row.date = new Date().toISOString(); // 更新当前时间
    isEditing.value = null; // 退出编辑模式
    saveDataToLocalStorage(); // 保存数据
  } else {
    // 如果当前行没有处于编辑状态，进入编辑模式
    isEditing.value = index;
  }
};

// 保存数据到 localStorage
const saveDataToLocalStorage = () => {
  localStorage.setItem("tableData", JSON.stringify(tableData.value));
};
const streamedOutput = ref("");
const streamedText = ref(""); // 维护全局拼接字符串

let assistantMessageIndex = -1; // 新增变量跟踪当前助手消息索引

// 处理建议项点击
const handleSuggestionClick = (question: string) => {
  input.value = question;
  dialogState.value = "dialog";
  showSuggestions.value = false;
  handleSearch();
};

const handleSearch = async (userInput = "", updateIndex?: number) => {
  if (isAssistantTyping.value) {
    ElMessage.warning("The assistant is outputting, please try again later.");
    return;
  }
  // 在原有代码前添加：
  if (dialogState.value !== "dialog") {
    dialogState.value = "dialog";
    showSuggestions.value = false; // 提交后保持隐藏
    saveDialogState();
  } //
  if (!input.value.trim() && !userInput) {
    ElMessage.error("Input cannot be empty or just spaces!");
    return;
  }
  // 如果传入了 userInput，则更新 input.value
  if (userInput) {
    input.value = userInput;
  }

  // 助手正在输出
  isAssistantTyping.value = true;

  // 如果是更新操作，直接修改现有消息
  if (updateIndex !== undefined) {
    const chat = chatHistory.value[updateIndex];
    chat.message = '<div class="loading-spinner"></div>'; // 显示加载状态
    chat.isComplete = false;
  } else {
    //  用户消息存为对象
    chatHistory.value.push({
      message: `${input.value}`, // 处理换行
      isUser: true,
      isComplete: false,
    });

    //  添加 AI 占位符
    chatHistory.value.push({
      message: '<div class="loading-spinner"></div>',
      isUser: false,
      isComplete: false,
    });
  }

  // 添加输入框点击处理（修改后）
  const handleInputClick = () => {
    if (dialogState.value === "collapsed") {
      dialogState.value = "expanded";
      showSuggestions.value = true; // 点击输入框时显示建议项
      saveDialogState();
    }
  };

  assistantMessageIndex = chatHistory.value.length - 1; // 记录索引
  streamedText.value = "";

  let payload;
  if (fileList.value.length > 0) {
    const fileId = fileList.value[0].url;
    const content = JSON.stringify([
      { type: "image", file_id: fileId },
      { type: "text", text: input.value },
    ]);
    payload = JSON.stringify({
      bot_id: "7478239854187266083",
      user_id: "123456789",
      stream: true,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          content: content,
          content_type: "object_string",
        },
      ],
    });
  } else {
    payload = JSON.stringify({
      bot_id: "7478239854187266083",
      user_id: "123456789",
      stream: true,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          content: input.value,
          content_type: "text",
        },
      ],
    });
  }

  try {
    abortController.value = new AbortController();
    const response = await fetch("https://api.coze.cn/v3/chat", {
      method: "POST",
      headers: {
        Authorization:
          "Bearer pat_O8EAWWUV4usmnwUBW4Lfw4Irsyr9nu0iQpe14gYtv6ruJgbUmF4GMMgeSTMBeOwV",
        "Content-Type": "application/json",
      },
      body: payload,
      signal: abortController.value.signal, // 绑定 AbortSignal
    });
    //记录到历史记录
    tableData.value.push({
      date: new Date().toISOString(),
      work: `User: ${input.value}`,
    });
    saveDataToLocalStorage();
    if (!response.ok) {
      throw new Error("Network response was not ok " + response.statusText);
    }
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let streamedText = "";
      while (true) {
        // 检查是否被暂停
        if (!isAssistantTyping.value) {
          break;
        }
        const { done, value } = await reader.read();
        if (done) {
          if (assistantMessageIndex !== -1) {
            chatHistory.value[assistantMessageIndex].isComplete = true; // 标记为完成
          }
          assistantMessageIndex = -1;
          // 助手输出完成
          isAssistantTyping.value = false;
          // 输出已完成，清空输入框
          input.value = "";
          break;
        }
        const text = decoder.decode(value, { stream: true });
        processStreamedData(text);

        // 将助手返回写到历史记录
        let answerValue;
        try {
          // text 以 "event:conversation.message.completed" 开头
          if (text.startsWith("event:conversation.message.completed")) {
            // 查找 "data:" 的位置
            const dataStartIndex = text.indexOf("data:");
            if (dataStartIndex !== -1) {
              // 提取 JSON 字符串部分
              const jsonString = text.substring(dataStartIndex + 5).trim();
              // 检查字符串中是否包含 "type":"answer"
              if (jsonString.includes('"type":"answer"')) {
                const parsedData = JSON.parse(jsonString);
                if (parsedData.type === "answer" && parsedData.content) {
                  answerValue = parsedData.content;
                }
              }
            }
          }
        } catch (error) {
          console.error("Failed to parse JSON:", error);
        }
        if (answerValue) {
          tableData.value.push({
            date: new Date().toISOString(),
            work: `Assistant: ${answerValue}`,
          });
          saveDataToLocalStorage();
          // 更新当前消息内容
          if (assistantMessageIndex !== -1) {
            chatHistory.value[assistantMessageIndex].message = answerValue;
          }
        }
        // 更新UI
        updateUI();
      }
    }
  } catch (error) {
    // ElMessage.error("Failed to fetch data: " + error.message);
    // 助手输出完成状态（处理错误时）
    isAssistantTyping.value = false;
  }
};

// 处理更新
const handleUpdate = async (index: number) => {
  // 查找最新的用户消息
  const latestUserMessage = chatHistory.value
    .slice()
    .reverse()
    .find((chat) => chat.isUser);

  if (latestUserMessage) {
    // 调用 handleSearch，传入最新的用户消息和需要更新的索引
    await handleSearch(latestUserMessage.message, index);
  } else {
    ElMessage.warning("没有找到用户消息。");
  }
};
// 用于中断 fetch 请求
const abortController = ref<AbortController | null>(null);
// 处理按钮点击
const handleButtonClick = () => {
  if (isAssistantTyping.value) {
    // 如果正在输出，执行暂停逻辑
    pauseSearch();
  } else {
    // 否则执行搜索逻辑
    handleSearch();
  }
};

// 暂停逻辑
const pauseSearch = () => {
  if (abortController.value) {
    abortController.value.abort(); // 中断 fetch 请求
  }
  isAssistantTyping.value = false;
  ElMessage.success("Paused assistant output.");
};

// 计算按钮文本
const buttonText = computed(() => {
  return isAssistantTyping.value ? "Pause" : "Send";
});

// 计算按钮样式
const buttonClass = computed(() => {
  return isAssistantTyping.value ? "light-button" : "";
});
// 处理键盘提交逻辑
const handleKeySubmit = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    // Shift+Enter：允许浏览器默认换行行为（不阻止）
    return;
  } else {
    // 普通 Enter：阻止默认换行并提交内容
    event.preventDefault();
    handleSearch();
  }
};

// 更新UI的函数
const updateUI = () => {
  streamedOutput.value = chatHistory.value.join("");
};

const processStreamedData = (chunk: string) => {
  const lines = chunk.split("\n");

  let isDeltaEvent = false;
  let jsonDataLine = "";

  for (const line of lines) {
    if (line.startsWith("event:conversation.message.delta")) {
      isDeltaEvent = true;
      continue;
    }

    if (isDeltaEvent && line.startsWith("data:")) {
      jsonDataLine = line.replace("data:", "").trim();
      isDeltaEvent = false;
    }

    if (jsonDataLine) {
      try {
        const parsedData = JSON.parse(jsonDataLine);

        if (parsedData.role === "assistant" && parsedData.type === "answer") {
          streamedText.value += parsedData.content;
          // 仅更新最后一条消息，不重复添加
          updateLastAssistantMessage();
        }
      } catch (error) {
        console.warn("JSON Parse Error:", error);
      }
      jsonDataLine = "";
    }
  }
};
const updateLastAssistantMessage = () => {
  if (assistantMessageIndex !== -1) {
    chatHistory.value[assistantMessageIndex] = {
      // message: streamedText.value, //  存纯文本
      message: `${streamedText.value}`,
      isUser: false, // 标记为 AI 消息
      isComplete: false,
    };
    updateUI();
  }
};

const fileList = ref<UploadUserFile[]>([]);

const handleRemove: UploadProps["onRemove"] = (file, uploadFiles) => {
  console.log(file, uploadFiles);
};

// // 定义 beforeUpload 方法
// const beforeUpload: UploadProps["beforeUpload"] = (file) => {
//   const maxSizeKB = 500;
//   const isLt500KB = file.size / 1024 <= maxSizeKB;
//   if (!isLt500KB) {
//     ElMessage.error(`File size must be less than ${maxSizeKB}KB!`);
//     return false;
//   }
//   return true;
// };

const handlePreview: UploadProps["onPreview"] = (uploadFile) => {
  console.log(uploadFile);
};

const handleExceed: UploadProps["onExceed"] = (files, uploadFiles) => {
  ElMessage.warning(
    `The limit is 3, you selected ${files.length} files this time, add up to ${
      files.length + uploadFiles.length
    } totally`
  );
};

// 文件删除
const handleFileDelete = (index: number) => {
  if (index < 0 || index >= fileList.value.length) return;

  ElMessageBox.confirm(
    `Cancel the transfer of ${fileList.value[index].name} ? `,
    "Confirm Deletion",
    { confirmButtonText: " OK ", cancelButtonText: "Cancel" }
  )
    .then(() => {
      fileList.value.splice(index, 1);
      ElMessage.success("Deletion successful");
    })
    .catch(() => {});
};

const handleFileChange = async (
  file: UploadUserFile,
  fileList: UploadUserFile[]
) => {
  let maxSize;
  if (file.raw?.type.startsWith("image/")) {
    maxSize = 10 * 1024 * 1024; // 10MB 图片
  } else {
    maxSize = 200 * 1024 * 1024; // 200MB 其他
  }

  const isLtMaxSize = (file.raw?.size || 0) <= maxSize;
  if (!isLtMaxSize) {
    ElMessage.error(
      `File size must be less than ${maxSize / (1024 * 1024)}MB!`
    );
    fileList.splice(
      fileList.findIndex((f) => f.raw === file.raw),
      1
    );
    return; // 阻止上传
  }

  console.log("Updated file list:", fileList);
  const formData = new FormData();
  formData.append("file", file.raw as File);

  try {
    const response = await fetch("https://api.coze.cn/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization:
          "Bearer pat_O8EAWWUV4usmnwUBW4Lfw4Irsyr9nu0iQpe14gYtv6ruJgbUmF4GMMgeSTMBeOwV",
      },
      body: formData,
    });

    const responseData = await response.json();
    if (response.ok && responseData?.code === 0) {
      console.log("File uploaded successfully:", responseData.data);
      ElMessage.success("File uploaded successfully!");
      // 更新文件 url 到 fileList
      console.log("id:", responseData.data.id);
      // 只更新文件的URL，而不手动push
      // file.url = responseData.data.id;
      const fileId = responseData.data.id;
      imageUrl.value = `https://s.coze.cn/t/${fileId}/`; // 拼接完整图片链接

      file.url = fileId; // 保存原始ID到fileList
      console.log("Updated file list:", fileList[0].url);
    } else {
      throw new Error(responseData?.msg || "Failed to upload file");
    }
  } catch (error) {
    console.error("Error during file upload:", error);
    ElMessage.error("Failed to upload file: " + error.message);
    // 如果上传失败，从fileList中移除该文件
    fileList.splice(
      fileList.findIndex((f) => f.raw === file.raw),
      1
    );
  }
};

const beforeRemove: UploadProps["beforeRemove"] = (uploadFile, uploadFiles) => {
  return ElMessageBox.confirm(
    `Cancel the transfer of ${uploadFile.name} ?`
  ).then(
    () => true,
    () => false
  );
};

// 从 localStorage 加载数据
const loadDataFromLocalStorage = () => {
  const storedData = localStorage.getItem("tableData");
  if (storedData) {
    tableData.value = JSON.parse(storedData);
  }
};

// 在组件挂载时从 localStorage 读取数据
onMounted(() => {
  loadDataFromLocalStorage();
});

// 检查某行是否在编辑状态
const isRowEditing = (index: number) => isEditing.value === index;

const handleInputClick = () => {
  if (dialogState.value === "collapsed") {
    dialogState.value = "expanded";
    showSuggestions.value = true;
    saveDialogState();
  }
};
</script>


<style>
.common-layout {
  height: 90vh;
  display: flex;
  flex-direction: row;
  margin: 0;
  width: 100%;
  min-width: 0;
}
/* 允许栅格列缩放 */
.el-col {
  flex-shrink: 1 !important; /* 允许缩小 */
  flex-grow: 1 !important; /* 允许拉伸 */
  min-width: 0 !important; /* 覆盖 Element Plus 默认最小宽度 */
}
.right-container {
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-left: 100px;
}
.aside-block {
  background-color: red;
  height: 100%;
  /* 内容溢出显示滚动条 */
  overflow: auto;
}
.header-block {
  /* background-color:lightblue; */
  display: flex;
  align-items: flex-start;
  padding: 10px 0;
}
.title {
  /* position: absolute;
  left: 1px;
  top: 5px; */
  font-style: italic;
  font-weight: bold;
  font-size: 30px;
  margin: 0;
}
.main-block {
  flex: 1;
  padding: 10px;
}

.input-wrapper {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 80%;
  margin-left: 150px;
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
  word-break: break-word; /* 长单词自动换行 */
}

.streamed-output-container {
  display: flex;
  flex-direction: column;
}
/*加了以下*/
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

/* 容器定位 */
.el-col.el-col-18 {
  position: relative;
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

/* 就是这段代码让.chat-input-container从footer溢出了！！！ */
/* .chat-input-container.dialog {
  bottom: 10px;
} */

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
.update-btn {
  position: absolute;
  left: 60px;
  bottom: 10px;
  padding: 4px;
  background-color: #f1f8e9 !important;
  border: none !important;
  z-index: 0;
}

/* 调整图标可见性 */
.copy-btn .el-icon {
  color: #606266;
  font-size: 16px;
}
.copy-btn:hover .el-icon {
  color: #92c876; /* 悬停绿色 */
}

.floating-file-list {
  position: absolute;
  bottom: 100%; /* 显示在输入框上方 */
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
  display: inline-flex !important; /* 启用flex布局 */
  align-items: center; /* 垂直居中 */
  height: 32px;
  line-height: normal !important;
  vertical-align: middle !important;
}
.el-tag__content {
  padding: 0px 12px 0px 0px;
}
/* 注意优先级 */
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
  transform: translateY(-50%) scale(1.5);
}

/* 头像 */
.avatar-container {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid #c5e1a5;
  background-color: #fff;
  /* 隐藏超出部分 */
  overflow: hidden;
  /* 头像和文本之间的间距 */
  margin-right: 10px;
}
/* .avatar {
  确保头像图片覆盖整个容器
  object-fit: cover; 
} */

.avatar {
  width: 22px;
  height: 22px;
  /* border-radius: 50%; */
  margin: 4px;
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

.loading-spinner {
  border: 2px solid #f3f3f3; /* Light grey */
  border-top: 2px solid gray;
  border-radius: 50%;
  width: 15px;
  height: 15px;
  animation: spin 1s linear infinite;
  margin-top: 20px; /* 调整上边距 */
  margin-bottom: 5px; /* 调整下边距 */
}

/* 欢迎页 */
.welcome-message {
  display: flex;
  align-items: center;
  background-color: #f0f8ff;
  color: #333;
  padding: 15px;
  border-radius: 8px;
  text-align: left;
  font-size: 16px;
  margin-bottom: 15px;
  border: 1px solid #d0e4ff;
}

strong {
  font-weight: bold;
}

.small-text {
  font-size: 18px; /* 小字 */
  color: #666;
}

.light-button {
  opacity: 0.7; /* 按钮颜色变浅 */
}
</style>
