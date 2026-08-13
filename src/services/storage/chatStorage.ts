import type {
	ChatMessage,
	ChatRole,
	ChatSession,
	MessageContent,
	MessageStatus,
	TokenUsage,
} from '../../types/chat';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../types/attachment';
import { normalizeConversationSummary } from './summaryStorage';

export const CHAT_SESSIONS_STORAGE_KEY = 'debugdiva:sessions:v2';
export const MAX_CHAT_STORAGE_RAW_BYTES = 4 * 1024 * 1024;
export const MAX_CHAT_SESSIONS = 200;
export const MAX_MESSAGES_PER_SESSION = 2_000;

const MAX_CONTENTS_PER_MESSAGE = 20;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_SESSION_TITLE_LENGTH = 200;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_MESSAGE_TEXT_LENGTH = 100_000;
const MAX_REASONING_LENGTH = 100_000;
const MAX_ATTACHMENT_ID_LENGTH = 200;
const MAX_ATTACHMENT_NAME_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_ALT_LENGTH = 1_000;
const MAX_CITATION_EXCERPT_LENGTH = 4_000;
const MAX_ERROR_CODE_LENGTH = 128;

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface LoadSessionsResult {
	sessions: ChatSession[];
	recoveredFromError: boolean;
	errorCode?: string;
	error?: string;
}

const asTimestamp = (value: unknown): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = new Date(value).getTime();
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
};

const timestampFromId = (value: unknown): number | undefined => {
	if (typeof value !== 'string') return undefined;
	const match = value.match(/(?:^|-)\b(\d{13})\b/);
	if (!match) return undefined;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const createFallbackMessageId = (
	sessionId: string,
	index: number,
	role: ChatRole,
) => `fallback-${sessionId}-${index}-${role}`;

const isRole = (value: unknown): value is ChatRole =>
	value === 'user' || value === 'assistant' || value === 'system';

const isStatus = (value: unknown): value is MessageStatus =>
	['pending', 'streaming', 'completed', 'stopped', 'error'].includes(
		String(value),
	);

const truncate = (value: string, maxCharacters: number): string =>
	Array.from(value).slice(0, maxCharacters).join('');

const validIdentifier = (value: unknown, maxCharacters: number): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	Array.from(value).length <= maxCharacters;

const byteLength = (value: string): number =>
	new TextEncoder().encode(value).byteLength;

const normalizeUsage = (value: unknown): TokenUsage | undefined => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const source = value as Record<string, unknown>;
	const result: TokenUsage = {};
	for (const key of [
		'promptTokens',
		'completionTokens',
		'totalTokens',
		'cacheHitTokens',
		'cacheMissTokens',
	] as const) {
		const tokenCount = source[key];
		if (
			typeof tokenCount === 'number' &&
			Number.isSafeInteger(tokenCount) &&
			tokenCount >= 0
		) {
			result[key] = tokenCount;
		}
	}
	return Object.keys(result).length ? result : undefined;
};

const normalizeContent = (value: unknown): MessageContent | null => {
	if (!value || typeof value !== 'object' || !('type' in value)) return null;
	const content = value as MessageContent;
	if (content.type === 'text' && typeof content.text === 'string') {
		return {
			type: 'text',
			text: truncate(content.text, MAX_MESSAGE_TEXT_LENGTH),
		};
	}
	if (
		content.type === 'file' &&
		validIdentifier(content.attachmentId, MAX_ATTACHMENT_ID_LENGTH) &&
		typeof content.name === 'string' &&
		typeof content.mimeType === 'string' &&
		typeof content.size === 'number' &&
		Number.isFinite(content.size) &&
		content.size >= 0
	) {
		return {
			type: 'file',
			attachmentId: content.attachmentId,
			name: truncate(content.name, MAX_ATTACHMENT_NAME_LENGTH),
			mimeType: truncate(content.mimeType, MAX_MIME_TYPE_LENGTH),
			size: content.size,
		};
	}
	if (
		content.type === 'image' &&
		validIdentifier(content.attachmentId, MAX_ATTACHMENT_ID_LENGTH)
	) {
		return {
			type: 'image',
			attachmentId: content.attachmentId,
			alt:
				typeof content.alt === 'string'
					? truncate(content.alt, MAX_ALT_LENGTH)
					: undefined,
		};
	}
	if (
		content.type === 'citation' &&
		validIdentifier(content.attachmentId, MAX_ATTACHMENT_ID_LENGTH) &&
		typeof content.name === 'string' &&
		typeof content.excerpt === 'string'
	) {
		return {
			type: 'citation',
			attachmentId: content.attachmentId,
			name: truncate(content.name, MAX_ATTACHMENT_NAME_LENGTH),
			page:
				typeof content.page === 'number' &&
				Number.isInteger(content.page) &&
				content.page > 0
					? content.page
					: undefined,
			excerpt: truncate(content.excerpt, MAX_CITATION_EXCERPT_LENGTH),
		};
	}
	return null;
};

const normalizeV2Message = (
	value: unknown,
	sessionId: string,
	index: number,
	fallbackTime: number,
): ChatMessage => {
	if (!value || typeof value !== 'object') {
		throw new Error(`会话 ${sessionId} 的第 ${index + 1} 条消息格式无效`);
	}
	const message = value as Partial<ChatMessage>;
	if (!isRole(message.role)) {
		throw new Error(`会话 ${sessionId} 的消息角色无效`);
	}
	if (
		Array.isArray(message.contents) &&
		message.contents.length > MAX_CONTENTS_PER_MESSAGE
	) {
		throw new Error(`会话 ${sessionId} 的消息内容块过多`);
	}

	const contents = Array.isArray(message.contents)
		? message.contents.map(normalizeContent).filter((item): item is MessageContent => Boolean(item))
		: [];
	let status = isStatus(message.status) ? message.status : 'completed';
	if (status === 'pending' || status === 'streaming') status = 'stopped';
	if (status === 'stopped' && contents.length === 0) {
		contents.push({ type: 'text', text: '已停止回复' });
	}

	return {
		id:
			validIdentifier(message.id, MAX_MESSAGE_ID_LENGTH)
				? message.id
				: createFallbackMessageId(sessionId, index, message.role),
		role: message.role,
		status,
		contents,
		reasoning:
			typeof message.reasoning === 'string'
				? truncate(message.reasoning, MAX_REASONING_LENGTH)
				: undefined,
		errorCode:
			typeof message.errorCode === 'string'
				? truncate(message.errorCode, MAX_ERROR_CODE_LENGTH)
				: undefined,
		requestId:
			typeof message.requestId === 'string'
				? truncate(message.requestId, MAX_MESSAGE_ID_LENGTH)
				: undefined,
		usage: normalizeUsage(message.usage),
		createdAt:
			asTimestamp(message.createdAt) ?? timestampFromId(message.id) ?? fallbackTime + index,
	};
};

export const normalizeV2Sessions = (
	input: unknown,
	now = Date.now(),
): ChatSession[] => {
	if (!Array.isArray(input)) throw new Error('v2 会话数据不是数组');
	if (input.length > MAX_CHAT_SESSIONS) {
		throw new Error(`v2 会话数量不能超过 ${MAX_CHAT_SESSIONS}`);
	}

	return input.map((value, index) => {
		if (!value || typeof value !== 'object') {
			throw new Error(`第 ${index + 1} 个 v2 会话格式无效`);
		}
		const session = value as Partial<ChatSession>;
		const id =
			validIdentifier(session.id, MAX_SESSION_ID_LENGTH)
				? session.id
				: `v2-session-${index}`;
		const updatedAt = asTimestamp(session.updatedAt) ?? now;
		if (
			Array.isArray(session.messages) &&
			session.messages.length > MAX_MESSAGES_PER_SESSION
		) {
			throw new Error(
				`会话 ${id} 的消息数量不能超过 ${MAX_MESSAGES_PER_SESSION}`,
			);
		}
		const messages = Array.isArray(session.messages)
			? session.messages.map((message, messageIndex) =>
					normalizeV2Message(message, id, messageIndex, updatedAt),
			  )
			: [];

		return {
			id,
			title:
				typeof session.title === 'string' && session.title.trim()
					? truncate(session.title, MAX_SESSION_TITLE_LENGTH)
					: '新对话',
			createdAt: asTimestamp(session.createdAt) ?? messages[0]?.createdAt ?? updatedAt,
			updatedAt,
			messages,
			summary:
				normalizeConversationSummary(session.summary) ?? undefined,
			activeAttachmentIds: Array.isArray(session.activeAttachmentIds)
				? [...new Set(session.activeAttachmentIds.filter(
						(item): item is string =>
							validIdentifier(item, MAX_ATTACHMENT_ID_LENGTH),
				  ))].slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
				: [],
		};
	});
};

export const loadChatSessions = (
	storage: StorageLike,
	now = Date.now(),
): LoadSessionsResult => {
	let v2Raw: string | null;
	try {
		v2Raw = storage.getItem(CHAT_SESSIONS_STORAGE_KEY);
	} catch (error) {
		return {
			sessions: [],
			recoveredFromError: true,
			errorCode: 'CHAT_STORAGE_READ_FAILED',
			error: error instanceof Error ? error.message : '会话读取失败',
		};
	}
	if (v2Raw !== null) {
		if (byteLength(v2Raw) > MAX_CHAT_STORAGE_RAW_BYTES) {
			return {
				sessions: [],
				recoveredFromError: true,
				errorCode: 'CHAT_STORAGE_TOO_LARGE',
				error: '本地会话超过安全读取上限，请导出后清理',
			};
		}
		try {
			return {
				sessions: normalizeV2Sessions(JSON.parse(v2Raw), now),
				recoveredFromError: false,
			};
		} catch (error) {
			return {
				sessions: [],
				recoveredFromError: true,
				errorCode: 'CHAT_STORAGE_CORRUPTED',
				error: error instanceof Error ? error.message : 'v2 会话读取失败',
			};
		}
	}

	return { sessions: [], recoveredFromError: false };
};

export const saveChatSessions = (
	storage: StorageLike,
	sessions: ChatSession[],
) => {
	if (sessions.length > MAX_CHAT_SESSIONS) {
		throw new Error(`本地会话数量不能超过 ${MAX_CHAT_SESSIONS}`);
	}

	const persistableSessions = sessions.map((session, sessionIndex) => {
		if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
			throw new Error(
				`会话 ${session.id} 的消息数量不能超过 ${MAX_MESSAGES_PER_SESSION}`,
			);
		}
		const sessionId = validIdentifier(session.id, MAX_SESSION_ID_LENGTH)
			? session.id
			: `persisted-session-${sessionIndex}`;
		const updatedAt = asTimestamp(session.updatedAt) ?? Date.now();

		return {
			id: sessionId,
			title:
				typeof session.title === 'string' && session.title.trim()
					? truncate(session.title, MAX_SESSION_TITLE_LENGTH)
					: '新对话',
			createdAt: asTimestamp(session.createdAt) ?? updatedAt,
			updatedAt,
			messages: session.messages.map((message, messageIndex) => {
				if (message.contents.length > MAX_CONTENTS_PER_MESSAGE) {
					throw new Error(`会话 ${sessionId} 的消息内容块过多`);
				}
				const role = isRole(message.role) ? message.role : 'assistant';
				const status = isStatus(message.status)
					? message.status
					: 'completed';
				const contents = message.contents
					.map(normalizeContent)
					.filter((item): item is MessageContent => item !== null);
				const reasoning =
					typeof message.reasoning === 'string'
						? truncate(message.reasoning, MAX_REASONING_LENGTH)
						: undefined;
				const errorCode =
					typeof message.errorCode === 'string'
						? truncate(message.errorCode, MAX_ERROR_CODE_LENGTH)
						: undefined;
				const requestId =
					typeof message.requestId === 'string'
						? truncate(message.requestId, MAX_MESSAGE_ID_LENGTH)
						: undefined;
				const usage = normalizeUsage(message.usage);

				return {
					id: validIdentifier(message.id, MAX_MESSAGE_ID_LENGTH)
						? message.id
						: createFallbackMessageId(sessionId, messageIndex, role),
					role,
					status,
					contents,
					...(reasoning !== undefined ? { reasoning } : {}),
					...(errorCode !== undefined ? { errorCode } : {}),
					...(requestId !== undefined ? { requestId } : {}),
					...(usage !== undefined ? { usage } : {}),
					createdAt:
						asTimestamp(message.createdAt) ?? updatedAt + messageIndex,
				};
			}),
			activeAttachmentIds: [
				...new Set(
					session.activeAttachmentIds.filter(id =>
						validIdentifier(id, MAX_ATTACHMENT_ID_LENGTH),
					),
				),
			].slice(0, MAX_ATTACHMENTS_PER_MESSAGE),
		};
	});
	const serialized = JSON.stringify(persistableSessions);
	if (byteLength(serialized) > MAX_CHAT_STORAGE_RAW_BYTES) {
		throw new Error('本地会话超过 4MB 安全存储上限');
	}
	storage.setItem(CHAT_SESSIONS_STORAGE_KEY, serialized);
};
