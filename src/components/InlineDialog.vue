<template>
  <div class="container">
    <!-- 收缩形态过渡 -->
    <transition name="scale-fade" mode="out-in">
      <input
        v-if="!isExpanded"
        key="collapsed"
        type="text"
        placeholder="Search..."
        @click="handleExpand"
        @keyup.enter="handleSubmit"
        class="search-input"
        v-model="newMessage"
      />
    </transition>

    <!-- 展开形态过渡 -->
    <transition name="slide-fade" mode="out-in">
      <div v-if="isExpanded" class="expanded-dialog">
        <div class="conversation-container">
          <div class="conversation">
            <transition-group name="message-list">
              <div
                v-for="(message, index) in messages"
                :key="index"
                :class="messageClass(message)"
              >
                <div v-if="message.isMarkdown" v-html="renderMarkdown(message.text)" />
                <img 
                  v-if="message.isImage" 
                  :src="message.text" 
                  class="response-image"
                  alt="AI生成的图片"
                />
                <template v-else>{{ message.text }}</template>
              </div>
            </transition-group>
          </div>
        </div>

        <div class="input-section">
          <input
            type="text"
            placeholder="输入消息..."
            v-model="newMessage"
            @keyup.enter="sendMessage"
            class="message-input"
          />
          <div class="suggestions">
            <div
              v-for="(item, index) in suggestions"
              :key="index"
              class="suggestion-item"
              @click="selectSuggestion(item)"
            >
              <svg class="suggestion-icon" viewBox="0 0 24 24" width="18" height="18">
                <path :d="iconPaths[index % 4]" />
              </svg>
              {{ item }}
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();

// 图标路径数据（4种不同图标循环）
const iconPaths = [
  'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z', // 星星
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', // 圆圈
  'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z', // 方框
  'M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' // 定位
];

// 响应式状态
const isExpanded = ref(false);
const newMessage = ref('');
const messages = ref([]);
const suggestions = ref([
  'Get Started with Vercel',
  'Vercel API',
  'Vercel CLI',
  'Development Environment Variables',
  'Streaming Data in Edge Functions',
  'Edge Functions Limitations',
  'Project Domains',
  'CLI vercel dev',
  'How to Build a Multi-Tenant App with Custom Domains Using Next.js'
]);

// 消息处理
const handleSubmit = () => {
  if (isExpanded.value) {
    sendMessage();
  } else {
    handleExpand();
  }
};

const handleExpand = () => {
  isExpanded.value = true;
  if (newMessage.value.trim()) {
    sendMessage();
  }
};

const sendMessage = async () => {
  const content = newMessage.value.trim();
  if (!content) return;

  messages.value.push({
    text: content,
    isUser: true,
    isMarkdown: false,
    isImage: false
  });

  newMessage.value = '';

  setTimeout(() => {
    const response = generateResponse();
    messages.value.push(response);
    scrollToBottom();
  }, 800);
};

// 工具函数
const generateResponse = () => {
  const isImage = Math.random() > 0.8;
  return {
    text: isImage ? 
      'https://source.unsplash.com/random/800x400' : 
      `**Markdown示例**：\n这是AI的回复，支持：\n- 列表项\n- **加粗文本**\n- 图片嵌入\n\n${'重复文本 '.repeat(8)}`,
    isUser: false,
    isMarkdown: !isImage,
    isImage
  };
};

const renderMarkdown = (text) => md.render(text);
const messageClass = (msg) => ({
  'message-bubble': true,
  'user-bubble': msg.isUser,
  'ai-bubble': !msg.isUser
});
const selectSuggestion = (text) => {
  newMessage.value = text;
  sendMessage();
};
const scrollToBottom = () => {
  nextTick(() => {
    const container = document.querySelector('.conversation');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });
};
</script>

<style scoped>
.container {
  position: relative;
  max-width: 1200px;
  margin: 2rem auto;
  min-height: 500px;
}

/* 收缩态样式 */
.search-input {
  width: 600px;
  padding: 1rem 1.5rem;
  border: 2px solid #e4e4e7;
  border-radius: 1.5rem;
  font-size: 1.1rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.search-input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

/* 展开态样式 */
.expanded-dialog {
  width: 800px;
  background: white;
  border-radius: 1.5rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  overflow: hidden;
}

.conversation-container {
  background: #f8fafc;
  padding: 1.5rem;
  min-height: 400px;
  max-height: 60vh;
}

.conversation {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
  max-height: 55vh;
  padding-right: 0.5rem;
}

.message-bubble {
  max-width: 85%;
  padding: 1rem 1.5rem;
  border-radius: 1.5rem;
  line-height: 1.6;
}

.user-bubble {
  background: #6366f1;
  color: white;
  align-self: flex-end;
}

.ai-bubble {
  background: white;
  border: 1px solid #e4e4e7;
  align-self: flex-start;
}

.response-image {
  border-radius: 1rem;
  margin-top: 0.5rem;
  max-width: 100%;
  height: auto;
}

.input-section {
  padding: 1.5rem;
  position: relative;
}

.message-input {
  width: 100%;
  padding: 1rem;
  border: 2px solid #e4e4e7;
  border-radius: 1rem;
  font-size: 1rem;
}

.suggestions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.75rem;
  background: #f1f5f9;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.suggestion-icon {
  flex-shrink: 0;
  fill: #64748b;
  transition: fill 0.2s ease;
}

.suggestion-item:hover {
  background: #e2e8f0;
}
.suggestion-item:hover .suggestion-icon {
  fill: #6366f1;
}

/* 过渡动画 */
.scale-fade-enter-active,
.scale-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.scale-fade-enter-from,
.scale-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(0.95);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.message-list-enter-active {
  transition: all 0.3s ease;
}
.message-list-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
</style>