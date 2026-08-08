import type { TokenUsage } from './chat';
import type { AppError } from '../services/errors/AppError';

export type ModelMode = 'fast' | 'deep' | 'quality';

export interface ProviderMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatRequest {
	messages: ProviderMessage[];
	mode: ModelMode;
	signal: AbortSignal;
	clientId: string;
}

export type ChatEvent =
	| { type: 'start'; requestId?: string }
	| { type: 'reasoning-delta'; text: string }
	| { type: 'text-delta'; text: string }
	| { type: 'usage'; usage: TokenUsage }
	| { type: 'done'; finishReason?: string }
	| { type: 'error'; error: AppError };

export interface ChatProvider {
	stream(request: ChatRequest): AsyncIterable<ChatEvent>;
}
