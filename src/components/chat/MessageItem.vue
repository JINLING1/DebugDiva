<template>
	<article
		class="message-item"
		:class="`message-item--${message.role}`"
		:data-message-id="message.id"
	>
		<div v-if="message.role === 'assistant'" class="avatar-container">
			<img src="/robot.svg" alt="Assistant Avatar" class="avatar" />
		</div>

		<div class="message-body">
			<div class="message-contents">
				<MessageContent
					v-for="(content, index) in message.contents"
					:key="`${message.id}-${index}`"
					class="message-content-part"
					:content="content"
					:role="message.role"
					:attachment="attachmentFor(content)"
				/>

				<div
					v-if="showSpinner"
					class="loading-spinner"
					role="status"
					aria-label="AI 正在回复"
				></div>
			</div>

			<span
				v-if="message.status === 'stopped'"
				class="message-status stopped-status"
			>
				已停止
			</span>
			<span
				v-else-if="message.status === 'error'"
				class="message-status error-status"
			>
				请求失败
			</span>

			<div v-if="showActions" class="message-actions">
				<button
					v-if="canCopy"
					type="button"
					class="action-button copy-button"
					aria-label="复制回复"
					@click="emit('copy', message.id)"
				>
					<CopyDocument aria-hidden="true" />
				</button>
				<button
					v-if="canRetry"
					type="button"
					class="action-button retry-button"
					aria-label="重试回复"
					@click="emit('retry', message.id)"
				>
					<RefreshRight aria-hidden="true" />
				</button>
				<button
					v-if="canRegenerate"
					type="button"
					class="action-button regenerate-button"
					aria-label="重新生成回复"
					@click="emit('regenerate', message.id)"
				>
					<Refresh aria-hidden="true" />
				</button>
			</div>
		</div>
	</article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
	CopyDocument,
	Refresh,
	RefreshRight,
} from '@element-plus/icons-vue';
import MessageContent from './MessageContent.vue';
import type { ChatAttachment } from '../../types/attachment';
import type { ChatMessage, MessageContent as Content } from '../../types/chat';

const props = defineProps<{
	message: ChatMessage;
	isLast: boolean;
	attachmentResults?: ChatAttachment[];
}>();

const attachmentFor = (content: Content): ChatAttachment | undefined => {
	if (content.type !== 'file' && content.type !== 'image') return undefined;
	return props.attachmentResults?.find(
		attachment => attachment.id === content.attachmentId,
	);
};

const emit = defineEmits<{
	copy: [messageId: string];
	retry: [messageId: string];
	regenerate: [messageId: string];
}>();

const hasVisibleContent = computed(() =>
	props.message.contents.some(content =>
		content.type === 'text' ? Boolean(content.text.trim()) : true,
	),
);

const showSpinner = computed(
	() =>
		props.message.role === 'assistant' &&
		(props.message.status === 'pending' ||
			props.message.status === 'streaming') &&
		!hasVisibleContent.value,
);

const isAssistant = computed(() => props.message.role === 'assistant');
const canCopy = computed(
	() =>
		isAssistant.value &&
		props.message.contents.some(
			content => content.type === 'text' && Boolean(content.text.trim()),
		),
);
const canRetry = computed(
	() =>
		isAssistant.value &&
		props.isLast &&
		props.message.status === 'error',
);
const canRegenerate = computed(
	() =>
		isAssistant.value &&
		props.isLast &&
		(props.message.status === 'completed' ||
			props.message.status === 'stopped'),
);
const showActions = computed(
	() => canCopy.value || canRetry.value || canRegenerate.value,
);
</script>

<style scoped>
.message-item {
	display: flex;
	box-sizing: border-box;
	width: 100%;
	max-width: 800px;
	margin: 0 auto;
	padding: 0 0 30px;
}

.message-item--user,
.message-item--system {
	justify-content: flex-end;
}

.avatar-container {
	width: 40px;
	height: 40px;
	margin: 10px;
	flex-shrink: 0;
}

.avatar {
	width: 30px;
	height: 30px;
}

.message-body {
	position: relative;
	min-width: 0;
	max-width: 100%;
	padding-bottom: 25px;
}

.message-item--user .message-body {
	max-width: 85%;
}

.message-contents {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 8px;
}

.message-status {
	display: inline-block;
	margin: 4px 20px 8px;
	font-size: 12px;
}

.stopped-status {
	color: var(--el-text-color-secondary);
}

.error-status {
	color: var(--el-color-danger);
}

.message-actions {
	position: absolute;
	bottom: 2px;
	left: 20px;
	display: flex;
	gap: 4px;
	opacity: 0;
	visibility: hidden;
	transition: opacity 0.2s, visibility 0.2s;
}

.message-item:hover .message-actions,
.message-actions:focus-within {
	opacity: 1;
	visibility: visible;
}

.action-button {
	display: inline-flex;
	width: 28px;
	height: 28px;
	align-items: center;
	justify-content: center;
	padding: 5px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--el-text-color-secondary);
	cursor: pointer;
}

.action-button:hover,
.action-button:focus-visible {
	background: var(--el-fill-color-light);
	color: var(--el-color-primary);
	outline: none;
}

.action-button svg {
	width: 16px;
	height: 16px;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.loading-spinner {
	width: 15px;
	height: 15px;
	margin: 20px 0 5px 20px;
	border: 2px solid #f3f3f3;
	border-top-color: gray;
	border-radius: 50%;
	animation: spin 1s linear infinite;
}

@media (max-width: 768px) {
	.message-item {
		padding-right: 10px;
		padding-left: 10px;
	}

	.message-actions {
		left: 0;
		opacity: 1;
		visibility: visible;
	}
}
</style>
