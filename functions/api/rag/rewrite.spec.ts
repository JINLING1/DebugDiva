import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeRewrittenQuery } from '../../_shared/ragUpstream';
import { onRequestPost } from './rewrite';

const fetchMock = vi.fn<typeof fetch>();
const env = {
	SILICONFLOW_API_KEY: 'SERVER_ONLY_SECRET_KEY',
	SILICONFLOW_BASE_URL: 'https://api.siliconflow.example/v1',
};

const createRequest = (body: unknown) =>
	new Request('https://debugdiva.example/api/rag/rewrite', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});

const chatResponse = (content: string) =>
	Response.json({ choices: [{ message: { role: 'assistant', content } }] });

const errorOf = async (response: Response) =>
	((await response.json()) as { error: { code: string } }).error;

describe('POST /api/rag/rewrite', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'info').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('calls the configured chat model with thinking disabled and returns one clean line', async () => {
		fetchMock.mockResolvedValueOnce(chatResponse('答：ERR_STREAM_WRITE_AFTER_END stream.write after end\n解释……'));
		const response = await onRequestPost({
			request: createRequest({ query: '流关掉了还往里写' }),
			env: { ...env, RAG_REWRITE_MODEL: 'Qwen/Qwen2.5-7B-Instruct' },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: {
				model: 'Qwen/Qwen2.5-7B-Instruct',
				query: 'ERR_STREAM_WRITE_AFTER_END stream.write after end',
			},
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.siliconflow.example/v1/chat/completions');
		const body = JSON.parse(String(init?.body));
		expect(body).toMatchObject({ temperature: 0, enable_thinking: false, stream: false });
		expect(body.messages.at(-1)).toEqual({ role: 'user', content: '流关掉了还往里写' });
	});

	it('fails closed without a key and rejects invalid queries', async () => {
		const missing = await onRequestPost({ request: createRequest({ query: 'q' }), env: {} });
		expect((await errorOf(missing)).code).toBe('AUTH_FAILED');

		for (const body of [{ query: ' ' }, { query: '字'.repeat(2001) }, { nope: 1 }, 'x']) {
			const response = await onRequestPost({ request: createRequest(body), env });
			expect(response.status).toBe(400);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('maps empty model output to an invalid-response error', async () => {
		fetchMock.mockResolvedValueOnce(chatResponse('   \n  '));
		const response = await onRequestPost({ request: createRequest({ query: 'q' }), env });
		expect(response.status).toBe(502);
		expect((await errorOf(response)).code).toBe('INVALID_REWRITE_RESPONSE');
	});
});

describe('sanitizeRewrittenQuery', () => {
	it('strips think blocks, prefixes and quotes, and caps the length', () => {
		expect(sanitizeRewrittenQuery('<think>想一想</think>\n「429 Too Many Requests」')).toBe(
			'429 Too Many Requests',
		);
		expect(sanitizeRewrittenQuery('查询: `ENOENT`')).toBe('ENOENT');
		expect(Array.from(sanitizeRewrittenQuery('字'.repeat(500)))).toHaveLength(300);
	});
});
