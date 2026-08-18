import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { trpc } from '../utils/trpc';

const MainView = () => import('../views/MainView.vue');
const PublicView = () => import('../views/PublicView.vue');
const LoginView = () => import('../views/LoginView.vue');
const JoinView = () => import('../views/JoinView.vue');
const SelectGeneralView = () => import('../views/SelectGeneralView.vue');
const InheritView = () => import('../views/InheritView.vue');
const AuctionView = () => import('../views/AuctionView.vue');
const NationCitiesView = () => import('../views/NationCitiesView.vue');
const NationInfoView = () => import('../views/NationInfoView.vue');
const GlobalInfoView = () => import('../views/GlobalInfoView.vue');
const CurrentCityView = () => import('../views/CurrentCityView.vue');
const NationGeneralsView = () => import('../views/NationGeneralsView.vue');
const NationSecretView = () => import('../views/NationSecretView.vue');
const NationPersonnelView = () => import('../views/NationPersonnelView.vue');
const NationStratFinanView = () => import('../views/NationStratFinanView.vue');
const ChiefCenterView = () => import('../views/ChiefCenterView.vue');
const BattleCenterView = () => import('../views/BattleCenterView.vue');
const BattleSimulatorView = () => import('../views/BattleSimulatorView.vue');
const NpcControlView = () => import('../views/NpcControlView.vue');
const NotFoundView = () => import('../views/NotFoundView.vue');
const TournamentView = () => import('../views/TournamentView.vue');
const BettingView = () => import('../views/BettingView.vue');
const MyPageView = () => import('../views/MyPageView.vue');
const BoardView = () => import('../views/BoardView.vue');
const DiplomacyView = () => import('../views/DiplomacyView.vue');
const BestGeneralView = () => import('../views/BestGeneralView.vue');
const HallOfFameView = () => import('../views/HallOfFameView.vue');
const DynastyListView = () => import('../views/DynastyListView.vue');
const DynastyDetailView = () => import('../views/DynastyDetailView.vue');
const SurveyView = () => import('../views/SurveyView.vue');
const TroopView = () => import('../views/TroopView.vue');
const YearbookView = () => import('../views/YearbookView.vue');
const NationBettingView = () => import('../views/NationBettingView.vue');
const NpcListView = () => import('../views/NpcListView.vue');
const NationListView = () => import('../views/NationListView.vue');
const GeneralListView = () => import('../views/GeneralListView.vue');
const TrafficView = () => import('../views/TrafficView.vue');
const PastPlaysView = () => import('../views/PastPlaysView.vue');

const accessPageByRouteName = {
    'nation-info': 'nation-info',
    'nation-cities': 'nation-cities',
    'nation-list': 'nation-list',
    'current-city': 'current-city',
    'dynasty-list': 'dynasty',
    'dynasty-detail': 'dynasty',
    traffic: 'traffic',
    'npc-control': 'npc-control',
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
        path: '/select-general',
        name: 'select-general',
        component: SelectGeneralView,
        meta: {
            requiresAuth: true,
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
