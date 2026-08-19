// @vitest-environment jsdom

import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Nav from './Nav.vue';

describe('Nav theme control', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.classList.remove('dark');
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			value: vi.fn(() => ({ matches: false })),
		});
	});

	afterEach(() => {
		document.getElementById('hljs-theme-style')?.remove();
		document.documentElement.classList.remove('dark');
	});

	it('restores and persists the selected color theme', async () => {
		localStorage.setItem('theme', 'dark');
		const wrapper = mount(Nav, {
			global: { plugins: [createPinia(), ElementPlus] },
		});

		expect(document.documentElement.classList.contains('dark')).toBe(true);
		await wrapper.get('.theme-toggle-btn').trigger('click');

		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(localStorage.getItem('theme')).toBe('light');
	});
});
