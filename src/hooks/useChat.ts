import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import { cozeApi } from '../api/coze';

//聊天消息
export interface ChatMessage {
	message: string;
	isUser: boolean;
	isComplete: boolean;
}

//聊天会话
export interface ChatSession {
	id: string;
	title: string;
	date: string;
	messages: ChatMessage[];
}

interface SearchParams {
	input?: string;
	fileList?: UploadUserFile[];
	userInput?: string;
	updateIndex?: number;
}

const chatSessions = ref<ChatSession[]>([]);
const currentSessionId = ref<string | null>(null); // 记录当前会话id
const chatHistory = ref<ChatMessage[]>([]); // 当前会话的聊天记录

const isAssistantTyping = ref(false);
const abortController = ref<AbortController | null>(null);

const streamedOutput = ref('');
const streamedText = ref('');
let assistantMessageIndex = -1;

const isSidebarOpen = ref(true);

export function useChat() {
	const saveSessionsToLocalStorage = () => {
		// 每次发生对话时，同步当前消息到会话列表中
		if (chatHistory.value.length > 0) {
			if (!currentSessionId.value) {
				// 如果是新会话，自动生成ID且取用户的第一句话作为标题
				currentSessionId.value = Date.now().toString();
				chatSessions.value.unshift({
					//向chatSessions开头添加新会话
					id: currentSessionId.value,
					title:
						chatHistory.value[0].message.slice(0, 15) +
						(chatHistory.value[0].message.length > 15 ? '...' : ''),
					date: new Date().toISOString(),
					messages: JSON.parse(JSON.stringify(chatHistory.value)), // 深拷贝防污染
				});
			} else {
				// 如果是已有会话，更新对应session的消息列表
				const session = chatSessions.value.find(
					targetSession => targetSession.id === currentSessionId.value,
				);
				if (session) {
					session.messages = JSON.parse(JSON.stringify(chatHistory.value));
				}
			}
		}
		localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
	};

	const loadDataFromLocalStorage = () => {
		const storedData = localStorage.getItem('chatSessions');
		if (storedData) {
			chatSessions.value = JSON.parse(storedData);
		}
		// 每次刷新页面，默认准备好一个干净的新会话
		startNewChat();
	};

	//重置会话状态
	const startNewChat = () => {
		if (isAssistantTyping.value)
			return ElMessage.warning(
				'The assistant is outputting, please try again later.',
			);
		currentSessionId.value = null;
		chatHistory.value = [];
	};

	//切换会话
	const switchSession = (id: string) => {
		if (isAssistantTyping.value)
			return ElMessage.warning(
				'The assistant is outputting, please try again later.',
			);
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
			startNewChat(); // 如果删的是当前正在聊的，自动重置为空白新对话
		} else {
			localStorage.setItem('chatSessions', JSON.stringify(chatSessions.value));
		}
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

	const updateUI = () => {
		streamedOutput.value = chatHistory.value
			.map(chatMessage => chatMessage.message)
			.join('');
	};

	const updateLastAssistantMessage = () => {
		if (streamedText.value !== '') {
			//如果当前有正在输出的AI消息，实时更新它的内容
			chatHistory.value[assistantMessageIndex] = {
				message: `${streamedText.value}`,
				isUser: false,
				isComplete: false,
			};
			updateUI();
		}
	};

	const processStreamedData = (chunk: string) => {
		const lines = chunk.split('\n');
		let isDeltaEvent = false;
		let jsonDataLine = '';
		for (const line of lines) {
			if (line.startsWith('event:conversation.message.delta')) {
				isDeltaEvent = true;
				continue;
			}
			if (isDeltaEvent && line.startsWith('data:')) {
				jsonDataLine = line.replace('data:', '').trim();
				isDeltaEvent = false;
			}
			if (jsonDataLine) {
				try {
					const parsedData = JSON.parse(jsonDataLine);
					if (parsedData.role === 'assistant' && parsedData.type === 'answer') {
						streamedText.value += parsedData.content;
						updateLastAssistantMessage();
					}
				} catch (error) {
					console.warn('JSON Parse Error:', error);
				}
				jsonDataLine = '';
			}
		}
	};

	const handleSearch = async ({
		input = '',
		fileList = [],
		userInput = '', //用于重新生成ai回复时候，上一次的input副本
		updateIndex,
	}: SearchParams = {}) => {
		if (isAssistantTyping.value) {
			ElMessage.warning('The assistant is outputting, please try again later.');
			return;
		}
		if (!input.trim() && !userInput) {
			ElMessage.error('Input cannot be empty or just spaces!');
			return;
		}
		if (userInput) input = userInput;

		isAssistantTyping.value = true;

		if (updateIndex !== undefined) {
			const chat = chatHistory.value[updateIndex];
			chat.message = '<div class="loading-spinner"></div>';
			chat.isComplete = false;
		} else {
			chatHistory.value.push({
				message: `${input}`,
				isUser: true,
				isComplete: false,
			});
			chatHistory.value.push({
				message: '<div class="loading-spinner"></div>',
				isUser: false,
				isComplete: false,
			});
		}

		assistantMessageIndex = chatHistory.value.length - 1;
		streamedText.value = '';

		// 发送消息时，立刻同步保存到本地列表
		saveSessionsToLocalStorage();

		let messagesContent: any[] = [];
		if (fileList.length > 0) {
			const contentArray: any[] = fileList.map(file => {
				// 根据文件后缀判断是否为图片
				const isImage = file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
				return {
					type: isImage ? 'image' : 'file',
					file_id: file.url,
				};
			});
			contentArray.push({ type: 'text', text: input });
			console.log('contentArray:', contentArray);
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
					if (!isAssistantTyping.value) break;
					const { done, value } = await reader.read();
					if (done) {
						if (assistantMessageIndex !== -1)
							chatHistory.value[assistantMessageIndex].isComplete = true;
						assistantMessageIndex = -1;
						isAssistantTyping.value = false;
						break;
					}
					const text = decoder.decode(value, { stream: true });
					processStreamedData(text);

					let answerValue;
					try {
						if (text.startsWith('event:conversation.message.completed')) {
							const dataStartIndex = text.indexOf('data:');
							if (dataStartIndex !== -1) {
								const jsonString = text.substring(dataStartIndex + 5).trim();
								if (jsonString.includes('"type":"answer"')) {
									const parsedData = JSON.parse(jsonString);
									if (parsedData.type === 'answer' && parsedData.content) {
										answerValue = parsedData.content;
									}
								}
							}
						}
					} catch (error) {
						console.error('Failed to parse JSON:', error);
					}
					if (answerValue) {
						if (assistantMessageIndex !== -1)
							chatHistory.value[assistantMessageIndex].message = answerValue;
						// AI 输出完最终结果后，再深拷贝保存一次完整上下文
						saveSessionsToLocalStorage();
					}
					updateUI();
				}
			}
		} catch (error) {
			isAssistantTyping.value = false;
		}
	};

	const pauseSearch = () => {
		if (abortController.value) abortController.value.abort();
		isAssistantTyping.value = false;
		ElMessage.success('Paused assistant output.');
	};

	const handleUpdate = async (index: number) => {
		const latestUserMessage = chatHistory.value
			.slice()
			.reverse()
			.find(chat => chat.isUser);
		if (latestUserMessage) {
			await handleSearch({
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
		startNewChat,
		switchSession,
		deleteSession,
		updateSessionTitle,
		loadDataFromLocalStorage,
		chatHistory,
		isAssistantTyping,
		handleSearch,
		pauseSearch,
		handleUpdate,
		isSidebarOpen,
	};
}
