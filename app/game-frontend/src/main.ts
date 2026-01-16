import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';
import { useSessionStore } from './stores/session';

const app = createApp(App);

const pinia = createPinia();
app.use(pinia);
app.use(router);

const session = useSessionStore(pinia);
void session.initialize();

app.mount('#app');
