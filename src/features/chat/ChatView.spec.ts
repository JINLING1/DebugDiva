// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from './ChatView.vue';
import { useAttachments } from '../../composables/useAttachments';
import { useChatStore } from '../../store/chat';
import { ATTACHMENT_RESULTS_STORAGE_KEY } from '../../services/storage/attachmentStorage';
import { CHAT_SESSIONS_STORAGE_KEY } from '../../services/storage/chatStorage';
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
	retain: vi.fn().mockReturnValue([]),
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

describe('ChatView attachment integration', () => {
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

	it('retains attachments referenced by any session and collects orphans', async () => {
		const { chatStore, attachmentManager } = renderView();
		attachmentManager.records.value = [
			createAttachment('shared'),
			createAttachment('citation-shared'),
			createAttachment('orphan'),
		];
		chatStore.chatSessions = [
			{
				id: 'session-a',
				title: 'A',
				createdAt: 1,
				updatedAt: 1,
				activeAttachmentIds: [],
				messages: [
					{
						id: 'message-a',
						role: 'user',
						status: 'completed',
						createdAt: 1,
						contents: [
							{ type: 'text', text: 'shared' },
							{
								type: 'file',
								attachmentId: 'shared',
								name: 'shared.txt',
								mimeType: 'text/plain',
									size: 7,
							},
							{
								type: 'citation',
								attachmentId: 'citation-shared',
								name: 'citation.txt',
								page: 2,
								excerpt: 'A cited passage',
							},
						],
					},
				],
			},
		];
		await nextTick();

		expect(attachmentManager.retain).toHaveBeenLastCalledWith([
			'citation-shared',
			'shared',
		]);
	});

	it('does not delete a record that another session still references', async () => {
		const { chatStore, chatWindow, attachmentManager } = renderView();
		attachmentManager.records.value = [createAttachment('shared')];
		chatStore.chatSessions = [
			{
				id: 'other-session',
				title: 'Other session',
				createdAt: 1,
				updatedAt: 1,
				activeAttachmentIds: [],
				messages: [
					{
						id: 'other-message',
						role: 'user',
						status: 'completed',
						createdAt: 1,
						contents: [
							{ type: 'text', text: 'Keep the shared result' },
							{
								type: 'file',
								attachmentId: 'shared',
								name: 'shared.txt',
								mimeType: 'text/plain',
								size: 7,
							},
						],
					},
				],
			},
		];
		chatStore.setActiveAttachmentIds(['shared']);
		await nextTick();

		chatWindow.vm.$emit('removeAttachment', 'shared');
		await nextTick();

		expect(chatStore.activeAttachmentIds).toEqual([]);
		expect(attachmentManager.remove).not.toHaveBeenCalled();
		expect(attachmentManager.retain).toHaveBeenLastCalledWith(['shared']);
	});

	it('does not collect attachment results when session storage is unreadable', async () => {
		localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, '{broken');
		const attachmentRaw = JSON.stringify({
			version: 1,
			attachments: [{ id: 'must-survive' }],
		});
		localStorage.setItem(ATTACHMENT_RESULTS_STORAGE_KEY, attachmentRaw);
		const { wrapper, chatStore, attachmentManager } = renderView();
		attachmentManager.records.value = [createAttachment('must-survive')];

		await nextTick();

		expect(chatStore.canPruneAttachmentResults).toBe(false);
		expect(attachmentManager.retain).not.toHaveBeenCalled();
		expect(localStorage.getItem(ATTACHMENT_RESULTS_STORAGE_KEY)).toBe(
			attachmentRaw,
		);
		wrapper.unmount();
	});
});
