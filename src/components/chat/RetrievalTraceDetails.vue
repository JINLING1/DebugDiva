<template>
	<details class="retrieval-trace">
		<summary>
			<span>检索详情</span>
			<span class="trace-summary">{{ summary }}</span>
		</summary>

		<dl class="trace-fields">
			<dt>检索查询</dt>
			<dd>{{ trace.query }}</dd>
			<template v-if="trace.rewrittenQuery">
				<dt>改写查询</dt>
				<dd>{{ trace.rewrittenQuery }}</dd>
			</template>
			<template v-if="trace.degraded.length">
				<dt>降级</dt>
				<dd>{{ trace.degraded.map(describeDegraded).join('；') }}</dd>
			</template>
			<template v-if="trace.invalidCitations">
				<dt>越界引用</dt>
				<dd>已删除 {{ trace.invalidCitations }} 处模型编造的引用编号</dd>
			</template>
		</dl>

		<p v-if="trace.noAnswer" class="trace-note">
			所有候选片段的相关度都低于阈值，已告知模型“文档中没有找到相关内容”。
		</p>
		<ol v-else-if="trace.hits.length" class="trace-hits">
			<li v-for="(hit, index) in trace.hits" :key="`${hit.chunkId}-${index}`">
				<span class="hit-index">[{{ index + 1 }}]</span>
				<span class="hit-name">{{ nameOf(hit.attachmentId) }}</span>
				<span class="hit-meta">
					{{ trace.reranked ? '相关度' : 'RRF' }} {{ formatScore(hit.score) }}
					<template v-if="hit.merged"> · 合并 {{ hit.merged }} 段</template>
				</span>
			</li>
		</ol>
	</details>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChatAttachment } from '../../types/attachment';
import type { RetrievalTrace } from '../../types/chat';

const props = defineProps<{
	trace: RetrievalTrace;
	attachmentResults?: ChatAttachment[];
}>();

const DEGRADED_LABELS: Record<string, string> = {
	'no-vectors': '向量尚未建立，只用关键词检索',
	'query-embedding-failed': '问题向量化失败，只用关键词检索',
	'model-mismatch': '向量模型已更换，只用关键词检索',
	'rerank-failed': '重排序不可用，使用融合排序',
	'rewrite-failed': '查询改写不可用，只用原问题检索',
	'no-index': '没有可用索引',
};

const describeDegraded = (code: string) => DEGRADED_LABELS[code] ?? code;

const summary = computed(() => {
	const { trace } = props;
	const method = [
		trace.mode === 'hybrid' ? '混合检索' : trace.mode === 'dense' ? '向量检索' : '关键词检索',
		trace.rewrittenQuery ? '改写' : '',
		trace.reranked ? '重排序' : '',
	]
		.filter(Boolean)
		.join(' + ');
	const result = trace.noAnswer ? '未找到相关内容' : `${trace.hits.length} 段`;
	return `${method} · ${result} · ${trace.durationMs} ms`;
});

const nameOf = (attachmentId: string) =>
	props.attachmentResults?.find(attachment => attachment.id === attachmentId)?.name ?? '附件';

const formatScore = (score: number) => (score >= 0.01 ? score.toFixed(2) : score.toFixed(4));
</script>

<style scoped>
.retrieval-trace {
	box-sizing: border-box;
	max-width: min(100%, 640px);
	/* 消息悬停操作栏绝对定位在消息底部，留出空间避免遮挡摘要行 */
	margin: 4px 0 12px;
	color: var(--dd-text-secondary);
	font-size: 12px;
}

.retrieval-trace summary {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 8px;
	width: fit-content;
	cursor: pointer;
	user-select: none;
}

.trace-summary {
	color: var(--dd-text-tertiary);
}

.trace-fields {
	display: grid;
	grid-template-columns: max-content minmax(0, 1fr);
	gap: 4px 12px;
	margin: 8px 0 0;
}

.trace-fields dt {
	color: var(--dd-text-tertiary);
}

.trace-fields dd {
	margin: 0;
	overflow-wrap: anywhere;
}

.trace-note {
	margin: 8px 0 0;
}

.trace-hits {
	display: grid;
	gap: 2px;
	margin: 8px 0 0;
	padding: 0;
	list-style: none;
}

.trace-hits li {
	display: flex;
	flex-wrap: wrap;
	gap: 0 8px;
}

.hit-index {
	color: var(--dd-accent);
}

.hit-name {
	overflow-wrap: anywhere;
}

.hit-meta {
	color: var(--dd-text-tertiary);
}
</style>
