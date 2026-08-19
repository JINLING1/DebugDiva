// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '../../types/chat';
import History from './History.vue';
import { useChatStore } from '../../store/chat';

const mocks = vi.hoisted(() => ({
	loadAttachmentResults: vi.fn(),
	downloadConversationExport: vi.fn(),
	clearAllDebugDivaLocalData: vi.fn(),
	confirm: vi.fn(),
	message: {
		success: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../services/storage/attachmentStorage', () => ({
	loadAttachmentResults: mocks.loadAttachmentResults,
}));

vi.mock('../../services/export/conversationExport', () => ({
	downloadConversationExport: mocks.downloadConversationExport,
}));

vi.mock('../../services/storage/localDataManagement', () => ({
	clearAllDebugDivaLocalData: mocks.clearAllDebugDivaLocalData,
}));

vi.mock('element-plus', () => ({
	ElMessage: mocks.message,
	ElMessageBox: { confirm: mocks.confirm },
}));

const ButtonStub = defineComponent({
	name: 'ElButton',
	emits: ['click'],
	template:
		'<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const IconStub = defineComponent({
	name: 'ElIcon',
	emits: ['click'],
	template:
		'<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const InputStub = defineComponent({
	name: 'ElInput',
	template: '<input />',
});

const sessionFixture = (): ChatSession => ({
	id: 'session-1',
	title: '前端调试记录',
	createdAt: 1,
	updatedAt: 2,
	messages: [
		{
			id: 'message-1',
			role: 'user',
			status: 'completed',
			contents: [
				{ type: 'text', text: '分析文件' },
				{
					type: 'file',
					attachmentId: 'attachment-1',
					name: 'debug.txt',
					mimeType: 'text/plain',
					size: 5,
				},
			],
			createdAt: 1,
		},
	],
	activeAttachmentIds: ['attachment-1'],
});

const renderHistory = () => {
	const pinia = createPinia();
	setActivePinia(pinia);
	const store = useChatStore(pinia);
	const session = sessionFixture();
	store.chatSessions = [session];
	const wrapper = mount(History, {
		global: {
			plugins: [pinia],
			stubs: {
				ElButton: ButtonStub,
				ElIcon: IconStub,
				ElInput: InputStub,
				Plus: true,
				ChatDotRound: true,
				Download: true,
				Edit: true,
				Delete: true,
			},
		},
	});
	return { wrapper, store, session };
};

describe('History data management actions', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		mocks.loadAttachmentResults.mockReturnValue({
			attachments: [{ id: 'attachment-1' }],
			recoveredFromError: false,
		});
		mocks.downloadConversationExport.mockResolvedValue({
			filename: 'conversation.zip',
			bytes: 100,
			missingImageIds: [],
		});
		mocks.clearAllDebugDivaLocalData.mockResolvedValue({
			ok: true,
			attempted: 8,
			removedKeys: [],
			failed: [],
		});
		mocks.confirm.mockResolvedValue('confirm');
	});

	it('exports the selected session with persisted attachment results', async () => {
		const { wrapper, session } = renderHistory();

		await wrapper
			.get('[aria-label="导出会话 前端调试记录"]')
			.trigger('click');
		await flushPromises();

		expect(mocks.loadAttachmentResults).toHaveBeenCalledWith(localStorage);
		expect(mocks.downloadConversationExport).toHaveBeenCalledWith(session, [
			{ id: 'attachment-1' },
		]);
		expect(mocks.message.success).toHaveBeenCalledWith('会话 ZIP 已导出。');
	});

	it('reports a partial attachment read while still exporting the session', async () => {
		mocks.loadAttachmentResults.mockReturnValue({
			attachments: [],
			recoveredFromError: true,
		});
		const { wrapper } = renderHistory();

		await wrapper
			.get('[aria-label="导出会话 前端调试记录"]')
			.trigger('click');
		await flushPromises();

		expect(mocks.downloadConversationExport).toHaveBeenCalledTimes(1);
		expect(mocks.message.warning).toHaveBeenCalledWith(
			'会话已导出，但部分本地附件记录无法读取。',
		);
	});

	it('warns once when a ZIP cannot include a historical original image', async () => {
		mocks.downloadConversationExport.mockResolvedValue({
			filename: 'conversation.zip',
			bytes: 100,
			missingImageIds: ['missing-image'],
		});
		const { wrapper } = renderHistory();

		await wrapper
			.get('[aria-label="导出会话 前端调试记录"]')
			.trigger('click');
		await flushPromises();

		expect(mocks.message.warning).toHaveBeenCalledOnce();
		expect(mocks.message.warning).toHaveBeenCalledWith(
			'会话 ZIP 已导出，但部分历史图片缺少原图，仅保留了元数据。',
		);
	});

	it('explains the destructive scope and does nothing when confirmation is cancelled', async () => {
		mocks.confirm.mockRejectedValue(new Error('cancel'));
		const { wrapper } = renderHistory();

		await wrapper.get('.clear-local-data-btn').trigger('click');
		await flushPromises();

		expect(mocks.confirm).toHaveBeenCalledTimes(1);
		const prompt = String(mocks.confirm.mock.calls[0][0]);
		expect(prompt).toContain('全部会话');
		expect(prompt).toContain('附件解析结果');
		expect(prompt).toContain('无法撤销');
		expect(prompt).toContain('先导出');
		expect(mocks.clearAllDebugDivaLocalData).not.toHaveBeenCalled();
	});

	it('does not claim success when only part of local data was removed', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		mocks.clearAllDebugDivaLocalData.mockReturnValue({
			ok: false,
			attempted: 8,
			removedKeys: ['debugdiva:sessions:v2'],
			failed: [{ key: 'theme', error: 'blocked' }],
		});
		const { wrapper } = renderHistory();

		await wrapper.get('.clear-local-data-btn').trigger('click');
		await flushPromises();

		expect(mocks.clearAllDebugDivaLocalData).toHaveBeenCalledWith(localStorage);
		expect(mocks.message.error).toHaveBeenCalledWith(
			'部分本地数据清理失败（1 项），请检查浏览器存储权限后重试。',
		);
		expect(mocks.message.success).not.toHaveBeenCalledWith(
			'全部本地数据已清除，页面即将刷新。',
		);
		expect(consoleError).toHaveBeenCalledWith(
			'Failed to clear some local data:',
			[{ key: 'theme', error: 'blocked' }],
		);
	});
});
