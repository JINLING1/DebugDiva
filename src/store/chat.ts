import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { ChatSession, ChatMessage, ChatParams } from '../types/chatType';
import { chatApi, type ChatMessagePayload } from '../api/chat';

const LOADING_MESSAGE = '<div class="loading-spinner"></div>';

export const useChatStore = defineStore('chat', () => {
	const chatSessions = ref<ChatSession[]>([]);
	const currentSessionId = ref<string | null>(null);
	const chatHistory = ref<ChatMessage[]>([]);
	const isAssistantTyping = ref(false);
	const isSidebarOpen = ref(window.innerWidth > 768);

	const abortController = ref<AbortController | null>(null);
	let assistantMessageIndex = -1;

	const saveSessionsToLocalStorage = () => {
		if (chatHistory.value.length > 0) {
			if (!currentSessionId.value) {
				currentSessionId.value = Date.now().toString();
				chatSessions.value.unshift({
					id: currentSessionId.value,
					title:
						chatHistory.value[0].message.slice(0, 15) +
						(chatHistory.value[0].message.length > 15 ? '...' : ''),
					date: new Date().toISOString(),
					messages: JSON.parse(JSON.stringify(chatHistory.value)),
				});
			} else {
				const sessionIndex = chatSessions.value.findIndex(
					targetSession => targetSession.id === currentSessionId.value,
				);
				if (sessionIndex !== -1) {
					const session = chatSessions.value[sessionIndex];
					session.messages = JSON.parse(JSON.stringify(chatHistory.value));
					session.date = new Date().toISOString();
					chatSessions.value.splice(sessionIndex, 1);
					chatSessions.value.unshift(session);
				}
			}
		}
		localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
	};

	const loadDataFromLocalStorage = () => {
		const storedData = localStorage.getItem('chatSessions');
		if (storedData) {
			try {
				chatSessions.value = JSON.parse(storedData);
				chatSessions.value.sort(
					(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
				);
			} catch {
				chatSessions.value = [];
				localStorage.removeItem('chatSessions');
			}
		}
		startNewChat();
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
			chatHistory.value = JSON.parse(JSON.stringify(session.messages));
		}
	};

	const deleteSession = (id: string) => {
		chatSessions.value = chatSessions.value.filter(item => item.id !== id);
		if (currentSessionId.value === id) startNewChat();
		localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
	};

	const updateSessionTitle = (id: string, newTitle: string) => {
		const session = chatSessions.value.find(item => item.id === id);
		if (session) {
			session.title = newTitle;
			localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
		}
	};

	const isContextMessage = (message: ChatMessage) => {
		if (!message.message || message.message === LOADING_MESSAGE) return false;
		if (!message.isUser && !message.isComplete) return false;
		return !/^\*\*\[(?:系统错误|请求失败)\]\*\*/.test(message.message);
	};

	const toApiMessages = (messages: ChatMessage[]): ChatMessagePayload[] =>
		messages.filter(isContextMessage).map(message => ({
			role: message.isUser ? 'user' : 'assistant',
			content: message.message,
		}));

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
			if (!target || target.isUser) {
				ElMessage.error('无法重新生成这条回复。');
				return;
			}
			requestMessages = toApiMessages(chatHistory.value.slice(0, updateIndex));
			chatHistory.value.splice(updateIndex + 1);
			target.message = LOADING_MESSAGE;
			target.reasoning = '';
			target.isComplete = false;
			targetIndex = updateIndex;
		} else {
			chatHistory.value.push({
				id: `msg-${Date.now()}-user`,
				message: normalizedInput,
				isUser: true,
				isComplete: true,
			});
			requestMessages = toApiMessages(chatHistory.value);
			chatHistory.value.push({
				id: `msg-${Date.now()}-ai`,
				message: LOADING_MESSAGE,
				isUser: false,
				isComplete: false,
				reasoning: '',
			});
			targetIndex = chatHistory.value.length - 1;
		}

		isAssistantTyping.value = true;
		assistantMessageIndex = targetIndex;
		saveSessionsToLocalStorage();

		const controller = new AbortController();
		abortController.value = controller;
		let streamedText = '';

		try {
			for await (const chunk of chatApi.chatStream(
				requestMessages,
				controller.signal,
			)) {
				if (assistantMessageIndex !== targetIndex) break;
				const target = chatHistory.value[targetIndex];
				if (!target) break;

				if (chunk.reasoningContent) {
					target.reasoning = (target.reasoning || '') + chunk.reasoningContent;
				}
				if (chunk.content) {
					streamedText += chunk.content;
					target.message = streamedText;
				}
			}

			if (assistantMessageIndex === targetIndex) {
				const target = chatHistory.value[targetIndex];
				if (target) {
					if (!streamedText) target.message = '模型未返回内容，请重试。';
					target.isComplete = true;
				}
				saveSessionsToLocalStorage();
			}
		} catch (error: any) {
			if (error?.name !== 'AbortError' && assistantMessageIndex === targetIndex) {
				const target = chatHistory.value[targetIndex];
				if (target) {
					target.message = `**[系统错误]** ${error?.message || '未知异常'}`;
					target.isComplete = true;
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
			chat.message =
				chat.message === LOADING_MESSAGE
					? '已停止回复'
					: `${chat.message}\n\n*(已停止回复)*`;
			chat.isComplete = true;
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
			.find(chat => chat.isUser);

		if (!previousUserMessage) {
			ElMessage.warning('没有找到对应的用户消息。');
			return;
		}

		await handleChat({
			userInput: previousUserMessage.message,
			updateIndex: index,
		});
	};

	return {
		chatSessions,
		currentSessionId,
		chatHistory,
		isAssistantTyping,
		isSidebarOpen,
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
