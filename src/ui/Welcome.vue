<template>
  <div class="header-block">
    <el-button text class="toggle-btn" @click="isSidebarOpen = !isSidebarOpen">
      <el-icon :size="22">
        <Expand v-if="!isSidebarOpen" />
        <Fold v-else />
      </el-icon>
    </el-button>
    <p class="title">Chat with DebugDiva</p>
  </div>
</template>

<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import { Fold, Expand } from '@element-plus/icons-vue';
import { useChatStore } from '../store/chat';

const chatStore = useChatStore();
const { isSidebarOpen } = storeToRefs(chatStore);
</script>

<style scoped>
.header-block {
  display: flex;
  align-items: center;
  height: 100%;
  width: 100%;
  padding: 0 10px;
}

.toggle-btn {
  margin-right: 15px;
  color: #606266;
}

.toggle-btn:hover {
  background-color: #e9e9eb;
}

.title {
  font-style: italic;
  font-weight: bold;
  font-size: 24px;
  margin: 0;
}
</style>