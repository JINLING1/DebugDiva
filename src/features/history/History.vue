<template>
  <div class="aside-block">
    <div class="new-chat-wrapper">
      <el-button class="new-chat-btn" type="primary" plain @click="startNewChat">
        <el-icon>
          <Plus />
        </el-icon>
        <span style="margin-left: 5px;">开启新对话</span>
      </el-button>
    </div>

    <div class="session-list">
      <div v-for="session in chatSessions" :key="session.id" class="session-item"
        :class="{ active: currentSessionId === session.id }" @click="switchSession(session.id)">
        <el-icon class="session-icon">
          <ChatDotRound />
        </el-icon>

        <div class="session-title-wrapper">
          <span v-if="editingId !== session.id" class="session-title" :title="session.title">
            {{ session.title }}
          </span>
          <el-input v-else v-model="editTitleText" size="small" @keyup.enter="saveEdit(session.id)"
            @blur="saveEdit(session.id)" @click.stop ref="editInputRef" />
        </div>

        <div class="session-actions" v-if="editingId !== session.id">
          <el-icon class="action-icon" @click.stop="startEdit(session)">
            <Edit />
          </el-icon>
          <el-icon class="action-icon delete-icon" @click.stop="handleDelete(session.id)">
            <Delete />
          </el-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, nextTick } from 'vue';
import { useChat } from '../../hooks/useChat';

const {
  chatSessions,
  currentSessionId,
  startNewChat,
  switchSession,
  deleteSession,
  updateSessionTitle
} = useChat();

const editingId = ref<string | null>(null);
const editTitleText = ref('');
const editInputRef = ref<any>(null);

//进入编辑模式
const startEdit = (session: any) => {
  editingId.value = session.id;
  editTitleText.value = session.title;
  nextTick(() => {
    editInputRef.value?.[0]?.focus();
  });
};

const saveEdit = (id: string) => {
  if (editTitleText.value.trim()) {
    updateSessionTitle(id, editTitleText.value.trim());
  }
  editingId.value = null;
};

const handleDelete = (id: string) => {
  deleteSession(id);
};
</script>

<style scoped>
.aside-block {
  height: 100%;
  width: 100%;
  background-color: #f9f9f9;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e4e7ed;
}

.new-chat-wrapper {
  padding: 15px;
}

.new-chat-btn {
  width: 100%;
  border-radius: 8px;
  justify-content: center;
  font-weight: bold;
  height: 40px;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 12px 10px;
  margin-bottom: 5px;
  border-radius: 8px;
  cursor: pointer;
  color: #333;
  transition: background-color 0.2s;
}

.session-item:hover {
  background-color: #eef2f5;
}

.session-item.active {
  background-color: #e3f2fd;
  color: #1976d2;
  font-weight: 500;
}

.session-icon {
  font-size: 18px;
  margin-right: 10px;
  opacity: 0.7;
}

.session-title-wrapper {
  flex: 1;
  overflow: hidden;
}

.session-title {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}

.session-actions {
  display: none;
  margin-left: 10px;
}

.session-item:hover .session-actions {
  display: flex;
  gap: 8px;
}

.action-icon {
  font-size: 16px;
  color: #909399;
  transition: color 0.2s;
}

.action-icon:hover {
  color: #409eff;
}

.delete-icon:hover {
  color: #f56c6c;
}
</style>