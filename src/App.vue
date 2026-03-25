<template>
  <!--四部分布局 aside/header/main/footer-->
  <el-container class="main-container">
    <!-- 移动端侧边栏遮罩 -->
    <div v-show="isMobile && isSidebarOpen" class="sidebar-overlay" @click="isSidebarOpen = false"></div>

    <el-aside :class="{ 'is-collapsed': !isSidebarOpen, 'is-mobile': isMobile }">
      <History></History>
    </el-aside>
    <el-container class="right-container">
      <el-header>
        <Nav></Nav>
      </el-header>
      <el-main>
        <ChatList></ChatList>
      </el-main>
      <el-footer>
        <Input></Input>
      </el-footer>
    </el-container>
  </el-container>
</template>


<script lang="ts" setup>
import "highlight.js/styles/default.css"; // 引入默认的高亮样式
import { ref, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import Nav from "./components/Nav.vue";
import History from "./features/history/History.vue";
import ChatList from "./features/chat/ChatList.vue";
import Input from "./features/input/Input.vue";
import { useChatStore } from './store/chat';

const chatStore = useChatStore();
const { isSidebarOpen } = storeToRefs(chatStore);

const isMobile = ref(window.innerWidth <= 768);

const handleResize = () => {
  const currentIsMobile = window.innerWidth <= 768;
  if (currentIsMobile !== isMobile.value) {
    isMobile.value = currentIsMobile;
    isSidebarOpen.value = !currentIsMobile;
  }
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});

</script>


<style>
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.main-container {
  height: 100vh;
  width: 100vw;
  display: flex;
  background-color: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

.right-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.el-aside {
  width: 260px;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background-color: var(--el-bg-color-page);
  overflow: hidden !important;
}

.el-aside.is-mobile {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1001;
  height: 100vh;
}

.sidebar-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  backdrop-filter: blur(2px);
  transition: opacity 0.3s ease;
}

.el-aside.is-collapsed {
  width: 0 !important;
}

.el-header {
  height: 50px;
}

.el-main {
  flex: 1;
  overflow: hidden !important;
  padding: 0px !important;
}
</style>