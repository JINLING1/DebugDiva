<template>
  <el-container class="app-shell">
    <Transition name="overlay-fade">
      <button
        v-if="isMobile && isSidebarOpen"
        class="sidebar-overlay"
        type="button"
        aria-label="关闭侧栏"
        @click="isSidebarOpen = false"
      ></button>
    </Transition>

    <el-aside
      class="app-sidebar"
      :class="{ 'is-collapsed': !isSidebarOpen, 'is-mobile': isMobile }"
    >
      <History />
    </el-aside>

    <el-container class="app-content">
      <el-header class="app-header">
        <Nav />
      </el-header>
      <el-main class="app-main">
        <ChatView />
      </el-main>
    </el-container>
  </el-container>
</template>

<script lang="ts" setup>
import 'highlight.js/styles/default.css';
import { onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Nav from './components/Nav.vue';
import History from './features/history/History.vue';
import ChatView from './features/chat/ChatView.vue';
import { useChatStore } from './store/chat';

const MOBILE_BREAKPOINT = '(max-width: 768px)';
const chatStore = useChatStore();
const { isSidebarOpen } = storeToRefs(chatStore);
const mobileQuery = window.matchMedia(MOBILE_BREAKPOINT);
const isMobile = ref(mobileQuery.matches);

isSidebarOpen.value = !isMobile.value;

function handleBreakpointChange(event: MediaQueryListEvent) {
  isMobile.value = event.matches;
  isSidebarOpen.value = !event.matches;
}

onMounted(() => {
  mobileQuery.addEventListener('change', handleBreakpointChange);
});

onUnmounted(() => {
  mobileQuery.removeEventListener('change', handleBreakpointChange);
});
</script>

<style scoped>
.app-shell {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--dd-bg);
  color: var(--dd-text);
}

.app-sidebar {
  width: var(--dd-sidebar-width);
  min-width: var(--dd-sidebar-width);
  height: 100%;
  overflow: hidden;
  background: var(--dd-sidebar);
  border-right: 1px solid var(--dd-border);
  transition:
    width 180ms ease,
    min-width 180ms ease,
    transform 220ms ease;
}

.app-sidebar.is-collapsed:not(.is-mobile) {
  width: 0;
  min-width: 0;
  border-right-width: 0;
}

.app-content {
  min-width: 0;
  height: 100%;
  background: var(--dd-bg);
}

.app-header {
  flex: 0 0 var(--dd-header-height);
  height: var(--dd-header-height);
  padding: 0 16px;
  background: var(--dd-bg);
}

.app-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: rgb(0 0 0 / 45%);
  backdrop-filter: blur(1px);
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 180ms ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .app-sidebar.is-mobile {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 1001;
    width: min(86vw, 320px);
    min-width: min(86vw, 320px);
    border-right: 1px solid var(--dd-border);
    box-shadow: var(--dd-shadow);
  }

  .app-sidebar.is-mobile.is-collapsed {
    transform: translateX(-102%);
    pointer-events: none;
  }

  .app-header {
    padding: 0 8px;
  }
}

@media (max-width: 480px) {
  .app-header {
    padding: 0 4px;
  }
}
</style>
