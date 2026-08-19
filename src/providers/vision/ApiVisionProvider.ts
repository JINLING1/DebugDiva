import { analyzeVisionImage, type VisionFetch } from '../../api/vision';
import type { VisionResult } from '../../types/attachment';
import type { VisionProvider, VisionTask } from './VisionProvider';

export class ApiVisionProvider implements VisionProvider {
	constructor(private readonly fetchImpl: VisionFetch = fetch) {}

	analyze(
		file: File,
		prompt: string,
		signal: AbortSignal,
		task: VisionTask = 'auto',
	): Promise<VisionResult> {
		return analyzeVisionImage(file, {
			prompt,
			signal,
			task,
			fetchImpl: this.fetchImpl,
		});
	}
}
