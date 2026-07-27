import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import MainView from '../views/MainView.vue';
import PublicView from '../views/PublicView.vue';
import LoginView from '../views/LoginView.vue';
import JoinView from '../views/JoinView.vue';
import InheritView from '../views/InheritView.vue';
import AuctionView from '../views/AuctionView.vue';
import NationCitiesView from '../views/NationCitiesView.vue';
import NationInfoView from '../views/NationInfoView.vue';
import GlobalInfoView from '../views/GlobalInfoView.vue';
import CurrentCityView from '../views/CurrentCityView.vue';
import NationGeneralsView from '../views/NationGeneralsView.vue';
import NationSecretView from '../views/NationSecretView.vue';
import NationPersonnelView from '../views/NationPersonnelView.vue';
import NationStratFinanView from '../views/NationStratFinanView.vue';
import ChiefCenterView from '../views/ChiefCenterView.vue';
import BattleCenterView from '../views/BattleCenterView.vue';
import BattleSimulatorView from '../views/BattleSimulatorView.vue';
import NpcControlView from '../views/NpcControlView.vue';
import NotFoundView from '../views/NotFoundView.vue';
import TournamentView from '../views/TournamentView.vue';
import BettingView from '../views/BettingView.vue';
import MyPageView from '../views/MyPageView.vue';
import BoardView from '../views/BoardView.vue';
import DiplomacyView from '../views/DiplomacyView.vue';
import BestGeneralView from '../views/BestGeneralView.vue';
import HallOfFameView from '../views/HallOfFameView.vue';
import DynastyListView from '../views/DynastyListView.vue';
import DynastyDetailView from '../views/DynastyDetailView.vue';
import SurveyView from '../views/SurveyView.vue';
import TroopView from '../views/TroopView.vue';
import YearbookView from '../views/YearbookView.vue';
import NationBettingView from '../views/NationBettingView.vue';
import NpcListView from '../views/NpcListView.vue';
import NationListView from '../views/NationListView.vue';
import GeneralListView from '../views/GeneralListView.vue';
import TrafficView from '../views/TrafficView.vue';
import PastPlaysView from '../views/PastPlaysView.vue';
import { useSessionStore } from '../stores/session';
import { trpc } from '../utils/trpc';

const accessPageByRouteName = {
    home: 'front-info',
    'nation-info': 'nation-info',
    'nation-cities': 'nation-cities',
    'global-info': 'global-info',
    'nation-list': 'nation-list',
    'general-list': 'general-list',
    'current-city': 'current-city',
    diplomacy: 'diplomacy',
    'nation-generals': 'nation-generals',
    'nation-personnel': 'nation-personnel',
    'nation-finance': 'nation-finance',
    'battle-center': 'battle-center',
    board: 'board',
    'board-secret': 'board',
    'best-general': 'best-general',
    'hall-of-fame': 'hall-of-fame',
    'dynasty-list': 'dynasty',
    'dynasty-detail': 'dynasty',
    yearbook: 'yearbook',
    'nation-betting': 'nation-betting',
    traffic: 'traffic',
    'npc-list': 'npc-list',
    'my-page': 'my-page',
    'npc-control': 'npc-control',
    tournament: 'tournament',
    betting: 'betting',
} as const;

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
        path: '/inherit',
        name: 'inherit',
        component: InheritView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/troop',
        name: 'troop',
        component: TroopView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/auction',
        name: 'auction',
        component: AuctionView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/nation/info',
        name: 'nation-info',
        component: NationInfoView,
        meta: { requiresAuth: true, requiresGeneral: true },
    },
    {
        path: '/nation/cities',
        name: 'nation-cities',
        component: NationCitiesView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/global-info',
        name: 'global-info',
        component: GlobalInfoView,
        meta: { requiresAuth: true, requiresGeneral: true },
    },
    {
        path: '/nation-list',
        name: 'nation-list',
        component: NationListView,
        meta: { requiresAuth: true, requiresGeneral: true },
    },
    {
        path: '/general-list',
        name: 'general-list',
        component: GeneralListView,
        meta: { requiresAuth: true, requiresGeneral: true },
    },
    {
        path: '/current-city',
        name: 'current-city',
        component: CurrentCityView,
        meta: { requiresAuth: true, requiresGeneral: true },
    },
    {
        path: '/nation/affairs',
        name: 'nation-affairs',
        redirect: '/nation/finance',
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/nation/recruit-message',
        name: 'nation-recruit-message',
        redirect: '/nation/finance',
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/diplomacy',
        name: 'diplomacy',
        component: DiplomacyView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/nation/generals',
        name: 'nation-generals',
        component: NationGeneralsView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/nation/secret',
        name: 'nation-secret',
        component: NationSecretView,
        meta: { requiresAuth: true, requiresGeneral: true },
    },
    {
        path: '/nation/personnel',
        name: 'nation-personnel',
        component: NationPersonnelView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/nation/finance',
        name: 'nation-finance',
        component: NationStratFinanView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/chief-center',
        name: 'chief-center',
        component: ChiefCenterView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/battle-center',
        name: 'battle-center',
        component: BattleCenterView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/battle-simulator',
        name: 'battle-simulator',
        component: BattleSimulatorView,
        meta: {
            requiresAuth: true,
        },
    },
    {
        path: '/board',
        name: 'board',
        component: BoardView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/board/secret',
        name: 'board-secret',
        component: BoardView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/best-general',
        name: 'best-general',
        component: BestGeneralView,
        meta: {
            requiresAuth: true,
        },
    },
    {
        path: '/hall-of-fame',
        name: 'hall-of-fame',
        component: HallOfFameView,
    },
    {
        path: '/dynasty',
        name: 'dynasty-list',
        component: DynastyListView,
    },
    {
        path: '/dynasty/:id',
        name: 'dynasty-detail',
        component: DynastyDetailView,
    },
    {
        path: '/yearbook',
        name: 'yearbook',
        component: YearbookView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/nation-betting',
        name: 'nation-betting',
        component: NationBettingView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/traffic',
        name: 'traffic',
        component: TrafficView,
    },
    {
        path: '/npc-list',
        name: 'npc-list',
        component: NpcListView,
    },
    {
        path: '/my-page',
        name: 'my-page',
        component: MyPageView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/past-plays',
        name: 'past-plays',
        component: PastPlaysView,
        meta: {
            requiresAuth: true,
        },
    },
    {
        path: '/survey',
        name: 'survey',
        component: SurveyView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/my-settings',
        redirect: '/my-page',
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/npc-control',
        name: 'npc-control',
        component: NpcControlView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/tournament',
        name: 'tournament',
        component: TournamentView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
        },
    },
    {
        path: '/betting',
        name: 'betting',
        component: BettingView,
        meta: {
            requiresAuth: true,
            requiresGeneral: true,
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

router.afterEach((to) => {
    const session = useSessionStore();
    const routeName = typeof to.name === 'string' ? to.name : '';
    const page = accessPageByRouteName[routeName as keyof typeof accessPageByRouteName];
    if (!page || !session.hasGeneral) {
        return;
    }
    void trpc.public.recordAccess.mutate({ page }).catch(() => undefined);
});

export default router;
