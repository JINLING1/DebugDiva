import { analyzeVisionImage, type VisionFetch } from '../../api/vision';
import {
	prepareVisionImageForAnalysis,
	type VisionImagePreparationOptions,
} from '../../services/images/prepareVisionImage';
import type { VisionResult } from '../../types/attachment';
import type { VisionProvider, VisionTask } from './VisionProvider';

export type VisionImagePreparer = (
	file: File,
	options: VisionImagePreparationOptions,
) => Promise<File>;

export class ApiVisionProvider implements VisionProvider {
	constructor(
		private readonly fetchImpl: VisionFetch = fetch,
		private readonly prepareImage: VisionImagePreparer =
			prepareVisionImageForAnalysis,
	) {}

	async analyze(
		file: File,
		prompt: string,
		signal: AbortSignal,
		task: VisionTask = 'auto',
	): Promise<VisionResult> {
		const preparedFile = await this.prepareImage(file, {
			prompt,
			task,
			signal,
		});
		return analyzeVisionImage(preparedFile, {
			prompt,
			signal,
			task,
			fetchImpl: this.fetchImpl,
		});
	}
}
