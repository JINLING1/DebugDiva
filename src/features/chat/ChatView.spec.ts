// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from './ChatView.vue';
import { useAttachments } from '../../composables/useAttachments';
import { useChatStore } from '../../store/chat';
import type {
	ChatAttachment,
	DocumentAttachment,
} from '../../types/attachment';
import type { ChatMessage } from '../../types/chat';

const messageMocks = vi.hoisted(() => ({
	warning: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock('element-plus', () => ({ ElMessage: messageMocks }));
vi.mock('../../composables/useAttachments', () => ({
	useAttachments: vi.fn(),
}));

const ChatWindowStub = defineComponent({
	name: 'ChatWindow',
	props: {
		messages: { type: Array, default: () => [] },
		streaming: Boolean,
		modelMode: String,
		attachments: { type: Array, default: () => [] },
		attachmentResults: { type: Array, default: () => [] },
		attachmentsDisabled: Boolean,
	},
	emits: [
		'send',
		'stop',
		'copy',
		'retry',
		'regenerate',
		'selectFiles',
		'retryAttachment',
		'cancelAttachment',
		'removeAttachment',
		'modelChange',
	],
	template: '<div data-testid="chat-window" />',
});

const createAttachment = (
	id: string,
	overrides: Partial<DocumentAttachment> = {},
): DocumentAttachment => ({
	id,
	kind: 'document',
	status: 'ready',
	name: `${id}.txt`,
	mimeType: 'text/plain',
	size: 7,
	text: `content for ${id}`,
	truncated: false,
	warnings: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const createAttachmentManager = () => ({
	records: shallowRef<ChatAttachment[]>([]),
	storageError: shallowRef<{ code: string; message: string }>(),
	load: vi.fn().mockReturnValue({
		attachments: [],
		recoveredFromError: false,
	}),
	queueFiles: vi.fn(),
	retry: vi.fn().mockReturnValue(true),
	cancel: vi.fn().mockReturnValue(true),
	remove: vi.fn().mockReturnValue(true),
	releaseOriginalFiles: vi.fn(),
	dispose: vi.fn(),
});

const renderView = () => {
	const pinia = createPinia();
	setActivePinia(pinia);
	const attachmentManager = createAttachmentManager();
	vi.mocked(useAttachments).mockReturnValue(
		attachmentManager as unknown as ReturnType<typeof useAttachments>,
	);

	const wrapper = mount(ChatView, {
		global: {
			plugins: [pinia],
			stubs: { ChatWindow: ChatWindowStub },
		},
	});
	const chatStore = useChatStore(pinia);
	const chatWindow = wrapper.getComponent(ChatWindowStub);

	return { wrapper, chatStore, chatWindow, attachmentManager };
};

const emitSelectFiles = (
	chatWindow: ReturnType<typeof renderView>['chatWindow'],
	files: File[],
) => {
	chatWindow.vm.$emit('selectFiles', files);
};

describe('ChatView Phase 4 attachment integration', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
	});

	it('loads persisted attachment results when mounted', () => {
		const { wrapper, attachmentManager } = renderView();

		expect(attachmentManager.load).toHaveBeenCalledTimes(1);
		wrapper.unmount();
		expect(attachmentManager.dispose).toHaveBeenCalledTimes(1);
	});

	it('accepts only the remaining attachment slots and warns about omitted files', async () => {
		const { chatStore, chatWindow, attachmentManager } = renderView();
		attachmentManager.records.value = [
			createAttachment('existing-1'),
			createAttachment('existing-2'),
		];
		chatStore.setActiveAttachmentIds(['existing-1', 'existing-2']);
		attachmentManager.queueFiles.mockImplementation((files: File[]) => {
			attachmentManager.records.value = [
				...attachmentManager.records.value,
				createAttachment('new-1', {
					name: files[0].name,
					status: 'uploading',
					text: '',
				}),
			];
			return ['new-1'];
		});

		const files = [
			new File(['one'], 'one.txt', { type: 'text/plain' }),
			new File(['two'], 'two.txt', { type: 'text/plain' }),
			new File(['three'], 'three.txt', { type: 'text/plain' }),
		];
		emitSelectFiles(chatWindow, files);
		await nextTick();

		expect(attachmentManager.queueFiles).toHaveBeenCalledTimes(1);
		expect(attachmentManager.queueFiles.mock.calls[0][0]).toEqual([files[0]]);
		expect(chatStore.activeAttachmentIds).toEqual([
			'existing-1',
			'existing-2',
			'new-1',
		]);
		expect(messageMocks.warning).toHaveBeenCalledWith(
			'每条消息最多添加 3 个附件，已添加前 1 个。',
		);
	});

	it('reconciles a missing active result and still accepts a new attachment', async () => {
		const { chatStore, chatWindow, attachmentManager } = renderView();
		attachmentManager.records.value = [createAttachment('available')];
		chatStore.setActiveAttachmentIds(['available', 'missing']);
		await nextTick();

		expect(chatStore.activeAttachmentIds).toEqual(['available']);
		expect(messageMocks.warning).toHaveBeenCalledWith(
			'已停用 1 个解析结果缺失的附件，请重新选择文件。',
		);
		expect(
			(chatWindow.props('attachments') as ChatAttachment[]).map(
				attachment => attachment.id,
			),
		).toEqual(['available']);

		attachmentManager.queueFiles.mockImplementation((files: File[]) => {
			attachmentManager.records.value = [
				...attachmentManager.records.value,
				createAttachment('replacement', { name: files[0].name }),
			];
			return ['replacement'];
		});
		emitSelectFiles(chatWindow, [
			new File(['replacement'], 'replacement.md', {
				type: 'text/markdown',
			}),
		]);
		await nextTick();

		expect(attachmentManager.queueFiles).toHaveBeenCalledTimes(1);
		expect(chatStore.activeAttachmentIds).toEqual([
			'available',
			'replacement',
		]);
	});

	it('deletes an unreferenced record but only deactivates a historical attachment', async () => {
		const { chatStore, chatWindow, attachmentManager } = renderView();
		attachmentManager.records.value = [
			createAttachment('orphan'),
			createAttachment('historical'),
		];
		const historicalMessage: ChatMessage = {
			id: 'user-1',
			role: 'user',
			status: 'completed',
			contents: [
				{ type: 'text', text: '分析历史附件' },
				{
					type: 'file',
					attachmentId: 'historical',
					name: 'historical.txt',
					mimeType: 'text/plain',
					size: 7,
				},
			],
			createdAt: 1,
		};
		chatStore.chatHistory = [historicalMessage];
		chatStore.setActiveAttachmentIds(['orphan', 'historical']);
		await nextTick();

		chatWindow.vm.$emit('removeAttachment', 'orphan');
		await nextTick();
		expect(chatStore.activeAttachmentIds).toEqual(['historical']);
		expect(attachmentManager.remove).toHaveBeenCalledWith('orphan');

		chatWindow.vm.$emit('removeAttachment', 'historical');
		await nextTick();
		expect(chatStore.activeAttachmentIds).toEqual([]);
		expect(attachmentManager.remove).toHaveBeenCalledTimes(1);
		expect(attachmentManager.remove).not.toHaveBeenCalledWith('historical');
	});
});
