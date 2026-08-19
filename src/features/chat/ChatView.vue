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
import { ApiVisionProvider } from '../../providers/vision/ApiVisionProvider';
import { getMessageText } from '../../services/context/buildChatContext';
import { useChatStore } from '../../store/chat';
import { useSettingsStore } from '../../store/settings';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../types/attachment';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const attachmentManager = useAttachments({
	visionProvider: new ApiVisionProvider(),
});
const { records: attachmentRecords, storageError } = attachmentManager;
const {
	chatSessions,
	chatHistory,
	isAssistantTyping,
	activeAttachmentIds,
	canPruneAttachmentResults,
} = storeToRefs(chatStore);
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

const referencedAttachmentIds = computed(() => {
	const ids = new Set(activeAttachmentIds.value);
	for (const message of chatHistory.value) {
		for (const content of message.contents) {
			if (
				content.type === 'file' ||
				content.type === 'image' ||
				content.type === 'citation'
			) {
				ids.add(content.attachmentId);
			}
		}
	}
	for (const session of chatSessions.value) {
		session.activeAttachmentIds.forEach(id => ids.add(id));
		for (const message of session.messages) {
			for (const content of message.contents) {
				if (
					content.type === 'file' ||
					content.type === 'image' ||
					content.type === 'citation'
				) {
					ids.add(content.attachmentId);
				}
			}
		}
	}
	return [...ids].sort();
});

const handleSend = async (text: string) => {
	const selectedIds = [...activeAttachmentIds.value];
	const previousMessageCount = chatHistory.value.length;
	await handleChat({
		input: text,
		attachmentIds: selectedIds,
		attachmentResults: attachmentRecords.value,
		onAccepted: acceptedIds => {
			const accepted = new Set(acceptedIds);
			setActiveAttachmentIds(
				activeAttachmentIds.value.filter(id => !accepted.has(id)),
			);
		},
		prepareAttachments: ({ prompt, attachmentIds, signal }) =>
			attachmentManager.prepareForSend(attachmentIds, prompt, signal),
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
	if (!referencedAttachmentIds.value.includes(attachmentId)) {
		attachmentManager.remove(attachmentId);
	}
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
	if (index >= 0) {
		void handleUpdate(index, attachmentRecords.value, request =>
			attachmentManager.prepareForSend(
				request.attachmentIds,
				request.prompt,
				request.signal,
			),
		);
	}
};

onMounted(() => {
	loadSettings();
	attachmentManager.load();
	void attachmentManager.restoreImagePreviews();
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

watch(
	[referencedAttachmentIds, attachmentRecords, canPruneAttachmentResults],
	([retainedIds, _records, canPrune]) => {
		if (!canPrune) return;
		attachmentManager.retain(retainedIds);
		void attachmentManager.retainStoredImages(retainedIds);
	},
	{ flush: 'post' },
);

onUnmounted(() => attachmentManager.dispose());
</script>
