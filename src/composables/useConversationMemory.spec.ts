import { describe, expect, it, vi } from 'vitest';
import {
	MAX_SUMMARY_INPUT_MESSAGE_LENGTH,
	MAX_SUMMARY_INPUT_TOTAL_LENGTH,
	MAX_SUMMARY_REQUEST_BYTES,
	serializeSummaryRequestPayload,
} from '../api/summarize';
import { AppError } from '../services/errors/AppError';
import type {
	ChatMessage,
	ConversationSummary,
	MessageStatus,
} from '../types/chat';
import {
	getValidSummaryMessages,
	MAX_SUMMARY_BATCH_MESSAGES,
	planConversationMemory,
	useConversationMemory,
	type ConversationSummarizer,
} from './useConversationMemory';

const chatMessage = (
	id: string,
	role: ChatMessage['role'] = 'user',
	status: MessageStatus = 'completed',
	content = `content-${id}`,
): ChatMessage => ({
	id,
	role,
	status,
	contents: [{ type: 'text', text: content }],
	createdAt: 1,
});

const messages = (count: number): ChatMessage[] =>
	Array.from({ length: count }, (_, index) =>
		chatMessage(
			`m-${index + 1}`,
			index % 2 === 0 ? 'user' : 'assistant',
		),
	);

const summary = (
	coveredUntilMessageId: string,
	overrides: Partial<ConversationSummary> = {},
): ConversationSummary => ({
	userGoals: ['goal'],
	confirmedFacts: ['fact'],
	decisions: ['decision'],
	unresolvedQuestions: [],
	coveredUntilMessageId,
	updatedAt: Date.now(),
	...overrides,
});

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

const flushMicrotasks = async (): Promise<void> => {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe('conversation memory planning', () => {
	it('does not trigger at 20 messages and summarizes the first 9 at 21', () => {
		const atThreshold = planConversationMemory(messages(20));
		expect(atThreshold.summaryRequest).toBeUndefined();
		expect(atThreshold.contextMessages).toHaveLength(20);

		const overThreshold = planConversationMemory(messages(21));
		expect(overThreshold.summaryRequest?.messages.map(item => item.id)).toEqual(
			messages(9).map(item => item.id),
		);
		expect(overThreshold.contextMessages).toHaveLength(21);
		expect(overThreshold.usableSummary).toBeUndefined();
	});

	it('keeps only completed, non-empty user/assistant text', () => {
		const source = [
			chatMessage('valid-user', 'user'),
			chatMessage('valid-assistant', 'assistant'),
			chatMessage('pending', 'assistant', 'pending'),
			chatMessage('streaming', 'assistant', 'streaming'),
			chatMessage('stopped', 'assistant', 'stopped'),
			chatMessage('error', 'assistant', 'error'),
			chatMessage('empty', 'user', 'completed', '   '),
			chatMessage('system', 'system'),
		];

		expect(getValidSummaryMessages(source)).toEqual([
			{ id: 'valid-user', role: 'user', content: 'content-valid-user' },
			{
				id: 'valid-assistant',
				role: 'assistant',
				content: 'content-valid-assistant',
			},
		]);
	});

	it('waits for +8 before updating and never drops unsummarized messages', () => {
		const currentSummary = summary('m-9');
		const plusSeven = planConversationMemory(messages(28), currentSummary);
		expect(plusSeven.summaryRequest).toBeUndefined();
		expect(plusSeven.contextMessages.map(item => item.id)).toEqual(
			messages(28)
				.slice(9)
				.map(item => item.id),
		);
		expect(plusSeven.contextMessages).toHaveLength(19);

		const plusEight = planConversationMemory(messages(29), currentSummary);
		expect(plusEight.summaryRequest?.previousSummary).toBe(currentSummary);
		expect(plusEight.summaryRequest?.messages.map(item => item.id)).toEqual(
			messages(29)
				.slice(9, 17)
				.map(item => item.id),
		);
		expect(plusEight.contextMessages).toHaveLength(20);
	});

	it('falls back to the full history and rebases when the covered ID is gone', () => {
		const source = messages(21);
		const plan = planConversationMemory(source, summary('deleted-message'));

		expect(plan.boundary).toBe('missing');
		expect(plan.usableSummary).toBeUndefined();
		expect(plan.contextMessages).toHaveLength(21);
		expect(plan.contextMessages.map(item => item.id)).toEqual(
			getValidSummaryMessages(source).map(item => item.id),
		);
		expect(plan.summaryRequest?.previousSummary).toBeUndefined();
		expect(plan.summaryRequest?.messages).toHaveLength(9);
	});

	it('caps each summary request for very long histories', () => {
		const firstPlan = planConversationMemory(messages(100));
		expect(firstPlan.summaryRequest?.messages).toHaveLength(
			MAX_SUMMARY_BATCH_MESSAGES,
		);

		const incrementalPlan = planConversationMemory(
			messages(100),
			summary('m-32'),
		);
		expect(incrementalPlan.summaryRequest?.messages).toHaveLength(
			MAX_SUMMARY_BATCH_MESSAGES,
		);
		expect(incrementalPlan.summaryRequest?.messages[0].id).toBe('m-33');
	});

	it('truncates long messages and respects server character limits', () => {
		const source = messages(21).map(message => ({
			...message,
			contents: [
				{
					type: 'text' as const,
					text: '界'.repeat(MAX_SUMMARY_INPUT_MESSAGE_LENGTH + 2_000),
				},
			],
		}));

		const requestMessages = planConversationMemory(source).summaryRequest?.messages;

		expect(requestMessages?.length).toBeGreaterThan(0);
		expect(
			requestMessages?.every(
				message =>
					Array.from(message.content).length ===
					MAX_SUMMARY_INPUT_MESSAGE_LENGTH,
			),
		).toBe(true);
		const totalCharacters =
			requestMessages?.reduce(
				(total, message) => total + Array.from(message.content).length,
				0,
			) ?? 0;
		expect(totalCharacters).toBeLessThanOrEqual(
			MAX_SUMMARY_INPUT_TOTAL_LENGTH,
		);
		const body = serializeSummaryRequestPayload(
			undefined,
			requestMessages ?? [],
			'😀'.repeat(128),
		);
		expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
			MAX_SUMMARY_REQUEST_BYTES,
		);
	});

	it('reserves UTF-8 request space for an existing maximum-size summary', () => {
		const previousSummary = summary('m-1', {
			userGoals: Array(10).fill('\u0001'.repeat(400)),
			confirmedFacts: Array(10).fill('\u0001'.repeat(400)),
			decisions: Array(10).fill('\u0001'.repeat(400)),
			unresolvedQuestions: Array(10).fill('\u0001'.repeat(400)),
		});
		const source = messages(29).map(message => ({
			...message,
			contents: [
				{
					type: 'text' as const,
					text: '\u0002'.repeat(MAX_SUMMARY_INPUT_MESSAGE_LENGTH),
				},
			],
		}));

		const request = planConversationMemory(source, previousSummary).summaryRequest;

		expect(request?.messages).toHaveLength(1);
		expect(Array.from(request!.messages[0].content).length).toBeLessThan(
			MAX_SUMMARY_INPUT_MESSAGE_LENGTH,
		);
		const body = serializeSummaryRequestPayload(
			request?.previousSummary,
			request?.messages ?? [],
			'😀'.repeat(128),
		);
		expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
			MAX_SUMMARY_REQUEST_BYTES,
		);
	});
});

describe('useConversationMemory', () => {
	it('coalesces same-session triggers, marks work dirty, and recalculates', async () => {
		const requests: Array<Deferred<ConversationSummary>> = [];
		const summarize = vi.fn<ConversationSummarizer>(() => {
			const request = deferred<ConversationSummary>();
			requests.push(request);
			return request.promise;
		});
		const onCommit = vi.fn();
		const memory = useConversationMemory({ summarize });

		const first = memory.trigger({
			sessionId: 'session',
			messages: messages(21),
			clientId: 'client',
			onCommit,
		});
		await flushMicrotasks();
		const second = memory.trigger({
			sessionId: 'session',
			messages: messages(29),
			clientId: 'client',
			onCommit,
		});

		expect(second).toBe(first);
		expect(summarize).toHaveBeenCalledTimes(1);
		requests[0].resolve(summary('m-9'));
		await flushMicrotasks();

		expect(summarize).toHaveBeenCalledTimes(2);
		expect(summarize.mock.calls[1][0].messages.map(item => item.id)).toEqual(
			messages(29)
				.slice(9, 17)
				.map(item => item.id),
		);
		requests[1].resolve(summary('m-17'));
		await first;

		expect(onCommit.mock.calls.map(call => call[0].coveredUntilMessageId)).toEqual([
			'm-9',
			'm-17',
		]);
		expect(memory.isPending('session')).toBe(false);
	});

	it('rejects a stale response when regeneration reuses an ID with new content', async () => {
		const requests: Array<Deferred<ConversationSummary>> = [];
		const summarize = vi.fn<ConversationSummarizer>(() => {
			const request = deferred<ConversationSummary>();
			requests.push(request);
			return request.promise;
		});
		const onCommit = vi.fn();
		const memory = useConversationMemory({ summarize });
		const original = messages(21);

		const pending = memory.trigger({
			sessionId: 'session',
			messages: original,
			clientId: 'client',
			onCommit,
		});
		await flushMicrotasks();
		const regenerated = original.map(message =>
			message.id === 'm-1'
				? chatMessage('m-1', 'user', 'completed', 'regenerated content')
				: message,
		);
		memory.trigger({
			sessionId: 'session',
			messages: regenerated,
			clientId: 'client',
			onCommit,
		});

		requests[0].resolve(summary('m-9'));
		await flushMicrotasks();
		expect(onCommit).not.toHaveBeenCalled();
		expect(summarize).toHaveBeenCalledTimes(2);
		expect(summarize.mock.calls[1][0].messages[0]).toEqual({
			id: 'm-1',
			role: 'user',
			content: 'regenerated content',
		});

		requests[1].resolve(summary('m-9'));
		await pending;
		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it('uses independent AbortControllers and keeps cancellation silent', async () => {
		const signals: AbortSignal[] = [];
		const summarize = vi.fn<ConversationSummarizer>(
			options =>
				new Promise<ConversationSummary>((_resolve, reject) => {
					signals.push(options.signal);
					options.signal.addEventListener('abort', () => {
						reject(new DOMException('cancelled', 'AbortError'));
					});
				}),
		);
		const firstCommit = vi.fn();
		const secondCommit = vi.fn();
		const memory = useConversationMemory({ summarize });

		const first = memory.trigger({
			sessionId: 'first',
			messages: messages(21),
			clientId: 'client',
			onCommit: firstCommit,
		});
		const second = memory.trigger({
			sessionId: 'second',
			messages: messages(21),
			clientId: 'client',
			onCommit: secondCommit,
		});
		await flushMicrotasks();

		expect(signals).toHaveLength(2);
		expect(signals[0]).not.toBe(signals[1]);
		expect(memory.cancel('first')).toBe(true);
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		memory.dispose();
		expect(signals[1].aborted).toBe(true);
		await Promise.all([first, second]);
		expect(firstCommit).not.toHaveBeenCalled();
		expect(secondCommit).not.toHaveBeenCalled();
		expect(memory.getLastError('first')).toBeUndefined();
		expect(memory.getLastError('second')).toBeUndefined();
	});

	it('swallows failures without automatic retries and allows a later trigger', async () => {
		const error = new AppError({
			code: 'UPSTREAM_UNAVAILABLE',
			message: 'offline',
			retryable: true,
		});
		const summarize = vi
			.fn<ConversationSummarizer>()
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce(summary('m-9'));
		const onCommit = vi.fn();
		const memory = useConversationMemory({ summarize });
		const update = {
			sessionId: 'session',
			messages: messages(21),
			clientId: 'client',
			onCommit,
		};

		await expect(memory.trigger(update)).resolves.toBeUndefined();
		expect(summarize).toHaveBeenCalledTimes(1);
		expect(onCommit).not.toHaveBeenCalled();
		expect(memory.getLastError('session')).toBe(error);

		await memory.trigger(update);
		expect(summarize).toHaveBeenCalledTimes(2);
		expect(onCommit).toHaveBeenCalledWith(
			expect.objectContaining({ coveredUntilMessageId: 'm-9' }),
		);
		expect(memory.getLastError('session')).toBeUndefined();
	});

	it('summarizes a 100-message history in bounded consecutive chunks', async () => {
		const summarize = vi.fn<ConversationSummarizer>(async options =>
			summary(options.messages.at(-1)!.id),
		);
		const committed: ConversationSummary[] = [];
		const memory = useConversationMemory({ summarize });

		await memory.trigger({
			sessionId: 'long-session',
			messages: messages(100),
			clientId: 'client',
			onCommit: value => {
				committed.push(value);
			},
		});

		expect(summarize.mock.calls.map(call => call[0].messages.length)).toEqual([
			32, 32, 24,
		]);
		expect(committed.map(item => item.coveredUntilMessageId)).toEqual([
			'm-32',
			'm-64',
			'm-88',
		]);
		expect(
			planConversationMemory(messages(100), committed.at(-1)).contextMessages,
		).toHaveLength(12);
	});
});
