<template>
	<Markdown
		v-if="content.type === 'text'"
		:message="content.text"
		:is-user-message="role === 'user'"
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
		<img
			v-if="content.previewUrl"
			:src="content.previewUrl"
			:alt="content.alt || '图片附件'"
		/>
		<div
			v-else
			class="image-placeholder"
			role="img"
			:aria-label="content.alt || '图片附件暂不可预览'"
		>
			<span aria-hidden="true">🖼️</span>
			<span>图片暂不可预览</span>
		</div>
		<figcaption>{{ content.alt || '图片附件' }}</figcaption>
	</figure>

	<aside v-else class="citation-content" aria-label="引用内容">
		<header class="citation-header">
			<strong>{{ content.name }}</strong>
			<span v-if="content.page">第 {{ content.page }} 页</span>
		</header>
		<blockquote>{{ content.excerpt }}</blockquote>
	</aside>
</template>

<script setup lang="ts">
import Markdown from '../Markdown.vue';
import type {
	ChatRole,
	MessageContent as MessageContentType,
} from '../../types/chat';

defineProps<{
	content: MessageContentType;
	role: ChatRole;
}>();

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
	max-width: min(100%, 560px);
}

.content-card {
	display: flex;
	gap: 10px;
	align-items: center;
	padding: 10px 12px;
	border: 1px solid var(--el-border-color-light);
	border-radius: 10px;
	background: var(--el-fill-color-lighter);
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
	color: var(--el-text-color-primary);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.content-meta {
	color: var(--el-text-color-secondary);
	font-size: 12px;
}

.image-content {
	margin: 4px 0;
}

.image-content img,
.image-placeholder {
	display: block;
	max-width: 100%;
	border-radius: 8px;
}

.image-content img {
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
	border: 1px dashed var(--el-border-color);
	background: var(--el-fill-color-light);
	color: var(--el-text-color-secondary);
}

.image-content figcaption {
	margin-top: 5px;
	color: var(--el-text-color-secondary);
	font-size: 12px;
}

.citation-content {
	padding: 10px 12px;
	border-left: 3px solid var(--el-color-primary-light-5);
	background: var(--el-fill-color-lighter);
}

.citation-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	color: var(--el-text-color-regular);
	font-size: 12px;
}

.citation-content blockquote {
	margin: 7px 0 0;
	color: var(--el-text-color-secondary);
	font-size: 13px;
	line-height: 1.6;
}
</style>
