export type NationGeneralColumnId =
    | 'icon'
    | 'name'
    | 'officerLevel'
    | 'expDedLv_1'
    | 'dedlevel'
    | 'explevel'
    | 'stat_1'
    | 'leadership'
    | 'strength'
    | 'intel'
    | 'troop'
    | 'goldRice_1'
    | 'gold'
    | 'rice'
    | 'city'
    | 'crew'
    | 'specials_1'
    | 'personal'
    | 'specialDomestic'
    | 'specialWar'
    | 'years_1'
    | 'belong'
    | 'killturnAndRefresh_1'
    | 'refreshScoreTotal';

export type NationGeneralGroupId = 'expDedLv' | 'stat' | 'goldRice' | 'specials' | 'years' | 'killturnAndRefresh';
export type SortDirection = 'asc' | 'desc';
export type NationGeneralViewMode = 'normal' | 'war';

export type NationGeneralColumnState = {
    colId: NationGeneralColumnId;
    width: number;
    hide: boolean;
    sort: SortDirection | null;
    sortIndex?: number;
};

export type NationGeneralGroupState = {
    groupId: NationGeneralGroupId;
    open: boolean;
};

export type NationGeneralDisplaySetting = {
    column: NationGeneralColumnState[];
    columnGroup: NationGeneralGroupState[];
};

export type NationGeneralSettingKey = [true, NationGeneralViewMode] | [false, string];

export const DISPLAY_SETTINGS_KEY = 'GeneralListDisplaySetting';
export const DISPLAY_SETTINGS_VERSION = 1;
export const lastUsedSettingsKey = (role: string): string => `LastUsedSettingsKey_${role}`;

const baseColumns = (): NationGeneralColumnState[] => [
    { colId: 'icon', width: 80, hide: false, sort: null },
    { colId: 'name', width: 126, hide: false, sort: null },
    { colId: 'officerLevel', width: 70, hide: false, sort: null },
    { colId: 'expDedLv_1', width: 60, hide: false, sort: null },
    { colId: 'dedlevel', width: 70, hide: false, sort: null },
    { colId: 'explevel', width: 60, hide: false, sort: null },
    { colId: 'stat_1', width: 88, hide: false, sort: null },
    { colId: 'leadership', width: 60, hide: false, sort: null },
    { colId: 'strength', width: 60, hide: false, sort: null },
    { colId: 'intel', width: 60, hide: false, sort: null },
    { colId: 'troop', width: 90, hide: true, sort: null },
    { colId: 'goldRice_1', width: 80, hide: false, sort: null },
    { colId: 'gold', width: 70, hide: false, sort: null },
    { colId: 'rice', width: 70, hide: false, sort: null },
    { colId: 'city', width: 60, hide: true, sort: null },
    { colId: 'crew', width: 70, hide: true, sort: null },
    { colId: 'specials_1', width: 80, hide: false, sort: null },
    { colId: 'personal', width: 60, hide: false, sort: null },
    { colId: 'specialDomestic', width: 60, hide: false, sort: null },
    { colId: 'specialWar', width: 60, hide: false, sort: null },
    { colId: 'years_1', width: 60, hide: false, sort: null },
    { colId: 'belong', width: 60, hide: false, sort: null },
    { colId: 'killturnAndRefresh_1', width: 70, hide: false, sort: null },
    { colId: 'refreshScoreTotal', width: 70, hide: false, sort: null },
];

const groupState = (overrides: Partial<Record<NationGeneralGroupId, boolean>>): NationGeneralGroupState[] =>
    (['expDedLv', 'stat', 'goldRice', 'specials', 'years', 'killturnAndRefresh'] as const).map((groupId) => ({
        groupId,
        open: overrides[groupId] ?? false,
    }));

const withColumnOverrides = (
    columns: NationGeneralColumnState[],
    overrides: Partial<Record<NationGeneralColumnId, Partial<NationGeneralColumnState>>>
): NationGeneralColumnState[] =>
    columns.map((column) => ({
        ...column,
        ...overrides[column.colId],
    }));

export const defaultNationGeneralDisplaySettings: Record<NationGeneralViewMode, NationGeneralDisplaySetting> = {
    normal: {
        column: withColumnOverrides(baseColumns(), {
            troop: { hide: true },
            city: { hide: true },
            crew: { hide: true },
            refreshScoreTotal: { sort: 'desc', sortIndex: 0 },
        }),
        columnGroup: groupState({
            expDedLv: true,
            stat: true,
            goldRice: true,
            specials: false,
            years: false,
            killturnAndRefresh: true,
        }),
    },
    war: {
        column: withColumnOverrides(baseColumns(), {
            icon: { hide: true },
            officerLevel: { hide: true },
            expDedLv_1: { hide: true },
            dedlevel: { hide: true },
            explevel: { hide: true },
            troop: { hide: false },
            city: { hide: false },
            crew: { hide: false },
            specials_1: { hide: true },
            personal: { hide: true },
            specialDomestic: { hide: true },
            specialWar: { hide: true },
            years_1: { hide: true },
            belong: { hide: true },
            killturnAndRefresh_1: { hide: true },
            refreshScoreTotal: { hide: true },
        }),
        columnGroup: groupState({
            expDedLv: false,
            stat: false,
            goldRice: true,
            specials: false,
            years: false,
            killturnAndRefresh: true,
        }),
    },
};

export const cloneNationGeneralDisplaySetting = (
    setting: NationGeneralDisplaySetting
): NationGeneralDisplaySetting => ({
    column: setting.column.map((column) => ({ ...column })),
    columnGroup: setting.columnGroup.map((group) => ({ ...group })),
});

const validColumnIds = new Set<NationGeneralColumnId>(baseColumns().map((column) => column.colId));
const validGroupIds = new Set<NationGeneralGroupId>(groupState({}).map((group) => group.groupId));

const isSortDirection = (value: unknown): value is SortDirection => value === 'asc' || value === 'desc';

export const normalizeNationGeneralDisplaySetting = (raw: unknown): NationGeneralDisplaySetting | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const candidate = raw as { column?: unknown; columnGroup?: unknown };
    if (!Array.isArray(candidate.column) || !Array.isArray(candidate.columnGroup)) {
        return null;
    }

    const fallback = cloneNationGeneralDisplaySetting(defaultNationGeneralDisplaySettings.normal);
    const rawColumns = new Map<string, Record<string, unknown>>();
    for (const value of candidate.column) {
        if (!value || typeof value !== 'object') continue;
        const column = value as Record<string, unknown>;
        if (typeof column.colId === 'string' && validColumnIds.has(column.colId as NationGeneralColumnId)) {
            rawColumns.set(column.colId, column);
        }
    }
    fallback.column = fallback.column.map((column) => {
        const saved = rawColumns.get(column.colId);
        if (!saved) return column;
        return {
            ...column,
            width: typeof saved.width === 'number' && saved.width > 0 ? saved.width : column.width,
            hide: typeof saved.hide === 'boolean' ? saved.hide : column.hide,
            sort: isSortDirection(saved.sort) ? saved.sort : null,
            ...(typeof saved.sortIndex === 'number' && saved.sortIndex >= 0
                ? { sortIndex: Math.trunc(saved.sortIndex) }
                : {}),
        };
    });

    const rawGroups = new Map<string, boolean>();
    for (const value of candidate.columnGroup) {
        if (!value || typeof value !== 'object') continue;
        const group = value as Record<string, unknown>;
        if (
            typeof group.groupId === 'string' &&
            validGroupIds.has(group.groupId as NationGeneralGroupId) &&
            typeof group.open === 'boolean'
        ) {
            rawGroups.set(group.groupId, group.open);
        }
    }
    fallback.columnGroup = fallback.columnGroup.map((group) => ({
        ...group,
        open: rawGroups.get(group.groupId) ?? group.open,
    }));
    return fallback;
};

export const parseStoredDisplaySettings = (raw: string | null): Map<string, NationGeneralDisplaySetting> => {
    if (!raw) return new Map();
    try {
        const parsed = JSON.parse(raw) as { version?: unknown; settings?: unknown };
        if (parsed.version !== DISPLAY_SETTINGS_VERSION || !Array.isArray(parsed.settings)) return new Map();
        const result = new Map<string, NationGeneralDisplaySetting>();
        for (const entry of parsed.settings) {
            if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
            const setting = normalizeNationGeneralDisplaySetting(entry[1]);
            if (setting) result.set(entry[0], setting);
        }
        return result;
    } catch {
        return new Map();
    }
};

export const serializeDisplaySettings = (settings: Map<string, NationGeneralDisplaySetting>): string =>
    JSON.stringify({
        version: DISPLAY_SETTINGS_VERSION,
        settings: [...settings.entries()],
    });

export const parseStoredSettingKey = (raw: string | null): NationGeneralSettingKey | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (
            !Array.isArray(parsed) ||
            parsed.length !== 2 ||
            typeof parsed[0] !== 'boolean' ||
            typeof parsed[1] !== 'string'
        ) {
            return null;
        }
        if (parsed[0]) return parsed[1] === 'normal' || parsed[1] === 'war' ? [true, parsed[1]] : null;
        return [false, parsed[1]];
    } catch {
        return null;
    }
};

const initialConsonants = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

const hangulInitials = (value: string): string =>
    [...value]
        .map((character) => {
            const code = character.charCodeAt(0);
            if (code < 0xac00 || code > 0xd7a3) return character;
            return initialConsonants[Math.floor((code - 0xac00) / 588)] ?? character;
        })
        .join('');

const normalizeSearchText = (value: string): string => value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');

export const matchesKoreanSearch = (value: string, query: string): boolean => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const normalizedValue = normalizeSearchText(value);
    return (
        normalizedValue.includes(normalizedQuery) ||
        normalizeSearchText(hangulInitials(value)).includes(normalizedQuery)
    );
};

export const matchesNumberSearch = (value: number | null, query: string): boolean => {
    const normalized = query.trim();
    if (!normalized) return true;
    if (value === null || !Number.isFinite(value)) return false;
    const match = /^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(normalized);
    if (!match) return false;
    const expected = Number(match[2]);
    switch (match[1] ?? '=') {
        case '<':
            return value < expected;
        case '<=':
            return value <= expected;
        case '>':
            return value > expected;
        case '>=':
            return value >= expected;
        default:
            return value === expected;
    }
};

export const compareGridValues = (left: string | number | null, right: string | number | null): number => {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right), 'ko-KR', { numeric: true });
};
