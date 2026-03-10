import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import type { User } from '../types/User';

//请求参数
interface SearchParams {
	input?: string;
	fileList?: UploadUserFile[];
	userInput?: string;
	updateIndex?: number;
}
//tableData:展示在aside的对话历史
const tableData = ref<User[]>([]);
//对话历史
const chatHistory = ref<
	{ message: string; isUser: boolean; isComplete: boolean }[]
>([]);

//ai是否正在输出
const isAssistantTyping = ref(false);

// 用于中断 fetch 请求
const abortController = ref<AbortController | null>(null);

//处理流式输出
const streamedOutput = ref('');
const streamedText = ref('');
let assistantMessageIndex = -1;

export function useChat() {
	const saveDataToLocalStorage = () => {
		localStorage.setItem('tableData', JSON.stringify(tableData.value));
	};

	const loadDataFromLocalStorage = () => {
		const storedData = localStorage.getItem('tableData');
		if (storedData) {
			tableData.value = JSON.parse(storedData);
		}
	};

	// 更新UI的函数
	const updateUI = () => {
		streamedOutput.value = chatHistory.value.join('');
	};

	const updateLastAssistantMessage = () => {
		if (assistantMessageIndex !== -1) {
			chatHistory.value[assistantMessageIndex] = {
				message: `${streamedText.value}`,
				isUser: false, // 标记为 AI 消息
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
						// 仅更新最后一条消息，不重复添加
						updateLastAssistantMessage();
					}
				} catch (error) {
					console.warn('JSON Parse Error:', error);
				}
				jsonDataLine = '';
			}
		}
	};

	//调用模型搜索用户提问
	const handleSearch = async ({
		input = '',
		fileList = [],
		userInput = '',
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
		// 如果传入了 userInput，则更新 input
		if (userInput) {
			input = userInput;
		}

		// 助手正在输出
		isAssistantTyping.value = true;

		// 如果是更新操作，直接修改现有消息
		if (updateIndex !== undefined) {
			const chat = chatHistory.value[updateIndex];
			chat.message = '<div class="loading-spinner"></div>'; // 显示加载状态
			chat.isComplete = false;
		} else {
			//用户消息存为对象
			chatHistory.value.push({
				message: `${input}`, // 处理换行
				isUser: true,
				isComplete: false,
			});

			//  添加 AI 占位符
			chatHistory.value.push({
				message: '<div class="loading-spinner"></div>',
				isUser: false,
				isComplete: false,
			});
		}

		assistantMessageIndex = chatHistory.value.length - 1; // 记录索引
		streamedText.value = '';

		let payload; //payload 是最终发送给 API 的 JSON 字符串
		if (fileList.length > 0) {
			const fileId = fileList[0].url;
			const content = JSON.stringify([
				{ type: 'image', file_id: fileId },
				{ type: 'text', text: input },
			]);
			payload = JSON.stringify({
				bot_id: '7477508764942237750',
				user_id: '123456789',
				stream: true,
				auto_save_history: true,
				additional_messages: [
					{
						role: 'user',
						content: content,
						content_type: 'object_string',
					},
				],
			});
		} else {
			payload = JSON.stringify({
				bot_id: '7477508764942237750',
				user_id: '123456789',
				stream: true,
				auto_save_history: true,
				additional_messages: [
					{
						role: 'user',
						content: input,
						content_type: 'text',
					},
				],
			});
		}

		try {
			abortController.value = new AbortController();
			const response = await fetch('https://api.coze.cn/v3/chat', {
				method: 'POST',
				headers: {
					Authorization:
						'Bearer pat_whaPptjAIGmXgOyXc3BZtdPrvNQEhTTOocziJnumTAGOI8vv2a00yvUxl0v7r1Mo',
					'Content-Type': 'application/json',
				},
				body: payload,
				signal: abortController.value.signal, // 绑定 AbortSignal
			});
			//记录到历史记录
			tableData.value.push({
				date: new Date().toISOString(),
				work: `User: ${input}`,
			});
			saveDataToLocalStorage();
			if (!response.ok) {
				throw new Error('Network response was not ok ' + response.statusText);
			}
			const reader = response.body?.getReader();
			if (reader) {
				const decoder = new TextDecoder();
				let streamedText = '';
				while (true) {
					// 检查是否被暂停
					if (!isAssistantTyping.value) {
						break;
					}
					const { done, value } = await reader.read();
					if (done) {
						if (assistantMessageIndex !== -1) {
							chatHistory.value[assistantMessageIndex].isComplete = true; // 标记为完成
						}
						assistantMessageIndex = -1;
						// 助手输出完成
						isAssistantTyping.value = false;
						// 输出已完成，清空输入框
						input = '';
						break;
					}
					const text = decoder.decode(value, { stream: true });
					processStreamedData(text);

					// 将助手返回写到历史记录
					let answerValue;
					try {
						// text 以 "event:conversation.message.completed" 开头
						if (text.startsWith('event:conversation.message.completed')) {
							// 查找 "data:" 的位置
							const dataStartIndex = text.indexOf('data:');
							if (dataStartIndex !== -1) {
								// 提取 JSON 字符串部分
								const jsonString = text.substring(dataStartIndex + 5).trim();
								// 检查字符串中是否包含 "type":"answer"
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
						tableData.value.push({
							date: new Date().toISOString(),
							work: `Assistant: ${answerValue}`,
						});
						saveDataToLocalStorage();
						// 更新当前消息内容
						if (assistantMessageIndex !== -1) {
							chatHistory.value[assistantMessageIndex].message = answerValue;
						}
					}
					// 更新UI
					updateUI();
				}
			}
		} catch (error) {
			// 助手输出完成状态（处理错误时）
			isAssistantTyping.value = false;
		}
	};

	//暂停模型
	const pauseSearch = () => {
		if (abortController.value) {
			abortController.value.abort(); // 中断 fetch 请求
		}
		isAssistantTyping.value = false;
		ElMessage.success('Paused assistant output.');
	};

	// 处理更新
	const handleUpdate = async (index: number) => {
		// 查找最新的用户消息
		const latestUserMessage = chatHistory.value
			.slice()
			.reverse()
			.find(chat => chat.isUser);

		if (latestUserMessage) {
			// 调用 handleSearch，传入最新的用户消息和需要更新的索引
			await handleSearch({
				userInput: latestUserMessage.message,
				updateIndex: index,
			});
		} else {
			ElMessage.warning('没有找到用户消息。');
		}
	};

	return {
		tableData,
		saveDataToLocalStorage,
		loadDataFromLocalStorage,
		chatHistory,
		isAssistantTyping,
		handleSearch,
		pauseSearch,
		handleUpdate,
	};
}
