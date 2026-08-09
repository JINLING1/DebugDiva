import { analyzeVisionImage, type VisionFetch } from '../../api/vision';
import type { VisionResult } from '../../types/attachment';
import type { VisionProvider, VisionTask } from './VisionProvider';

/** Browser provider for the Cloudflare Pages vision endpoint. */
export class WorkersAIVisionProvider implements VisionProvider {
	constructor(private readonly fetchImpl: VisionFetch = fetch) {}

	analyze(
		file: File,
		signal: AbortSignal,
		task: VisionTask = 'auto',
	): Promise<VisionResult> {
		return analyzeVisionImage(file, {
			signal,
			task,
			fetchImpl: this.fetchImpl,
		});
	}
}
