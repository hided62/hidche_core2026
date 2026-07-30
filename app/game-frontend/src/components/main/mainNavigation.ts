export type NationAccessRule =
    'always' | 'meeting' | 'secret' | 'nation-member' | 'nation-established' | 'nation-secret';

export type MainNavigationLink = {
    kind: 'link';
    id: string;
    label: string;
    to?: string;
    href?: string;
    compactLabel?: string;
    newTab?: boolean;
    access?: NationAccessRule;
    highlightStage?: 1 | 6;
    unavailableReason?: string;
};

export interface MainNavigationDivider {
    kind: 'divider';
    id: string;
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

const configuredExternalLink = (
    id: string,
    label: string,
    value: string | undefined,
    unavailableReason: string
): MainNavigationLink => {
    const href = value?.trim();
    return {
        kind: 'link',
        id,
        label,
        ...(href ? { href } : {}),
        newTab: true,
        unavailableReason: href ? undefined : unavailableReason,
    };
};

export const buildGlobalNavigation = (npcMode: number): MainNavigationEntry[] => [
    {
        kind: 'link',
        id: 'nation-betting',
        label: '천통국 베팅',
        to: '/nation-betting',
    },
    {
        kind: 'group',
        id: 'game-info',
        label: '게임정보',
        items: [
            { kind: 'link', id: 'nation-list', label: '세력일람', to: '/nation-list', newTab: true },
            { kind: 'link', id: 'general-list', label: '장수일람', to: '/general-list', newTab: true },
            { kind: 'link', id: 'best-general', label: '명장일람', to: '/best-general', newTab: true },
            { kind: 'divider', id: 'game-info-divider' },
            { kind: 'link', id: 'hall-of-fame', label: '명예의전당', to: '/hall-of-fame', newTab: true },
            { kind: 'link', id: 'dynasty', label: '왕조일람', to: '/dynasty', newTab: true },
        ],
    },
    { kind: 'link', id: 'yearbook', label: '연감', to: '/yearbook', newTab: true },
    {
        kind: 'split',
        id: 'boards',
        main: {
            kind: 'link',
            id: 'board-community',
            label: '게시판',
            href: import.meta.env.VITE_BOARD_COMMUNITY_URL?.trim() || '/xe/community',
            newTab: true,
        },
        items: [
            configuredExternalLink(
                'board-request',
                '건의/제안',
                import.meta.env.VITE_BOARD_REQUEST_URL,
                '건의/제안 게시판 URL이 설정되지 않았습니다.'
            ),
            configuredExternalLink(
                'board-tip',
                '팁/강좌',
                import.meta.env.VITE_BOARD_TIP_URL,
                '팁/강좌 게시판 URL이 설정되지 않았습니다.'
            ),
            { kind: 'divider', id: 'board-divider' },
            configuredExternalLink(
                'board-patch',
                '패치 내역',
                import.meta.env.VITE_BOARD_PATCH_URL,
                '패치 내역 URL이 설정되지 않았습니다.'
            ),
        ],
    },
    {
        kind: 'split',
        id: 'open-chat',
        main: configuredExternalLink(
            'official-chat',
            '공식 오픈 톡',
            import.meta.env.VITE_OFFICIAL_CHAT_URL,
            '공식 오픈톡 URL이 설정되지 않았습니다.'
        ),
        items: [
            configuredExternalLink(
                'casual-chat',
                '잡담 오픈 톡',
                import.meta.env.VITE_CASUAL_CHAT_URL,
                '잡담 오픈톡 URL이 설정되지 않았습니다.'
            ),
        ],
    },
    {
        kind: 'link',
        id: 'battle-simulator',
        label: '전투 시뮬레이터',
        to: '/battle-simulator',
        newTab: true,
    },
    {
        kind: 'group',
        id: 'other-info',
        label: '기타 정보',
        items: [
            { kind: 'link', id: 'traffic', label: '접속량정보', to: '/traffic', newTab: true },
            ...(npcMode > 0
                ? [{ kind: 'link', id: 'npc-list', label: '빙의일람', to: '/npc-list', newTab: true } as const]
                : []),
        ],
    },
    { kind: 'link', id: 'survey', label: '설문조사', to: '/survey', newTab: true },
];

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
        kind: 'link',
        id: 'tournament',
        label: '토 너 먼 트',
        compactLabel: '토너먼트',
        to: '/tournament',
        newTab: true,
        access: 'always',
        highlightStage: 1,
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
    {
        kind: 'link',
        id: 'betting',
        label: '베 팅 장',
        compactLabel: '베팅장',
        to: '/betting',
        newTab: true,
        access: 'always',
        highlightStage: 6,
    },
];

export const quickNavigation: Array<QuickNavigationItem | MainNavigationDivider> = [
    { kind: 'divider', id: 'quick-nation-heading' },
    { id: 'policy', label: '방침', tab: 'map', selector: '[data-main-target="policy"]' },
    { id: 'commands', label: '명령', tab: 'commands', selector: '[data-main-target="commands"]' },
    { id: 'nation', label: '국가', tab: 'status', selector: '[data-main-target="nation"]' },
    { id: 'general', label: '장수', tab: 'status', selector: '[data-main-target="general"]' },
    { id: 'city', label: '도시', tab: 'status', selector: '[data-main-target="city"]' },
    { kind: 'divider', id: 'quick-record-heading' },
    { id: 'map', label: '지도', tab: 'map', selector: '[data-main-target="map"]' },
    { id: 'global-records', label: '동향', tab: 'world', selector: '[data-main-target="global-records"]' },
    { id: 'general-records', label: '개인', tab: 'world', selector: '[data-main-target="general-records"]' },
    { id: 'world-history', label: '정세', tab: 'world', selector: '[data-main-target="world-history"]' },
    { kind: 'divider', id: 'quick-message-heading' },
    { id: 'public-message', label: '전체', tab: 'messages', selector: '[data-message-type="public"]' },
    { id: 'national-message', label: '국가', tab: 'messages', selector: '[data-message-type="national"]' },
    { id: 'private-message', label: '개인', tab: 'messages', selector: '[data-message-type="private"]' },
    { id: 'diplomacy-message', label: '외교', tab: 'messages', selector: '[data-message-type="diplomacy"]' },
];

export const isNavigationConfigured = (link: MainNavigationLink): boolean => Boolean(link.to || link.href);

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
