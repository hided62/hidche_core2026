import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LobbyView from '../views/LobbyView.vue';
import AdminView from '../views/AdminView.vue';
import ServerOperationsView from '../views/ServerOperationsView.vue';

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView,
        },
        {
            path: '/lobby',
            name: 'lobby',
            component: LobbyView,
        },
        {
            path: '/admin',
            name: 'admin',
            component: AdminView,
        },
        {
            path: '/admin/server-operations',
            name: 'server-operations',
            component: ServerOperationsView,
        },
    ],
});

export default router;
