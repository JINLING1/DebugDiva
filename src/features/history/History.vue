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
          <button type="button" class="action-button" :aria-label="`导出会话 ${session.title}`"
            :title="`导出会话 ${session.title}`" @click.stop="handleExport(session)">
            <el-icon class="action-icon">
              <Download />
            </el-icon>
          </button>
          <el-icon class="action-icon" @click.stop="startEdit(session)">
            <Edit />
          </el-icon>
          <el-icon class="action-icon delete-icon" @click.stop="handleDelete(session.id)">
            <Delete />
          </el-icon>
        </div>
      </div>
    </div>

    <div class="local-data-actions">
      <el-button class="clear-local-data-btn" type="danger" text @click="handleClearAllLocalData">
        清除全部本地数据
      </el-button>
      <span class="local-data-hint">清除前建议逐个导出需要保留的会话</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useChatStore } from '../../store/chat';
import { loadAttachmentResults } from '../../services/storage/attachmentStorage';
import { downloadConversationExport } from '../../services/export/conversationExport';
import { clearAllDebugDivaLocalData } from '../../services/storage/localDataManagement';
import type { ChatSession } from '../../types/chat';


const chatStore = useChatStore();
const { chatSessions, currentSessionId } = storeToRefs(chatStore);
const { startNewChat, switchSession, updateSessionTitle, deleteSession } = chatStore;


const editingId = ref<string | null>(null);
const editTitleText = ref('');
const editInputRef = ref<any>(null);

//进入编辑模式
const startEdit = (session: ChatSession) => {
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

const handleExport = (session: ChatSession) => {
  try {
    const attachmentResult = loadAttachmentResults(localStorage);
    downloadConversationExport(session, attachmentResult.attachments);
    if (attachmentResult.recoveredFromError) {
      ElMessage.warning('会话已导出，但部分本地附件记录无法读取。');
    } else {
      ElMessage.success('会话 JSON 已导出。');
    }
  } catch (error) {
    console.error('Failed to export conversation:', error);
    ElMessage.error('会话导出失败，请稍后重试。');
  }
};

const handleClearAllLocalData = async () => {
  try {
    await ElMessageBox.confirm(
      '这会删除本机保存的全部会话、历史摘要、附件解析结果、模型设置和主题偏好，且无法撤销。建议先导出需要保留的会话。',
      '清除全部本地数据？',
      {
        type: 'warning',
        confirmButtonText: '确认清除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }

  const result = clearAllDebugDivaLocalData(localStorage);
  if (!result.ok) {
    console.error('Failed to clear some local data:', result.failed);
    ElMessage.error(
      `部分本地数据清理失败（${result.failed.length} 项），请检查浏览器存储权限后重试。`,
    );
    return;
  }

  ElMessage.success('全部本地数据已清除，页面即将刷新。');
  window.location.reload();
};
</script>

<style scoped>
.aside-block {
  height: 100%;
  width: 100%;
  background-color: transparent;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color-light);
  overflow: hidden;
  box-sizing: border-box
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
  overflow-x: hidden;
  padding: 0 10px;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 12px 10px;
  margin-bottom: 5px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--el-text-color-primary);
  transition: background-color 0.2s;
}

.session-item:hover {
  background-color: var(--el-fill-color-light);
}

.session-item.active {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
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

.session-item:focus-within .session-actions {
  display: flex;
  gap: 8px;
}

.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
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

.session-list::-webkit-scrollbar {
  width: 4px;
}

.session-list::-webkit-scrollbar-button {
  display: none !important;
}

.session-list::-webkit-scrollbar-track {
  background: transparent;
}

.session-list::-webkit-scrollbar-thumb {
  background: var(--el-border-color-darker);
  border-radius: 4px;
}

.session-list::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-placeholder);
}

.local-data-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 12px 14px;
  border-top: 1px solid var(--el-border-color-light);
}

.clear-local-data-btn {
  width: 100%;
}

.local-data-hint {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
}

@media (hover: none) {
  .session-actions {
    display: flex;
    gap: 8px;
  }
}
</style>
