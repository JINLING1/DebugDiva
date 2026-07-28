export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessagePayload {
	role: ChatRole;
	content: string;
}

export interface ChatStreamChunk {
	content?: string;
	reasoningContent?: string;
	finishReason?: string | null;
	usage?: Record<string, number>;
}

interface ChatStreamOptions {
	thinking?: boolean;
	reasoningEffort?: 'high' | 'max';
}

const chatUrl = import.meta.env.VITE_CHAT_API_URL || '/api/chat';

const getErrorMessage = async (response: Response) => {
	const fallback = `${response.status} ${response.statusText}`.trim();

	try {
		const data = await response.json();
		return data?.error?.message || data?.message || fallback;
	} catch {
		return fallback;
	}
};

const findEventSeparator = (buffer: string) => {
	const match = /\r?\n\r?\n/.exec(buffer);
	return match ? { index: match.index, length: match[0].length } : null;
};

export const chatApi = {
	async *chatStream(
		messages: ChatMessagePayload[],
		signal: AbortSignal,
		options: ChatStreamOptions = {},
	): AsyncGenerator<ChatStreamChunk> {
		const response = await fetch(chatUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messages,
				thinking: options.thinking ?? false,
				reasoningEffort: options.reasoningEffort,
			}),
			signal,
		});

		if (!response.ok) {
			throw new Error(`API 请求失败：${await getErrorMessage(response)}`);
		}

		if (!response.body) {
			throw new Error('API 未返回可读取的数据流');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value, { stream: !done });
				if (done && buffer.trim()) buffer += '\n\n';

				let separator = findEventSeparator(buffer);
				while (separator) {
					const eventBlock = buffer.slice(0, separator.index);
					buffer = buffer.slice(separator.index + separator.length);

					const data = eventBlock
						.split(/\r?\n/)
						.filter(line => line.startsWith('data:'))
						.map(line => line.slice(5).trimStart())
						.join('\n')
						.trim();

					if (data === '[DONE]') return;
					if (data) {
						let parsed: any;
						try {
							parsed = JSON.parse(data);
						} catch {
							throw new Error('API 返回了无法解析的流式数据');
						}

						const choice = parsed.choices?.[0];
						const delta = choice?.delta;
						yield {
							content: delta?.content || undefined,
							reasoningContent: delta?.reasoning_content || undefined,
							finishReason: choice?.finish_reason,
							usage: parsed.usage || undefined,
						};
					}

					separator = findEventSeparator(buffer);
				}

				if (done) break;
			}
		} finally {
			reader.releaseLock();
		}
	},
};
