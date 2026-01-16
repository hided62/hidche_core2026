import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import MainView from '../views/MainView.vue';
import PublicView from '../views/PublicView.vue';
import LoginView from '../views/LoginView.vue';
import JoinView from '../views/JoinView.vue';
import NotFoundView from '../views/NotFoundView.vue';
import { useSessionStore } from '../stores/session';

const routes = [
    {
        path: '/',
        name: 'home',
        component: MainView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/public',
        name: 'public',
        component: PublicView,
    },
    {
        path: '/join',
        name: 'join',
        component: JoinView,
        meta: {
            requiresAuth: true,
            requiresNoGeneral: true,
        },
    },
    {
        path: '/login',
        name: 'login',
        component: LoginView,
        meta: {
            publicOnly: true,
        },
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: NotFoundView,
    },
] satisfies RouteRecordRaw[];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
});

router.beforeEach(async (to) => {
    const session = useSessionStore();

    if (!session.isReady) {
        await session.initialize();
    }

    if (!session.isReady) {
        return true;
    }

    if (to.meta.publicOnly && session.isAuthed) {
        return { name: session.hasGeneral ? 'home' : 'join' };
    }

    if (to.meta.requiresAuth && !session.isAuthed) {
        return { name: 'public' };
    }

    if (to.meta.requiresNoGeneral && session.hasGeneral) {
        return { name: 'home' };
    }

    if (to.meta.requiresGeneral && !session.hasGeneral) {
        return { name: session.isAuthed ? 'join' : 'public' };
    }

    return true;
});

export default router;
