<template>
	<ChatWindow
		:messages="chatHistory"
		:streaming="isAssistantTyping"
		:model-mode="modelMode"
		:attachments="activeAttachments"
		:attachment-results="attachmentRecords"
		:attachments-disabled="false"
		@send="handleSend"
		@stop="pauseChat"
		@copy="copyMessage"
		@retry="regenerateMessage"
		@regenerate="regenerateMessage"
		@select-files="handleSelectFiles"
		@retry-attachment="handleRetryAttachment"
		@cancel-attachment="handleCancelAttachment"
		@remove-attachment="handleRemoveAttachment"
		@model-change="setModelMode"
	/>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { ElMessage } from 'element-plus';
import ChatWindow from '../../components/chat/ChatWindow.vue';
import { useAttachments } from '../../composables/useAttachments';
import { WorkersAIVisionProvider } from '../../providers/vision/WorkersAIVisionProvider';
import { getMessageText } from '../../services/context/buildChatContext';
import { useChatStore } from '../../store/chat';
import { useSettingsStore } from '../../store/settings';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../types/attachment';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const attachmentManager = useAttachments({
	visionProvider: new WorkersAIVisionProvider(),
});
const { records: attachmentRecords, storageError } = attachmentManager;
const { chatHistory, isAssistantTyping, activeAttachmentIds } =
	storeToRefs(chatStore);
const { modelMode } = storeToRefs(settingsStore);
const {
	handleChat,
	handleUpdate,
	loadDataFromLocalStorage,
	pauseChat,
	reconcileActiveAttachmentIds,
	setActiveAttachmentIds,
} = chatStore;
const { loadSettings, setModelMode } = settingsStore;

const activeAttachments = computed(() => {
	const byId = new Map(
		attachmentRecords.value.map(attachment => [attachment.id, attachment]),
	);
	return activeAttachmentIds.value
		.map(id => byId.get(id))
		.filter((attachment): attachment is NonNullable<typeof attachment> =>
			Boolean(attachment),
		);
});

const handleSend = async (text: string) => {
	const selectedIds = [...activeAttachmentIds.value];
	const previousMessageCount = chatHistory.value.length;
	await handleChat({
		input: text,
		attachmentIds: selectedIds,
		attachmentResults: attachmentRecords.value,
	});
	if (chatHistory.value.length > previousMessageCount) {
		attachmentManager.releaseOriginalFiles(selectedIds);
	}
};

const handleSelectFiles = (files: File[]) => {
	const availableSlots =
		MAX_ATTACHMENTS_PER_MESSAGE - activeAttachmentIds.value.length;
	if (availableSlots <= 0) {
		ElMessage.warning(`每条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`);
		return;
	}

	const accepted = files.slice(0, availableSlots);
	if (accepted.length < files.length) {
		ElMessage.warning(
			`每条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件，已添加前 ${accepted.length} 个。`,
		);
	}
	const ids = attachmentManager.queueFiles(accepted);
	setActiveAttachmentIds([...activeAttachmentIds.value, ...ids]);
};

const handleRetryAttachment = (attachmentId: string) => {
	if (!attachmentManager.retry(attachmentId)) {
		ElMessage.error('原始文件已不可用，请移除后重新选择。');
	}
};

const handleCancelAttachment = (attachmentId: string) => {
	attachmentManager.cancel(attachmentId);
};

const handleRemoveAttachment = (attachmentId: string) => {
	setActiveAttachmentIds(
		activeAttachmentIds.value.filter(id => id !== attachmentId),
	);
	const referencedByHistory = chatHistory.value.some(message =>
		message.contents.some(
			content =>
				(content.type === 'file' || content.type === 'image') &&
				content.attachmentId === attachmentId,
		),
	);
	if (!referencedByHistory) attachmentManager.remove(attachmentId);
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
	if (index >= 0) void handleUpdate(index, attachmentRecords.value);
};

onMounted(() => {
	loadSettings();
	attachmentManager.load();
	loadDataFromLocalStorage();
});

let lastStorageError = '';
watch(storageError, error => {
	if (!error) {
		lastStorageError = '';
		return;
	}
	const fingerprint = `${error.code}:${error.message}`;
	if (fingerprint === lastStorageError) return;
	lastStorageError = fingerprint;
	ElMessage.error(error.message);
});

watch(
	[activeAttachmentIds, attachmentRecords],
	([ids, records]) => {
		if (!ids.length) return;
		const missingIds = reconcileActiveAttachmentIds(
			records.map(record => record.id),
		);
		if (missingIds.length) {
			ElMessage.warning(
				`已停用 ${missingIds.length} 个解析结果缺失的附件，请重新选择文件。`,
			);
		}
	},
	{ flush: 'post' },
);

onUnmounted(() => attachmentManager.dispose());
</script>
