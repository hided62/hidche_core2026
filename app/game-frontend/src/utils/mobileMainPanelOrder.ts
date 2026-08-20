export const MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY = 'sam.mobileMainPanelOrder.v1';
export const MOBILE_MAIN_PANEL_ORDER_CHANGED_EVENT = 'sam-mobile-main-panel-order-changed';

export const MOBILE_MAIN_PANEL_DEFINITIONS = [
    { id: 'commands', label: '명령 목록' },
    { id: 'nation-menu', label: '국가 메뉴' },
    { id: 'nation', label: '국가 정보' },
    { id: 'general', label: '장수 정보' },
    { id: 'city', label: '도시 정보' },
    { id: 'map', label: '지도' },
    { id: 'records', label: '기록 영역' },
    { id: 'global-menu', label: '공통 메뉴' },
    { id: 'messages', label: '서신' },
] as const;

export type MobileMainPanelId = (typeof MOBILE_MAIN_PANEL_DEFINITIONS)[number]['id'];

export const DEFAULT_MOBILE_MAIN_PANEL_ORDER: readonly MobileMainPanelId[] = MOBILE_MAIN_PANEL_DEFINITIONS.map(
    ({ id }) => id
);

const mobilePanelIds = new Set<string>(DEFAULT_MOBILE_MAIN_PANEL_ORDER);

export const normalizeMobileMainPanelOrder = (value: unknown): MobileMainPanelId[] => {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const normalized: MobileMainPanelId[] = [];

    for (const item of source) {
        if (typeof item !== 'string' || !mobilePanelIds.has(item) || seen.has(item)) continue;
        seen.add(item);
        normalized.push(item as MobileMainPanelId);
    }

    for (const item of DEFAULT_MOBILE_MAIN_PANEL_ORDER) {
        if (!seen.has(item)) normalized.push(item);
    }

    return normalized;
};

export const parseMobileMainPanelOrder = (raw: string | null): MobileMainPanelId[] => {
    if (!raw) return [...DEFAULT_MOBILE_MAIN_PANEL_ORDER];
    try {
        return normalizeMobileMainPanelOrder(JSON.parse(raw));
    } catch {
        return [...DEFAULT_MOBILE_MAIN_PANEL_ORDER];
    }
};

export const loadMobileMainPanelOrder = (storage: Pick<Storage, 'getItem'> = window.localStorage) =>
    parseMobileMainPanelOrder(storage.getItem(MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY));

export const saveMobileMainPanelOrder = (
    value: readonly MobileMainPanelId[],
    storage: Pick<Storage, 'setItem'> = window.localStorage
): MobileMainPanelId[] => {
    const normalized = normalizeMobileMainPanelOrder(value);
    storage.setItem(MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY, JSON.stringify(normalized));
    if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent(MOBILE_MAIN_PANEL_ORDER_CHANGED_EVENT));
    }
    return normalized;
};

export const moveMobileMainPanel = (
    value: readonly MobileMainPanelId[],
    fromIndex: number,
    toIndex: number
): MobileMainPanelId[] => {
    const normalized = normalizeMobileMainPanelOrder(value);
    if (
        fromIndex < 0 ||
        fromIndex >= normalized.length ||
        toIndex < 0 ||
        toIndex >= normalized.length ||
        fromIndex === toIndex
    ) {
        return normalized;
    }
    const [moved] = normalized.splice(fromIndex, 1);
    if (!moved) return normalized;
    normalized.splice(toIndex, 0, moved);
    return normalized;
};
