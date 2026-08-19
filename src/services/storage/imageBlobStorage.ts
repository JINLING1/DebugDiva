export const IMAGE_BLOB_DATABASE_NAME = 'debugdiva';
export const IMAGE_BLOB_DATABASE_VERSION = 1;
export const IMAGE_BLOB_STORE_NAME = 'image-blobs';

export interface StoredImageBlob {
	attachmentId: string;
	blob: Blob;
	name: string;
	mimeType: string;
	size: number;
	createdAt: number;
}

export interface ImageBlobRepository {
	put(record: StoredImageBlob): Promise<void>;
	get(attachmentId: string): Promise<StoredImageBlob | undefined>;
	getMany(attachmentIds: readonly string[]): Promise<StoredImageBlob[]>;
	delete(attachmentId: string): Promise<void>;
	retain(attachmentIds: readonly string[]): Promise<string[]>;
	clear(): Promise<void>;
	close(): void;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.addEventListener('success', () => resolve(request.result), {
			once: true,
		});
		request.addEventListener(
			'error',
			() => reject(request.error ?? new Error('IndexedDB 请求失败')),
			{ once: true },
		);
	});

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.addEventListener('complete', () => resolve(), { once: true });
		transaction.addEventListener(
			'abort',
			() => reject(transaction.error ?? new Error('IndexedDB 事务已中止')),
			{ once: true },
		);
		transaction.addEventListener(
			'error',
			() => reject(transaction.error ?? new Error('IndexedDB 事务失败')),
			{ once: true },
		);
	});

const normalizeStoredImage = (value: unknown): StoredImageBlob | undefined => {
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Partial<StoredImageBlob>;
	if (
		typeof record.attachmentId !== 'string' ||
		!record.attachmentId ||
		!(record.blob instanceof Blob) ||
		typeof record.name !== 'string' ||
		typeof record.mimeType !== 'string' ||
		typeof record.size !== 'number' ||
		!Number.isFinite(record.size) ||
		record.size < 0 ||
		typeof record.createdAt !== 'number' ||
		!Number.isFinite(record.createdAt)
	) {
		return undefined;
	}
	return {
		attachmentId: record.attachmentId,
		blob: record.blob,
		name: record.name,
		mimeType: record.mimeType,
		size: record.size,
		createdAt: record.createdAt,
	};
};
export const createIndexedDbImageBlobRepository = (
	indexedDb: IDBFactory = indexedDB,
): ImageBlobRepository => {
	let databasePromise: Promise<IDBDatabase> | undefined;
	let database: IDBDatabase | undefined;

	const openDatabase = (): Promise<IDBDatabase> => {
		if (databasePromise) return databasePromise;
		databasePromise = new Promise((resolve, reject) => {
			const request = indexedDb.open(
				IMAGE_BLOB_DATABASE_NAME,
				IMAGE_BLOB_DATABASE_VERSION,
			);
			request.addEventListener(
				'upgradeneeded',
				() => {
					const opened = request.result;
					if (!opened.objectStoreNames.contains(IMAGE_BLOB_STORE_NAME)) {
						opened.createObjectStore(IMAGE_BLOB_STORE_NAME, {
							keyPath: 'attachmentId',
						});
					}
				},
				{ once: true },
			);
			request.addEventListener(
				'success',
				() => {
					database = request.result;
					database.addEventListener('versionchange', () => database?.close());
					resolve(database);
				},
				{ once: true },
			);
			request.addEventListener(
				'error',
				() => reject(request.error ?? new Error('无法打开图片存储')),
				{ once: true },
			);
		});
		return databasePromise;
	};

	const runStore = async (
		mode: IDBTransactionMode,
		operation: (store: IDBObjectStore) => void,
	): Promise<void> => {
		const opened = await openDatabase();
		const transaction = opened.transaction(IMAGE_BLOB_STORE_NAME, mode);
		operation(transaction.objectStore(IMAGE_BLOB_STORE_NAME));
		await transactionComplete(transaction);
	};

	return {
		async put(record) {
			await runStore('readwrite', store => {
				store.put({ ...record });
			});
		},
		async get(attachmentId) {
			const opened = await openDatabase();
			const transaction = opened.transaction(IMAGE_BLOB_STORE_NAME, 'readonly');
			const value = await requestResult(
				transaction.objectStore(IMAGE_BLOB_STORE_NAME).get(attachmentId),
			);
			await transactionComplete(transaction);
			return normalizeStoredImage(value);
		},
		async getMany(attachmentIds) {
			const uniqueIds = [...new Set(attachmentIds)];
			if (!uniqueIds.length) return [];
			const opened = await openDatabase();
			const transaction = opened.transaction(IMAGE_BLOB_STORE_NAME, 'readonly');
			const store = transaction.objectStore(IMAGE_BLOB_STORE_NAME);
			const values = await Promise.all(
				uniqueIds.map(attachmentId => requestResult(store.get(attachmentId))),
			);
			await transactionComplete(transaction);
			return values
				.map(normalizeStoredImage)
				.filter((value): value is StoredImageBlob => Boolean(value));
		},
		async delete(attachmentId) {
			await runStore('readwrite', store => {
				store.delete(attachmentId);
			});
		},
		async retain(attachmentIds) {
			const retained = new Set(attachmentIds);
			const opened = await openDatabase();
			const transaction = opened.transaction(IMAGE_BLOB_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(IMAGE_BLOB_STORE_NAME);
			const keys = await requestResult(store.getAllKeys());
			const removed = keys
				.filter((key): key is string => typeof key === 'string')
				.filter(key => !retained.has(key));
			removed.forEach(key => store.delete(key));
			await transactionComplete(transaction);
			return removed;
		},
		async clear() {
			await runStore('readwrite', store => {
				store.clear();
			});
		},
		close() {
			database?.close();
			database = undefined;
			databasePromise = undefined;
		},
	};
};
