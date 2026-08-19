// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from './store/chat';

type MediaChangeListener = (event: MediaQueryListEvent) => void;

let mediaListener: MediaChangeListener | undefined;
let mediaMatches = false;

const installMatchMedia = () => {
	mediaListener = undefined;
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: vi.fn(() => ({
			matches: mediaMatches,
			media: '(max-width: 768px)',
			onchange: null,
			addEventListener: vi.fn(
				(_type: string, listener: MediaChangeListener) => {
					mediaListener = listener;
				},
			),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
		})),
	});
};

const renderApp = async () => {
	vi.resetModules();
	installMatchMedia();
	const { default: App } = await import('./App.vue');
	const pinia = createPinia();
	setActivePinia(pinia);
	const wrapper = mount(App, {
		global: {
			plugins: [pinia],
			stubs: {
				ElContainer: { template: '<div><slot /></div>' },
				ElAside: { template: '<aside><slot /></aside>' },
				ElHeader: { template: '<header><slot /></header>' },
				ElMain: { template: '<main><slot /></main>' },
				History: true,
				Nav: true,
				ChatView: true,
			},
		},
	});
	return { wrapper, store: useChatStore(pinia) };
};

describe('App responsive shell', () => {
	beforeEach(() => {
		mediaMatches = false;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('starts with an open desktop sidebar and restores it across breakpoint changes', async () => {
		const { wrapper, store } = await renderApp();

		expect(store.isSidebarOpen).toBe(true);
		expect(wrapper.get('.app-sidebar').classes()).not.toContain('is-mobile');

		mediaListener?.({ matches: true } as MediaQueryListEvent);
		await nextTick();
		expect(store.isSidebarOpen).toBe(false);
		expect(wrapper.get('.app-sidebar').classes()).toEqual(
			expect.arrayContaining(['is-mobile', 'is-collapsed']),
		);

		mediaListener?.({ matches: false } as MediaQueryListEvent);
		await nextTick();
		expect(store.isSidebarOpen).toBe(true);
		expect(wrapper.get('.app-sidebar').classes()).not.toContain('is-mobile');
	});

	it('keeps the mobile drawer closed by default and closes it from the overlay', async () => {
		mediaMatches = true;
		const { wrapper, store } = await renderApp();

		expect(store.isSidebarOpen).toBe(false);
		store.isSidebarOpen = true;
		await nextTick();

		await wrapper.get('[aria-label="关闭侧栏"]').trigger('click');
		expect(store.isSidebarOpen).toBe(false);
	});
});
