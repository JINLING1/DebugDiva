import type {
	ChatMessage,
	ChatRole,
	ChatSession,
	MessageContent,
	MessageStatus,
} from '../../types/chat';

export const CHAT_SESSIONS_STORAGE_KEY = 'debugdiva:sessions:v2';
export const LEGACY_CHAT_SESSIONS_STORAGE_KEY = 'chatSessions';
export const MIGRATION_BACKUP_STORAGE_KEY = 'debugdiva:migration-backup:v1';

const LEGACY_LOADING_MARKER = '<div class="loading-spinner"></div>';
const STOPPED_MARKER_PATTERN = /\n*\*\(已停止回复\)\*\s*$|^已停止回复$/;
const ERROR_MARKER_PATTERN = /^\*\*\[(系统错误|请求失败)\]\*\*\s*/;

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface LoadSessionsResult {
	sessions: ChatSession[];
	migrated: boolean;
	recoveredFromError: boolean;
	error?: string;
}

interface LegacyMessage {
	id?: unknown;
	message?: unknown;
	isUser?: unknown;
	isComplete?: unknown;
	reasoning?: unknown;
}

interface LegacySession {
	id?: unknown;
	title?: unknown;
	date?: unknown;
	messages?: unknown;
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

const createStableId = (sessionId: string, index: number, role: ChatRole) =>
	`migrated-${sessionId}-${index}-${role}`;

const sanitizeLegacyText = (
	value: unknown,
): { text: string; statusHint?: MessageStatus; errorCode?: string } => {
	if (typeof value !== 'string') return { text: '' };
	if (value === LEGACY_LOADING_MARKER) {
		return { text: '', statusHint: 'stopped' };
	}

	const errorMatch = value.match(ERROR_MARKER_PATTERN);
	if (errorMatch) {
		return {
			text: value.replace(ERROR_MARKER_PATTERN, '').trim(),
			statusHint: 'error',
			errorCode:
				errorMatch[1] === '请求失败' ? 'UPSTREAM_REQUEST_FAILED' : 'CHAT_ERROR',
		};
	}

	if (STOPPED_MARKER_PATTERN.test(value)) {
		return {
			text: value.replace(STOPPED_MARKER_PATTERN, '').trim(),
			statusHint: 'stopped',
		};
	}

	return { text: value };
};

const migrateLegacyMessage = (
	input: LegacyMessage,
	sessionId: string,
	index: number,
	fallbackTime: number,
): ChatMessage => {
	const role: ChatRole = input.isUser === true ? 'user' : 'assistant';
	const sanitized = sanitizeLegacyText(input.message);
	let status: MessageStatus;

	if (role === 'user') {
		status = 'completed';
	} else if (sanitized.statusHint) {
		status = sanitized.statusHint;
	} else {
		status = input.isComplete === false ? 'stopped' : 'completed';
	}

	const text =
		status === 'stopped' && !sanitized.text ? '已停止回复' : sanitized.text;

	return {
		id:
			typeof input.id === 'string' && input.id
				? input.id
				: createStableId(sessionId, index, role),
		role,
		status,
		contents: text ? [{ type: 'text', text }] : [],
		reasoning: typeof input.reasoning === 'string' ? input.reasoning : undefined,
		errorCode: sanitized.errorCode,
		createdAt: timestampFromId(input.id) ?? fallbackTime + index,
	};
};

export const migrateLegacySessions = (
	input: unknown,
	now = Date.now(),
): ChatSession[] => {
	if (!Array.isArray(input)) {
		throw new Error('旧会话数据不是数组');
	}

	return input.map((rawSession, sessionIndex) => {
		if (!rawSession || typeof rawSession !== 'object') {
			throw new Error(`第 ${sessionIndex + 1} 个旧会话格式无效`);
		}

		const session = rawSession as LegacySession;
		const sessionId =
			typeof session.id === 'string' && session.id
				? session.id
				: `migrated-session-${sessionIndex}`;
		const updatedAt = asTimestamp(session.date) ?? timestampFromId(session.id) ?? now;
		const legacyMessages = Array.isArray(session.messages) ? session.messages : [];
		const messages = legacyMessages.map((message, messageIndex) => {
			if (!message || typeof message !== 'object') {
				throw new Error(
					`会话 ${sessionId} 的第 ${messageIndex + 1} 条消息格式无效`,
				);
			}
			return migrateLegacyMessage(
				message as LegacyMessage,
				sessionId,
				messageIndex,
				updatedAt,
			);
		});
		const createdAt =
			messages[0]?.createdAt ?? timestampFromId(session.id) ?? updatedAt;

		return {
			id: sessionId,
			title:
				typeof session.title === 'string' && session.title.trim()
					? session.title
					: '新对话',
			createdAt,
			updatedAt,
			messages,
			activeAttachmentIds: [],
		};
	});
};

const isRole = (value: unknown): value is ChatRole =>
	value === 'user' || value === 'assistant' || value === 'system';

const isStatus = (value: unknown): value is MessageStatus =>
	['pending', 'streaming', 'completed', 'stopped', 'error'].includes(
		String(value),
	);

const normalizeContent = (value: unknown): MessageContent | null => {
	if (!value || typeof value !== 'object' || !('type' in value)) return null;
	const content = value as MessageContent;
	if (content.type === 'text' && typeof content.text === 'string') return content;
	if (
		content.type === 'file' &&
		typeof content.attachmentId === 'string' &&
		typeof content.name === 'string' &&
		typeof content.mimeType === 'string' &&
		typeof content.size === 'number'
	) {
		return content;
	}
	if (
		content.type === 'image' &&
		typeof content.attachmentId === 'string'
	) {
		return { ...content, previewUrl: undefined };
	}
	if (
		content.type === 'citation' &&
		typeof content.attachmentId === 'string' &&
		typeof content.name === 'string' &&
		typeof content.excerpt === 'string'
	) {
		return content;
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
			typeof message.id === 'string' && message.id
				? message.id
				: createStableId(sessionId, index, message.role),
		role: message.role,
		status,
		contents,
		reasoning:
			typeof message.reasoning === 'string' ? message.reasoning : undefined,
		errorCode:
			typeof message.errorCode === 'string' ? message.errorCode : undefined,
		usage: message.usage,
		createdAt:
			asTimestamp(message.createdAt) ?? timestampFromId(message.id) ?? fallbackTime + index,
	};
};

export const normalizeV2Sessions = (
	input: unknown,
	now = Date.now(),
): ChatSession[] => {
	if (!Array.isArray(input)) throw new Error('v2 会话数据不是数组');

	return input.map((value, index) => {
		if (!value || typeof value !== 'object') {
			throw new Error(`第 ${index + 1} 个 v2 会话格式无效`);
		}
		const session = value as Partial<ChatSession>;
		const id =
			typeof session.id === 'string' && session.id
				? session.id
				: `v2-session-${index}`;
		const updatedAt = asTimestamp(session.updatedAt) ?? now;
		const messages = Array.isArray(session.messages)
			? session.messages.map((message, messageIndex) =>
					normalizeV2Message(message, id, messageIndex, updatedAt),
			  )
			: [];

		return {
			id,
			title:
				typeof session.title === 'string' && session.title.trim()
					? session.title
					: '新对话',
			createdAt: asTimestamp(session.createdAt) ?? messages[0]?.createdAt ?? updatedAt,
			updatedAt,
			messages,
			summary: session.summary,
			activeAttachmentIds: Array.isArray(session.activeAttachmentIds)
				? session.activeAttachmentIds.filter(
						(item): item is string => typeof item === 'string',
				  )
				: [],
		};
	});
};

const backupRawData = (storage: StorageLike, sourceKey: string, raw: string) => {
	try {
		storage.setItem(
			MIGRATION_BACKUP_STORAGE_KEY,
			JSON.stringify({ sourceKey, raw, backedUpAt: Date.now() }),
		);
	} catch {
		// 原存储仍保留时，备份写入失败不应造成二次数据破坏。
	}
};

export const loadChatSessions = (
	storage: StorageLike,
	now = Date.now(),
): LoadSessionsResult => {
	const v2Raw = storage.getItem(CHAT_SESSIONS_STORAGE_KEY);
	if (v2Raw !== null) {
		try {
			return {
				sessions: normalizeV2Sessions(JSON.parse(v2Raw), now),
				migrated: false,
				recoveredFromError: false,
			};
		} catch (error) {
			backupRawData(storage, CHAT_SESSIONS_STORAGE_KEY, v2Raw);
			return {
				sessions: [],
				migrated: false,
				recoveredFromError: true,
				error: error instanceof Error ? error.message : 'v2 会话读取失败',
			};
		}
	}

	const legacyRaw = storage.getItem(LEGACY_CHAT_SESSIONS_STORAGE_KEY);
	if (legacyRaw === null) {
		return { sessions: [], migrated: false, recoveredFromError: false };
	}

	backupRawData(storage, LEGACY_CHAT_SESSIONS_STORAGE_KEY, legacyRaw);
	try {
		const sessions = migrateLegacySessions(JSON.parse(legacyRaw), now);
		storage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
		return {
			sessions,
			migrated: true,
			recoveredFromError: false,
		};
	} catch (error) {
		return {
			sessions: [],
			migrated: false,
			recoveredFromError: true,
			error: error instanceof Error ? error.message : '旧会话迁移失败',
		};
	}
};

export const saveChatSessions = (
	storage: StorageLike,
	sessions: ChatSession[],
) => {
	storage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
};
