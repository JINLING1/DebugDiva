// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ModelSelector from './ModelSelector.vue';

describe('ModelSelector', () => {
	it('shows only the three supported user-facing modes', () => {
		const wrapper = mount(ModelSelector, { props: { modelMode: 'fast' } });
		const options = wrapper.findAll('option');

		expect(options.map(option => option.attributes('value'))).toEqual([
			'fast',
			'deep',
			'quality',
		]);
		expect(options.map(option => option.text())).toEqual([
			'快速回答',
			'深度思考',
			'高质量',
		]);
	});

	it('emits a mode instead of a provider model name', async () => {
		const wrapper = mount(ModelSelector, { props: { modelMode: 'fast' } });

		await wrapper.get('select').setValue('quality');

		expect(wrapper.emitted('change')).toEqual([['quality']]);
	});

	it('can be disabled while a request is streaming', () => {
		const wrapper = mount(ModelSelector, {
			props: { modelMode: 'deep', disabled: true },
		});

		expect(wrapper.get('select').attributes()).toHaveProperty('disabled');
	});
});
