<template>
	<section ref="listRef" class="message-list" aria-label="消息列表">
		<div v-if="messages.length === 0" class="welcome-wrapper">
			<div class="welcome-message">
				<div class="welcome-avatar">
					<img src="/robot.svg" alt="Assistant Avatar" class="avatar" />
				</div>
				<h1>有什么可以帮忙的？</h1>
				<p>我可以帮你调试代码、分析问题并给出建议。</p>
			</div>
		</div>

		<DynamicScroller
			v-else
			ref="scrollerRef"
			class="scroller"
			:items="messages"
			:min-item-size="80"
			key-field="id"
			@scroll="handleScroll"
		>
			<template #default="{ item, index, active }">
				<DynamicScrollerItem
					:item="item"
					:active="active"
					:size-dependencies="[messageSignature(item)]"
					:data-index="index"
				>
					<MessageItem
						:message="item"
						:is-last="index === messages.length - 1"
						:attachment-results="attachmentResults"
						@copy="emit('copy', $event)"
						@retry="emit('retry', $event)"
						@regenerate="emit('regenerate', $event)"
					/>
				</DynamicScrollerItem>
			</template>
		</DynamicScroller>
	</section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import MessageItem from './MessageItem.vue';
import type { ChatMessage } from '../../types/chat';
import type { ChatAttachment } from '../../types/attachment';
import { getMessageText } from '../../services/context/buildChatContext';

const props = withDefaults(
	defineProps<{
		messages: ChatMessage[];
		attachmentResults?: ChatAttachment[];
	}>(),
	{ attachmentResults: () => [] },
);

const emit = defineEmits<{
	copy: [messageId: string];
	retry: [messageId: string];
	regenerate: [messageId: string];
}>();

type ScrollerHandle = {
	scrollToBottom?: () => void;
	$el?: HTMLElement;
};

const scrollerRef = ref<ScrollerHandle | null>(null);
const listRef = ref<HTMLElement | null>(null);
const pinnedToBottom = ref(true);
let scrollTimeouts: number[] = [];
let resizeObserver: ResizeObserver | null = null;

const messageSignature = (message: ChatMessage) =>
	`${message.status}:${getMessageText(message).length}:${message.contents.length}`;

const doScrollToBottom = () => {
	const scroller = scrollerRef.value;
	if (!scroller) return;
	if (typeof scroller.scrollToBottom === 'function') {
		scroller.scrollToBottom();
		return;
	}
	if (scroller.$el) scroller.$el.scrollTop = scroller.$el.scrollHeight;
};

const getScrollerElement = () => scrollerRef.value?.$el ?? null;

const handleScroll = () => {
	const element = getScrollerElement();
	if (!element) return;
	const distanceToBottom =
		element.scrollHeight - element.scrollTop - element.clientHeight;
	pinnedToBottom.value = distanceToBottom <= 96;
};

const scheduleScrollToBottom = (force = false) => {
	if (!force && !pinnedToBottom.value) return;
	scrollTimeouts.forEach(window.clearTimeout);
	scrollTimeouts = [];

	nextTick(() => {
		doScrollToBottom();
		[50, 150, 300].forEach(delay => {
			scrollTimeouts.push(
				window.setTimeout(() => {
					if (pinnedToBottom.value) doScrollToBottom();
				}, delay),
			);
		});
	});
};

watch(
	() => props.messages.map(message => `${message.id}:${messageSignature(message)}`),
	(current, previous = []) => {
		scheduleScrollToBottom(current.length > previous.length);
	},
	{ deep: true },
);

onMounted(() => {
	if (!listRef.value || typeof ResizeObserver === 'undefined') return;
	resizeObserver = new ResizeObserver(() => {
		if (pinnedToBottom.value) scheduleScrollToBottom();
	});
	resizeObserver.observe(listRef.value);
});

onBeforeUnmount(() => {
	scrollTimeouts.forEach(window.clearTimeout);
	resizeObserver?.disconnect();
});
</script>

<style scoped>
.message-list {
	display: flex;
	flex: 1;
	flex-direction: column;
	width: 100%;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	overflow: hidden;
	background: var(--dd-bg);
}

.welcome-wrapper {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	padding: 24px 20px 190px;
}

.welcome-message {
	display: flex;
	max-width: var(--dd-content-width);
	flex-direction: column;
	align-items: center;
	color: var(--dd-text);
	text-align: center;
}

.welcome-avatar {
	display: grid;
	width: 48px;
	height: 48px;
	place-items: center;
	margin-bottom: 18px;
	border: 1px solid var(--dd-border);
	border-radius: 50%;
	background: var(--dd-surface-muted);
}

.avatar {
	width: 32px;
	height: 32px;
}

.welcome-message h1 {
	margin: 0;
	font-size: clamp(24px, 3vw, 30px);
	font-weight: 600;
	letter-spacing: -0.03em;
}

.welcome-message p {
	margin: 8px 0 0;
	color: var(--dd-text-secondary);
	font-size: 15px;
}

.scroller {
	flex: 1;
	min-height: 0;
	overflow-x: hidden;
	scrollbar-gutter: stable;
}

.scroller::-webkit-scrollbar {
	display: block;
	width: 6px;
}

.scroller::-webkit-scrollbar-button {
	display: none !important;
}

.scroller::-webkit-scrollbar-track {
	background: transparent;
}

.scroller::-webkit-scrollbar-thumb {
	background: var(--dd-border-strong);
	border-radius: 4px;
}

.scroller::-webkit-scrollbar-thumb:hover {
	background: var(--dd-text-tertiary);
}

@media (max-width: 768px) {
	.welcome-wrapper {
		padding: 16px 16px 170px;
	}

	.welcome-message p {
		font-size: 14px;
	}
}

@media (max-width: 480px) {
	.welcome-wrapper {
		padding-bottom: 150px;
	}

	.welcome-message h1 {
		font-size: 22px;
	}
}
</style>
