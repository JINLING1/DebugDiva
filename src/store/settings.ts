import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { ModelMode } from '../types/provider';

export const SETTINGS_STORAGE_KEY = 'debugdiva:settings:v1';

interface PersistedSettings {
	version: 1;
	modelMode: ModelMode;
	clientId: string;
}

export const isModelMode = (value: unknown): value is ModelMode =>
	value === 'fast' || value === 'deep' || value === 'quality';

const createAnonymousClientId = () => {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `anonymous-${suffix}`;
};

const isValidClientId = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.startsWith('anonymous-') &&
	value.length <= 128;

export const useSettingsStore = defineStore('settings', () => {
	const modelMode = ref<ModelMode>('fast');
	const clientId = ref(createAnonymousClientId());
	const initialized = ref(false);

	const persist = (storage: Storage = localStorage) => {
		const snapshot: PersistedSettings = {
			version: 1,
			modelMode: modelMode.value,
			clientId: clientId.value,
		};

		try {
			storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
			return true;
		} catch (error) {
			console.error('Failed to persist settings:', error);
			return false;
		}
	};

	const loadSettings = (storage: Storage = localStorage) => {
		if (initialized.value) return;

		try {
			const raw = storage.getItem(SETTINGS_STORAGE_KEY);
			if (raw) {
				const saved = JSON.parse(raw) as Partial<PersistedSettings>;
				if (isModelMode(saved.modelMode)) modelMode.value = saved.modelMode;
				if (isValidClientId(saved.clientId)) clientId.value = saved.clientId;
			}
		} catch (error) {
			console.warn('Failed to load settings, using defaults:', error);
		}

		initialized.value = true;
		persist(storage);
	};

	const setModelMode = (
		mode: ModelMode,
		storage: Storage = localStorage,
	) => {
		if (!isModelMode(mode)) return false;
		modelMode.value = mode;
		return persist(storage);
	};

	return {
		modelMode,
		clientId,
		initialized,
		loadSettings,
		setModelMode,
	};
});
