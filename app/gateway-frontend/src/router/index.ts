import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LobbyView from '../views/LobbyView.vue';
import AdminView from '../views/AdminView.vue';
import ServerOperationsView from '../views/ServerOperationsView.vue';
import AccountView from '../views/AccountView.vue';
import OAuthCallbackView from '../views/OAuthCallbackView.vue';

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
        {
            path: '/account',
            name: 'account',
            component: AccountView,
        },
        {
            path: '/oauth/callback',
            name: 'oauth-callback',
            component: OAuthCallbackView,
        },
    ],
});

export default router;
