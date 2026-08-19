<template>
	<div v-if="attachments.length" class="attachment-list" aria-label="待发送附件">
		<AttachmentCard
			v-for="attachment in attachments"
			:key="attachment.id"
			:attachment="attachment"
			:disabled="disabled"
			@retry="emit('retry', $event)"
			@cancel="emit('cancel', $event)"
			@remove="emit('remove', $event)"
		/>
	</div>
</template>

<script setup lang="ts">
import AttachmentCard from './AttachmentCard.vue';
import type { ChatAttachment } from '../../types/attachment';

withDefaults(
	defineProps<{
		attachments: ChatAttachment[];
		disabled?: boolean;
	}>(),
	{ disabled: false },
);

const emit = defineEmits<{
	retry: [attachmentId: string];
	cancel: [attachmentId: string];
	remove: [attachmentId: string];
}>();
</script>

<style scoped>
.attachment-list {
	display: grid;
	gap: 6px;
	max-height: 210px;
	padding: 2px 2px 8px;
	overflow-y: auto;
	scrollbar-width: thin;
	scrollbar-color: var(--dd-border-strong) transparent;
}
</style>
