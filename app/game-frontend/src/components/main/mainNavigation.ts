import type {
    RuntimeNavigationConfig,
    RuntimeNavigationEntry,
    RuntimeNavigationLink,
} from '@sammo-ts/common/navigation/menuConfig';
import defaultNavigationJson from '../../../../../resources/navigation.json';
import { resolveTournamentMainPresentation } from '../../utils/tournamentNavigation';

export type NationAccessRule =
    'always' | 'meeting' | 'secret' | 'nation-member' | 'nation-established' | 'nation-secret';

export type MainNavigationLink = RuntimeNavigationLink & {
    compactLabel?: string;
    access?: NationAccessRule;
    highlightStage?: number;
    highlightStages?: readonly number[];
    unavailableReason?: string;
};

export interface MainNavigationDivider {
    kind: 'divider';
    id: string;
    label?: string;
}

export interface MainNavigationGroup {
    kind: 'group';
    id: string;
    label: string;
    items: Array<MainNavigationLink | MainNavigationDivider>;
}

export interface MainNavigationSplit {
    kind: 'split';
    id: string;
    main: MainNavigationLink;
    items: Array<MainNavigationLink | MainNavigationDivider>;
}

export type MainNavigationEntry = MainNavigationLink | MainNavigationGroup | MainNavigationSplit;

export interface NationNavigationAccess {
    permission: number;
    officerLevel: number;
    nationLevel: number;
}

export interface QuickNavigationItem {
    id: string;
    label: string;
    tab: 'map' | 'commands' | 'status' | 'world' | 'messages';
    selector: string;
}

const defaultNavigation = defaultNavigationJson as RuntimeNavigationConfig;
export const defaultGlobalNavigation = defaultNavigation.game.items as MainNavigationEntry[];

const isVisible = (link: MainNavigationLink, npcMode: number): boolean =>
    link.showWhen !== 'npc-enabled' || npcMode > 0;

export const buildGlobalNavigation = (
    npcMode: number,
    source: RuntimeNavigationEntry[] = defaultGlobalNavigation
): MainNavigationEntry[] =>
    source.flatMap((entry): MainNavigationEntry[] => {
        if (entry.kind === 'link') return isVisible(entry, npcMode) ? [entry] : [];
        const items = entry.items.filter(
            (item): item is MainNavigationLink | MainNavigationDivider =>
                item.kind === 'divider' || isVisible(item, npcMode)
        );
        if (entry.kind === 'group') return items.length > 0 ? [{ ...entry, items }] : [];
        if (!isVisible(entry.main, npcMode)) return [];
        return items.length > 0 ? [{ ...entry, items }] : [entry.main];
    });

export const nationNavigation: MainNavigationEntry[] = [
    {
        kind: 'link',
        id: 'meeting',
        label: '회 의 실',
        compactLabel: '회의실',
        to: '/board',
        access: 'meeting',
    },
    {
        kind: 'link',
        id: 'secret-board',
        label: '기 밀 실',
        compactLabel: '기밀실',
        to: '/board/secret',
        access: 'secret',
    },
    {
        kind: 'link',
        id: 'troop',
        label: '부대 편성',
        to: '/troop',
        access: 'nation-established',
    },
    {
        kind: 'link',
        id: 'diplomacy',
        label: '외 교 부',
        compactLabel: '외교부',
        to: '/diplomacy',
        access: 'nation-secret',
    },
    {
        kind: 'link',
        id: 'personnel',
        label: '인 사 부',
        compactLabel: '인사부',
        to: '/nation/personnel',
        access: 'nation-member',
    },
    {
        kind: 'link',
        id: 'finance',
        label: '내 무 부',
        compactLabel: '내무부',
        to: '/nation/finance',
        access: 'nation-secret',
    },
    {
        kind: 'link',
        id: 'chief-center',
        label: '사 령 부',
        compactLabel: '사령부',
        to: '/chief-center',
        access: 'nation-secret',
    },
    {
        kind: 'link',
        id: 'npc-control',
        label: 'NPC 정책',
        to: '/npc-control',
        access: 'nation-secret',
    },
    {
        kind: 'link',
        id: 'nation-secret',
        label: '암 행 부',
        compactLabel: '암행부',
        to: '/nation/secret',
        newTab: true,
        access: 'nation-secret',
    },
    {
        kind: 'split',
        id: 'tournament-betting',
        main: {
            kind: 'link',
            id: 'tournament',
            label: '토 너 먼 트',
            compactLabel: '토너먼트',
            to: '/tournament',
            newTab: true,
            access: 'always',
        },
        items: [
            {
                kind: 'link',
                id: 'tournament-menu',
                label: '토너먼트',
                to: '/tournament',
                newTab: true,
                access: 'always',
                highlightStage: 1,
            },
            {
                kind: 'link',
                id: 'betting',
                label: '베팅장',
                to: '/betting',
                newTab: true,
                access: 'always',
                highlightStage: 6,
            },
        ],
    },
    {
        kind: 'link',
        id: 'nation-info',
        label: '세력 정보',
        to: '/nation/info',
        access: 'nation-member',
    },
    {
        kind: 'link',
        id: 'nation-cities',
        label: '세력 도시',
        to: '/nation/cities',
        access: 'nation-established',
    },
    {
        kind: 'link',
        id: 'nation-generals',
        label: '세력 장수',
        to: '/nation/generals',
        access: 'nation-member',
    },
    { kind: 'link', id: 'global-info', label: '중원 정보', to: '/global-info', access: 'always' },
    { kind: 'link', id: 'current-city', label: '현재 도시', to: '/current-city', access: 'always' },
    {
        kind: 'link',
        id: 'battle-center',
        label: '감 찰 부',
        compactLabel: '감찰부',
        to: '/battle-center',
        newTab: true,
        access: 'nation-secret',
    },
    { kind: 'link', id: 'inherit', label: '유산 관리', to: '/inherit', access: 'always' },
    { kind: 'link', id: 'my-page', label: '내 정보&설정', to: '/my-page', access: 'always' },
    {
        kind: 'split',
        id: 'auction',
        main: {
            kind: 'link',
            id: 'auction-resource',
            label: '경 매 장',
            compactLabel: '금/쌀 경매장',
            to: '/auction',
            newTab: true,
            access: 'always',
        },
        items: [
            {
                kind: 'link',
                id: 'auction-resource-menu',
                label: '금/쌀 경매장',
                to: '/auction',
                newTab: true,
                access: 'always',
            },
            {
                kind: 'link',
                id: 'auction-unique',
                label: '유니크 경매장',
                to: '/auction?type=unique',
                newTab: true,
                access: 'always',
            },
        ],
    },
    { kind: 'link', id: 'my-settings', label: '환경 설정', to: '/my-settings', access: 'always' },
];

export const buildNationNavigation = (
    tournamentStage: number,
    tournamentType: number | null,
    source: MainNavigationEntry[] = nationNavigation
): MainNavigationEntry[] =>
    source.map((entry) => {
        if (entry.kind !== 'split' || entry.id !== 'tournament-betting') return entry;

        const presentation = resolveTournamentMainPresentation(tournamentStage, tournamentType);
        const main: MainNavigationLink = {
            ...entry.main,
            label: presentation.label,
            compactLabel: presentation.compactLabel,
            to: presentation.to,
            highlightStage: presentation.active ? tournamentStage : undefined,
            highlightStages: undefined,
        };
        const items = entry.items.map((item) => {
            if (item.kind !== 'link') return item;
            if (item.id === 'tournament-menu') {
                return {
                    ...item,
                    highlightStage: presentation.active && !presentation.bettingActive ? tournamentStage : undefined,
                };
            }
            if (item.id === 'betting') {
                return { ...item, highlightStage: presentation.bettingActive ? tournamentStage : undefined };
            }
            return item;
        });
        return { ...entry, main, items };
    });

export const quickNavigation: Array<QuickNavigationItem | MainNavigationDivider> = [
    { kind: 'divider', id: 'quick-nation-heading', label: '국가 정보' },
    { id: 'policy', label: '방침', tab: 'map', selector: '[data-main-target="policy"]' },
    { id: 'commands', label: '명령', tab: 'commands', selector: '[data-main-target="commands"]' },
    { id: 'nation', label: '국가', tab: 'status', selector: '[data-main-target="nation"]' },
    { id: 'general', label: '장수', tab: 'status', selector: '[data-main-target="general"]' },
    { id: 'city', label: '도시', tab: 'status', selector: '[data-main-target="city"]' },
    { kind: 'divider', id: 'quick-record-heading', label: '동향 정보' },
    { id: 'map', label: '지도', tab: 'map', selector: '[data-main-target="map"]' },
    { id: 'global-records', label: '동향', tab: 'world', selector: '[data-main-target="global-records"]' },
    { id: 'general-records', label: '개인', tab: 'world', selector: '[data-main-target="general-records"]' },
    { id: 'world-history', label: '정세', tab: 'world', selector: '[data-main-target="world-history"]' },
    { kind: 'divider', id: 'quick-message-heading', label: '메시지' },
    { id: 'public-message', label: '전체', tab: 'messages', selector: '[data-message-type="public"]' },
    { id: 'national-message', label: '국가', tab: 'messages', selector: '[data-message-type="national"]' },
    { id: 'private-message', label: '개인', tab: 'messages', selector: '[data-message-type="private"]' },
    { id: 'diplomacy-message', label: '외교', tab: 'messages', selector: '[data-message-type="diplomacy"]' },
];

export const isNavigationConfigured = (link: MainNavigationLink): boolean =>
    Boolean(link.to || link.href || link.action);

export const isNationNavigationEnabled = (link: MainNavigationLink, access: NationNavigationAccess): boolean => {
    const rule = link.access ?? 'always';
    const showSecret = access.permission >= 1 || access.officerLevel >= 2;
    switch (rule) {
        case 'meeting':
            return access.officerLevel >= 1;
        case 'secret':
            return access.permission >= 2;
        case 'nation-member':
            return access.officerLevel >= 1;
        case 'nation-established':
            return access.officerLevel >= 1 && access.nationLevel >= 1;
        case 'nation-secret':
            return showSecret;
        case 'always':
            return true;
    }
};
