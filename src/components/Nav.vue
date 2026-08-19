<template>
  <div class="header-block">
    <el-button text class="toggle-btn" @click="isSidebarOpen = !isSidebarOpen">
      <el-icon :size="22">
        <Expand v-if="!isSidebarOpen" />
        <Fold v-else />
      </el-icon>
    </el-button>
    <p class="title">DebugDiva</p>

    <div class="spacer"></div>

    <el-button text class="theme-toggle-btn" @click="toggleDark">
      <el-icon :size="20">
        <Sunny v-if="!isDark" />
        <Moon v-else />
      </el-icon>
    </el-button>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { Fold, Expand, Sunny, Moon } from '@element-plus/icons-vue';
import { useChatStore } from '../store/chat';
import lightHljsTheme from 'highlight.js/styles/github.css?inline';
import darkHljsTheme from 'highlight.js/styles/github-dark.css?inline';

const chatStore = useChatStore();
const { isSidebarOpen } = storeToRefs(chatStore);

const isDark = ref(false);

const updateHljsTheme = (dark: boolean) => {
  let styleEl = document.getElementById('hljs-theme-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'hljs-theme-style';
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = dark ? darkHljsTheme : lightHljsTheme;
};

const toggleDark = () => {
  isDark.value = !isDark.value;
  updateHljsTheme(isDark.value);
  if (isDark.value) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
};

onMounted(() => {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark' || (!storedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true;
    document.documentElement.classList.add('dark');
  } else {
    isDark.value = false;
    document.documentElement.classList.remove('dark');
  }
  updateHljsTheme(isDark.value);
});
</script>

<style scoped>
.header-block {
  display: flex;
  align-items: center;
  height: 100%;
  width: 100%;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.toggle-btn {
  margin: 0;
  color: var(--dd-text-secondary);
}

.theme-toggle-btn {
  margin: 0;
  color: var(--dd-text-secondary);
}

.toggle-btn,
.theme-toggle-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.toggle-btn:hover,
.theme-toggle-btn:hover {
  background-color: var(--dd-surface-hover);
  color: var(--dd-text);
}

.title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--dd-text);
}

@media (max-width: 480px) {
  .header-block {
    gap: 4px;
  }

  .title {
    font-size: 16px;
  }
}
</style>
