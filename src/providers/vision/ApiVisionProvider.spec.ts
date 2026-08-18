// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { VisionFetch } from '../../api/vision';
import { ApiVisionProvider } from './ApiVisionProvider';

const result = {
	summary: 'A screenshot',
	extractedText: 'TypeError',
	objects: ['editor'],
	warnings: [],
};

describe('ApiVisionProvider', () => {
	it('implements the provider contract through the same-origin endpoint', async () => {
		const fetchMock = vi.fn<VisionFetch>().mockResolvedValue(
			new Response(JSON.stringify({ data: result }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		const provider = new ApiVisionProvider(fetchMock);
		const file = new File(['image'], 'screen.png', { type: 'image/png' });
		const controller = new AbortController();

		await expect(
			provider.analyze(file, controller.signal, 'describe'),
		).resolves.toEqual(result);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/vision/analyze');
		expect(init?.signal).toBe(controller.signal);
		const formData = init?.body as FormData;
		expect(formData.get('file')).toBe(file);
		expect(formData.get('task')).toBe('describe');
	});

	it('uses auto as the default task', async () => {
		const fetchMock = vi.fn<VisionFetch>().mockResolvedValue(
			new Response(JSON.stringify({ data: result }), { status: 200 }),
		);
		const provider = new ApiVisionProvider(fetchMock);

		await provider.analyze(
			new File(['image'], 'screen.png', { type: 'image/png' }),
			new AbortController().signal,
		);

		const formData = fetchMock.mock.calls[0][1]?.body as FormData;
		expect(formData.get('task')).toBe('auto');
	});
});
