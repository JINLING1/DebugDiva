import { resolveModelMode } from '../_shared/modelMode';

interface Env {
	DEEPSEEK_API_KEY: string;
	DEEPSEEK_BASE_URL?: string;
}

interface ChatRequest {
	messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
	mode?: unknown;
	clientId?: unknown;
}

const jsonError = (code: string, message: string, status: number) =>
	Response.json({ error: { code, message } }, { status });

export const onRequestPost = async ({
	request,
	env,
}: {
	request: Request;
	env: Env;
}) => {
	if (!env.DEEPSEEK_API_KEY) {
		return jsonError('AUTH_FAILED', '服务端 DeepSeek API Key 未配置', 500);
	}

	if (!request.headers.get('content-type')?.includes('application/json')) {
		return jsonError('INVALID_REQUEST', 'Content-Type 必须是 application/json', 415);
	}

	let payload: ChatRequest;
	try {
		payload = await request.json();
	} catch {
		return jsonError('INVALID_REQUEST', '请求体不是有效的 JSON', 400);
	}

	const modeConfig = resolveModelMode(payload.mode);
	if (!modeConfig) {
		return jsonError('INVALID_MODEL_MODE', '不支持的模型模式', 400);
	}

	if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
		return jsonError('INVALID_REQUEST', 'messages 不能为空', 400);
	}

	const messagesAreValid = payload.messages.every(
		message =>
			['system', 'user', 'assistant'].includes(message.role) &&
			typeof message.content === 'string' &&
			message.content.length > 0,
	);
	if (!messagesAreValid) {
		return jsonError('INVALID_REQUEST', 'messages 格式无效', 400);
	}

	if (
		payload.clientId !== undefined &&
		(typeof payload.clientId !== 'string' || payload.clientId.length > 128)
	) {
		return jsonError('INVALID_REQUEST', 'clientId 格式无效', 400);
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
			model: modeConfig.model,
			messages: payload.messages,
			thinking: modeConfig.thinking,
			...('reasoning_effort' in modeConfig
				? { reasoning_effort: modeConfig.reasoning_effort }
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
