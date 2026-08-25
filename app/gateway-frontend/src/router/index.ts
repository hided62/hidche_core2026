import { createRouter, createWebHistory } from 'vue-router';

const HomeView = () => import('../views/HomeView.vue');
const LobbyView = () => import('../views/LobbyView.vue');
const OpenSuggestionView = () => import('../views/OpenSuggestionView.vue');
const AdminOverviewView = () => import('../views/AdminOverviewView.vue');
const AdminView = () => import('../views/AdminView.vue');
const ServerOperationsView = () => import('../views/ServerOperationsView.vue');
const BulkReleaseView = () => import('../views/BulkReleaseView.vue');
const AccountView = () => import('../views/AccountView.vue');
const OAuthCallbackView = () => import('../views/OAuthCallbackView.vue');
const SignupView = () => import('../views/SignupView.vue');

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
            path: '/open-suggestion',
            name: 'open-suggestion',
            component: OpenSuggestionView,
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
            path: '/admin/servers/:profileName',
            name: 'admin-server',
            component: AdminView,
            props: (route) => ({ section: 'servers', profileName: route.params.profileName }),
        },
        {
            path: '/admin/servers/:profileName/version',
            name: 'admin-server-version',
            component: ServerOperationsView,
            props: (route) => ({ mode: 'version', profileName: route.params.profileName }),
        },
        {
            path: '/admin/servers/:profileName/scenario',
            name: 'admin-server-scenario',
            component: ServerOperationsView,
            props: (route) => ({ mode: 'scenario', profileName: route.params.profileName }),
        },
        {
            path: '/admin/servers/:profileName/cancel',
            name: 'admin-server-cancel',
            component: ServerOperationsView,
            props: (route) => ({ mode: 'cancel', profileName: route.params.profileName }),
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
            path: '/admin/releases/batch',
            name: 'admin-bulk-releases',
            component: BulkReleaseView,
        },
        {
            path: '/admin/releases',
            name: 'admin-releases',
            component: ServerOperationsView,
            props: { mode: 'gateway' },
        },
        {
            path: '/admin/server-operations',
            redirect: (to) => ({ path: '/admin/servers', query: to.query }),
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
