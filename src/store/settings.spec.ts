// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
	SETTINGS_STORAGE_KEY,
	useSettingsStore,
} from './settings';

describe('settings store', () => {
	beforeEach(() => {
		localStorage.clear();
		setActivePinia(createPinia());
	});

	it('creates and persists anonymous defaults', () => {
		const store = useSettingsStore();
		store.loadSettings();

		expect(store.modelMode).toBe('fast');
		expect(store.clientId).toMatch(/^anonymous-/);
		expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}')).toEqual(
			expect.objectContaining({
				version: 1,
				modelMode: 'fast',
				clientId: store.clientId,
			}),
		);
	});

	it('restores and updates the selected mode', () => {
		localStorage.setItem(
			SETTINGS_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				modelMode: 'deep',
				clientId: 'anonymous-stable-client',
			}),
		);
		const store = useSettingsStore();
		store.loadSettings();

		expect(store.modelMode).toBe('deep');
		expect(store.clientId).toBe('anonymous-stable-client');
		expect(store.setModelMode('quality')).toBe(true);
		expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}')).toEqual(
			expect.objectContaining({ modelMode: 'quality' }),
		);
	});

	it('falls back safely when persisted values are invalid', () => {
		localStorage.setItem(
			SETTINGS_STORAGE_KEY,
			JSON.stringify({ modelMode: 'arbitrary-model', clientId: 'email@example.com' }),
		);
		const store = useSettingsStore();
		store.loadSettings();

		expect(store.modelMode).toBe('fast');
		expect(store.clientId).toMatch(/^anonymous-/);
	});
});
