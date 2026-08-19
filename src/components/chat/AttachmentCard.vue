<template>
	<article
		class="attachment-card"
		:class="`is-${attachment.status}`"
		:data-attachment-id="attachment.id"
	>
		<div v-if="attachment.kind === 'image'" class="image-thumbnail">
			<img
				v-if="attachment.previewUrl"
				:src="attachment.previewUrl"
				:alt="`图片预览 ${attachment.name}`"
			/>
			<span v-else aria-hidden="true">🖼️</span>
		</div>
		<div v-else class="file-icon" aria-hidden="true">📄</div>
		<div class="attachment-details">
			<div class="attachment-heading">
				<strong class="attachment-name" :title="attachment.name">
					{{ attachment.name }}
				</strong>
				<span
					class="status-label"
					:data-status="attachment.status"
					:role="isProcessing ? 'status' : undefined"
					:aria-live="isProcessing ? 'polite' : undefined"
				>
					<span v-if="isProcessing" class="status-spinner" aria-hidden="true" />
					{{ statusLabel }}
				</span>
			</div>

			<p class="attachment-meta">
				<span>{{ formatFileSize(attachment.size) }}</span>
				<span v-if="attachment.kind === 'document' && attachment.pageCount">
					{{ attachment.pageCount }} 页
				</span>
			</p>

			<p v-if="attachment.errorMessage" class="attachment-error" role="alert">
				{{ attachment.errorMessage }}
			</p>

			<div
				v-if="isTruncated || displayedWarnings.length"
				class="attachment-warnings"
				aria-label="附件提示"
			>
				<span v-if="isTruncated" class="truncated-label">内容已截断</span>
				<ul v-if="displayedWarnings.length">
					<li v-for="warning in displayedWarnings" :key="warning">
						{{ warning }}
					</li>
				</ul>
			</div>
		</div>

		<div class="attachment-actions">
			<button
				v-if="isProcessing"
				type="button"
				class="attachment-action"
				:disabled="disabled"
				:aria-label="`取消处理 ${attachment.name}`"
				@click="emit('cancel', attachment.id)"
			>
				取消
			</button>
			<button
				v-if="attachment.status === 'error'"
				type="button"
				class="attachment-action retry-action"
				:disabled="disabled"
				:aria-label="`重试附件 ${attachment.name}`"
				@click="emit('retry', attachment.id)"
			>
				重试
			</button>
			<button
				type="button"
				class="attachment-action remove-action"
				:disabled="disabled"
				:aria-label="`移除附件 ${attachment.name}`"
				@click="emit('remove', attachment.id)"
			>
				移除
			</button>
		</div>
	</article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
	AttachmentStatus,
	ChatAttachment,
} from '../../types/attachment';

const props = withDefaults(
	defineProps<{
		attachment: ChatAttachment;
		disabled?: boolean;
	}>(),
	{ disabled: false },
);

const emit = defineEmits<{
	retry: [attachmentId: string];
	cancel: [attachmentId: string];
	remove: [attachmentId: string];
}>();

const statusLabels: Record<AttachmentStatus, string> = {
	waiting: '待发送',
	uploading: '上传中',
	parsing: '解析中',
	analyzing: '正在处理图片',
	ready: '已就绪',
	error: '处理失败',
};

const isProcessing = computed(() =>
	['uploading', 'parsing', 'analyzing'].includes(props.attachment.status),
);
const statusLabel = computed(() => statusLabels[props.attachment.status]);
const isTruncated = computed(
	() => props.attachment.kind === 'document' && props.attachment.truncated,
);
const displayedWarnings = computed(() => [
	...props.attachment.warnings,
]);

const formatFileSize = (size: number) => {
	const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
	if (safeSize < 1024) return `${safeSize} B`;

	const units = ['KB', 'MB', 'GB'];
	let value = safeSize / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${Number(value.toFixed(value >= 10 ? 0 : 1))} ${units[unitIndex]}`;
};
</script>

<style scoped>
.attachment-card {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 9px 10px;
	border: 1px solid var(--dd-border);
	border-radius: var(--dd-radius-md);
	background: var(--dd-surface-muted);
}

.attachment-card.is-error {
	border-color: color-mix(in srgb, var(--dd-danger) 32%, var(--dd-border));
	background: var(--dd-danger-soft);
}

.file-icon {
	flex: 0 0 auto;
	font-size: 20px;
	line-height: 1.4;
}

.image-thumbnail {
	display: flex;
	width: 48px;
	height: 48px;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	border-radius: 8px;
	background: var(--dd-surface-hover);
}

.image-thumbnail img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.attachment-details {
	min-width: 0;
	flex: 1;
}

.attachment-heading,
.attachment-meta,
.attachment-actions {
	display: flex;
	align-items: center;
}

.attachment-heading {
	gap: 8px;
}

.attachment-name {
	min-width: 0;
	overflow: hidden;
	color: var(--dd-text);
	font-size: 13px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.status-label {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 4px;
	color: var(--dd-text-secondary);
	font-size: 11px;
}

.status-label[data-status='ready'] {
	color: var(--el-color-success);
}

.status-label[data-status='error'] {
	color: var(--dd-danger);
}

.status-spinner {
	width: 10px;
	height: 10px;
	border: 1.5px solid var(--dd-border-strong);
	border-top-color: var(--dd-accent);
	border-radius: 50%;
	animation: attachment-spin 0.8s linear infinite;
}

.attachment-meta {
	gap: 8px;
	margin: 3px 0 0;
	color: var(--dd-text-secondary);
	font-size: 11px;
}

.attachment-error {
	margin: 5px 0 0;
	color: var(--dd-danger);
	font-size: 12px;
}

.attachment-warnings {
	margin-top: 5px;
	color: var(--dd-warning);
	font-size: 11px;
}

.attachment-warnings ul {
	padding-left: 16px;
	margin: 3px 0 0;
}

.truncated-label {
	display: inline-block;
	padding: 1px 5px;
	border-radius: 4px;
	background: color-mix(in srgb, var(--dd-warning) 16%, transparent);
}

.attachment-actions {
	flex: 0 0 auto;
	gap: 4px;
}

.attachment-action {
	padding: 3px 5px;
	font: inherit;
	font-size: 11px;
	color: var(--dd-text-secondary);
	cursor: pointer;
	background: transparent;
	border: 0;
	border-radius: 4px;
}

.attachment-action:hover:not(:disabled) {
	color: var(--dd-text);
	background: var(--dd-surface-hover);
}

.attachment-action:disabled {
	cursor: not-allowed;
	opacity: 0.5;
}

.retry-action {
	color: var(--dd-accent);
}

.remove-action:hover:not(:disabled) {
	color: var(--dd-danger);
}

@media (max-width: 480px) {
	.attachment-card {
		flex-wrap: wrap;
	}

	.attachment-actions {
		width: 100%;
		justify-content: flex-end;
	}

	.attachment-action {
		min-width: 40px;
		min-height: 32px;
	}
}

@keyframes attachment-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
