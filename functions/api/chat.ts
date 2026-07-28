interface Env {
	DEEPSEEK_API_KEY: string;
	DEEPSEEK_BASE_URL?: string;
	DEEPSEEK_MODEL?: string;
}

interface ChatRequest {
	messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
	thinking?: boolean;
	reasoningEffort?: 'high' | 'max';
}

const jsonError = (message: string, status: number) =>
	Response.json({ error: { message } }, { status });

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	if (!env.DEEPSEEK_API_KEY) {
		return jsonError('服务端 DeepSeek API Key 未配置', 500);
	}

	let payload: ChatRequest;
	try {
		payload = await request.json();
	} catch {
		return jsonError('请求体不是有效的 JSON', 400);
	}

	if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
		return jsonError('messages 不能为空', 400);
	}

	const messagesAreValid = payload.messages.every(
		message =>
			['system', 'user', 'assistant'].includes(message.role) &&
			typeof message.content === 'string' &&
			message.content.length > 0,
	);
	if (!messagesAreValid) {
		return jsonError('messages 格式无效', 400);
	}

	const baseUrl = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(
		/\/$/,
		'',
	);
	const upstream = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
			messages: payload.messages,
			thinking: { type: payload.thinking ? 'enabled' : 'disabled' },
			...(payload.thinking && payload.reasoningEffort
				? { reasoning_effort: payload.reasoningEffort }
				: {}),
			stream: true,
			stream_options: { include_usage: true },
		}),
		signal: request.signal,
	});

	return new Response(upstream.body, {
		status: upstream.status,
		headers: {
			'Content-Type':
				upstream.headers.get('content-type') || 'application/json; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
		},
	});
};
