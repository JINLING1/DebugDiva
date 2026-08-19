import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import VueVirtualScroller from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/index.scss';

const app = createApp(App);
const pinia = createPinia();
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
	app.component(key, component);
}

app.use(ElementPlus);
app.use(pinia);
app.use(VueVirtualScroller);
app.mount('#app');
