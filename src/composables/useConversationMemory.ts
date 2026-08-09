import {
	MAX_SUMMARY_INPUT_MESSAGE_LENGTH,
	MAX_SUMMARY_INPUT_TOTAL_LENGTH,
	MAX_SUMMARY_REQUEST_BYTES,
	serializeSummaryRequestPayload,
	summarizeConversation,
	type SummarizeConversationOptions,
	type SummaryInputMessage,
} from '../api/summarize';
import {
	getMessageText,
	isContextMessage,
} from '../services/context/buildChatContext';
import type { ChatMessage, ConversationSummary } from '../types/chat';

export const SUMMARY_TRIGGER_MESSAGE_COUNT = 20;
export const SUMMARY_RECENT_MESSAGE_COUNT = 12;
export const SUMMARY_UPDATE_MESSAGE_COUNT = 8;
export const MAX_SUMMARY_BATCH_MESSAGES = 32;

// The endpoint accepts at most 128 Unicode characters for clientId. Reserve
// the worst possible UTF-8 width so the planner stays safe for every valid ID.
const SUMMARY_CLIENT_ID_SIZE_PLACEHOLDER = '😀'.repeat(128);
const textEncoder = new TextEncoder();

const truncateSummaryContent = (content: string): string =>
	Array.from(content).slice(0, MAX_SUMMARY_INPUT_MESSAGE_LENGTH).join('');

const selectSummaryBatch = (
	messages: readonly SummaryInputMessage[],
	previousSummary?: ConversationSummary,
): SummaryInputMessage[] => {
	const batch: SummaryInputMessage[] = [];
	let totalCharacters = 0;
	const fitsRequest = (candidateMessages: readonly SummaryInputMessage[]) =>
		textEncoder.encode(
			serializeSummaryRequestPayload(
				previousSummary,
				candidateMessages,
				SUMMARY_CLIENT_ID_SIZE_PLACEHOLDER,
			),
		).byteLength <= MAX_SUMMARY_REQUEST_BYTES;
	const fitFirstMessage = (
		message: SummaryInputMessage,
	): SummaryInputMessage | undefined => {
		const characters = Array.from(message.content);
		let low = 1;
		let high = characters.length;
		let fitted: SummaryInputMessage | undefined;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			const candidate = {
				...message,
				content: characters.slice(0, middle).join(''),
			};
			if (fitsRequest([candidate])) {
				fitted = candidate;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}
		return fitted;
	};

	for (const message of messages) {
		if (batch.length >= MAX_SUMMARY_BATCH_MESSAGES) break;
		let candidate = message;
		let messageCharacters = Array.from(candidate.content).length;
		if (
			totalCharacters + messageCharacters >
			MAX_SUMMARY_INPUT_TOTAL_LENGTH
		) {
			break;
		}
		if (!fitsRequest([...batch, candidate])) {
			if (batch.length > 0) break;
			const fitted = fitFirstMessage(candidate);
			if (!fitted) break;
			candidate = fitted;
			messageCharacters = Array.from(candidate.content).length;
		}
		batch.push(candidate);
		totalCharacters += messageCharacters;
	}
	return batch;
};

export interface ConversationSummaryRequestPlan {
	previousSummary?: ConversationSummary;
	messages: SummaryInputMessage[];
}

export interface ConversationMemoryPlan {
	/** Every completed, non-empty user/assistant message in source order. */
	validMessages: SummaryInputMessage[];
	/** Raw messages that must accompany the usable summary in chat context. */
	contextMessages: SummaryInputMessage[];
	/** Omitted when no summary exists or its covered message has disappeared. */
	usableSummary?: ConversationSummary;
	/** Present only when the threshold/batch rules allow a summary request. */
	summaryRequest?: ConversationSummaryRequestPlan;
	boundary: 'none' | 'valid' | 'missing';
}

export const getValidSummaryMessages = (
	messages: readonly ChatMessage[],
): SummaryInputMessage[] =>
	messages
		.filter(
			message =>
				(message.role === 'user' || message.role === 'assistant') &&
				isContextMessage(message),
		)
		.map(message => ({
			id: message.id,
			role: message.role as 'user' | 'assistant',
			content: truncateSummaryContent(getMessageText(message).trim()),
		}));

/**
 * Select the lossless raw-message window and, independently, any summary work.
 *
 * Until the next eight-message batch can be summarized, every message after
 * the previous boundary stays in context. This deliberately allows a window
 * larger than 12 for a short time instead of dropping unsummarized turns.
 */
export const planConversationMemory = (
	messages: readonly ChatMessage[],
	summary?: ConversationSummary,
): ConversationMemoryPlan => {
	const validMessages = getValidSummaryMessages(messages);

	if (!summary) {
		const messagesToSummarize = selectSummaryBatch(
			validMessages.slice(
				0,
				Math.max(0, validMessages.length - SUMMARY_RECENT_MESSAGE_COUNT),
			),
		);
		return {
			validMessages,
			contextMessages: [...validMessages],
			summaryRequest:
				validMessages.length > SUMMARY_TRIGGER_MESSAGE_COUNT
					? { messages: messagesToSummarize }
					: undefined,
			boundary: 'none',
		};
	}

	const coveredIndex = validMessages.findIndex(
		message => message.id === summary.coveredUntilMessageId,
	);
	if (coveredIndex < 0) {
		const messagesToSummarize = selectSummaryBatch(
			validMessages.slice(
				0,
				Math.max(0, validMessages.length - SUMMARY_RECENT_MESSAGE_COUNT),
			),
		);
		return {
			validMessages,
			contextMessages: [...validMessages],
			summaryRequest:
				validMessages.length > SUMMARY_TRIGGER_MESSAGE_COUNT
					? { messages: messagesToSummarize }
					: undefined,
			boundary: 'missing',
		};
	}

	const uncoveredMessages = validMessages.slice(coveredIndex + 1);
	const summarizableMessages = uncoveredMessages.slice(
		0,
		Math.max(0, uncoveredMessages.length - SUMMARY_RECENT_MESSAGE_COUNT),
	);
	const messagesToSummarize = selectSummaryBatch(
		summarizableMessages,
		summary,
	);

	return {
		validMessages,
		contextMessages: uncoveredMessages,
		usableSummary: summary,
		summaryRequest:
			summarizableMessages.length >= SUMMARY_UPDATE_MESSAGE_COUNT &&
			messagesToSummarize.length > 0
				? {
						previousSummary: summary,
						messages: messagesToSummarize,
				  }
				: undefined,
		boundary: 'valid',
	};
};

export interface ConversationMemoryUpdate {
	sessionId: string;
	messages: readonly ChatMessage[];
	summary?: ConversationSummary;
	clientId: string;
	onCommit: (summary: ConversationSummary) => void | Promise<void>;
}

export type ConversationSummarizer = (
	options: SummarizeConversationOptions,
) => Promise<ConversationSummary>;

export interface UseConversationMemoryOptions {
	summarize?: ConversationSummarizer;
}

interface SessionWork {
	latest: ConversationMemoryUpdate;
	dirty: boolean;
	cancelled: boolean;
	controller?: AbortController;
	promise: Promise<void>;
}

const sameInputMessage = (
	left: SummaryInputMessage,
	right: SummaryInputMessage,
): boolean =>
	left.id === right.id &&
	left.role === right.role &&
	left.content === right.content;

const summaryFingerprint = (summary?: ConversationSummary): string =>
	summary
		? JSON.stringify({
				userGoals: summary.userGoals,
				confirmedFacts: summary.confirmedFacts,
				decisions: summary.decisions,
				unresolvedQuestions: summary.unresolvedQuestions,
				coveredUntilMessageId: summary.coveredUntilMessageId,
				updatedAt: summary.updatedAt,
			})
		: '';

const requestSnapshotIsCurrent = (
	snapshot: ConversationSummaryRequestPlan,
	latest: ConversationMemoryUpdate,
): boolean => {
	const latestRequest = planConversationMemory(
		latest.messages,
		latest.summary,
	).summaryRequest;
	if (!latestRequest) return false;
	if (
		summaryFingerprint(snapshot.previousSummary) !==
		summaryFingerprint(latestRequest.previousSummary)
	) {
		return false;
	}
	if (latestRequest.messages.length < snapshot.messages.length) return false;

	return snapshot.messages.every((message, index) =>
		sameInputMessage(message, latestRequest.messages[index]),
	);
};

const cloneRequestPlan = (
	request: ConversationSummaryRequestPlan,
): ConversationSummaryRequestPlan => ({
	previousSummary: request.previousSummary,
	messages: request.messages.map(message => ({ ...message })),
});

const isAbortError = (error: unknown): boolean =>
	typeof error === 'object' &&
	error !== null &&
	'name' in error &&
	(error as { name?: unknown }).name === 'AbortError';

/**
 * Coordinate background summary requests without coupling them to chat flow.
 * Errors are retained for diagnostics but intentionally never reject trigger().
 */
export const useConversationMemory = (
	options: UseConversationMemoryOptions = {},
) => {
	const summarize = options.summarize ?? summarizeConversation;
	const workBySession = new Map<string, SessionWork>();
	const errorsBySession = new Map<string, unknown>();
	let disposed = false;

	const run = async (work: SessionWork): Promise<void> => {
		while (!work.cancelled && !disposed) {
			work.dirty = false;
			const current = work.latest;
			const plannedRequest = planConversationMemory(
				current.messages,
				current.summary,
			).summaryRequest;
			if (!plannedRequest) return;

			const snapshot = cloneRequestPlan(plannedRequest);
			const controller = new AbortController();
			work.controller = controller;
			let result: ConversationSummary;

			try {
				result = await summarize({
					previousSummary: snapshot.previousSummary,
					messages: snapshot.messages,
					clientId: current.clientId,
					signal: controller.signal,
				});
			} catch (error) {
				if (!isAbortError(error)) errorsBySession.set(current.sessionId, error);
				return;
			} finally {
				if (work.controller === controller) work.controller = undefined;
			}

			if (work.cancelled || disposed) return;
			const latest = work.latest;
			if (!requestSnapshotIsCurrent(snapshot, latest)) {
				if (work.dirty) continue;
				return;
			}

			try {
				await latest.onCommit(result);
			} catch (error) {
				errorsBySession.set(latest.sessionId, error);
				return;
			}
			errorsBySession.delete(latest.sessionId);
			work.latest = { ...work.latest, summary: result };

			if (
				!work.dirty &&
				!planConversationMemory(
					work.latest.messages,
					work.latest.summary,
				).summaryRequest
			) {
				return;
			}
		}
	};

	const trigger = (update: ConversationMemoryUpdate): Promise<void> => {
		if (disposed) return Promise.resolve();
		const active = workBySession.get(update.sessionId);
		if (active) {
			active.latest = update;
			active.dirty = true;
			return active.promise;
		}

		const work: SessionWork = {
			latest: update,
			dirty: false,
			cancelled: false,
			promise: Promise.resolve(),
		};
		work.promise = Promise.resolve()
			.then(() => run(work))
			.finally(() => {
				if (workBySession.get(update.sessionId) === work) {
					workBySession.delete(update.sessionId);
				}
			});
		workBySession.set(update.sessionId, work);
		return work.promise;
	};

	const cancel = (sessionId: string): boolean => {
		const work = workBySession.get(sessionId);
		if (!work) return false;
		work.cancelled = true;
		work.controller?.abort();
		workBySession.delete(sessionId);
		return true;
	};

	const dispose = (): void => {
		disposed = true;
		workBySession.forEach(work => {
			work.cancelled = true;
			work.controller?.abort();
		});
		workBySession.clear();
	};

	return {
		trigger,
		cancel,
		dispose,
		isPending: (sessionId: string): boolean => workBySession.has(sessionId),
		getLastError: (sessionId: string): unknown => errorsBySession.get(sessionId),
	};
};
