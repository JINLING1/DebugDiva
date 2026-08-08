import { describe, expect, it } from 'vitest';
import { resolveModelMode } from './modelMode';

describe('resolveModelMode', () => {
	it('maps fast mode to Flash with thinking explicitly disabled', () => {
		expect(resolveModelMode('fast')).toEqual({
			model: 'deepseek-v4-flash',
			thinking: { type: 'disabled' },
		});
	});

	it('maps deep mode to Flash with high reasoning effort', () => {
		expect(resolveModelMode('deep')).toEqual({
			model: 'deepseek-v4-flash',
			thinking: { type: 'enabled' },
			reasoning_effort: 'high',
		});
	});

	it('maps quality mode to Pro with high reasoning effort', () => {
		expect(resolveModelMode('quality')).toEqual({
			model: 'deepseek-v4-pro',
			thinking: { type: 'enabled' },
			reasoning_effort: 'high',
		});
	});

	it.each([undefined, null, '', 'turbo', '__proto__', { mode: 'fast' }])(
		'rejects an unsupported mode: %s',
		mode => {
			expect(resolveModelMode(mode)).toBeNull();
		},
	);
});
