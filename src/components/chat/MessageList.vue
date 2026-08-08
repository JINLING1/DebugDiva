<template>
	<section class="message-list" aria-label="消息列表">
		<div v-if="messages.length === 0" class="welcome-wrapper">
			<div class="welcome-message">
				<div class="avatar-container">
					<img src="/robot.svg" alt="Assistant Avatar" class="avatar" />
				</div>
				<p>
					<strong>我是 DebugDiva！你的智能助理，很高兴见到你！</strong><br />
					<span class="small-text">我可以帮你调试代码、分析问题并给出建议。</span>
				</p>
			</div>
		</div>

		<DynamicScroller
			v-else
			ref="scrollerRef"
			class="scroller"
			:items="messages"
			:min-item-size="80"
			key-field="id"
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
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import MessageItem from './MessageItem.vue';
import type { ChatMessage } from '../../types/chat';
import { getMessageText } from '../../services/context/buildChatContext';

const props = defineProps<{ messages: ChatMessage[] }>();

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
let scrollTimeouts: number[] = [];

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

const scheduleScrollToBottom = () => {
	scrollTimeouts.forEach(window.clearTimeout);
	scrollTimeouts = [];

	nextTick(() => {
		doScrollToBottom();
		[50, 150, 300].forEach(delay => {
			scrollTimeouts.push(window.setTimeout(doScrollToBottom, delay));
		});
	});
};

watch(
	() => props.messages.map(message => `${message.id}:${messageSignature(message)}`),
	scheduleScrollToBottom,
	{ deep: true },
);

onBeforeUnmount(() => {
	scrollTimeouts.forEach(window.clearTimeout);
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
	padding-bottom: 130px;
	box-sizing: border-box;
	overflow: hidden;
}

.welcome-wrapper {
	display: flex;
	justify-content: center;
	width: 100%;
	height: 50%;
}

.welcome-message {
	display: flex;
	align-items: center;
	padding: 15px;
	margin-bottom: 15px;
	font-size: 30px;
	color: var(--el-text-color-primary);
	text-align: left;
	border-radius: 8px;
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

.small-text {
	font-size: 18px;
	color: var(--el-text-color-secondary);
}

.scroller {
	flex: 1;
	min-height: 0;
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
	background: #d2d3d6;
	border-radius: 4px;
}

.scroller::-webkit-scrollbar-thumb:hover {
	background: #a9adb4;
}

@media (max-width: 768px) {
	.welcome-message {
		flex-direction: column;
		padding: 10px;
		font-size: 20px;
		text-align: center;
	}

	.small-text {
		font-size: 14px;
	}
}
</style>
