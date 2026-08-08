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
			:attachments-disabled="attachmentsDisabled"
			@send="emit('send', $event)"
			@stop="emit('stop')"
			@select-files="emit('selectFiles', $event)"
		/>
	</section>
</template>

<script setup lang="ts">
import ChatComposer from './ChatComposer.vue';
import MessageList from './MessageList.vue';
import type { ChatMessage } from '../../types/chat';

withDefaults(
	defineProps<{
		messages: ChatMessage[];
		streaming: boolean;
		attachmentsDisabled?: boolean;
	}>(),
	{ attachmentsDisabled: true },
);

const emit = defineEmits<{
	send: [text: string];
	stop: [];
	copy: [messageId: string];
	retry: [messageId: string];
	regenerate: [messageId: string];
	selectFiles: [files: File[]];
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
