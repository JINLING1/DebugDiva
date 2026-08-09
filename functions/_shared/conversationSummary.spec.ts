import { describe, expect, it } from 'vitest';
import {
	buildSummaryUpstreamBody,
	ConversationSummaryError,
	MAX_SUMMARY_ARRAY_ITEMS,
	MAX_SUMMARY_ITEM_CHARACTERS,
	MAX_SUMMARY_MESSAGE_CHARACTERS,
	MAX_SUMMARY_MESSAGES,
	parseConversationSummary,
	parseSummaryModelResponse,
	parseSummaryRequestPayload,
	SUMMARY_MODEL,
} from './conversationSummary';

const previousSummary = {
	userGoals: ['完成项目'],
	confirmedFacts: ['使用 Vue 3'],
	decisions: ['采用服务端代理'],
	unresolvedQuestions: ['如何部署'],
	coveredUntilMessageId: 'message-8',
	updatedAt: 1_700_000_000_000,
};

const validMessage = {
	id: 'message-9',
	role: 'user' as const,
	content: '继续实现摘要',
};

const modelResponse = (summary: Record<string, unknown>) => ({
	choices: [{ message: { content: JSON.stringify(summary) } }],
});

describe('conversation summary request validation', () => {
	it('accepts the exact limits using Unicode character counts', () => {
		const messages = Array.from({ length: MAX_SUMMARY_MESSAGES }, (_, index) => ({
			id: `message-${index}`,
			role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
			content: '😀'.repeat(index <= 55 ? 1_000 : 125),
		}));
		messages[0].content = '😀'.repeat(MAX_SUMMARY_MESSAGE_CHARACTERS);

		const parsed = parseSummaryRequestPayload({
			messages,
			previousSummary,
			clientId: 'anonymous-client',
		});

		expect(parsed.messages).toHaveLength(MAX_SUMMARY_MESSAGES);
		expect(parsed.previousSummary).toEqual(previousSummary);
	});

	it('rejects unsupported roles, duplicate ids and message thresholds', () => {
		expect(() =>
			parseSummaryRequestPayload({
				messages: [{ ...validMessage, role: 'system' }],
			}),
		).toThrowError(ConversationSummaryError);
		expect(() =>
			parseSummaryRequestPayload({ messages: [validMessage, validMessage] }),
		).toThrowError('message id 必须唯一');
		expect(() =>
			parseSummaryRequestPayload({
				messages: [
					{ ...validMessage, content: '😀'.repeat(MAX_SUMMARY_MESSAGE_CHARACTERS + 1) },
				],
			}),
		).toThrowError(/单条消息内容/);
		expect(() =>
			parseSummaryRequestPayload({
				messages: Array.from({ length: MAX_SUMMARY_MESSAGES + 1 }, (_, index) => ({
					...validMessage,
					id: `message-${index}`,
				})),
			}),
		).toThrowError(/messages 数量/);
		expect(() =>
			parseSummaryRequestPayload({
				messages: Array.from({ length: 9 }, (_, index) => ({
					...validMessage,
					id: `message-${index}`,
					content: 'x'.repeat(MAX_SUMMARY_MESSAGE_CHARACTERS),
				})),
			}),
		).toThrowError(/消息内容合计/);
		expect(() =>
			parseSummaryRequestPayload({
				messages: [validMessage],
				clientId: '😀'.repeat(129),
			}),
		).toThrowError('clientId 格式无效');
	});

	it('strictly validates previousSummary metadata, arrays and extra fields', () => {
		expect(parseConversationSummary(previousSummary)).toEqual(previousSummary);
		expect(() =>
			parseConversationSummary({ ...previousSummary, injected: true }),
		).toThrowError('previousSummary 格式无效');
		expect(() =>
			parseConversationSummary({ ...previousSummary, updatedAt: 0 }),
		).toThrowError('previousSummary 格式无效');
		expect(() =>
			parseConversationSummary({
				...previousSummary,
				userGoals: Array.from(
					{ length: MAX_SUMMARY_ARRAY_ITEMS + 1 },
					() => '目标',
				),
			}),
		).toThrowError('previousSummary 格式无效');
	});

	it('drops all client-controlled provider options from the upstream body', () => {
		const request = parseSummaryRequestPayload({
			messages: [validMessage],
			previousSummary,
			clientId: 'client-id',
			model: 'attacker-model',
			thinking: { type: 'enabled' },
			stream: true,
			response_format: { type: 'text' },
		});
		const body = buildSummaryUpstreamBody(request);

		expect(body).toMatchObject({
			model: SUMMARY_MODEL,
			thinking: { type: 'disabled' },
			stream: false,
			response_format: { type: 'json_object' },
		});
		expect(body.messages[0].content).toContain('不可信的待摘要数据');
		expect(body.messages[1].content).not.toContain('attacker-model');
		expect(body.messages[1].content).not.toContain('client-id');
	});
});

describe('conversation summary model response validation', () => {
	const arrays = {
		userGoals: ['完成对话应用'],
		confirmedFacts: ['使用 Vue 3'],
		decisions: [],
		unresolvedQuestions: ['部署方式待定'],
	};

	it('returns only validated arrays plus server-owned metadata', () => {
		const result = parseSummaryModelResponse(
			modelResponse(arrays),
			'message-12',
			1_800_000_000_000,
		);

		expect(result).toEqual({
			...arrays,
			coveredUntilMessageId: 'message-12',
			updatedAt: 1_800_000_000_000,
		});
	});

	it('rejects malformed JSON, extra fields and oversized output', () => {
		expect(() =>
			parseSummaryModelResponse(
				{ choices: [{ message: { content: '```json\n{}\n```' } }] },
				'message-12',
			),
		).toThrowError('摘要服务返回了无效结果');
		expect(() =>
			parseSummaryModelResponse(
				modelResponse({ ...arrays, coveredUntilMessageId: 'model-owned' }),
				'message-12',
			),
		).toThrowError('摘要服务返回了无效结果');
		expect(() =>
			parseSummaryModelResponse(
				modelResponse({
					...arrays,
					userGoals: ['x'.repeat(MAX_SUMMARY_ITEM_CHARACTERS + 1)],
				}),
				'message-12',
			),
		).toThrowError('摘要服务返回了无效结果');
		const oversizedTotal = Object.fromEntries(
			['userGoals', 'confirmedFacts', 'decisions', 'unresolvedQuestions'].map(
				key => [key, Array.from({ length: 20 }, () => 'x'.repeat(201))],
			),
		);
		expect(() =>
			parseSummaryModelResponse(modelResponse(oversizedTotal), 'message-12'),
		).toThrowError('摘要服务返回了无效结果');
	});

	it('rejects missing choices and non-array fields without returning an old summary', () => {
		expect(() => parseSummaryModelResponse({}, 'message-12')).toThrowError(
			ConversationSummaryError,
		);
		expect(() =>
			parseSummaryModelResponse(
				modelResponse({ ...arrays, decisions: 'keep old decisions' }),
				'message-12',
			),
		).toThrowError(ConversationSummaryError);
	});
});
