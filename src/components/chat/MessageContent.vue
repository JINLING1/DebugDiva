<template>
	<Markdown
		v-if="content.type === 'text'"
		:message="content.text"
		:is-user-message="role === 'user'"
		:citations="citations"
		@cite="index => emit('cite', index)"
	/>

	<article
		v-else-if="content.type === 'file'"
		class="content-card file-content"
		aria-label="文件附件"
	>
		<span class="content-icon" aria-hidden="true">📎</span>
		<div class="content-details">
			<strong class="content-title">{{ content.name }}</strong>
			<span class="content-meta">
				{{ content.mimeType || '未知文件类型' }} · {{ formatFileSize(content.size) }}
			</span>
		</div>
	</article>

	<figure v-else-if="content.type === 'image'" class="image-content">
		<div
			v-if="imagePreviewUrl"
			class="image-preview-trigger"
			role="button"
			:aria-label="`预览图片：${imageName}`"
		>
			<ElImage
				class="image-preview"
				:src="imagePreviewUrl"
				:preview-src-list="[imagePreviewUrl]"
				:initial-index="0"
				fit="contain"
				preview-teleported
				hide-on-click-modal
			/>
		</div>
		<div
			v-else
			class="image-placeholder"
			role="img"
			:aria-label="imageName"
		>
			<span aria-hidden="true">🖼️</span>
			<span>图片暂不可预览</span>
		</div>
		<figcaption>{{ imageName }}</figcaption>
	</figure>

	<aside
		v-else
		class="citation-content"
		aria-label="引用内容"
		:data-citation-index="content.index"
		:tabindex="content.index ? -1 : undefined"
	>
		<header class="citation-header">
			<span class="citation-source">
				<span v-if="content.index" class="citation-index">[{{ content.index }}]</span>
				<strong>{{ content.name }}</strong>
			</span>
			<span v-if="citationLocation">{{ citationLocation }}</span>
		</header>
		<p v-if="content.headingPath?.length" class="citation-path">
			{{ content.headingPath.join(' › ') }}
		</p>
		<blockquote>{{ content.excerpt }}</blockquote>
	</aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElImage } from 'element-plus';
import Markdown from '../Markdown.vue';
import type { ChatAttachment } from '../../types/attachment';
import type {
	ChatRole,
	MessageContent as MessageContentType,
} from '../../types/chat';

const props = defineProps<{
	content: MessageContentType;
	role: ChatRole;
	attachment?: ChatAttachment;
	/** 本条消息中有引用卡片的编号，传给 Markdown 渲染可点击的 [n]。 */
	citations?: number[];
}>();

const emit = defineEmits<{ cite: [index: number] }>();

const citationLocation = computed(() => {
	if (props.content.type !== 'citation' || !props.content.page) return '';
	const { page, pageEnd } = props.content;
	return pageEnd && pageEnd !== page ? `第 ${page}–${pageEnd} 页` : `第 ${page} 页`;
});

const imageAttachment = computed(() =>
	props.attachment?.kind === 'image' ? props.attachment : undefined,
);
const imagePreviewUrl = computed(() =>
	props.content.type === 'image'
		? imageAttachment.value?.previewUrl || props.content.previewUrl
		: undefined,
);
const imageName = computed(() =>
	props.content.type === 'image'
		? imageAttachment.value?.name || props.content.alt || '图片附件'
		: '图片附件',
);
const formatFileSize = (size: number) => {
	const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
	if (safeSize < 1024) {
		return `${safeSize} B`;
	}

	const units = ['KB', 'MB', 'GB'];
	let value = safeSize / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	const precision = value >= 10 ? 0 : 1;
	return `${Number(value.toFixed(precision))} ${units[unitIndex]}`;
};
</script>

<style scoped>
.content-card,
.citation-content,
.image-content {
	box-sizing: border-box;
	max-width: min(100%, 640px);
}

.content-card {
	display: flex;
	gap: 10px;
	align-items: center;
	padding: 10px 12px;
	border: 1px solid var(--dd-border);
	border-radius: var(--dd-radius-md);
	background: var(--dd-surface-muted);
}

.content-icon {
	font-size: 20px;
	line-height: 1;
}

.content-details {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 3px;
}

.content-title {
	overflow: hidden;
	color: var(--dd-text);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.content-meta {
	color: var(--dd-text-secondary);
	font-size: 12px;
}

.image-content {
	margin: 4px 0;
}

.image-preview-trigger,
.image-preview,
.image-placeholder {
	display: block;
	max-width: 100%;
	overflow: hidden;
	border-radius: var(--dd-radius-md);
}

.image-preview {
	width: auto;
	max-height: 360px;
	border: 1px solid var(--dd-border);
	background: var(--dd-surface-muted);
}

.image-preview :deep(img) {
	max-width: 100%;
	max-height: 360px;
	object-fit: contain;
}

.image-placeholder {
	display: flex;
	min-width: 220px;
	min-height: 120px;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	border: 1px dashed var(--dd-border-strong);
	background: var(--dd-surface-muted);
	color: var(--dd-text-secondary);
}

.image-content figcaption {
	margin-top: 5px;
	color: var(--dd-text-secondary);
	font-size: 12px;
}

.citation-content {
	padding: 10px 12px;
	border: 1px solid var(--dd-border);
	border-left: 3px solid var(--dd-accent);
	border-radius: 0 var(--dd-radius-md) var(--dd-radius-md) 0;
	background: var(--dd-surface-muted);
}

.citation-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	color: var(--dd-text-secondary);
	font-size: 12px;
}

.citation-content {
	scroll-margin: 80px;
	transition: box-shadow 0.3s ease;
}

.citation-content--highlight {
	box-shadow: 0 0 0 2px var(--dd-accent);
}

.citation-source {
	display: inline-flex;
	gap: 6px;
	align-items: baseline;
	min-width: 0;
}

.citation-index {
	color: var(--dd-accent);
	font-weight: 600;
}

.citation-path {
	margin: 4px 0 0;
	color: var(--dd-text-secondary);
	font-size: 12px;
	overflow-wrap: anywhere;
}

.citation-content blockquote {
	max-height: 168px;
	overflow: auto;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	margin: 7px 0 0;
	color: var(--dd-text-secondary);
	font-size: 13px;
	line-height: 1.6;
}

@media (max-width: 480px) {
	.image-preview,
	.image-preview :deep(img) {
		max-height: 280px;
	}

	.image-placeholder {
		min-width: min(220px, 100%);
	}
}
</style>
