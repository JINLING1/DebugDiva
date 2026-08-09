<template>
	<div class="composer-layer">
		<transition name="chat-transition">
			<div class="chat-composer" :class="dialogState">
				<div class="input-wrapper">
					<div class="custom-input-container">
						<AttachmentList
							:attachments="attachments"
							:disabled="streaming"
							@retry="emit('retryAttachment', $event)"
							@cancel="emit('cancelAttachment', $event)"
							@remove="emit('removeAttachment', $event)"
						/>
						<el-input
							v-model="input"
							class="inner-input"
							:autosize="{ minRows: 1, maxRows: 8 }"
							type="textarea"
							resize="none"
							placeholder="Ask me everything... (Press Shift+Enter to newline, max 1000 words)"
							maxlength="1000"
							aria-label="聊天输入框"
							@keydown.enter="handleKeySubmit"
							@click="expandComposer"
						/>

						<div class="input-action-bar">
							<div class="action-left">
								<ModelSelector
									:model-mode="modelMode"
									:disabled="streaming"
									@change="emit('modelChange', $event)"
								/>
								<input
									ref="fileInputRef"
									class="file-input"
									type="file"
									multiple
									:accept="attachmentAccept"
									:disabled="attachmentSelectionDisabled"
									@change="handleFileSelection"
								/>
								<el-tooltip :content="attachmentTooltip" placement="top">
									<el-button
										text
										circle
										class="action-btn"
										:disabled="attachmentSelectionDisabled"
										aria-label="选择附件"
										@click="openFilePicker"
									>
										<el-icon :size="20"><Paperclip /></el-icon>
									</el-button>
								</el-tooltip>
							</div>

							<div class="action-right">
								<span class="word-count">{{ input.length }} / 1000</span>
								<el-button
									class="send-btn custom-transparent-btn"
									:class="{ 'light-button': streaming }"
									:disabled="!streaming && !canSend"
									:aria-label="streaming ? '停止生成' : '发送消息'"
									@click="handlePrimaryAction"
								>
									<el-icon :size="24">
										<VideoPause v-if="streaming" />
										<Promotion v-else />
									</el-icon>
								</el-button>
							</div>
						</div>
					</div>
				</div>

				<div v-if="showSuggestions" class="suggestions" aria-label="建议问题">
					<button
						v-for="question in suggestedQuestions"
						:key="question"
						type="button"
						class="suggestion-item"
						@click="submit(question)"
					>
						{{ question }}
					</button>
				</div>
			</div>
		</transition>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Paperclip, Promotion, VideoPause } from '@element-plus/icons-vue';
import AttachmentList from './AttachmentList.vue';
import ModelSelector from './ModelSelector.vue';
import type { DocumentAttachment } from '../../types/attachment';
import type { ModelMode } from '../../types/provider';

type DialogState = 'collapsed' | 'expanded' | 'dialog';

const props = withDefaults(
	defineProps<{
		streaming: boolean;
		hasMessages: boolean;
		attachments?: DocumentAttachment[];
		attachmentsDisabled?: boolean;
		modelMode?: ModelMode;
	}>(),
	{
		attachments: () => [],
		attachmentsDisabled: true,
		modelMode: 'fast',
	},
);

const emit = defineEmits<{
	send: [text: string];
	stop: [];
	selectFiles: [files: File[]];
	retryAttachment: [attachmentId: string];
	cancelAttachment: [attachmentId: string];
	removeAttachment: [attachmentId: string];
	modelChange: [mode: ModelMode];
}>();

const input = ref('');
const expanded = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const attachmentAccept = [
	'.txt',
	'.md',
	'.markdown',
	'.json',
	'.js',
	'.mjs',
	'.cjs',
	'.jsx',
	'.ts',
	'.mts',
	'.cts',
	'.tsx',
	'.vue',
	'.css',
	'.scss',
	'.sass',
	'.less',
	'.html',
	'.htm',
	'.xml',
	'.yaml',
	'.yml',
	'.py',
	'.java',
	'.c',
	'.cc',
	'.cpp',
	'.h',
	'.hpp',
	'.go',
	'.rs',
	'.cs',
	'.php',
	'.rb',
	'.sql',
	'.sh',
	'.bash',
	'.pdf',
	'.docx',
	'text/*',
	'application/json',
	'application/javascript',
	'application/typescript',
	'application/xml',
	'application/x-sh',
	'application/x-yaml',
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

const suggestedQuestions = [
	'如何调试 JavaScript 内存泄漏？',
	'Python 异步编程的最佳实践是什么？',
	'如何优化 React 应用性能？',
];

const dialogState = computed<DialogState>(() => {
	if (props.hasMessages) return 'dialog';
	return expanded.value ? 'expanded' : 'collapsed';
});

const showSuggestions = computed(
	() => !props.hasMessages && expanded.value && !props.streaming,
);

const attachmentSelectionDisabled = computed(
	() =>
		props.attachmentsDisabled ||
		props.streaming ||
		props.attachments.length >= 3,
);
const hasUnreadyAttachments = computed(() =>
	props.attachments.some(attachment => attachment.status !== 'ready'),
);
const canSend = computed(
	() => Boolean(input.value.trim()) && !hasUnreadyAttachments.value,
);
const attachmentTooltip = computed(() => {
	if (props.attachmentsDisabled) return '附件功能暂不可用';
	if (props.streaming) return '生成中无法添加附件';
	if (props.attachments.length >= 3) return '每条消息最多添加 3 个附件';
	return '选择附件';
});

watch(
	() => props.hasMessages,
	hasMessages => {
		if (!hasMessages) expanded.value = false;
	},
);

const expandComposer = () => {
	if (!props.hasMessages) expanded.value = true;
};

const submit = (value = input.value) => {
	if (props.streaming || hasUnreadyAttachments.value) return;
	const normalized = value.trim();
	if (!normalized) return;

	emit('send', normalized);
	input.value = '';
};

const handleKeySubmit = (event: KeyboardEvent) => {
	if (event.shiftKey || event.isComposing) return;
	event.preventDefault();
	submit();
};

const handlePrimaryAction = () => {
	if (props.streaming) {
		emit('stop');
		return;
	}
	submit();
};

const openFilePicker = () => {
	if (!attachmentSelectionDisabled.value) fileInputRef.value?.click();
};

const handleFileSelection = (event: Event) => {
	const target = event.target as HTMLInputElement;
	const files = Array.from(target.files ?? []);
	if (files.length) emit('selectFiles', files);
	target.value = '';
};
</script>

<style scoped>
.composer-layer {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 10;
}

.chat-composer {
	position: absolute;
	left: 50%;
	width: 80%;
	max-width: 800px;
	transform: translateX(-50%);
	transition: all 0.3s ease;
	pointer-events: auto;
}

.chat-composer.collapsed {
	top: 50%;
	transform: translate(-50%, -50%);
}

.chat-composer.expanded {
	top: 40%;
}

.chat-composer.dialog {
	bottom: max(10px, env(safe-area-inset-bottom));
}

.input-wrapper {
	display: flex;
	justify-content: center;
	width: 100%;
	margin-bottom: 10px;
}

.custom-input-container {
	display: flex;
	flex-direction: column;
	width: 100%;
	padding: 10px 12px 8px;
	background-color: var(--el-bg-color-overlay);
	border: 1px solid var(--el-border-color);
	border-radius: 16px;
	box-shadow: 0 -4px 15px rgb(0 0 0 / 6%);
	transition: all 0.3s ease;
}

.custom-input-container:focus-within {
	border-color: var(--el-color-primary);
	box-shadow: 0 -4px 18px rgb(64 158 255 / 12%);
}

:deep(.inner-input .el-textarea__inner) {
	padding: 0 4px;
	font-size: 16px;
	resize: none !important;
	background-color: transparent !important;
	border: none !important;
	box-shadow: none !important;
}

:deep(.inner-input .el-textarea__inner:focus) {
	outline: none;
	box-shadow: none !important;
}

.input-action-bar,
.action-left,
.action-right {
	display: flex;
	align-items: center;
}

.input-action-bar {
	justify-content: space-between;
	margin-top: 5px;
}

.action-right {
	gap: 12px;
}

.action-left {
	gap: 6px;
}

.file-input {
	display: none;
}

.action-btn {
	color: var(--el-text-color-regular);
}

.word-count {
	font-size: 12px;
	color: var(--el-text-color-placeholder);
	user-select: none;
}

.send-btn {
	transition: all 0.3s;
}

.custom-transparent-btn {
	padding: 0;
	margin-left: 10px;
	background-color: transparent !important;
	border: none !important;
}

.custom-transparent-btn:not(.is-disabled) {
	color: var(--el-color-primary) !important;
}

.custom-transparent-btn.is-disabled {
	color: var(--el-text-color-placeholder) !important;
}

.light-button {
	opacity: 0.7;
}

.suggestions {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 10px;
	margin-top: 20px;
}

.suggestion-item {
	padding: 12px;
	font: inherit;
	color: inherit;
	cursor: pointer;
	background: var(--el-fill-color-light);
	border: 0;
	border-radius: 8px;
	transition: all 0.2s;
}

.suggestion-item:hover {
	background: var(--el-fill-color);
	transform: translateY(-2px);
}

.chat-transition-enter-active,
.chat-transition-leave-active {
	transition: all 0.3s ease;
}

.chat-transition-enter-from,
.chat-transition-leave-to {
	opacity: 0;
	transform: translateY(20px);
}

@media (max-width: 768px) {
	.chat-composer {
		width: 95%;
	}
}
</style>
