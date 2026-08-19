<template>
	<label class="model-selector">
		<span class="sr-only">回答模式</span>
		<select
			class="mode-select"
			:value="modelMode"
			:disabled="disabled"
			aria-label="回答模式"
			@change="handleChange"
		>
			<option v-for="option in options" :key="option.value" :value="option.value">
				{{ option.label }}
			</option>
		</select>
	</label>
</template>

<script setup lang="ts">
import type { ModelMode } from '../../types/provider';

withDefaults(
	defineProps<{
		modelMode: ModelMode;
		disabled?: boolean;
	}>(),
	{ disabled: false },
);

const emit = defineEmits<{
	change: [mode: ModelMode];
}>();

const options: Array<{ value: ModelMode; label: string }> = [
	{ value: 'fast', label: '快速回答' },
	{ value: 'deep', label: '深度思考' },
	{ value: 'quality', label: '高质量' },
];

const handleChange = (event: Event) => {
	emit('change', (event.target as HTMLSelectElement).value as ModelMode);
};
</script>

<style scoped>
.model-selector {
	display: inline-flex;
	align-items: center;
}

.mode-select {
	max-width: 112px;
	min-height: 36px;
	padding: 6px 24px 6px 10px;
	font: inherit;
	font-size: 13px;
	color: var(--dd-text-secondary);
	cursor: pointer;
	background: transparent;
	border: 1px solid transparent;
	border-radius: 8px;
	outline: none;
}

.mode-select:hover,
.mode-select:focus-visible {
	color: var(--dd-text);
	background: var(--dd-surface-hover);
	border-color: var(--dd-border);
}

.mode-select:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
</style>
