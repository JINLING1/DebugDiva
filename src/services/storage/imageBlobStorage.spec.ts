import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbImageBlobRepository } from './imageBlobStorage';

const storedImage = (attachmentId: string) => ({
	attachmentId,
	blob: new Blob([`image-${attachmentId}`], { type: 'image/png' }),
	name: `${attachmentId}.png`,
	mimeType: 'image/png',
	size: `image-${attachmentId}`.length,
	createdAt: 1,
});

describe('imageBlobStorage', () => {
	it('stores and restores image Blobs by attachment id', async () => {
		const repository = createIndexedDbImageBlobRepository(new IDBFactory());
		await repository.put(storedImage('one'));

		const restored = await repository.get('one');
		expect(restored).toMatchObject({
			attachmentId: 'one',
			name: 'one.png',
			mimeType: 'image/png',
		});
		expect(await restored?.blob.text()).toBe('image-one');
		repository.close();
	});

	it('loads unique requested images and ignores missing ids', async () => {
		const repository = createIndexedDbImageBlobRepository(new IDBFactory());
		await repository.put(storedImage('one'));
		await repository.put(storedImage('two'));

		const restored = await repository.getMany(['two', 'missing', 'two']);
		expect(restored.map(record => record.attachmentId)).toEqual(['two']);
		repository.close();
	});

	it('deletes individual images and retains only referenced ids', async () => {
		const repository = createIndexedDbImageBlobRepository(new IDBFactory());
		await repository.put(storedImage('one'));
		await repository.put(storedImage('two'));
		await repository.put(storedImage('three'));

		await repository.delete('three');
		expect(await repository.get('three')).toBeUndefined();
		await expect(repository.retain(['two'])).resolves.toEqual(['one']);
		expect((await repository.getMany(['one', 'two'])).map(item => item.attachmentId)).toEqual([
			'two',
		]);
		repository.close();
	});

	it('clears all stored image Blobs', async () => {
		const repository = createIndexedDbImageBlobRepository(new IDBFactory());
		await repository.put(storedImage('one'));
		await repository.clear();

		expect(await repository.get('one')).toBeUndefined();
		repository.close();
	});
});
