import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { useThemeStore } from './stores/theme';

import './assets/styles/variables.css';
import './assets/styles/fonts.css';
import './assets/styles/base.css';
import './assets/styles/layout.css';

const app = createApp(App);

// State management
const pinia = createPinia();
app.use(pinia);

// Initialize theme from localStorage before mount
const themeStore = useThemeStore();
themeStore.init();

// Router
app.use(router);

app.mount('#app');
