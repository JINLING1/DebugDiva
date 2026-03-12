import { getConfig } from '../utils/configHelper';
const api_key = getConfig('COZE_API_KEY');
const bot_id = getConfig('COZE_BOT_ID');
const chat_url = getConfig('COZE_CHAT_URL');
const file_url = getConfig('COZE_FILE_URL');

export const cozeApi = {
	async chatStream(additionalMessages: any[], signal: AbortSignal) {
		//请求体
		const payload = {
			bot_id: bot_id,
			user_id: '123456789',
			stream: true,
			auto_save_history: true,
			additional_messages: additionalMessages,
		};

		const response = await fetch(chat_url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${api_key}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
			signal, // 用于支持中断请求
		});

		if (!response.ok) {
			throw new Error(`API 请求失败: ${response.statusText}`);
		}

		//返回数据流读取器
		return response.body?.getReader();
	},

	async uploadFile(file: File) {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(`${file_url}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${api_key}`,
			},
			body: formData,
		});

		const responseData = await response.json();

		if (response.ok && responseData?.code === 0) {
			return responseData.data;
		} else {
			throw new Error(responseData?.msg || '上传文件失败');
		}
	},
};
