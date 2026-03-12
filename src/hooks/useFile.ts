import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadUserFile } from 'element-plus';
import { cozeApi } from '../api/coze';

const fileList = ref<UploadUserFile[]>([]);
const imageUrl = ref<string>('');

export function useFile() {
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

		try {
			const fileData = await cozeApi.uploadFile(file.raw as File);

			console.log('File uploaded successfully:', fileData);
			ElMessage.success('File uploaded successfully!');

			const fileId = fileData.id;
			imageUrl.value = `https://s.coze.cn/t/${fileId}/`; // 拼接完整图片链接

			file.url = fileId; // 保存原始ID到fileList
			console.log('Updated file list:', fileList[0].url);
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
