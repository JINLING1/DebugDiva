import type { VisionResult } from '../../types/attachment';

export type VisionTask = 'describe' | 'ocr' | 'auto';

export interface VisionProvider {
	analyze(
		file: File,
		prompt: string,
		signal: AbortSignal,
		task?: VisionTask,
	): Promise<VisionResult>;
}
