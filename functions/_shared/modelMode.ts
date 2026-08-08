export const MODEL_MODE_CONFIG = {
	fast: {
		model: 'deepseek-v4-flash',
		thinking: { type: 'disabled' as const },
	},
	deep: {
		model: 'deepseek-v4-flash',
		thinking: { type: 'enabled' as const },
		reasoning_effort: 'high' as const,
	},
	quality: {
		model: 'deepseek-v4-pro',
		thinking: { type: 'enabled' as const },
		reasoning_effort: 'high' as const,
	},
} as const;

export type ServerModelMode = keyof typeof MODEL_MODE_CONFIG;
export type ModelModeConfig = (typeof MODEL_MODE_CONFIG)[ServerModelMode];

export const isServerModelMode = (value: unknown): value is ServerModelMode =>
	typeof value === 'string' && Object.hasOwn(MODEL_MODE_CONFIG, value);

export const resolveModelMode = (value: unknown): ModelModeConfig | null =>
	isServerModelMode(value) ? MODEL_MODE_CONFIG[value] : null;
