<template>
	<section class="chat-window" aria-label="DebugDiva 对话窗口">
		<MessageList
			:messages="messages"
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
			@select-files="emit('selectFiles', $event)"
			@retry-attachment="emit('retryAttachment', $event)"
			@cancel-attachment="emit('cancelAttachment', $event)"
			@remove-attachment="emit('removeAttachment', $event)"
			@model-change="emit('modelChange', $event)"
		/>
	</section>
</template>

<script setup lang="ts">
import ChatComposer from './ChatComposer.vue';
import MessageList from './MessageList.vue';
import type { DocumentAttachment } from '../../types/attachment';
import type { ChatMessage } from '../../types/chat';
import type { ModelMode } from '../../types/provider';

withDefaults(
	defineProps<{
		messages: ChatMessage[];
		streaming: boolean;
		attachments?: DocumentAttachment[];
		attachmentsDisabled?: boolean;
		modelMode?: ModelMode;
	}>(),
	{ attachments: () => [], attachmentsDisabled: true, modelMode: 'fast' },
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
	display: flex;
	flex: 1;
	width: 100%;
	height: 100%;
	min-height: 0;
	overflow: hidden;
}
</style>
