import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { ChatSession, ChatMessage, ChatParams } from '../types/chatType';
import { cozeApi } from '../api/coze';

export const useChatStore = defineStore('chat', () => {
	const chatSessions = ref<ChatSession[]>([]);
	const currentSessionId = ref<string | null>(null);
	const chatHistory = ref<ChatMessage[]>([]); //当前活跃会话的消息列表
	const isAssistantTyping = ref(false);
	const isSidebarOpen = ref(window.innerWidth > 768);

	const abortController = ref<AbortController | null>(null);
	const streamedText = ref('');
	let assistantMessageIndex = -1;
	let streamBuffer = '';

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
					//更新过的session移动到最顶部
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
			chatSessions.value = JSON.parse(storedData);
			//加载时根据最后对话时间降序排序，确保最近的在最上方
			chatSessions.value.sort(
				(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
			);
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
		const session = chatSessions.value.find(
			targetSession => targetSession.id === id,
		);
		if (session) {
			currentSessionId.value = id;
			chatHistory.value = JSON.parse(JSON.stringify(session.messages));
		}
	};

	const deleteSession = (id: string) => {
		chatSessions.value = chatSessions.value.filter(
			targetSession => targetSession.id !== id,
		);
		if (currentSessionId.value === id) {
			startNewChat();
		}
		localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
	};

	const updateSessionTitle = (id: string, newTitle: string) => {
		const session = chatSessions.value.find(
			targetSession => targetSession.id === id,
		);
		if (session) {
			session.title = newTitle;
			localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
		}
	};

	//用于将流式响应的内容更新到chatHistory的最后一个assistant消息
	const updateLastAssistantMessage = () => {
		if (streamedText.value !== '') {
			chatHistory.value[assistantMessageIndex].message = streamedText.value;
		}
	};

	const parseEventBlock = (block: string) => {
		const lines = block.split('\n');
		let eventType = '';
		let eventData = '';

		for (const line of lines) {
			if (line.startsWith('event:')) {
				eventType = line.substring(6).trim();
			} else if (line.startsWith('data:')) {
				eventData = line.substring(5).trim();
			}
		}

		if (!eventData) return;

		try {
			if (eventType === 'conversation.message.delta') {
				const parsedData = JSON.parse(eventData);
				if (parsedData.role === 'assistant' && parsedData.type === 'answer') {
					streamedText.value += parsedData.content;
					updateLastAssistantMessage();
				}
			} else if (eventType === 'conversation.message.completed') {
				const parsedData = JSON.parse(eventData);
				if (parsedData.type === 'answer' && parsedData.content) {
					if (assistantMessageIndex !== -1) {
						chatHistory.value[assistantMessageIndex].message =
							parsedData.content;
						chatHistory.value[assistantMessageIndex].isComplete = true;
						saveSessionsToLocalStorage();
					}
				}
			} else if (eventType === 'conversation.chat.failed') {
				const parsedData = JSON.parse(eventData);
				if (assistantMessageIndex !== -1) {
					const errorMsg = parsedData.last_error?.msg || 'API 请求失败';
					chatHistory.value[assistantMessageIndex].message =
						`**[请求失败]** ${errorMsg}`;
					chatHistory.value[assistantMessageIndex].isComplete = true;
					saveSessionsToLocalStorage();
				}
			}
		} catch (error) {
			console.warn('JSON Parse Error:', error);
		}
	};

	const processStreamedData = (chunk: string) => {
		streamBuffer += chunk;
		let eolIndex;
		while ((eolIndex = streamBuffer.indexOf('\n\n')) >= 0) {
			const eventBlock = streamBuffer.slice(0, eolIndex);
			streamBuffer = streamBuffer.slice(eolIndex + 2);
			parseEventBlock(eventBlock);
		}
	};

	//向ai发送提问
	const handleChat = async ({
		input = '',
		fileList = [],
		userInput = '',
		updateIndex,
	}: ChatParams = {}) => {
		if (isAssistantTyping.value) {
			ElMessage.warning('AI正在输出，请稍后再试。');
			return;
		}
		if (!input.trim() && !userInput) {
			ElMessage.error('输入不能为空！');
			return;
		}
		if (userInput) input = userInput;

		isAssistantTyping.value = true;

		if (updateIndex !== undefined) {
			//更新ai旧回复
			const chat = chatHistory.value[updateIndex];
			chat.message = '<div class="loading-spinner"></div>';
			chat.isComplete = false;
			assistantMessageIndex = updateIndex;
		} else {
			//需要ai新回复
			chatHistory.value.push({
				id: `msg-${Date.now()}-user`,
				message: `${input}`,
				isUser: true,
				isComplete: false,
			});
			chatHistory.value.push({
				id: `msg-${Date.now()}-ai`,
				message: '<div class="loading-spinner"></div>',
				isUser: false,
				isComplete: false,
			});
			assistantMessageIndex = chatHistory.value.length - 1;
		}

		streamedText.value = '';
		streamBuffer = '';
		saveSessionsToLocalStorage();

		let messagesContent: any[] = [];
		if (fileList.length > 0) {
			const contentArray: any[] = fileList.map(file => {
				const isImage = file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
				return {
					type: isImage ? 'image' : 'file',
					file_id: file.url,
				};
			});
			contentArray.push({ type: 'text', text: input });
			messagesContent = [
				{
					role: 'user',
					content: JSON.stringify(contentArray),
					content_type: 'object_string',
				},
			];
		} else {
			messagesContent = [
				{ role: 'user', content: input, content_type: 'text' },
			];
		}

		try {
			abortController.value = new AbortController();
			const reader = await cozeApi.chatStream(
				messagesContent,
				abortController.value.signal,
			);
			if (reader) {
				const decoder = new TextDecoder();
				while (true) {
					//如果ai输出完成(isAssistantTyping为false)
					if (!isAssistantTyping.value) {
						if (assistantMessageIndex !== -1) {
							chatHistory.value[assistantMessageIndex].isComplete = true;
							saveSessionsToLocalStorage();
						}
						assistantMessageIndex = -1;
						break;
					}
					const { done, value } = await reader.read(); //done为true表示读取完成，value为当前读取到的数据
					if (done) {
						if (streamBuffer.trim()) {
							//处理流结束后遗留的chunk
							parseEventBlock(streamBuffer);
							streamBuffer = '';
						}
						if (assistantMessageIndex !== -1)
							chatHistory.value[assistantMessageIndex].isComplete = true;
						assistantMessageIndex = -1;
						isAssistantTyping.value = false;
						break;
					}
					const text = decoder.decode(value, { stream: true });
					processStreamedData(text);
				}
			}
		} catch (error: any) {
			isAssistantTyping.value = false;
			if (assistantMessageIndex !== -1) {
				chatHistory.value[assistantMessageIndex].message =
					`**[系统错误]** ${error.message || '未知异常'}`;
				chatHistory.value[assistantMessageIndex].isComplete = true;
				saveSessionsToLocalStorage();
			}
			assistantMessageIndex = -1;
		}
	};

	const pauseChat = () => {
		if (abortController.value) abortController.value.abort();
		isAssistantTyping.value = false;

		if (
			assistantMessageIndex !== -1 &&
			chatHistory.value[assistantMessageIndex]
		) {
			const chat = chatHistory.value[assistantMessageIndex];
			if (chat.message === '<div class="loading-spinner"></div>') {
				chat.message = '已停止回复';
			} else {
				chat.message += '\n\n*(已停止回复)*';
			}
			chat.isComplete = true;
			saveSessionsToLocalStorage();
			assistantMessageIndex = -1;
		}

		ElMessage.success('已暂停AI输出。');
	};

	const handleUpdate = async (index: number) => {
		const latestUserMessage = chatHistory.value
			.slice()
			.reverse()
			.find(chat => chat.isUser);
		if (latestUserMessage) {
			await handleChat({
				userInput: latestUserMessage.message,
				updateIndex: index,
			});
		} else {
			ElMessage.warning('没有找到用户消息。');
		}
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
