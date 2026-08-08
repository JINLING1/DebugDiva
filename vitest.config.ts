import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	plugins: [vue()],
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts', 'functions/**/*.spec.ts'],
		clearMocks: true,
		restoreMocks: true,
	},
});
