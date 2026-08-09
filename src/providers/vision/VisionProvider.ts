import type { VisionResult } from '../../types/attachment';

export type VisionTask = 'describe' | 'ocr' | 'auto';

/** Provider boundary used by attachment orchestration without exposing vendor APIs. */
export interface VisionProvider {
	analyze(
		file: File,
		signal: AbortSignal,
		task?: VisionTask,
	): Promise<VisionResult>;
}
