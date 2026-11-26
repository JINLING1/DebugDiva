/**
 * 文档检索索引的本地存储（IndexedDB）。
 *
 * 使用独立数据库 `debugdiva-rag`，不改动图片库 `debugdiva` 的版本与结构。
 * chunk 原文与向量都只保存在当前浏览器，与项目“服务端不保存用户数据”的原则一致。
 */

import type { SegmentKind } from '../../../functions/_shared/documentSegments';

export const RAG_INDEX_DATABASE_NAME = 'debugdiva-rag';
export const RAG_INDEX_DATABASE_VERSION = 1;
const CHUNK_STORE = 'chunks';
const DOCUMENT_STORE = 'documents';
const BY_ATTACHMENT = 'by-attachment';

export interface StoredChunk {
	id: string;
	attachmentId: string;
	ordinal: number;
	text: string;
	/** 用于向量化与 BM25 的文本（带文件名与标题前缀）。 */
	searchText: string;
	charStart: number;
	charEnd: number;
	page?: number;
	pageEnd?: number;
	headingPath?: string[];
	kind: SegmentKind;
	vector?: Float32Array;
}

export interface StoredDocumentIndex {
	attachmentId: string;
	name: string;
	chunkCount: number;
	textLength: number;
	/** 已完成向量化时记录模型；模型变更后需要重新向量化。 */
	model?: string;
	dims?: number;
	createdAt: number;
}

export interface RagIndexRepository {
	putDocument(document: StoredDocumentIndex, chunks: readonly StoredChunk[]): Promise<void>;
	getDocuments(attachmentIds: readonly string[]): Promise<StoredDocumentIndex[]>;
	getChunks(attachmentIds: readonly string[]): Promise<StoredChunk[]>;
	putVectors(
		attachmentId: string,
		model: string,
		dims: number,
		vectors: ReadonlyMap<string, Float32Array>,
	): Promise<void>;
	delete(attachmentId: string): Promise<void>;
	/** 删除不在列表中的索引，返回被删除的附件 id。 */
	retain(attachmentIds: readonly string[]): Promise<string[]>;
	clear(): Promise<void>;
	close(): void;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.addEventListener('success', () => resolve(request.result), { once: true });
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

const deleteChunksOf = (store: IDBObjectStore, attachmentId: string) => {
	const request = store.index(BY_ATTACHMENT).openKeyCursor(attachmentId);
	request.addEventListener('success', () => {
		const cursor = request.result;
		if (!cursor) return;
		store.delete(cursor.primaryKey);
		cursor.continue();
	});
};

export const createIndexedDbRagIndexRepository = (
	indexedDb: IDBFactory = indexedDB,
): RagIndexRepository => {
	let databasePromise: Promise<IDBDatabase> | undefined;
	let database: IDBDatabase | undefined;

	const open = (): Promise<IDBDatabase> => {
		databasePromise ??= new Promise((resolve, reject) => {
			const request = indexedDb.open(RAG_INDEX_DATABASE_NAME, RAG_INDEX_DATABASE_VERSION);
			request.addEventListener(
				'upgradeneeded',
				() => {
					const opened = request.result;
					if (!opened.objectStoreNames.contains(CHUNK_STORE)) {
						opened
							.createObjectStore(CHUNK_STORE, { keyPath: 'id' })
							.createIndex(BY_ATTACHMENT, 'attachmentId');
					}
					if (!opened.objectStoreNames.contains(DOCUMENT_STORE)) {
						opened.createObjectStore(DOCUMENT_STORE, { keyPath: 'attachmentId' });
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
				() => reject(request.error ?? new Error('无法打开文档索引存储')),
				{ once: true },
			);
		});
		return databasePromise;
	};

	const getAllByAttachment = async <T>(storeName: string, attachmentIds: readonly string[]) => {
		const ids = [...new Set(attachmentIds)];
		if (!ids.length) return [] as T[];
		const opened = await open();
		const transaction = opened.transaction(storeName, 'readonly');
		const store = transaction.objectStore(storeName);
		const results = await Promise.all(
			ids.map(id =>
				storeName === CHUNK_STORE
					? requestResult(store.index(BY_ATTACHMENT).getAll(id))
					: requestResult(store.get(id)).then(value => (value ? [value] : [])),
			),
		);
		await transactionComplete(transaction);
		return results.flat() as T[];
	};

	return {
		async putDocument(document, chunks) {
			const opened = await open();
			const transaction = opened.transaction([CHUNK_STORE, DOCUMENT_STORE], 'readwrite');
			const chunkStore = transaction.objectStore(CHUNK_STORE);
			deleteChunksOf(chunkStore, document.attachmentId);
			for (const chunk of chunks) chunkStore.put({ ...chunk });
			transaction.objectStore(DOCUMENT_STORE).put({ ...document });
			await transactionComplete(transaction);
		},
		getDocuments: ids => getAllByAttachment<StoredDocumentIndex>(DOCUMENT_STORE, ids),
		async getChunks(ids) {
			const chunks = await getAllByAttachment<StoredChunk>(CHUNK_STORE, ids);
			return chunks.sort((a, b) =>
				a.attachmentId === b.attachmentId
					? a.ordinal - b.ordinal
					: a.attachmentId.localeCompare(b.attachmentId),
			);
		},
		async putVectors(attachmentId, model, dims, vectors) {
			const opened = await open();
			const transaction = opened.transaction([CHUNK_STORE, DOCUMENT_STORE], 'readwrite');
			const chunkStore = transaction.objectStore(CHUNK_STORE);
			const documentStore = transaction.objectStore(DOCUMENT_STORE);
			const chunks = await requestResult(
				chunkStore.index(BY_ATTACHMENT).getAll(attachmentId),
			);
			for (const chunk of chunks as StoredChunk[]) {
				const vector = vectors.get(chunk.id);
				if (vector) chunkStore.put({ ...chunk, vector });
			}
			const document = (await requestResult(documentStore.get(attachmentId))) as
				| StoredDocumentIndex
				| undefined;
			if (document) documentStore.put({ ...document, model, dims });
			await transactionComplete(transaction);
		},
		async delete(attachmentId) {
			const opened = await open();
			const transaction = opened.transaction([CHUNK_STORE, DOCUMENT_STORE], 'readwrite');
			deleteChunksOf(transaction.objectStore(CHUNK_STORE), attachmentId);
			transaction.objectStore(DOCUMENT_STORE).delete(attachmentId);
			await transactionComplete(transaction);
		},
		async retain(attachmentIds) {
			const keep = new Set(attachmentIds);
			const opened = await open();
			const readTransaction = opened.transaction(DOCUMENT_STORE, 'readonly');
			const keys = (await requestResult(
				readTransaction.objectStore(DOCUMENT_STORE).getAllKeys(),
			)) as string[];
			await transactionComplete(readTransaction);
			const removed = keys.filter(key => !keep.has(key));
			for (const id of removed) await this.delete(id);
			return removed;
		},
		async clear() {
			const opened = await open();
			const transaction = opened.transaction([CHUNK_STORE, DOCUMENT_STORE], 'readwrite');
			transaction.objectStore(CHUNK_STORE).clear();
			transaction.objectStore(DOCUMENT_STORE).clear();
			await transactionComplete(transaction);
		},
		close() {
			database?.close();
			database = undefined;
			databasePromise = undefined;
		},
	};
};
