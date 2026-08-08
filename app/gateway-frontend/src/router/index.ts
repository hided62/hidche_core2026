import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LobbyView from '../views/LobbyView.vue';
import AdminOverviewView from '../views/AdminOverviewView.vue';
import AdminView from '../views/AdminView.vue';
import ServerOperationsView from '../views/ServerOperationsView.vue';
import AccountView from '../views/AccountView.vue';
import OAuthCallbackView from '../views/OAuthCallbackView.vue';
import SignupView from '../views/SignupView.vue';

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView,
        },
        {
            path: '/signup',
            name: 'signup',
            component: SignupView,
        },
        {
            path: '/lobby',
            name: 'lobby',
            component: LobbyView,
        },
        {
            path: '/admin',
            name: 'admin',
            component: AdminOverviewView,
        },
        {
            path: '/admin/users',
            name: 'admin-users',
            component: AdminView,
            props: { section: 'users' },
        },
        {
            path: '/admin/servers',
            name: 'admin-servers',
            component: AdminView,
            props: { section: 'servers' },
        },
        {
            path: '/admin/system',
            name: 'admin-system',
            component: AdminView,
            props: { section: 'system' },
        },
        {
            path: '/admin/audit',
            name: 'admin-audit',
            component: AdminView,
            props: { section: 'audit' },
        },
        {
            path: '/admin/releases',
            name: 'admin-releases',
            component: ServerOperationsView,
        },
        {
            path: '/admin/server-operations',
            redirect: (to) => ({ path: '/admin/releases', query: to.query }),
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
