import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';

const app = createApp(App);

// Vue emits component init/render/patch measures in development builds. This
// keeps realtime refresh profiling available in Chromium DevTools without
// adding production runtime work.
app.config.performance = import.meta.env.DEV;

const pinia = createPinia();
app.use(pinia);
app.use(router);

app.mount('#app');
