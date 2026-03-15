export function getConfig(config: string) {
	const envMap: Record<string, string> = {
		COZE_API_KEY: import.meta.env.VITE_COZE_API_KEY,
		COZE_BOT_ID: import.meta.env.VITE_COZE_BOT_ID,
		COZE_CHAT_URL: import.meta.env.VITE_COZE_CHAT_URL,
		COZE_FILE_URL: import.meta.env.VITE_COZE_FILE_URL,
	};
	return envMap[config];
}
