<template>
	<section
		class="chat-window"
		:class="{ 'empty-composer-expanded': emptyComposerExpanded }"
		aria-label="DebugDiva 对话窗口"
	>
		<MessageList
			:messages="messages"
			:attachment-results="attachmentResults"
			:composer-expanded="emptyComposerExpanded"
			@copy="emit('copy', $event)"
			@retry="emit('retry', $event)"
			@regenerate="emit('regenerate', $event)"
		/>
		<ChatComposer
			:streaming="streaming"
			:has-messages="messages.length > 0"
			:attachments="attachments"
			:attachments-disabled="attachmentsDisabled"
			:model-mode="modelMode"
			@send="emit('send', $event)"
			@stop="emit('stop')"
			@expanded-change="emptyComposerExpanded = $event"
			@select-files="emit('selectFiles', $event)"
			@retry-attachment="emit('retryAttachment', $event)"
			@cancel-attachment="emit('cancelAttachment', $event)"
			@remove-attachment="emit('removeAttachment', $event)"
			@model-change="emit('modelChange', $event)"
		/>
	</section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import ChatComposer from './ChatComposer.vue';
import MessageList from './MessageList.vue';
import type { ChatAttachment } from '../../types/attachment';
import type { ChatMessage } from '../../types/chat';
import type { ModelMode } from '../../types/provider';

const props = withDefaults(
	defineProps<{
		messages: ChatMessage[];
		streaming: boolean;
		attachments?: ChatAttachment[];
		attachmentResults?: ChatAttachment[];
		attachmentsDisabled?: boolean;
		modelMode?: ModelMode;
	}>(),
	{
		attachments: () => [],
		attachmentResults: () => [],
		attachmentsDisabled: true,
		modelMode: 'fast',
	},
);

const emptyComposerExpanded = ref(false);

watch(
	() => props.messages.length,
	messageCount => {
		if (messageCount > 0) emptyComposerExpanded.value = false;
	},
);

const emit = defineEmits<{
	send: [text: string];
	stop: [];
	copy: [messageId: string];
	retry: [messageId: string];
	regenerate: [messageId: string];
	selectFiles: [files: File[]];
	retryAttachment: [attachmentId: string];
	cancelAttachment: [attachmentId: string];
	removeAttachment: [attachmentId: string];
	modelChange: [mode: ModelMode];
}>();
</script>

<style scoped>
.chat-window {
	position: relative;
	display: grid;
	grid-template-rows: minmax(0, 1fr) auto;
	flex: 1;
	width: 100%;
	height: 100%;
	min-height: 0;
	overflow: hidden;
	background: var(--dd-bg);
}
</style>
