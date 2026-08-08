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
import { chatApi, type ChatMessagePayload } from '../api/chat';
import {
	appendMessageText,
	buildChatContext,
	getMessageText,
	mapTokenUsage,
	setMessageText,
} from '../services/context/buildChatContext';
import {
	loadChatSessions,
	saveChatSessions,
} from '../services/storage/chatStorage';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

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

export const useChatStore = defineStore('chat', () => {
	const chatSessions = ref<ChatSession[]>([]);
	const currentSessionId = ref<string | null>(null);
	const chatHistory = ref<ChatMessage[]>([]);
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
					activeAttachmentIds: [],
				});
			} else {
				const sessionIndex = chatSessions.value.findIndex(
					session => session.id === currentSessionId.value,
				);
				if (sessionIndex !== -1) {
					const session = chatSessions.value[sessionIndex];
					session.messages = clone(chatHistory.value);
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
	};

	const startNewChat = () => {
		if (isAssistantTyping.value) {
			return ElMessage.warning('AI正在输出，请稍后再试。');
		}
		currentSessionId.value = null;
		chatHistory.value = [];
	};

	const switchSession = (id: string) => {
		if (isAssistantTyping.value) {
			return ElMessage.warning('AI正在输出，请稍后再试。');
		}
		const session = chatSessions.value.find(item => item.id === id);
		if (session) {
			currentSessionId.value = id;
			chatHistory.value = clone(session.messages);
		}
	};

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

		let requestMessages: ChatMessagePayload[];
		let targetIndex: number;

		if (updateIndex !== undefined) {
			const target = chatHistory.value[updateIndex];
			if (!target || target.role !== 'assistant') {
				ElMessage.error('无法重新生成这条回复。');
				return;
			}

			requestMessages = buildChatContext(chatHistory.value, updateIndex);
			chatHistory.value.splice(updateIndex + 1);
			target.status = 'pending';
			target.contents = [];
			target.reasoning = '';
			target.usage = undefined;
			target.errorCode = undefined;
			targetIndex = updateIndex;
		} else {
			chatHistory.value.push(
				createTextMessage('user', normalizedInput, 'completed'),
			);
			requestMessages = buildChatContext(chatHistory.value);
			chatHistory.value.push(createTextMessage('assistant', '', 'pending'));
			targetIndex = chatHistory.value.length - 1;
		}

		isAssistantTyping.value = true;
		assistantMessageIndex = targetIndex;
		saveSessionsToLocalStorage();

		const controller = new AbortController();
		abortController.value = controller;

		try {
			for await (const chunk of chatApi.chatStream(
				requestMessages,
				controller.signal,
			)) {
				if (assistantMessageIndex !== targetIndex) break;
				const target = chatHistory.value[targetIndex];
				if (!target) break;

				if (chunk.reasoningContent || chunk.content) {
					target.status = 'streaming';
				}
				if (chunk.reasoningContent) {
					target.reasoning = (target.reasoning || '') + chunk.reasoningContent;
				}
				if (chunk.content) appendMessageText(target, chunk.content);
				if (chunk.usage) target.usage = mapTokenUsage(chunk.usage);
			}

			if (assistantMessageIndex === targetIndex) {
				const target = chatHistory.value[targetIndex];
				if (target) {
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

	const handleUpdate = async (index: number) => {
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
		});
	};

	return {
		chatSessions,
		currentSessionId,
		chatHistory,
		isAssistantTyping,
		isSidebarOpen,
		initialized,
		startNewChat,
		switchSession,
		deleteSession,
		updateSessionTitle,
		loadDataFromLocalStorage,
		handleChat,
		pauseChat,
		handleUpdate,
	};
});
