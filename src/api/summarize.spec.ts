// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../services/errors/AppError';
import type { ConversationSummary } from '../types/chat';
import {
	MAX_SUMMARY_ITEM_LENGTH,
	MAX_SUMMARY_ITEMS_PER_CATEGORY,
	MAX_SUMMARY_TOTAL_LENGTH,
	SUMMARIZE_ENDPOINT,
	summarizeConversation,
	validateConversationSummary,
	type SummaryFetch,
	type SummaryInputMessage,
} from './summarize';

const summary = (
	coveredUntilMessageId = 'm-1',
	overrides: Partial<ConversationSummary> = {},
): ConversationSummary => ({
	userGoals: ['ship the feature'],
	confirmedFacts: ['the app uses Vue'],
	decisions: ['keep data local'],
	unresolvedQuestions: ['which color?'],
	coveredUntilMessageId,
	updatedAt: 1_700_000_000_000,
	...overrides,
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers },
	});

describe('summarize API', () => {
	it('posts only the allowlisted summary fields and forwards the signal', async () => {
		const fetchMock = vi
			.fn<SummaryFetch>()
			.mockResolvedValue(jsonResponse({ data: summary('m-2') }));
		const controller = new AbortController();
		const unsafeMessage = {
			id: 'm-2',
			role: 'user',
			content: 'question',
			attachmentId: 'private-file',
			previewUrl: 'blob:secret',
			contents: [{ type: 'image', data: 'base64-secret' }],
		} as SummaryInputMessage;
		const previous = {
			...summary('m-1'),
			secret: 'do-not-send',
		} as ConversationSummary;

		await summarizeConversation({
			previousSummary: previous,
			messages: [unsafeMessage],
			clientId: 'anonymous-client',
			signal: controller.signal,
			fetchImpl: fetchMock,
		});

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(SUMMARIZE_ENDPOINT);
		expect(init?.method).toBe('POST');
		expect(init?.signal).toBe(controller.signal);
		expect(init?.headers).toEqual({ 'content-type': 'application/json' });
		expect(JSON.parse(String(init?.body))).toEqual({
			previousSummary: summary('m-1'),
			messages: [{ id: 'm-2', role: 'user', content: 'question' }],
			clientId: 'anonymous-client',
		});
		expect(String(init?.body)).not.toMatch(/attachment|blob:|base64|secret/);
	});

	it('requires one input message before performing fetch', async () => {
		const fetchMock = vi.fn<SummaryFetch>();
		await expect(
			summarizeConversation({
				messages: [],
				clientId: 'client',
				signal: new AbortController().signal,
				fetchImpl: fetchMock,
			}),
		).rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('strictly validates every response field and the covered boundary', async () => {
		expect(validateConversationSummary(summary('last'), 'last')).toEqual(
			summary('last'),
		);

		const invalidValues = [
			{ ...summary(), userGoals: 'not-an-array' },
			{
				...summary(),
				userGoals: Array.from(
					{ length: MAX_SUMMARY_ITEMS_PER_CATEGORY + 1 },
					(_, index) => `goal-${index}`,
				),
			},
			{ ...summary(), decisions: ['x'.repeat(MAX_SUMMARY_ITEM_LENGTH + 1)] },
			{ ...summary(), confirmedFacts: ['   '] },
			{ ...summary(), coveredUntilMessageId: '' },
			{ ...summary(), updatedAt: Number.NaN },
			{ ...summary(), updatedAt: 1.5 },
		];

		for (const value of invalidValues) {
			expect(() => validateConversationSummary(value)).toThrowError(
				expect.objectContaining({ code: 'INVALID_SUMMARY_RESPONSE' }),
			);
		}
		expect(() => validateConversationSummary(summary('wrong'), 'expected')).toThrowError(
			expect.objectContaining({ code: 'INVALID_SUMMARY_RESPONSE' }),
		);

		const item = 'x'.repeat(
			Math.floor(MAX_SUMMARY_TOTAL_LENGTH / (MAX_SUMMARY_ITEMS_PER_CATEGORY * 4)) +
				1,
		);
		expect(() =>
			validateConversationSummary(
				summary('m', {
					userGoals: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill(item),
					confirmedFacts: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill(item),
					decisions: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill(item),
					unresolvedQuestions: Array(MAX_SUMMARY_ITEMS_PER_CATEGORY).fill(item),
				}),
			),
		).toThrowError(expect.objectContaining({ code: 'INVALID_SUMMARY_RESPONSE' }));
	});

	it('maps structured errors and status fallbacks to AppError', async () => {
		const message: SummaryInputMessage = {
			id: 'm',
			role: 'assistant',
			content: 'answer',
		};
		const structuredFetch = vi.fn<SummaryFetch>().mockResolvedValue(
			jsonResponse(
				{
					error: {
						code: 'RATE_LIMITED',
						message: 'slow down',
						requestId: 'body-id',
						retryable: false,
					},
				},
				{ status: 429 },
			),
		);
		await expect(
			summarizeConversation({
				messages: [message],
				clientId: 'client',
				signal: new AbortController().signal,
				fetchImpl: structuredFetch,
			}),
		).rejects.toMatchObject({
			name: 'AppError',
			code: 'RATE_LIMITED',
			status: 429,
			requestId: 'body-id',
			retryable: false,
		});

		const fallbackFetch = vi.fn<SummaryFetch>().mockResolvedValue(
			new Response('bad gateway', {
				status: 502,
				headers: { 'x-request-id': 'header-id' },
			}),
		);
		await expect(
			summarizeConversation({
				messages: [message],
				clientId: 'client',
				signal: new AbortController().signal,
				fetchImpl: fallbackFetch,
			}),
		).rejects.toMatchObject({
			code: 'UPSTREAM_UNAVAILABLE',
			status: 502,
			requestId: 'header-id',
			retryable: true,
		});
	});

	it('preserves AbortError and provides a stable network error', async () => {
		const message: SummaryInputMessage = {
			id: 'm',
			role: 'user',
			content: 'question',
		};
		const abortError = new DOMException('cancelled', 'AbortError');

		await expect(
			summarizeConversation({
				messages: [message],
				clientId: 'client',
				signal: new AbortController().signal,
				fetchImpl: vi.fn<SummaryFetch>().mockRejectedValue(abortError),
			}),
		).rejects.toBe(abortError);

		const cause = new TypeError('offline');
		await expect(
			summarizeConversation({
				messages: [message],
				clientId: 'client',
				signal: new AbortController().signal,
				fetchImpl: vi.fn<SummaryFetch>().mockRejectedValue(cause),
			}),
		).rejects.toEqual(
			expect.objectContaining({
				name: 'AppError',
				code: 'SUMMARY_NETWORK_ERROR',
				retryable: true,
				cause,
			}),
		);
	});

	it('rejects malformed success envelopes and data', async () => {
		const message: SummaryInputMessage = {
			id: 'm',
			role: 'user',
			content: 'question',
		};
		for (const body of [{ result: summary('m') }, { data: summary('other') }]) {
			await expect(
				summarizeConversation({
					messages: [message],
					clientId: 'client',
					signal: new AbortController().signal,
					fetchImpl: vi
						.fn<SummaryFetch>()
						.mockResolvedValue(jsonResponse(body)),
				}),
			).rejects.toMatchObject({ code: 'INVALID_SUMMARY_RESPONSE' });
		}
	});
});
