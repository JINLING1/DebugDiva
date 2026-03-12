import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import { getConfig } from '../utils/configHelper';

const fileList = ref<UploadUserFile[]>([]);
const imageUrl = ref<string>('');

const coze_api_key = getConfig('COZE_API_KEY');

export function useFile() {
	// 文件删除
	const handleFileDelete = (index: number) => {
		if (index < 0 || index >= fileList.value.length) return;

		ElMessageBox.confirm(
			`Cancel the transfer of ${fileList.value[index].name} ? `,
			'Confirm Deletion',
			{ confirmButtonText: ' OK ', cancelButtonText: 'Cancel' },
		)
			.then(() => {
				fileList.value.splice(index, 1);
				ElMessage.success('Deletion successful');
			})
			.catch(() => {});
	};

	const handleFileChange = async (
		file: UploadUserFile,
		fileList: UploadUserFile[],
	) => {
		let maxSize;
		if (file.raw?.type.startsWith('image/')) {
			maxSize = 10 * 1024 * 1024; // 10MB 图片
		} else {
			maxSize = 200 * 1024 * 1024; // 200MB 其他
		}

		const isLtMaxSize = (file.raw?.size || 0) <= maxSize;
		if (!isLtMaxSize) {
			ElMessage.error(
				`File size must be less than ${maxSize / (1024 * 1024)}MB!`,
			);
			fileList.splice(
				fileList.findIndex(f => f.raw === file.raw),
				1,
			);
			return; // 阻止上传
		}

		console.log('Updated file list:', fileList);
		const formData = new FormData();
		formData.append('file', file.raw as File);

		try {
			const response = await fetch('https://api.coze.cn/v1/files/upload', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${coze_api_key}`,
				},
				body: formData,
			});

			const responseData = await response.json();
			if (response.ok && responseData?.code === 0) {
				console.log('File uploaded successfully:', responseData.data);
				ElMessage.success('File uploaded successfully!');
				// 更新文件 url 到 fileList
				console.log('id:', responseData.data.id);
				// 只更新文件的URL，而不手动push
				// file.url = responseData.data.id;
				const fileId = responseData.data.id;
				imageUrl.value = `https://s.coze.cn/t/${fileId}/`; // 拼接完整图片链接

				file.url = fileId; // 保存原始ID到fileList
				console.log('Updated file list:', fileList[0].url);
			} else {
				throw new Error(responseData?.msg || 'Failed to upload file');
			}
		} catch (error) {
			console.error('Error during file upload:', error);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			ElMessage.error('Failed to upload file: ' + errorMessage);
			// 如果上传失败，从fileList中移除该文件
			fileList.splice(
				fileList.findIndex(f => f.raw === file.raw),
				1,
			);
		}
	};

	return { fileList, handleFileDelete, handleFileChange };
}
