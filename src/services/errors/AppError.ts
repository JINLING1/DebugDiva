export interface AppErrorOptions {
	code: string;
	message: string;
	status?: number;
	requestId?: string;
	retryable?: boolean;
	cause?: unknown;
}

/**
 * Application-level error shared by providers and their consumers.
 *
 * The stable fields let the UI select a useful message without depending on a
 * provider's raw response shape.
 */
export class AppError extends Error {
	readonly code: string;
	readonly status?: number;
	readonly requestId?: string;
	readonly retryable: boolean;

	constructor({
		code,
		message,
		status,
		requestId,
		retryable = false,
		cause,
	}: AppErrorOptions) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'AppError';
		this.code = code;
		this.status = status;
		this.requestId = requestId;
		this.retryable = retryable;
	}
}
