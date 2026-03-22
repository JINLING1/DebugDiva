<template>
  <!--四部分布局 aside/header/main/footer-->
  <el-container class="main-container">
    <el-aside :class="{ 'is-collapsed': !isSidebarOpen }">
      <History></History>
    </el-aside>
    <el-container class="right-container">
      <el-header>
        <Welcome></Welcome>
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
import { storeToRefs } from 'pinia';
import Welcome from "./UI/Welcome.vue";
import History from "./features/history/History.vue";
import ChatList from "./features/chat/ChatList.vue";
import Input from "./features/input/Input.vue";
import { useChatStore } from './store/chat';

const chatStore = useChatStore();
const { isSidebarOpen } = storeToRefs(chatStore);

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
  background-color: #f9f9f9;
}

.right-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.el-aside {
  width: 260px;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background-color: #f3f4f6;
  overflow: hidden !important;
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