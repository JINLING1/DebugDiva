<template>
	<ChatWindow
		:messages="chatHistory"
		:streaming="isAssistantTyping"
		:model-mode="modelMode"
		attachments-disabled
		@send="handleSend"
		@stop="pauseChat"
		@copy="copyMessage"
		@retry="regenerateMessage"
		@regenerate="regenerateMessage"
		@model-change="setModelMode"
	/>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { ElMessage } from 'element-plus';
import ChatWindow from '../../components/chat/ChatWindow.vue';
import { getMessageText } from '../../services/context/buildChatContext';
import { useChatStore } from '../../store/chat';
import { useSettingsStore } from '../../store/settings';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { chatHistory, isAssistantTyping } = storeToRefs(chatStore);
const { modelMode } = storeToRefs(settingsStore);
const { handleChat, handleUpdate, loadDataFromLocalStorage, pauseChat } = chatStore;
const { loadSettings, setModelMode } = settingsStore;

const handleSend = (text: string) => {
	void handleChat({ input: text });
};

const copyMessage = async (messageId: string) => {
	const message = chatHistory.value.find(item => item.id === messageId);
	const text = message ? getMessageText(message) : '';
	if (!text) return;

	try {
		await navigator.clipboard.writeText(text);
		ElMessage.success('复制成功');
	} catch (error) {
		console.error('Clipboard error:', error);
		ElMessage.error('复制失败');
	}
};

const regenerateMessage = (messageId: string) => {
	const index = chatHistory.value.findIndex(item => item.id === messageId);
	if (index >= 0) void handleUpdate(index);
};

onMounted(() => {
	loadSettings();
	loadDataFromLocalStorage();
});
</script>
