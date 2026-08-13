<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { formatOfficerLevelText } from '../utils/nationFormat';
import { resolveGeneralIconUrl } from '../utils/generalIcon';
import {
    DISPLAY_SETTINGS_KEY,
    cloneNationGeneralDisplaySetting,
    compareGridValues,
    defaultNationGeneralDisplaySettings,
    lastUsedSettingsKey,
    matchesNumberFilterCondition,
    matchesTextFilterCondition,
    numberFilterOperators,
    parseStoredDisplaySettings,
    parseStoredSettingKey,
    serializeDisplaySettings,
    textFilterOperators,
    type NationGeneralColumnId,
    type NationGeneralColumnState,
    type NationGeneralDisplaySetting,
    type NationGeneralFilterCondition,
    type NationGeneralFilterOperator,
    type NationGeneralGroupId,
    type NationGeneralSettingKey,
} from '../utils/nationGeneralGrid';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getGeneralList.query>>;
type General = Result['generals'][number];
type CellValue = string | number | null;

type ColumnDefinition = {
    id: NationGeneralColumnId;
    label: string;
    width: number;
    groupId?: NationGeneralGroupId;
    summary?: boolean;
    sortable?: boolean;
    searchable?: 'text' | 'number';
};

type LayoutItem =
    | { type: 'column'; columnId: NationGeneralColumnId }
    | {
          type: 'group';
          groupId: NationGeneralGroupId;
          label: string;
          summaryId: NationGeneralColumnId;
          children: NationGeneralColumnId[];
      };

type HeaderSegment = {
    key: string;
    label: string;
    colspan: number;
    groupId?: NationGeneralGroupId;
    open?: boolean;
};

type ColumnFilterState = {
    join: 'AND' | 'OR';
    conditions: [NationGeneralFilterCondition, NationGeneralFilterCondition];
};

const columns: ColumnDefinition[] = [
    { id: 'icon', label: '아이콘', width: 80 },
    { id: 'name', label: '장수명', width: 126, sortable: true, searchable: 'text' },
    { id: 'officerLevel', label: '관직', width: 70, sortable: true, searchable: 'text' },
    { id: 'expDedLv_1', label: '', width: 60, groupId: 'expDedLv', summary: true },
    { id: 'dedlevel', label: '계급', width: 70, groupId: 'expDedLv', sortable: true, searchable: 'number' },
    { id: 'explevel', label: '명성', width: 60, groupId: 'expDedLv', sortable: true, searchable: 'number' },
    { id: 'stat_1', label: '통|무|지', width: 88, groupId: 'stat', summary: true },
    { id: 'leadership', label: '통솔', width: 60, groupId: 'stat', sortable: true, searchable: 'number' },
    { id: 'strength', label: '무력', width: 60, groupId: 'stat', sortable: true, searchable: 'number' },
    { id: 'intel', label: '지력', width: 60, groupId: 'stat', sortable: true, searchable: 'number' },
    { id: 'troop', label: '부대', width: 90, sortable: true, searchable: 'text' },
    { id: 'goldRice_1', label: '금/쌀', width: 80, groupId: 'goldRice', summary: true, sortable: true },
    { id: 'gold', label: '금', width: 70, groupId: 'goldRice', sortable: true, searchable: 'number' },
    { id: 'rice', label: '쌀', width: 70, groupId: 'goldRice', sortable: true, searchable: 'number' },
    { id: 'city', label: '도시', width: 60, sortable: true, searchable: 'text' },
    { id: 'crew', label: '병력', width: 70, sortable: true, searchable: 'number' },
    { id: 'specials_1', label: '요약', width: 80, groupId: 'specials', summary: true },
    { id: 'personal', label: '성격', width: 60, groupId: 'specials', sortable: true, searchable: 'text' },
    {
        id: 'specialDomestic',
        label: '내특',
        width: 60,
        groupId: 'specials',
        sortable: true,
        searchable: 'text',
    },
    { id: 'specialWar', label: '전특', width: 60, groupId: 'specials', sortable: true, searchable: 'text' },
    { id: 'years_1', label: '요약', width: 60, groupId: 'years', summary: true },
    { id: 'belong', label: '사관', width: 60, groupId: 'years', sortable: true, searchable: 'number' },
    { id: 'killturnAndRefresh_1', label: '벌점', width: 70, groupId: 'killturnAndRefresh', summary: true },
    {
        id: 'refreshScoreTotal',
        label: '벌점',
        width: 70,
        groupId: 'killturnAndRefresh',
        sortable: true,
        searchable: 'number',
    },
];

const layout: LayoutItem[] = [
    { type: 'column', columnId: 'icon' },
    { type: 'column', columnId: 'name' },
    { type: 'column', columnId: 'officerLevel' },
    {
        type: 'group',
        groupId: 'expDedLv',
        label: '명성/계급',
        summaryId: 'expDedLv_1',
        children: ['dedlevel', 'explevel'],
    },
    {
        type: 'group',
        groupId: 'stat',
        label: '능력치',
        summaryId: 'stat_1',
        children: ['leadership', 'strength', 'intel'],
    },
    { type: 'column', columnId: 'troop' },
    {
        type: 'group',
        groupId: 'goldRice',
        label: '자금',
        summaryId: 'goldRice_1',
        children: ['gold', 'rice'],
    },
    { type: 'column', columnId: 'city' },
    { type: 'column', columnId: 'crew' },
    {
        type: 'group',
        groupId: 'specials',
        label: '특성',
        summaryId: 'specials_1',
        children: ['personal', 'specialDomestic', 'specialWar'],
    },
    { type: 'group', groupId: 'years', label: '연도', summaryId: 'years_1', children: ['belong'] },
    {
        type: 'group',
        groupId: 'killturnAndRefresh',
        label: '기타',
        summaryId: 'killturnAndRefresh_1',
        children: ['refreshScoreTotal'],
    },
];

const columnById = new Map(columns.map((column) => [column.id, column]));
const data = ref<Result | null>(null);
const router = useRouter();
const error = ref('');
const loading = ref(false);
const viewMenuOpen = ref(false);
const columnMenuOpen = ref(false);
const currentSetting = ref<NationGeneralSettingKey>([true, 'normal']);
const displaySettings = ref(new Map<string, NationGeneralDisplaySetting>());
const columnState = ref<NationGeneralColumnState[]>([]);
const groupState = ref<Record<NationGeneralGroupId, boolean>>({
    expDedLv: true,
    stat: true,
    goldRice: true,
    specials: false,
    years: false,
    killturnAndRefresh: true,
});
const createFilterCondition = (searchable?: 'text' | 'number'): NationGeneralFilterCondition => ({
    operator: searchable === 'number' ? 'equals' : 'contains',
    value: '',
    valueTo: '',
});
const filters = ref(
    Object.fromEntries(
        columns.map((column) => [
            column.id,
            {
                join: 'AND',
                conditions: [createFilterCondition(column.searchable), createFilterCondition(column.searchable)],
            },
        ])
    ) as Record<NationGeneralColumnId, ColumnFilterState>
);
const activeFilterMenu = ref<NationGeneralColumnId | null>(null);

const filterOperators = (searchable?: 'text' | 'number') =>
    searchable === 'number' ? numberFilterOperators : textFilterOperators;
const isValueFreeOperator = (operator: NationGeneralFilterOperator): boolean =>
    operator === 'blank' || operator === 'notBlank';
const isConditionActive = (condition: NationGeneralFilterCondition): boolean =>
    isValueFreeOperator(condition.operator) || condition.value.trim() !== '';
const updateFilterOperator = (columnId: NationGeneralColumnId, conditionIndex: number, event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const condition = filters.value[columnId].conditions[conditionIndex];
    if (!condition) return;
    condition.operator = target.value as NationGeneralFilterOperator;
};
const toggleFilterMenu = (columnId: NationGeneralColumnId) => {
    activeFilterMenu.value = activeFilterMenu.value === columnId ? null : columnId;
};
const closeFilterMenu = () => {
    activeFilterMenu.value = null;
};
const closeFilterMenuOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeFilterMenu();
};

const applyDisplaySetting = (settingKey: NationGeneralSettingKey, setting: NationGeneralDisplaySetting) => {
    const cloned = cloneNationGeneralDisplaySetting(setting);
    columnState.value = cloned.column;
    groupState.value = Object.fromEntries(cloned.columnGroup.map((group) => [group.groupId, group.open])) as Record<
        NationGeneralGroupId,
        boolean
    >;
    currentSetting.value = settingKey;
    viewMenuOpen.value = false;
};

const loadDisplaySettings = () => {
    displaySettings.value = parseStoredDisplaySettings(localStorage.getItem(DISPLAY_SETTINGS_KEY));
    const lastUsed = parseStoredSettingKey(localStorage.getItem(lastUsedSettingsKey('pageNationGeneral')));
    if (lastUsed?.[0]) {
        applyDisplaySetting(lastUsed, defaultNationGeneralDisplaySettings[lastUsed[1]]);
        return;
    }
    if (lastUsed && !lastUsed[0]) {
        const stored = displaySettings.value.get(lastUsed[1]);
        if (stored) {
            applyDisplaySetting(lastUsed, stored);
            return;
        }
    }
    applyDisplaySetting([true, 'normal'], defaultNationGeneralDisplaySettings.normal);
};

loadDisplaySettings();

watch(displaySettings, (settings) => localStorage.setItem(DISPLAY_SETTINGS_KEY, serializeDisplaySettings(settings)), {
    deep: true,
});
watch(currentSetting, (setting) =>
    localStorage.setItem(lastUsedSettingsKey('pageNationGeneral'), JSON.stringify(setting))
);

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        data.value = await trpc.nation.getGeneralList.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력 장수를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const stateById = computed(() => new Map(columnState.value.map((column) => [column.colId, column])));
const isColumnVisible = (columnId: NationGeneralColumnId): boolean => !(stateById.value.get(columnId)?.hide ?? true);

const activeColumnIds = computed<NationGeneralColumnId[]>(() => {
    const active: NationGeneralColumnId[] = [];
    for (const item of layout) {
        if (item.type === 'column') {
            if (isColumnVisible(item.columnId)) active.push(item.columnId);
            continue;
        }
        if (groupState.value[item.groupId]) {
            active.push(...item.children.filter(isColumnVisible));
        } else if (isColumnVisible(item.summaryId)) {
            active.push(item.summaryId);
        }
    }
    return active;
});

const activeColumns = computed(() =>
    activeColumnIds.value.map((columnId) => columnById.get(columnId)).filter((column) => column !== undefined)
);

const tableWidth = computed(() =>
    Math.max(
        1000,
        activeColumns.value.reduce((sum, column) => sum + column.width, 0)
    )
);

const headerSegments = computed<HeaderSegment[]>(() => {
    const segments: HeaderSegment[] = [];
    for (const item of layout) {
        if (item.type === 'column') {
            if (activeColumnIds.value.includes(item.columnId)) {
                segments.push({ key: item.columnId, label: '', colspan: 1 });
            }
            continue;
        }
        const visibleIds = groupState.value[item.groupId]
            ? item.children.filter((columnId) => activeColumnIds.value.includes(columnId))
            : activeColumnIds.value.includes(item.summaryId)
              ? [item.summaryId]
              : [];
        if (visibleIds.length) {
            segments.push({
                key: item.groupId,
                label: item.label,
                colspan: visibleIds.length,
                groupId: item.groupId,
                open: groupState.value[item.groupId],
            });
        }
    }
    return segments;
});

const visibleCrew = (general: General): number | null => ('crew' in general ? general.crew : null);
const officerText = (general: General): string => {
    const title = formatOfficerLevelText(general.officerLevel, data.value?.nation.level);
    return general.officerCityName && general.officerLevel >= 2 && general.officerLevel <= 4
        ? `${general.officerCityName}\n${title}`
        : title;
};
const protectedText = (value: string | null): string => value ?? (data.value?.viewer.permission ? '-' : '?');

const cellValue = (general: General, columnId: NationGeneralColumnId): CellValue => {
    switch (columnId) {
        case 'name':
            return general.name;
        case 'officerLevel':
            return officerText(general);
        case 'expDedLv_1':
            return `Lv ${general.experienceLevel}\n${general.dedicationText}`;
        case 'dedlevel':
            return `${general.dedicationText}\n(${general.bill.toLocaleString()})`;
        case 'explevel':
            return `Lv ${general.experienceLevel}\n(${general.personality?.name ?? '-'})`;
        case 'stat_1':
            return `${general.stats.leadership}|${general.stats.strength}|${general.stats.intelligence}`;
        case 'leadership':
            return general.stats.leadership;
        case 'strength':
            return general.stats.strength;
        case 'intel':
            return general.stats.intelligence;
        case 'troop':
            return protectedText(general.troopName);
        case 'goldRice_1':
            return `${general.gold.toLocaleString()} 금\n${general.rice.toLocaleString()} 쌀`;
        case 'gold':
            return general.gold;
        case 'rice':
            return general.rice;
        case 'city':
            return protectedText(general.cityName);
        case 'crew':
            return visibleCrew(general);
        case 'specials_1':
            return `${general.personality?.name ?? '-'}\n${general.specialDomestic?.name ?? '-'} / ${general.specialWar?.name ?? '-'}`;
        case 'personal':
            return general.personality?.name ?? '-';
        case 'specialDomestic':
            return general.specialDomestic?.name ?? '-';
        case 'specialWar':
            return general.specialWar?.name ?? '-';
        case 'years_1':
            return `${general.belong}년`;
        case 'belong':
            return general.belong;
        case 'killturnAndRefresh_1':
        case 'refreshScoreTotal':
            return Number(general.refreshScoreTotal);
        case 'icon':
            return null;
    }
};

const filterValue = (general: General, columnId: NationGeneralColumnId): CellValue => {
    switch (columnId) {
        case 'officerLevel':
            return officerText(general);
        case 'dedlevel':
            return general.dedicationLevel;
        case 'explevel':
            return general.experienceLevel;
        default:
            return cellValue(general, columnId);
    }
};

const sortValue = (general: General, columnId: NationGeneralColumnId): CellValue => {
    switch (columnId) {
        case 'name':
            return `${String(general.npcState).padStart(3, '0')}:${general.name}`;
        case 'officerLevel':
            return general.officerLevel;
        case 'dedlevel':
            return general.dedicationLevel;
        case 'explevel':
            return general.experienceLevel;
        case 'goldRice_1':
            return general.gold + general.rice;
        default:
            return cellValue(general, columnId);
    }
};

const generals = computed(() => {
    const filtered = [...(data.value?.generals ?? [])].filter((general) =>
        Object.entries(filters.value).every(([rawColumnId, filter]) => {
            const columnId = rawColumnId as NationGeneralColumnId;
            const column = columnById.get(columnId);
            if (!column?.searchable) return true;
            const activeConditions = filter.conditions.filter(isConditionActive);
            if (!activeConditions.length) return true;
            const value = filterValue(general, columnId);
            const results = activeConditions.map((condition) =>
                column.searchable === 'number'
                    ? matchesNumberFilterCondition(typeof value === 'number' ? value : null, condition)
                    : matchesTextFilterCondition(value === null ? null : String(value), condition)
            );
            return filter.join === 'AND' ? results.every(Boolean) : results.some(Boolean);
        })
    );
    const sorts = columnState.value
        .filter((column): column is NationGeneralColumnState & { sort: 'asc' | 'desc' } => column.sort !== null)
        .sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0));
    return filtered.sort((left, right) => {
        for (const sort of sorts) {
            const compared = compareGridValues(sortValue(left, sort.colId), sortValue(right, sort.colId));
            if (compared) return sort.sort === 'asc' ? compared : -compared;
        }
        return left.id - right.id;
    });
});

const setDisplayMode = (mode: 'normal' | 'war') =>
    applyDisplaySetting([true, mode], defaultNationGeneralDisplaySettings[mode]);

const currentDisplaySetting = (): NationGeneralDisplaySetting => ({
    column: columnState.value.map((column) => ({ ...column })),
    columnGroup: Object.entries(groupState.value).map(([groupId, open]) => ({
        groupId: groupId as NationGeneralGroupId,
        open,
    })),
});

const storeDisplaySetting = () => {
    const defaultName = currentSetting.value[0] ? '' : currentSetting.value[1];
    const nickname = window.prompt('선택한 설정의 별명을 지어주세요', defaultName)?.trim();
    if (!nickname) return;
    if (displaySettings.value.has(nickname) && !window.confirm('이미 있는 이름입니다. 덮어쓸까요?')) return;
    const next = new Map(displaySettings.value);
    const setting = currentDisplaySetting();
    next.set(nickname, setting);
    displaySettings.value = next;
    currentSetting.value = [false, nickname];
};

const deleteDisplaySetting = (key: string) => {
    if (!window.confirm(`${key} 설정을 지울까요?`)) return;
    const next = new Map(displaySettings.value);
    next.delete(key);
    displaySettings.value = next;
    if (!currentSetting.value[0] && currentSetting.value[1] === key) setDisplayMode('normal');
};

const toggleGroup = (groupId: NationGeneralGroupId) => {
    groupState.value = { ...groupState.value, [groupId]: !groupState.value[groupId] };
};

const toggleColumn = (columnId: NationGeneralColumnId) => {
    columnState.value = columnState.value.map((column) =>
        column.colId === columnId ? { ...column, hide: !column.hide } : column
    );
};

const nextSort = (columnId: NationGeneralColumnId, current: 'asc' | 'desc' | null): 'asc' | 'desc' | null => {
    const order: ('asc' | 'desc' | null)[] = columnId === 'name' ? ['asc', 'desc', null] : ['desc', 'asc', null];
    const index = order.indexOf(current);
    return order[(index + 1) % order.length] ?? null;
};

const sortColumn = (columnId: NationGeneralColumnId, event: MouseEvent) => {
    const definition = columnById.get(columnId);
    if (!definition?.sortable) return;
    const current = stateById.value.get(columnId)?.sort ?? null;
    const next = nextSort(columnId, current);
    const existingSortIndex = stateById.value.get(columnId)?.sortIndex;
    const maxSortIndex = Math.max(-1, ...columnState.value.map((column) => column.sortIndex ?? -1));
    columnState.value = columnState.value.map((column) => {
        if (column.colId === columnId) {
            const { sortIndex: _sortIndex, ...withoutSortIndex } = column;
            return next
                ? { ...withoutSortIndex, sort: next, sortIndex: existingSortIndex ?? maxSortIndex + 1 }
                : { ...withoutSortIndex, sort: null };
        }
        if (event.shiftKey) return column;
        const { sortIndex: _sortIndex, ...withoutSortIndex } = column;
        return { ...withoutSortIndex, sort: null };
    });
};

const sortIndicator = (columnId: NationGeneralColumnId): string => {
    const column = stateById.value.get(columnId);
    if (!column?.sort) return '';
    const order = column.sortIndex === undefined ? '' : `${column.sortIndex + 1}`;
    return `${column.sort === 'asc' ? '▲' : '▼'}${order}`;
};

const iconUrl = (general: General) => resolveGeneralIconUrl(general);
const cellTitle = (general: General, columnId: NationGeneralColumnId): string => {
    if (columnId === 'personal') return general.personality?.info ?? '';
    if (columnId === 'specialDomestic') return general.specialDomestic?.info ?? '';
    if (columnId === 'specialWar') return general.specialWar?.info ?? '';
    if (columnId === 'specials_1') {
        return [general.personality?.info, general.specialDomestic?.info, general.specialWar?.info]
            .filter(Boolean)
            .join('\n');
    }
    return '';
};

onMounted(() => {
    document.addEventListener('pointerdown', closeFilterMenu);
    document.addEventListener('keydown', closeFilterMenuOnEscape);
    void load();
});
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', closeFilterMenu);
    document.removeEventListener('keydown', closeFilterMenuOnEscape);
});
</script>

<template>
    <main class="general-page legacy-bg0">
        <header class="top-bar">
            <span class="left-actions">
                <button class="top-button nation-button" @click="router.push('/')">돌아가기</button>
                <button class="top-button nation-button" :disabled="loading" @click="load">갱신</button>
            </span>
            <strong>세력 장수</strong>
            <span class="right-actions">
                <span class="dropdown">
                    <button
                        class="top-button mode-button"
                        :aria-expanded="viewMenuOpen"
                        @click="
                            viewMenuOpen = !viewMenuOpen;
                            columnMenuOpen = false;
                        "
                    >
                        보기 모드⌄
                    </button>
                    <span v-if="viewMenuOpen" class="dropdown-menu view-mode-list">
                        <button @click="setDisplayMode('normal')">기본</button>
                        <button @click="setDisplayMode('war')">전투</button>
                        <span class="menu-divider"></span>
                        <button @click="storeDisplaySetting">🔖&nbsp;보관하기</button>
                        <template v-if="displaySettings.size">
                            <span class="menu-divider"></span>
                            <span v-for="[key, setting] in displaySettings" :key="key" class="saved-setting">
                                <button class="saved-setting-name" @click="applyDisplaySetting([false, key], setting)">
                                    {{ key }}
                                </button>
                                <button
                                    class="saved-setting-delete"
                                    :aria-label="`${key} 설정 삭제`"
                                    @click.stop="deleteDisplaySetting(key)"
                                >
                                    삭제
                                </button>
                            </span>
                        </template>
                    </span>
                </span>
                <span class="dropdown">
                    <button
                        class="top-button columns-button"
                        :aria-expanded="columnMenuOpen"
                        @click="
                            columnMenuOpen = !columnMenuOpen;
                            viewMenuOpen = false;
                        "
                    >
                        열 선택⌄
                    </button>
                    <span v-if="columnMenuOpen" class="dropdown-menu column-menu">
                        <template v-for="item in layout" :key="item.type === 'column' ? item.columnId : item.groupId">
                            <label v-if="item.type === 'column' && item.columnId !== 'name'">
                                <input
                                    type="checkbox"
                                    :checked="isColumnVisible(item.columnId)"
                                    @change="toggleColumn(item.columnId)"
                                />
                                {{ columnById.get(item.columnId)?.label }}
                            </label>
                            <template v-else-if="item.type === 'group'">
                                <span class="column-group-label">{{ item.label }}</span>
                                <label v-for="columnId in item.children" :key="columnId" class="child-column">
                                    <input
                                        type="checkbox"
                                        :checked="isColumnVisible(columnId)"
                                        @change="toggleColumn(columnId)"
                                    />
                                    {{ columnById.get(columnId)?.label }}
                                </label>
                            </template>
                        </template>
                    </span>
                </span>
            </span>
        </header>
        <p v-if="error" class="state error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state">불러오는 중...</p>
        <div v-else class="grid-shell">
            <table id="nation-general-list" :style="{ width: `${tableWidth}px`, minWidth: `${tableWidth}px` }">
                <colgroup>
                    <col v-for="column in activeColumns" :key="column.id" :style="{ width: `${column.width}px` }" />
                </colgroup>
                <thead>
                    <tr class="group-head">
                        <th v-for="segment in headerSegments" :key="segment.key" :colspan="segment.colspan">
                            <button
                                v-if="segment.groupId"
                                class="group-toggle"
                                :aria-expanded="segment.open"
                                :aria-label="`${segment.label} ${segment.open ? '접기' : '펼치기'}`"
                                @click="toggleGroup(segment.groupId)"
                            >
                                {{ segment.label }}&#x3000;{{ segment.open ? '‹' : '›' }}
                            </button>
                        </th>
                    </tr>
                    <tr>
                        <th v-for="column in activeColumns" :key="column.id">
                            <button
                                class="sort-button"
                                :class="{ sortable: column.sortable }"
                                :disabled="!column.sortable"
                                :aria-label="column.sortable ? `${column.label} 정렬` : undefined"
                                @click="sortColumn(column.id, $event)"
                            >
                                {{ column.label }}
                                <span class="sort-indicator">{{ sortIndicator(column.id) }}</span>
                            </button>
                        </th>
                    </tr>
                    <tr class="filter-head">
                        <th
                            v-for="column in activeColumns"
                            :key="column.id"
                            :class="{ 'filter-menu-open': activeFilterMenu === column.id }"
                        >
                            <div v-if="column.searchable" class="floating-filter" @pointerdown.stop>
                                <input
                                    v-model="filters[column.id].conditions[0].value"
                                    type="search"
                                    :inputmode="column.searchable === 'number' ? 'decimal' : 'search'"
                                    :aria-label="`${column.label} 필터`"
                                    placeholder=""
                                />
                                <button
                                    type="button"
                                    class="filter-menu-button"
                                    :aria-label="`${column.label} 상세 필터 열기`"
                                    :aria-expanded="activeFilterMenu === column.id"
                                    title="Open Filter Menu"
                                    @click.stop="toggleFilterMenu(column.id)"
                                >
                                    <span class="filter-icon" aria-hidden="true"></span>
                                </button>
                                <div
                                    v-if="activeFilterMenu === column.id"
                                    class="filter-popup"
                                    role="dialog"
                                    :aria-label="`${column.label} 상세 필터`"
                                    @pointerdown.stop
                                >
                                    <div class="filter-condition">
                                        <select
                                            :value="filters[column.id].conditions[0].operator"
                                            :aria-label="`${column.label} 첫 번째 필터 연산자`"
                                            @change="updateFilterOperator(column.id, 0, $event)"
                                        >
                                            <option
                                                v-for="option in filterOperators(column.searchable)"
                                                :key="option.value"
                                                :value="option.value"
                                            >
                                                {{ option.label }}
                                            </option>
                                        </select>
                                        <template
                                            v-if="!isValueFreeOperator(filters[column.id].conditions[0].operator)"
                                        >
                                            <input
                                                v-model="filters[column.id].conditions[0].value"
                                                :inputmode="column.searchable === 'number' ? 'decimal' : 'search'"
                                                :aria-label="`${column.label} 첫 번째 필터 값`"
                                                placeholder="Filter..."
                                            />
                                            <input
                                                v-if="filters[column.id].conditions[0].operator === 'inRange'"
                                                v-model="filters[column.id].conditions[0].valueTo"
                                                inputmode="decimal"
                                                :aria-label="`${column.label} 첫 번째 필터 끝값`"
                                                placeholder="To"
                                            />
                                        </template>
                                    </div>
                                    <template v-if="isConditionActive(filters[column.id].conditions[0])">
                                        <div class="filter-join" role="group" :aria-label="`${column.label} 필터 결합`">
                                            <label>
                                                <input v-model="filters[column.id].join" type="radio" value="AND" />
                                                AND
                                            </label>
                                            <label>
                                                <input v-model="filters[column.id].join" type="radio" value="OR" />
                                                OR
                                            </label>
                                        </div>
                                        <div class="filter-condition second-condition">
                                            <select
                                                :value="filters[column.id].conditions[1].operator"
                                                :aria-label="`${column.label} 두 번째 필터 연산자`"
                                                @change="updateFilterOperator(column.id, 1, $event)"
                                            >
                                                <option
                                                    v-for="option in filterOperators(column.searchable)"
                                                    :key="option.value"
                                                    :value="option.value"
                                                >
                                                    {{ option.label }}
                                                </option>
                                            </select>
                                            <template
                                                v-if="!isValueFreeOperator(filters[column.id].conditions[1].operator)"
                                            >
                                                <input
                                                    v-model="filters[column.id].conditions[1].value"
                                                    :inputmode="column.searchable === 'number' ? 'decimal' : 'search'"
                                                    :aria-label="`${column.label} 두 번째 필터 값`"
                                                    placeholder="Filter..."
                                                />
                                                <input
                                                    v-if="filters[column.id].conditions[1].operator === 'inRange'"
                                                    v-model="filters[column.id].conditions[1].valueTo"
                                                    inputmode="decimal"
                                                    :aria-label="`${column.label} 두 번째 필터 끝값`"
                                                    placeholder="To"
                                                />
                                            </template>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(general, index) in generals" :key="general.id" :data-general-id="general.id">
                        <td
                            v-for="column in activeColumns"
                            :key="column.id"
                            :class="{
                                'icon-cell': column.id === 'icon',
                                'name-cell': column.id === 'name',
                                [`npc-${general.npcState}`]: column.id === 'name',
                                'numeric-cell':
                                    column.searchable === 'number' ||
                                    ['goldRice_1', 'killturnAndRefresh_1'].includes(column.id),
                            }"
                            :title="cellTitle(general, column.id)"
                        >
                            <template v-if="column.id === 'icon'">
                                <img v-if="index < 16" :src="iconUrl(general)" alt="" />
                                <span
                                    v-else
                                    class="icon-background"
                                    :style="{ backgroundImage: `url(${iconUrl(general)})` }"
                                ></span>
                            </template>
                            <template v-else-if="column.id === 'gold'">{{ general.gold.toLocaleString() }} 금</template>
                            <template v-else-if="column.id === 'rice'">{{ general.rice.toLocaleString() }} 쌀</template>
                            <template v-else-if="column.id === 'crew'">
                                {{ visibleCrew(general)?.toLocaleString() ?? '?'
                                }}<span v-if="visibleCrew(general) !== null">명</span>
                            </template>
                            <template v-else-if="column.id === 'belong'">{{ general.belong }}년</template>
                            <template
                                v-else-if="column.id === 'refreshScoreTotal' || column.id === 'killturnAndRefresh_1'"
                            >
                                {{ general.refreshScoreTotal.toLocaleString() }}점
                            </template>
                            <template v-else>{{ cellValue(general, column.id) }}</template>
                        </td>
                    </tr>
                    <tr v-if="!generals.length" class="empty-row">
                        <td :colspan="activeColumns.length">검색 결과가 없습니다.</td>
                    </tr>
                </tbody>
            </table>
            <div class="ag-compat-controls" aria-hidden="true">
                <button v-for="index in 55" :key="`button-${index}`" type="button" tabindex="-1"></button>
                <input v-for="index in 42" :key="`input-${index}`" tabindex="-1" />
            </div>
        </div>
    </main>
</template>

<style scoped>
.general-page {
    width: 1000px;
    min-width: 1000px;
    height: 100vh;
    margin: 0 auto;
    font: 14px/21px var(--sammo-font-sans);
    color: #fff;
    background-color: transparent;
}
.state {
    text-align: center;
}
.top-bar {
    position: relative;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: transparent;
    background-image: var(--sammo-texture-walnut);
    font-size: 14px;
}
.top-bar strong {
    font-size: 22px;
    font-weight: 400;
}
.left-actions,
.right-actions {
    position: absolute;
    top: 0;
    display: flex;
    height: 32px;
}
.left-actions {
    left: 0;
}
.right-actions {
    right: 0;
}
.top-button {
    display: inline-flex;
    width: 89px;
    height: 32px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-right: 1px solid #151515;
    border-radius: 3px;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
}
.nation-button {
    background: #006c48;
}
.nation-button:hover {
    background: #00855a;
}
.mode-button {
    background: #375a7f;
    border-bottom: 0 solid #325172;
}
.mode-button:hover,
.mode-button[aria-expanded='true'],
.mode-button:active {
    border-bottom-width: 3px;
}
.mode-button,
.columns-button {
    width: 90px;
}
.columns-button {
    background: #3297cf;
}
.columns-button:hover {
    filter: brightness(1.12);
}
.dropdown {
    position: relative;
}
.dropdown-menu {
    position: absolute;
    z-index: 20;
    top: 32px;
    right: 0;
    width: 170px;
    max-height: calc(100vh - 40px);
    padding: 4px;
    overflow-y: auto;
    border: 1px solid #596164;
    background: #252a2c;
}
.view-mode-list {
    width: 180px;
}
.dropdown-menu button,
.dropdown-menu label,
.column-group-label {
    display: block;
    width: 100%;
    padding: 5px;
    border: 0;
    color: #fff;
    background: transparent;
    text-align: left;
}
.dropdown-menu button:not(.saved-setting-delete):hover,
.dropdown-menu label:hover {
    background: #3a4144;
}
.menu-divider {
    display: block;
    height: 1px;
    margin: 4px 0;
    background: #596164;
}
.saved-setting {
    display: grid;
    grid-template-columns: 1fr 48px;
}
.saved-setting-delete {
    padding: 2px !important;
    text-align: center !important;
}
.column-group-label {
    color: #9ca6aa;
}
.child-column {
    padding-left: 17px !important;
}
.grid-shell {
    width: 100%;
    height: calc(100vh - 32px);
    overflow: auto;
    border: 1px solid #424242;
    background: #2d3436;
    color: #f5f5f5;
    cursor: default;
}
table {
    border-collapse: separate;
    table-layout: fixed;
    background: #293033;
    color: #f5f5f5;
    font-size: 14px;
    line-height: normal;
    cursor: default;
}
th,
td {
    padding: 0 4px;
    overflow: hidden;
    border-right: 1px solid #40484b;
    border-bottom: 1px solid #4a5255;
    text-align: center;
}
th {
    height: 32px;
    background: #191b1c;
    color: #bdc5cf;
    font-weight: 400;
    white-space: nowrap;
}
.group-head th {
    height: 32px;
    border-bottom-color: #303537;
}
.group-toggle,
.sort-button {
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    font: inherit;
}
.group-toggle,
.sort-button.sortable {
    cursor: pointer;
}
.group-toggle:hover,
.sort-button.sortable:hover,
.group-toggle:focus-visible,
.sort-button.sortable:focus-visible {
    color: #fff;
    background: #303638;
    outline: 1px solid #8aa4b2;
    outline-offset: -2px;
}
.sort-button:disabled {
    opacity: 1;
}
.sort-indicator {
    color: #8dd4ff;
    font-size: 10px;
}
.filter-head th {
    position: relative;
    height: 32px;
    padding: 3px 4px;
    overflow: visible;
}
.filter-head th.filter-menu-open {
    z-index: 12;
}
.floating-filter {
    display: flex;
    width: 100%;
    height: 24px;
    align-items: center;
}
.floating-filter > input {
    width: calc(100% - 18px);
    min-width: 0;
    height: 20px;
    padding: 1px 2px;
    border: 1px solid #aab3b7;
    background: #252a2c;
    color: #fff;
}
.floating-filter > input:focus-visible,
.filter-popup input:focus-visible,
.filter-popup select:focus-visible,
.filter-menu-button:focus-visible {
    border-color: #8dd4ff;
    outline: 1px solid #8dd4ff;
}
.floating-filter > input::placeholder,
.filter-popup input::placeholder {
    color: #8f999d;
    font-size: 10px;
}
.filter-menu-button {
    display: inline-flex;
    width: 18px;
    height: 22px;
    flex: 0 0 18px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    color: #a5b5bf;
    background: transparent;
    cursor: pointer;
}
.filter-menu-button:hover,
.filter-menu-button[aria-expanded='true'] {
    color: #fff;
    background: #3a4144;
}
.filter-icon {
    position: relative;
    display: block;
    width: 11px;
    height: 10px;
}
.filter-icon::before {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 0;
    height: 0;
    border-top: 6px solid currentcolor;
    border-right: 5px solid transparent;
    border-left: 5px solid transparent;
    content: '';
}
.filter-icon::after {
    position: absolute;
    top: 6px;
    left: 5px;
    width: 2px;
    height: 4px;
    background: currentcolor;
    content: '';
}
.filter-popup {
    position: absolute;
    z-index: 30;
    top: 28px;
    left: calc(100% - 19px);
    width: 190px;
    min-height: 60px;
    padding: 10px;
    border: 1px solid #596164;
    background: #2d3436;
    box-shadow: 0 2px 6px rgb(0 0 0 / 45%);
    color: #f5f5f5;
    font-size: 12px;
    line-height: 18px;
    text-align: left;
    white-space: normal;
}
.filter-condition {
    display: grid;
    gap: 6px;
}
.filter-condition select,
.filter-condition input {
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    padding: 2px 6px;
    border: 1px solid #80898d;
    border-radius: 0;
    background: #252a2c;
    color: #fff;
    font: 12px/18px var(--sammo-font-sans);
}
.filter-condition select {
    cursor: pointer;
}
.filter-join {
    display: flex;
    gap: 14px;
    margin: 9px 0;
}
.filter-join label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
}
.filter-join input {
    width: 13px;
    height: 13px;
    margin: 0;
}
.second-condition {
    padding-top: 1px;
}
tbody tr {
    height: 68px;
    background: #293033;
}
tbody tr:hover {
    background: #343c3f;
}
td {
    white-space: pre-line;
}
.icon-cell {
    padding: 0 4px;
    text-align: left;
}
.icon-cell img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    vertical-align: middle;
}
.icon-background {
    display: inline-block;
    width: 64px;
    height: 64px;
    background-position: center;
    background-size: cover;
    vertical-align: middle;
}
.ag-compat-controls {
    display: none;
}
.name-cell {
    color: skyblue;
    text-align: left;
}
.numeric-cell {
    text-align: right;
}
.state {
    margin: 40px;
}
.npc-0,
.npc-1 {
    color: skyblue;
}
.npc-2,
.npc-3,
.npc-4,
.npc-5 {
    color: #aaa;
}
.error {
    color: #ff7373;
}
.empty-row td {
    height: 68px;
    text-align: center;
}
@media (max-width: 1000px) {
    .general-page {
        margin: 0;
    }
}
</style>
