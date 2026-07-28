/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_CHAT_API_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component: DefineComponent<{}, {}, any>;
	export default component;
}

declare module '*.css';
declare module '*.scss';
declare module '*.less';

declare module 'vue-virtual-scroller';
declare module 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
declare module 'element-plus/dist/index.css';
