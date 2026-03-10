<template>
  <!--四部分布局 aside/header/main/footer-->
  <el-container class="main-container">
    <el-aside>
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
import Welcome from "./UI/Welcome.vue";
import History from "./features/History/History.vue";
import ChatList from "./features/chat/ChatList.vue";
import Input from "./features/input/Input.vue";
</script>


<style>
.main-container {
  height: 100vh;
  width: 100vw;
  display: flex;
  overflow: hidden;
}

.right-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.el-aside {
  width: 300px;
}

.el-header {
  height: 50px;
}

.el-main {
  flex: 1;
  overflow-y: hidden;
  padding: 0;
}
</style>