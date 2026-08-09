import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type {
	ChatMessage,
	ChatParams,
	ChatRole,
	ChatSession,
	MessageStatus,
} from '../types/chat';
import {
	MAX_ACTIVE_ATTACHMENT_TEXT_LENGTH,
	MAX_ATTACHMENTS_PER_MESSAGE,
	type ChatAttachment,
} from '../types/attachment';
import type { ProviderMessage } from '../types/provider';
import { DeepSeekChatProvider } from '../providers/chat/DeepSeekChatProvider';
import {
	appendMessageText,
	buildChatContext,
	getMessageText,
	setMessageText,
} from '../services/context/buildChatContext';
import {
	CHAT_CAPABILITY_SYSTEM_PROMPT,
	detectImageGenerationIntent,
	IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
} from '../services/context/detectImageGenerationIntent';
import {
	loadChatSessions,
	saveChatSessions,
} from '../services/storage/chatStorage';
import { loadAttachmentResults } from '../services/storage/attachmentStorage';
import { useSettingsStore } from './settings';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const chatProvider = new DeepSeekChatProvider();

const createMessageId = (role: ChatRole) => {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `msg-${Date.now()}-${role}-${suffix}`;
};

const createTextMessage = (
	role: ChatRole,
	text: string,
	status: MessageStatus,
): ChatMessage => ({
	id: createMessageId(role),
	role,
	status,
	contents: text ? [{ type: 'text', text }] : [],
	createdAt: Date.now(),
});

const createUserMessage = (
	text: string,
	attachments: readonly ChatAttachment[] = [],
): ChatMessage => ({
	id: createMessageId('user'),
	role: 'user',
	status: 'completed',
	contents: [
		{ type: 'text', text },
		...attachments.map(attachment =>
			attachment.kind === 'image'
				? {
						type: 'image' as const,
						attachmentId: attachment.id,
						alt: attachment.name,
					}
				: {
						type: 'file' as const,
						attachmentId: attachment.id,
						name: attachment.name,
						mimeType: attachment.mimeType,
						size: attachment.size,
					},
		),
	],
	createdAt: Date.now(),
});

const normalizeAttachmentIds = (ids: readonly string[]): string[] =>
	[...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))];

export const useChatStore = defineStore('chat', () => {
	const settingsStore = useSettingsStore();
	const chatSessions = ref<ChatSession[]>([]);
	const currentSessionId = ref<string | null>(null);
	const chatHistory = ref<ChatMessage[]>([]);
	const activeAttachmentIds = ref<string[]>([]);
	const isAssistantTyping = ref(false);
	const isSidebarOpen = ref(window.innerWidth > 768);
	const initialized = ref(false);

	const abortController = ref<AbortController | null>(null);
	let assistantMessageIndex = -1;

	const persistSessionList = () => {
		try {
			saveChatSessions(localStorage, chatSessions.value);
			return true;
		} catch (error) {
			console.error('Failed to persist chat sessions:', error);
			ElMessage.error('本地存储空间不足，会话暂时无法保存。');
			return false;
		}
	};

	const saveSessionsToLocalStorage = () => {
		if (chatHistory.value.length > 0) {
			const now = Date.now();
			if (!currentSessionId.value) {
				currentSessionId.value = now.toString();
				const firstUserMessage = chatHistory.value.find(
					message => message.role === 'user',
				);
				const titleText = firstUserMessage
					? getMessageText(firstUserMessage).trim()
					: '新对话';
				chatSessions.value.unshift({
					id: currentSessionId.value,
					title:
						titleText.slice(0, 15) + (titleText.length > 15 ? '...' : ''),
					createdAt: now,
					updatedAt: now,
					messages: clone(chatHistory.value),
					activeAttachmentIds: clone(activeAttachmentIds.value),
				});
			} else {
				const sessionIndex = chatSessions.value.findIndex(
					session => session.id === currentSessionId.value,
				);
				if (sessionIndex !== -1) {
					const session = chatSessions.value[sessionIndex];
					session.messages = clone(chatHistory.value);
					session.activeAttachmentIds = clone(activeAttachmentIds.value);
					session.updatedAt = now;
					chatSessions.value.splice(sessionIndex, 1);
					chatSessions.value.unshift(session);
				}
			}
		}
		persistSessionList();
	};

	const loadDataFromLocalStorage = () => {
		if (initialized.value) return;

		const result = loadChatSessions(localStorage);
		chatSessions.value = result.sessions.sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);
		initialized.value = true;

		if (result.recoveredFromError) {
			ElMessage.warning(
				'部分本地会话无法读取，原始数据已保留，请查看迁移备份。',
			);
		}

		currentSessionId.value = null;
		chatHistory.value = [];
		activeAttachmentIds.value = [];
	};

	const startNewChat = () => {
		if (isAssistantTyping.value) {
			return ElMessage.warning('AI正在输出，请稍后再试。');
		}
		currentSessionId.value = null;
		chatHistory.value = [];
		activeAttachmentIds.value = [];
	};

	const switchSession = (id: string) => {
		if (isAssistantTyping.value) {
			return ElMessage.warning('AI正在输出，请稍后再试。');
		}
		const session = chatSessions.value.find(item => item.id === id);
		if (session) {
			currentSessionId.value = id;
			chatHistory.value = clone(session.messages);
			activeAttachmentIds.value = clone(session.activeAttachmentIds);
		}
	};

	const setActiveAttachmentIds = (ids: readonly string[]) => {
		activeAttachmentIds.value = normalizeAttachmentIds(ids);
		const session = chatSessions.value.find(
			item => item.id === currentSessionId.value,
		);
		if (session) {
			session.activeAttachmentIds = clone(activeAttachmentIds.value);
			session.updatedAt = Date.now();
			persistSessionList();
		}
	};

	const reconcileActiveAttachmentIds = (
		availableIds: readonly string[],
	): string[] => {
		const available = new Set(availableIds);
		const missingIds = activeAttachmentIds.value.filter(
			id => !available.has(id),
		);
		if (missingIds.length) {
			setActiveAttachmentIds(
				activeAttachmentIds.value.filter(id => available.has(id)),
			);
		}
		return missingIds;
	};

	const resolveAttachmentContext = (
		requestedIds: readonly string[],
		runtimeResults?: readonly ChatAttachment[],
	) => {
		const all = runtimeResults
			? [...runtimeResults]
			: loadAttachmentResults(localStorage).attachments;
		const byId = new Map(
			all.map(attachment => [attachment.id, attachment]),
		);
		const active: ChatAttachment[] = [];

		for (const id of requestedIds) {
			const attachment = byId.get(id);
			if (!attachment) {
				ElMessage.error('附件解析结果已丢失，请移除后重新选择文件。');
				return null;
			}
			if (attachment.status !== 'ready') {
				ElMessage.error(`附件“${attachment.name}”尚未解析完成。`);
				return null;
			}
			if (attachment.kind === 'document') {
				if (!attachment.text.trim()) {
					ElMessage.error(
						`附件“${attachment.name}”未提取到可用文本，扫描版 PDF 暂不支持 OCR。`,
					);
					return null;
				}
			} else if (
				!attachment.result ||
				(!attachment.result.summary.trim() &&
					!attachment.result.extractedText.trim() &&
					attachment.result.objects.length === 0)
			) {
				ElMessage.error(`图片“${attachment.name}”缺少可用的分析结果。`);
				return null;
			}
			active.push(attachment);
		}

		const totalCharacters = active.reduce(
			(total, attachment) => {
				const contextText =
					attachment.kind === 'document'
						? attachment.text
						: [
								attachment.result?.summary ?? '',
								attachment.result?.extractedText ?? '',
								...(attachment.result?.objects ?? []),
							].join('\n');
				return total + Array.from(contextText).length;
			},
			0,
		);
		if (totalCharacters > MAX_ACTIVE_ATTACHMENT_TEXT_LENGTH) {
			ElMessage.error('当前启用的附件文本总计不能超过 80,000 字符。');
			return null;
		}

		return { all, active };
	};

	const getMessageAttachmentIds = (message: ChatMessage): string[] =>
			normalizeAttachmentIds(
			message.contents
				.filter(
					content => content.type === 'file' || content.type === 'image',
				)
				.map(content => content.attachmentId),
		);

	const deleteSession = (id: string) => {
		chatSessions.value = chatSessions.value.filter(item => item.id !== id);
		if (currentSessionId.value === id) startNewChat();
		persistSessionList();
	};

	const updateSessionTitle = (id: string, newTitle: string) => {
		const session = chatSessions.value.find(item => item.id === id);
		if (session) {
			session.title = newTitle;
			session.updatedAt = Date.now();
			persistSessionList();
		}
	};

	const handleChat = async ({
		input = '',
		userInput = '',
		updateIndex,
		attachmentIds,
		attachmentResults,
	}: ChatParams = {}) => {
		if (isAssistantTyping.value) {
			ElMessage.warning('AI正在输出，请稍后再试。');
			return;
		}

		const normalizedInput = (userInput || input).trim();
		if (!normalizedInput) {
			ElMessage.error('输入不能为空！');
			return;
		}

		const isRegeneration = updateIndex !== undefined;
		const previousUserMessage = isRegeneration
			? chatHistory.value
					.slice(0, updateIndex)
					.reverse()
					.find(message => message.role === 'user')
			: undefined;
		const requestAttachmentIds = isRegeneration
			? normalizeAttachmentIds(
					attachmentIds ??
						(previousUserMessage
							? getMessageAttachmentIds(previousUserMessage)
							: []),
				)
			: attachmentIds !== undefined
				? normalizeAttachmentIds(attachmentIds)
				: [...activeAttachmentIds.value];

		if (requestAttachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
			ElMessage.error(
				`每条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`,
			);
			return;
		}
		if (!isRegeneration && attachmentIds !== undefined) {
			activeAttachmentIds.value = [...requestAttachmentIds];
		}

		const attachmentContext = resolveAttachmentContext(
			requestAttachmentIds,
			attachmentResults,
		);
		if (!attachmentContext) return;
		const contextOptions = {
			activeAttachmentIds: requestAttachmentIds,
			attachmentResults: attachmentContext.all,
		};

		if (detectImageGenerationIntent(normalizedInput)) {
			if (updateIndex !== undefined) {
				const target = chatHistory.value[updateIndex];
				if (!target || target.role !== 'assistant') {
					ElMessage.error('无法重新生成这条回复。');
					return;
				}

				chatHistory.value.splice(updateIndex + 1);
				target.status = 'completed';
				target.reasoning = '';
				target.usage = undefined;
				target.errorCode = undefined;
				setMessageText(target, IMAGE_GENERATION_UNAVAILABLE_MESSAGE);
			} else {
				chatHistory.value.push(
					createUserMessage(normalizedInput, attachmentContext.active),
					createTextMessage(
						'assistant',
						IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
						'completed',
					),
				);
			}

			saveSessionsToLocalStorage();
			return;
		}

		let requestMessages: ProviderMessage[];
		let targetIndex: number;

		if (updateIndex !== undefined) {
			const target = chatHistory.value[updateIndex];
			if (!target || target.role !== 'assistant') {
				ElMessage.error('无法重新生成这条回复。');
				return;
			}

			requestMessages = buildChatContext(
				chatHistory.value,
				updateIndex,
				contextOptions,
			);
			chatHistory.value.splice(updateIndex + 1);
			target.status = 'pending';
			target.contents = [];
			target.reasoning = '';
			target.usage = undefined;
			target.errorCode = undefined;
			targetIndex = updateIndex;
		} else {
			chatHistory.value.push(
				createUserMessage(normalizedInput, attachmentContext.active),
			);
			requestMessages = buildChatContext(
				chatHistory.value,
				chatHistory.value.length,
				contextOptions,
			);
			chatHistory.value.push(createTextMessage('assistant', '', 'pending'));
			targetIndex = chatHistory.value.length - 1;
		}

		requestMessages = [
			{ role: 'system', content: CHAT_CAPABILITY_SYSTEM_PROMPT },
			...requestMessages,
		];

		isAssistantTyping.value = true;
		assistantMessageIndex = targetIndex;
		saveSessionsToLocalStorage();

		const controller = new AbortController();
		abortController.value = controller;

		try {
			for await (const event of chatProvider.stream({
				messages: requestMessages,
				mode: settingsStore.modelMode,
				clientId: settingsStore.clientId,
				signal: controller.signal,
			})) {
				if (assistantMessageIndex !== targetIndex) break;
				const target = chatHistory.value[targetIndex];
				if (!target) break;

				switch (event.type) {
					case 'reasoning-delta':
						target.status = 'streaming';
						target.reasoning = (target.reasoning || '') + event.text;
						break;
					case 'text-delta':
						target.status = 'streaming';
						appendMessageText(target, event.text);
						break;
					case 'usage':
						target.usage = event.usage;
						break;
					case 'error':
						target.status = 'error';
						target.errorCode = event.error.code;
						setMessageText(target, event.error.message);
						break;
					case 'start':
					case 'done':
						break;
				}
			}

			if (assistantMessageIndex === targetIndex) {
				const target = chatHistory.value[targetIndex];
				if (target && target.status !== 'error') {
					if (getMessageText(target).trim()) {
						target.status = 'completed';
					} else {
						target.status = 'error';
						target.errorCode = 'EMPTY_RESPONSE';
						setMessageText(target, '模型未返回内容，请重试。');
					}
				}
				saveSessionsToLocalStorage();
			}
		} catch (error: unknown) {
			const isAbortError =
				error instanceof Error && error.name === 'AbortError';
			if (!isAbortError && assistantMessageIndex === targetIndex) {
				const target = chatHistory.value[targetIndex];
				if (target) {
					target.status = 'error';
					target.errorCode = 'CHAT_REQUEST_FAILED';
					setMessageText(
						target,
						error instanceof Error ? error.message : '未知异常',
					);
				}
				saveSessionsToLocalStorage();
			}
		} finally {
			if (assistantMessageIndex === targetIndex) assistantMessageIndex = -1;
			if (abortController.value === controller) abortController.value = null;
			isAssistantTyping.value = false;
		}
	};

	const pauseChat = () => {
		abortController.value?.abort();

		if (
			assistantMessageIndex !== -1 &&
			chatHistory.value[assistantMessageIndex]
		) {
			const chat = chatHistory.value[assistantMessageIndex];
			if (!getMessageText(chat).trim()) setMessageText(chat, '已停止回复');
			chat.status = 'stopped';
			saveSessionsToLocalStorage();
			assistantMessageIndex = -1;
		}

		isAssistantTyping.value = false;
		ElMessage.success('已停止AI输出。');
	};

	const handleUpdate = async (
		index: number,
		attachmentResults?: ChatAttachment[],
	) => {
		const previousUserMessage = chatHistory.value
			.slice(0, index)
			.reverse()
			.find(chat => chat.role === 'user');

		if (!previousUserMessage) {
			ElMessage.warning('没有找到对应的用户消息。');
			return;
		}

		await handleChat({
			userInput: getMessageText(previousUserMessage),
			updateIndex: index,
			attachmentIds: getMessageAttachmentIds(previousUserMessage),
			attachmentResults,
		});
	};

	return {
		chatSessions,
		currentSessionId,
		chatHistory,
		activeAttachmentIds,
		isAssistantTyping,
		isSidebarOpen,
		initialized,
		startNewChat,
		switchSession,
		deleteSession,
		updateSessionTitle,
		loadDataFromLocalStorage,
		setActiveAttachmentIds,
		reconcileActiveAttachmentIds,
		handleChat,
		pauseChat,
		handleUpdate,
	};
});
