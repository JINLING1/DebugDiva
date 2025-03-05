<template>
  <div
    class="message-container"
    :class="{
      'user-message': isUserMessage,
      'ai-message': !isUserMessage,
      isSearch: isSearch,
    }"
  >
    <!-- 使用 v-loading 控制加载状态 -->
    <div
      class="message-content"
      v-loading="isLoading"
      element-loading-text="加载中"
    >
      <el-icon v-show="isLoading"></el-icon>
      <div v-highlight>
        <div v-html="htmlContent"></div>
      </div>

      <!-- 点击图片时切换放大状态 -->
      <img
        v-if="!isBigger && isImage"
        :src="fileUrl"
        @click="bigger"
        :class="{ bigger: isBigger }"
        style="width: 100%; cursor: pointer"
      />
      <!-- 放大的图片，点击时关闭放大效果 -->
      <div v-if="isBigger" class="bigger-overlay" @click="bigger">
        <img :src="fileUrl" class="bigger-image" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import { ElMessage } from "element-plus"; // 引入 ElMessage
import multiMdTable from "markdown-it-multimd-table";
export default {
  name: "MessageComponent",
  props: {
    message: {
      type: String,
      default: "", // 提供默认值
    },
    isUserMessage: Boolean,
    isSearch: {
      type: Boolean,
      default: false,
    },
    isImage: {
      type: Boolean,
      default: false,
    },
    fileUrl: {
      type: String,
      default: "",
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    // 确保在 TypeScript 中正确设置 refs 类型
    const htmlContent = ref<string>("");
    const isImage = ref<boolean>(props.isImage);
    const fileUrl = ref<string>(props.fileUrl);
    const isLoading = ref<boolean>(props.isLoading);
    const isBigger = ref<boolean>(false);
    // 监听 DOM 变化，确保每次 Markdown 解析后新图片能绑定事件
    const observeDOMChanges = () => {
      const observer = new MutationObserver(() => {
        bindImageClickEvents(); // 重新绑定图片点击事件
      });

      observer.observe(document.querySelector(".message-content")!, {
        childList: true,
        subtree: true,
      });
    };
    // 绑定所有图片的点击事件
    const bindImageClickEvents = () => {
      document.querySelectorAll(".message-content img").forEach((img) => {
        const imgEl = img as HTMLImageElement;
        imgEl.style.maxWidth = "100%";
        imgEl.style.height = "auto";
        imgEl.style.cursor = "pointer";

        imgEl.addEventListener("click", () => {
          if (fileUrl.value === imgEl.src && isBigger.value) {
            // **点击当前放大的图片时，直接缩小**
            isBigger.value = false;
          } else {
            // **点击新图片时，更新 `fileUrl` 并放大**
            fileUrl.value = imgEl.src;
            isBigger.value = true;
          }
        });
      });
    };

    // 监听 message 的变化
    watch(
      () => props.message,
      (newMessage) => {
        markdownRender(newMessage);
        // 重新执行复制按钮添加逻辑
        nextTick(() => {
          const codeBlocks = document.querySelectorAll("pre code");
          codeBlocks.forEach((block) => {
            const existingButton =
              block.parentElement?.querySelector(".copy-icon");
            if (existingButton) return;

            // 修改按钮创建逻辑为SVG方式
            const copyButton = document.createElement("div");
            copyButton.innerHTML = `
              <svg viewBox="0 0 1024 1024" width="16" height="16" class="copy-icon">
                <path fill="currentColor" d="M768 832a128 128 0 0 1-128 128H192A128 128 0 0 1 64 832V384a128 128 0 0 1 128-128v64H192v448h448v64h128z"/>
                <path fill="currentColor" d="M384 128a64 64 0 0 0-64 64v656a64 64 0 0 0 64 64h448a64 64 0 0 0 64-64V338.88a64 64 0 0 0-18.88-45.28L657.28 146.88a64 64 0 0 0-45.28-18.88H384zm0-64h227.52a128 128 0 0 1 90.56 37.44l121.44 121.44a128 128 0 0 1 37.44 90.56V848a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V192a128 128 0 0 1 128-128z"/>
              </svg>
            `;
            copyButton.classList.add("copy-icon");

            const blockParent = block.parentElement as HTMLElement;
            if (blockParent) {
              blockParent.style.position = "relative";
              blockParent.appendChild(copyButton);
            }
            // 这段代码与vue里面有重复
            copyButton.addEventListener("click", () => {
              const code = block.textContent;
              if (code) {
                console.log("111111:", code); 
                navigator.clipboard
                  .writeText(code)
                  .then(() => {
                    ElMessage.success("复制成功"); // 使用 ElMessage 输出复制成功提示
                  })
                  .catch((error) => {
                    ElMessage.error("复制失败");
                  });
              }
            });
          });
          bindImageClickEvents(); // 绑定所有图片的点击事件
        });
      }
    );

    // 渲染 markdown 消息
    const markdownRender = (message: string) => {
      // 去掉包含“你可以点击链接查看图片”文字的部分
      message = message.replace("链接", "图片");
      const md = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        breaks: true, // 让 \n 自动转成 <br>
      }).use(multiMdTable);
      //  自动转换 `[点击查看](url)` 为 `![点击查看](url)`
      // 1. 先去掉 `[点击查看](url)` 后面的 . 或 。（如果有的话）
      message = message.replace(/\[(.*?)\]\((.*?)\)[。.]/g, "![$1]($2)");

      // 2. 再确保 `[点击查看](url)` 仍然转换为 `![点击查看](url)`
      message = message.replace(/\[(.*?)\]\((.*?)\)/g, "[$1]($2)");
      message = message.replace(/(!\[[^\]]*]\(.*?\))(\S)/g, "$1\n\n$2");
      htmlContent.value = md.render(message);
    };

    onMounted(() => {
      markdownRender(props.message);

      nextTick(() => {
        // 确保图片元素正确设置样式
        bindImageClickEvents(); // 页面加载时绑定

        // 为代码块添加复制按钮
        const codeBlocks = document.querySelectorAll("pre code");
        codeBlocks.forEach((block) => {
          const existingButton =
            block.parentElement?.querySelector(".copy-icon");
          if (existingButton) return;

          // 修改按钮创建逻辑为SVG方式
          const copyButton = document.createElement("div");
          copyButton.innerHTML = `
            <svg viewBox="0 0 1024 1024" width="16" height="16" class="copy-icon">
              <path fill="currentColor" d="M768 832a128 128 0 0 1-128 128H192A128 128 0 0 1 64 832V384a128 128 0 0 1 128-128v64H192v448h448v64h128z"/>
              <path fill="currentColor" d="M384 128a64 64 0 0 0-64 64v656a64 64 0 0 0 64 64h448a64 64 0 0 0 64-64V338.88a64 64 0 0 0-18.88-45.28L657.28 146.88a64 64 0 0 0-45.28-18.88H384zm0-64h227.52a128 128 0 0 1 90.56 37.44l121.44 121.44a128 128 0 0 1 37.44 90.56V848a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V192a128 128 0 0 1 128-128z"/>
            </svg>
          `;
          copyButton.classList.add("copy-icon");

          const blockParent = block.parentElement as HTMLElement;
          if (blockParent) {
            blockParent.style.position = "relative";
            blockParent.appendChild(copyButton);
          }

          copyButton.addEventListener("click", () => {
            const code = block.textContent;
            if (code) {
              navigator.clipboard
                .writeText(code)
                .then(() => {
                  ElMessage.success("复制成功"); // 使用 ElMessage 输出复制成功提示
                })
                .catch((error) => {
                  ElMessage.error("复制失败");
                });
            }
          });
        });
      });
    });

    // 放大图片
    const bigger = () => {
      isBigger.value = false; // 直接关闭放大模式
    };

    return {
      htmlContent,
      isImage,
      fileUrl,
      isLoading,
      isBigger,
      bigger,
    };
  },

  directives: {
    highlight: {
      updated(el: HTMLElement) {
        // 获取所有的 code 元素
        const blocks = el.querySelectorAll(
          "pre code"
        ) as NodeListOf<HTMLElement>; // 强制转换类型为 HTMLElement 类型

        blocks.forEach((block) => {
          // 对每个 block 进行类型断言
          hljs.highlightElement(block); // 使用 highlight.js 高亮元素
        });
      },
    },
  },
};
</script>

<style scoped>
.assistant-message-container p {
  display: inline; /* 防止 Markdown 解析后自动包裹 `<p>` */
  margin: 0;
  padding: 0;
}
.message-container {
  display: flex;
  margin-bottom: 10px;
  max-width: 100%; /* 控制整体消息宽度 */
  flex-direction: column;
}
/* 使表格宽度占满 */
:deep(table) {
  width: 100%;
  border-collapse: collapse; /* 合并表格边框 */
  table-layout: auto; /* 根据内容自适应列宽 */
  font-size: 14px;
  text-align: center; /* 内容居中对齐 */
}

/* 设置表头和单元格的边框、背景色 */
:deep(th),
:deep(td) {
  border: 1px solid #c5e1a5;
  padding: 10px; /* 单元格内间距 */
  width: fit-content; /* 自适应列宽 */
}

:deep(th) {
  background-color: #d7f1b9; 
  color: #555; /* 字体颜色 */
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
  width: fit-content; /* 关键修改：根据内容自适应宽度 */
  text-align: left; /* 强制内容左对齐 */
  word-break: break-word;
}

/* AI消息靠左显示 */
.ai-message {
  margin-right: auto;
  background-color: #f1f8e9;
  border: 1px solid #c5e1a5;
  border-radius: 10px;
  padding:0 20px 15px 20px;
  max-width: 70%;
  margin: 5px 0;
  width: fit-content; /* 根据内容自适应宽度 */
  text-align: left; /* 强制内容左对齐 */
  word-break: break-word;
}

/* 搜索模式保持原有样式 */
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

:deep(.copy-icon) {
  position: absolute;
  top: 8px;
  right: 8px;
  cursor: pointer;
  padding: 4px;
  border-radius: 10px;
  background-color: #f3f3f3;
  transition: all 0.2s;
  z-index: 0;
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
