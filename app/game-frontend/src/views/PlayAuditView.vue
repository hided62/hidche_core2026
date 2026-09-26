<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import MapViewer from '../components/main/MapViewer.vue';
import PanelCard from '../components/ui/PanelCard.vue';
import AuditNationSeries from '../components/playAudit/AuditNationSeries.vue';
import AuditNationSnapshot from '../components/playAudit/AuditNationSnapshot.vue';
import AuditGeneralDetail from '../components/playAudit/AuditGeneralDetail.vue';
import AuditDiplomacyHistory from '../components/playAudit/AuditDiplomacyHistory.vue';
import AuditPolicyHistory from '../components/playAudit/AuditPolicyHistory.vue';
import AuditCityDetail from '../components/playAudit/AuditCityDetail.vue';
import { usePageExit } from '../composables/usePageExit';
import { trpc } from '../utils/trpc';

type Coverage = Awaited<ReturnType<typeof trpc.playAudit.coverage.query>>;
type Nations = Awaited<ReturnType<typeof trpc.playAudit.nations.query>>;
type Generals = Awaited<ReturnType<typeof trpc.playAudit.generals.query>>;
type Cities = Awaited<ReturnType<typeof trpc.playAudit.cities.query>>;
type Series = Awaited<ReturnType<typeof trpc.playAudit.nationSeries.query>>;
type NationSnapshot = Awaited<ReturnType<typeof trpc.playAudit.nationSnapshot.query>>;
const route = useRoute();
const router = useRouter();
const { pageExitLabel, exitPage } = usePageExit();
const coverage = ref<Coverage | null>(null);
const nations = ref<Nations | null>(null);
const generals = ref<Generals | null>(null);
const cities = ref<Cities | null>(null);
const cityMap = ref<Awaited<ReturnType<typeof trpc.playAudit.cityMap.query>> | null>(null);
const cityView = computed(() => (route.query.view === 'map' ? 'map' : 'list'));
const sortOptions = [
    ['id', '장수 번호'],
    ['gold', '금'],
    ['rice', '쌀'],
    ['crew', '병력'],
    ['train', '훈련'],
    ['atmos', '사기'],
    ['leadership', '통솔'],
    ['strength', '무력'],
    ['intelligence', '지력'],
    ['experience', '경험'],
    ['dedication', '공헌'],
    ['dex1', '보병 숙련'],
    ['dex2', '궁병 숙련'],
    ['dex3', '기병 숙련'],
    ['dex4', '귀병 숙련'],
    ['dex5', '차병 숙련'],
] as const;
const generalSort = ref<(typeof sortOptions)[number][0]>('id');
const series = ref<Series | null>(null);
const nationSnapshot = ref<NationSnapshot | null>(null);
const authorized = ref(false);
const profileName = ref('');
const loading = ref(false);
const error = ref('');
const tab = ref('nations');
const policyArea = ref<'NPC_VALUES' | 'NPC_NATION_PRIORITY' | 'NPC_GENERAL_PRIORITY' | 'DEFENCE'>('NPC_VALUES');
const appliedPolicy = computed(() => {
    const to = {
        year: numeric(route.query.year, coverage.value?.year ?? 0),
        month: numeric(route.query.month, coverage.value?.month ?? 1),
    };
    const start = Math.max(
        (coverage.value?.startYear ?? to.year) * 12 + (coverage.value?.startMonth ?? 1) - 1,
        to.year * 12 + to.month - 6
    );
    return {
        nationId: numeric(route.query.nation, 0),
        area: (['NPC_NATION_PRIORITY', 'NPC_GENERAL_PRIORITY', 'DEFENCE'].includes(String(route.query.policyArea))
            ? route.query.policyArea
            : 'NPC_VALUES') as typeof policyArea.value,
        from: {
            year: numeric(route.query.fromYear, Math.floor(start / 12)),
            month: numeric(route.query.fromMonth, (start % 12) + 1),
        },
        to,
    };
});
const otherNationId = ref('');
const appliedDiplomacy = computed(() => ({
    nationId: appliedPolicy.value.nationId,
    otherNationId: numeric(route.query.otherNation, 0),
    from: appliedPolicy.value.from,
    to: appliedPolicy.value.to,
}));
const nationId = ref('');
const cityId = ref('');
const population = ref('');
const generalName = ref('');
const generalOrder = ref<'asc' | 'desc'>('asc');
const moment = ref('current');
const year = ref(0);
const month = ref(1);
const fromYear = ref(0);
const fromMonth = ref(1);
const resolution = ref<'month' | 'halfYear'>('month');
const inspector = ref<HTMLElement | null>(null);
const nationSearch = ref('');
const visibleNations = computed(
    () => nations.value?.items.filter((item) => item.name.includes(nationSearch.value)) ?? []
);
const chooseNation = (id: string) =>
    router.push({
        query: {
            ...route.query,
            nation: id || undefined,
            general: undefined,
            cityRecord: undefined,
            decision: undefined,
        },
    });

let generation = 0;
const numeric = (value: unknown, fallback: number) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : fallback;
const selectedGeneral = computed(() =>
    typeof route.query.general === 'string' && /^\d+$/.test(route.query.general) ? Number(route.query.general) : null
);
const selectedAt = computed(() =>
    route.query.at === 'month' || route.query.at === 'final' || route.query.at === 'initial'
        ? {
              year: numeric(route.query.year, coverage.value?.year ?? 0),
              month: numeric(route.query.month, coverage.value?.month ?? 1),
              kind:
                  route.query.at === 'final'
                      ? ('FINAL' as const)
                      : route.query.at === 'initial'
                        ? ('INITIAL' as const)
                        : ('MONTH_END' as const),
          }
        : undefined
);
const selectedCity = computed(() =>
    typeof route.query.cityRecord === 'string' && /^\d+$/.test(route.query.cityRecord)
        ? Number(route.query.cityRecord)
        : null
);
const focusInspector = async () => {
    if (!authorized.value || !coverage.value || (selectedGeneral.value === null && selectedCity.value === null)) return;
    await nextTick();
    inspector.value?.focus({ preventScroll: true });
    if (window.innerWidth < 1200) inspector.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
watch([selectedGeneral, selectedCity], focusInspector);
const selectGeneral = (id: number) =>
    router.push({ query: { ...route.query, general: String(id), cityRecord: undefined, decision: undefined } });
const closeGeneral = () => router.push({ query: { ...route.query, general: undefined, decision: undefined } });
const selectCity = (id: number) =>
    router.push({ query: { ...route.query, cityRecord: String(id), general: undefined, decision: undefined } });
const closeCity = () => router.push({ query: { ...route.query, cityRecord: undefined } });
const at = computed(() =>
    moment.value === 'current'
        ? undefined
        : {
              year: year.value,
              month: month.value,
              kind:
                  moment.value === 'final'
                      ? ('FINAL' as const)
                      : moment.value === 'initial'
                        ? ('INITIAL' as const)
                        : ('MONTH_END' as const),
          }
);
const format = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const nationName = (id: number) =>
    nations.value?.items.find((item) => item.id === id)?.name ?? (id === 0 ? '무소속' : `국가 #${id}`);
const scopeLabel = computed(() =>
    route.query.at !== 'month' && route.query.at !== 'final' && route.query.at !== 'initial'
        ? '현재 상태'
        : `${route.query.year}년 ${route.query.month}월 ${route.query.at === 'final' ? '최종 표본' : route.query.at === 'initial' ? '수집 시작 기준' : '월말'}`
);
const result = computed(() =>
    tab.value === 'generals'
        ? generals.value
        : tab.value === 'cities'
          ? cityView.value === 'map'
              ? cityMap.value
              : cities.value
          : nationSnapshot.value
            ? { ...nationSnapshot.value, nextCursor: null }
            : series.value
);
// 메뉴 상태도 기존 query 계약을 사용해 저장된 링크와 뒤로가기를 보존한다.
const primaryMenus = [
    { key: 'nations', label: '국가' },
    { key: 'generals', label: '장수' },
    { key: 'cities', label: '도시' },
    { key: 'diplomacy', label: '외교' },
    { key: 'policies', label: '정책' },
];
const secondaryMenus = computed(() => {
    if (tab.value === 'policies')
        return [
            { key: 'NPC_VALUES', label: 'NPC 국가 정책' },
            { key: 'NPC_NATION_PRIORITY', label: '국가 행동 우선순위' },
            { key: 'NPC_GENERAL_PRIORITY', label: '장수 행동 우선순위' },
            { key: 'DEFENCE', label: '국방 설정' },
        ];
    if (tab.value === 'generals')
        return [
            { key: '', label: '전체 장수' },
            { key: 'human', label: '유저' },
            { key: 'npc', label: 'NPC' },
            { key: 'troopNpc', label: '부대장 NPC' },
        ];
    if (tab.value === 'diplomacy') return [{ key: 'history', label: '문서·관계 이력' }];
    if (tab.value === 'nations')
        return [
            { key: 'series', label: '자원·숙련도 추이' },
            { key: 'initial', label: '수집 시작 표본' },
            { key: 'final', label: '최종 표본' },
        ];
    return [
        { key: 'current', label: '현재 도시' },
        { key: 'month', label: '월말 도시' },
        { key: 'initial', label: '수집 시작 표본' },
        { key: 'final', label: '최종 표본' },
    ];
});
const activeSecondary = computed(() => {
    if (tab.value === 'policies') return policyArea.value;
    if (tab.value === 'generals') return population.value;
    if (tab.value === 'diplomacy') return 'history';
    if (tab.value === 'nations') return ['initial', 'final'].includes(moment.value) ? moment.value : 'series';
    return moment.value;
});
const menuTarget = (target: string, secondary?: string) => {
    const query: LocationQueryRaw = { ...route.query, tab: target };
    for (const key of [
        'general',
        'cityRecord',
        'decision',
        'policy',
        'event',
        'city',
        'name',
        'population',
        'policyArea',
    ])
        delete query[key];
    if (target !== 'diplomacy') delete query.otherNation;
    if (target === 'generals' && secondary) query.population = secondary;
    if (target === 'policies') query.policyArea = secondary ?? 'NPC_VALUES';
    if (target === 'cities') query.at = secondary ?? 'current';
    if (target === 'nations') query.at = secondary === 'initial' || secondary === 'final' ? secondary : 'current';
    return { query };
};
const readQuery = () => {
    tab.value = ['nations', 'generals', 'cities', 'policies', 'diplomacy'].includes(String(route.query.tab))
        ? String(route.query.tab)
        : 'nations';
    policyArea.value = appliedPolicy.value.area;
    otherNationId.value = route.query.otherNation ? String(numeric(route.query.otherNation, 0)) : '';
    nationId.value = route.query.nation ? String(numeric(route.query.nation, 0)) : '';
    cityId.value = route.query.city ? String(numeric(route.query.city, 0)) : '';
    generalName.value = typeof route.query.name === 'string' ? route.query.name : '';
    generalOrder.value = route.query.order === 'desc' ? 'desc' : 'asc';
    generalSort.value = sortOptions.find(([key]) => key === route.query.sort)?.[0] ?? 'id';
    population.value = ['human', 'npc', 'troopNpc'].includes(String(route.query.population))
        ? String(route.query.population)
        : '';
    moment.value = ['month', 'final', 'initial'].includes(String(route.query.at)) ? String(route.query.at) : 'current';
    year.value = numeric(route.query.year, coverage.value?.year ?? 0);
    month.value = numeric(route.query.month, coverage.value?.month ?? 1);
    const defaultStart = Math.max(
        (coverage.value?.startYear ?? year.value) * 12 + (coverage.value?.startMonth ?? 1) - 1,
        year.value * 12 + month.value - (tab.value === 'nations' ? 12 : 6)
    );
    fromYear.value = numeric(route.query.fromYear, Math.floor(defaultStart / 12));
    fromMonth.value = numeric(route.query.fromMonth, (defaultStart % 12) + 1);
    resolution.value = route.query.resolution === 'halfYear' ? 'halfYear' : 'month';
};
const message = (cause: unknown) => (cause instanceof Error ? cause.message : '자료를 조회하지 못했습니다.');
const load = async (append = false) => {
    if (append) readQuery();
    const request = ++generation;
    loading.value = true;
    error.value = '';
    if (!append) {
        generals.value = null;
        cities.value = null;
        cityMap.value = null;
        series.value = null;
        nationSnapshot.value = null;
    }
    const filter = { at: at.value, nationId: nationId.value === '' ? undefined : Number(nationId.value), limit: 50 };
    try {
        if (tab.value === 'generals') {
            const response = await trpc.playAudit.generals.query({
                ...filter,
                cityId: cityId.value === '' ? undefined : Number(cityId.value),
                name: generalName.value.trim() || undefined,
                order: generalOrder.value,
                sort: generalSort.value,
                population:
                    population.value === 'human' || population.value === 'npc' || population.value === 'troopNpc'
                        ? population.value
                        : undefined,
                cursor: append ? (generals.value?.nextCursor ?? undefined) : undefined,
            });
            if (request === generation)
                generals.value = {
                    ...response,
                    items: append ? [...(generals.value?.items ?? []), ...response.items] : response.items,
                };
        } else if (tab.value === 'cities' && cityView.value === 'map') {
            const response = await trpc.playAudit.cityMap.query({ at: at.value });
            if (request === generation) cityMap.value = response;
        } else if (tab.value === 'cities') {
            const response = await trpc.playAudit.cities.query({
                ...filter,
                cursor: append ? (cities.value?.nextCursor ?? undefined) : undefined,
            });
            if (request === generation)
                cities.value = {
                    ...response,
                    items: append ? [...(cities.value?.items ?? []), ...response.items] : response.items,
                };
        } else if (tab.value === 'policies' || tab.value === 'diplomacy') {
            // 정책 목록/상세는 해당 component가 필요한 요청만 실행한다.
        } else if (nationId.value !== '' && (moment.value === 'final' || moment.value === 'initial')) {
            const response = await trpc.playAudit.nationSnapshot.query({
                nationId: Number(nationId.value),
                at: { year: year.value, month: month.value, kind: moment.value === 'initial' ? 'INITIAL' : 'FINAL' },
            });
            if (request === generation) nationSnapshot.value = response;
        } else if (nationId.value !== '') {
            const response = await trpc.playAudit.nationSeries.query({
                nationId: Number(nationId.value),
                from: { year: fromYear.value, month: fromMonth.value },
                to: { year: year.value, month: month.value },
                resolution: resolution.value,
                limit: 50,
                cursor: append ? (series.value?.nextCursor ?? undefined) : undefined,
            });
            if (request === generation)
                series.value = {
                    ...response,
                    items: append ? [...(series.value?.items ?? []), ...response.items] : response.items,
                };
        }
    } catch (cause) {
        if (request === generation) error.value = message(cause);
    } finally {
        if (request === generation) loading.value = false;
    }
};
const loadNations = async (append = false) => {
    const request = generation;
    const response = await trpc.playAudit.nations.query({
        at: at.value,
        limit: 50,
        cursor: append ? (nations.value?.nextCursor ?? undefined) : undefined,
    });
    if (request === generation)
        nations.value = {
            ...response,
            items: append ? [...(nations.value?.items ?? []), ...response.items] : response.items,
        };
};
const apply = async () => {
    const query = {
        tab: tab.value,
        nation: nationId.value || undefined,
        otherNation: tab.value === 'diplomacy' ? otherNationId.value || undefined : undefined,
        city: cityId.value || undefined,
        population: population.value || undefined,
        name: tab.value === 'generals' ? generalName.value.trim() || undefined : undefined,
        order: tab.value === 'generals' ? generalOrder.value : undefined,
        sort: tab.value === 'generals' && generalSort.value !== 'id' ? generalSort.value : undefined,
        view: tab.value === 'cities' ? cityView.value : undefined,
        at: moment.value,
        year: String(year.value),
        month: String(month.value),
        fromYear: String(fromYear.value),
        fromMonth: String(fromMonth.value),
        resolution: resolution.value,
        policyArea: tab.value === 'policies' ? policyArea.value : undefined,
    };
    if (JSON.stringify(route.query) === JSON.stringify(query)) await refresh();
    else {
        const before = route.fullPath;
        await router.push({ query });
        if (before === route.fullPath) await refresh();
    }
};
const recentPeriod = async (months: number) => {
    if (!coverage.value) return;
    year.value = coverage.value.year;
    month.value = coverage.value.month;
    const first = Math.max(
        coverage.value.startYear * 12 + coverage.value.startMonth - 1,
        year.value * 12 + month.value - months
    );
    fromYear.value = Math.floor(first / 12);
    fromMonth.value = (first % 12) + 1;
    moment.value = 'current';
    await apply();
};
const refresh = async () => {
    const dataRequest = load();
    const request = generation;
    const results = await Promise.allSettled([dataRequest, loadNations()]);
    if (request !== generation) return;
    for (const response of results) if (response.status === 'rejected') error.value = message(response.reason);
    await focusInspector();
};
const showCityGenerals = async (id: number) => {
    readQuery();
    tab.value = 'generals';
    cityId.value = String(id);
    nationId.value = '';
    population.value = '';
    generalName.value = '';
    generalOrder.value = 'asc';
    await apply();
};
const moreNations = async () => {
    const request = generation;
    loading.value = true;
    try {
        await loadNations(true);
    } catch (cause) {
        if (request === generation) error.value = message(cause);
    } finally {
        if (request === generation) loading.value = false;
    }
};
watch(
    () =>
        JSON.stringify(
            Object.entries(route.query).filter(
                ([key]) =>
                    key !== 'general' &&
                    key !== 'cityRecord' &&
                    key !== 'policy' &&
                    key !== 'event' &&
                    key !== 'decision'
            )
        ),
    () => {
        if (authorized.value) {
            readQuery();
            void refresh();
        }
    }
);
onMounted(async () => {
    loading.value = true;
    try {
        const capabilities = await trpc.playAudit.capabilities.query();
        profileName.value = capabilities.profileName;
        authorized.value = true;
        coverage.value = await trpc.playAudit.coverage.query({ limit: 50 });
        readQuery();
        await refresh();
    } catch (cause) {
        error.value = message(cause);
    } finally {
        loading.value = false;
    }
});
</script>

<template>
    <main id="play-audit-container" class="audit-page">
        <PanelCard title="플레이 감사" :subtitle="profileName || undefined">
            <template #actions
                ><button class="legacy-button" @click="exitPage">{{ pageExitLabel }}</button></template
            >
            <p v-if="error" role="alert">{{ error }}</p>
            <p v-if="loading" role="status">조회 중…</p>
            <template v-if="authorized && coverage">
                <p>
                    현재 {{ coverage.year }}년 {{ coverage.month }}월 · {{ scopeLabel }} · 현재 기수의 수집 자료를
                    조회합니다.
                </p>
                <p v-if="coverage.historyGap" role="status">
                    {{ coverage.historyGap.firstYear }}년 {{ coverage.historyGap.firstMonth }}월 이후 감사 이력에 누락된
                    구간이 있습니다. 수집된 기록만 표시하며 게임은 계속 진행됩니다.
                </p>
                <p v-if="coverage.status === 'IDENTITY_MISSING'">
                    기수 식별자가 없어 과거 자료를 수집하지 못했습니다. 현재 상태만 확인할 수 있습니다.
                </p>
                <p v-else-if="coverage.status === 'NOT_COLLECTED'">
                    아직 수집된 월별 표본이 없습니다. 현재 상태는 조회할 수 있습니다.
                </p>
                <p v-if="coverage.collectionStart">
                    상태·정책 수집 시작: {{ coverage.collectionStart.year }}년 {{ coverage.collectionStart.month }}월 ·
                    {{ coverage.collectionStart.observedAt }}
                </p>
            </template>
        </PanelCard>
        <div v-if="authorized && coverage" class="audit-workspace">
            <aside class="audit-sidebar" aria-label="감사 탐색">
                <nav class="audit-navigation" aria-label="플레이 감사 메뉴">
                    <div class="menu-row" aria-label="감사 분류">
                        <RouterLink
                            v-for="item in primaryMenus"
                            :key="item.key"
                            class="legacy-button"
                            :class="{ selected: tab === item.key }"
                            :aria-current="tab === item.key ? 'true' : undefined"
                            :to="menuTarget(item.key)"
                            >{{ item.label }}</RouterLink
                        >
                    </div>
                    <div class="menu-row secondary-menu" aria-label="세부 조회">
                        <RouterLink
                            v-for="item in secondaryMenus"
                            :key="item.key"
                            class="legacy-button"
                            :class="{ selected: activeSecondary === item.key }"
                            :aria-current="activeSecondary === item.key ? 'page' : undefined"
                            :to="menuTarget(tab, item.key)"
                            >{{ item.label }}</RouterLink
                        >
                    </div>
                </nav>
                <section class="nation-browser" aria-label="국가 탐색">
                    <h2>국가</h2>
                    <input v-model="nationSearch" aria-label="국가 이름 검색" placeholder="국가 이름 검색" />
                    <button class="legacy-button" :aria-pressed="!route.query.nation" @click="chooseNation('')">
                        전체 국가
                    </button>
                    <button
                        v-for="nation in visibleNations"
                        :key="nation.id"
                        class="legacy-button nation-choice"
                        :aria-pressed="String(route.query.nation) === String(nation.id)"
                        @click="chooseNation(String(nation.id))"
                    >
                        {{ nation.name }} <small>#{{ nation.id }}</small>
                    </button>
                    <p v-if="!visibleNations.length">조건에 맞는 국가가 없습니다.</p>
                    <button
                        v-if="nations?.nextCursor != null"
                        class="legacy-button"
                        :disabled="loading"
                        @click="moreNations"
                    >
                        국가 더 불러오기
                    </button>
                </section>
            </aside>
            <section class="audit-content" aria-label="감사 분석">
                <PanelCard title="조회 조건">
                    <div v-if="tab === 'nations'" class="period-shortcuts" aria-label="빠른 조회 기간">
                        <button
                            v-for="months in [6, 12, 24]"
                            :key="months"
                            class="legacy-button"
                            :disabled="loading"
                            @click="recentPeriod(months)"
                        >
                            최근 {{ months }}개월
                        </button>
                    </div>
                    <form class="filters" @submit.prevent="apply">
                        <p class="selected-nation">{{ nationId ? nationName(Number(nationId)) : '전체 국가' }}</p>
                        <label
                            >국가 목록·상태 기준<select class="legacy-sort-select" v-model="moment">
                                <option value="current">현재</option>
                                <option value="month">월말</option>
                                <option value="final">최종 표본</option>
                                <option value="initial">수집 시작 기준</option>
                            </select></label
                        >
                        <label
                            >{{
                                tab === 'nations' || tab === 'policies' || tab === 'diplomacy'
                                    ? '종료 연도'
                                    : '표본 연도'
                            }}<input
                                v-model.number="year"
                                type="number"
                                :min="coverage.startYear"
                                :max="coverage.year"
                                required
                        /></label>
                        <label
                            >월<input
                                v-model.number="month"
                                type="number"
                                :min="year === coverage.startYear ? coverage.startMonth : 1"
                                :max="year === coverage.year ? coverage.month : 12"
                                required
                        /></label>
                        <template
                            v-if="
                                (tab === 'nations' && moment !== 'final' && moment !== 'initial') ||
                                tab === 'policies' ||
                                tab === 'diplomacy'
                            "
                        >
                            <label
                                >시작 연도<input
                                    v-model.number="fromYear"
                                    type="number"
                                    :min="coverage.startYear"
                                    :max="coverage.year"
                                    required
                            /></label>
                            <label
                                >시작 월<input
                                    v-model.number="fromMonth"
                                    type="number"
                                    :min="fromYear === coverage.startYear ? coverage.startMonth : 1"
                                    :max="fromYear === coverage.year ? coverage.month : 12"
                                    required
                            /></label>
                            <label v-if="tab === 'nations'"
                                >간격<select class="legacy-sort-select" v-model="resolution">
                                    <option value="halfYear">반기 (1~6월 / 7~12월)</option>
                                    <option value="month">매월</option>
                                </select></label
                            >
                        </template>
                        <label v-if="tab === 'diplomacy'"
                            >상대 국가<select class="legacy-sort-select" v-model="otherNationId">
                                <option value="">국가 선택</option>
                                <option
                                    v-for="nation in nations?.items.filter((item) => item.id > 0)"
                                    :key="nation.id"
                                    :value="String(nation.id)"
                                >
                                    {{ nation.name }} (#{{ nation.id }})
                                </option>
                                <option
                                    v-if="
                                        otherNationId &&
                                        !nations?.items.some((item) => String(item.id) === otherNationId)
                                    "
                                    :value="otherNationId"
                                >
                                    국가 #{{ otherNationId }}
                                </option>
                            </select></label
                        >
                        <template v-if="tab === 'generals'">
                            <label
                                >정렬 기준<select
                                    v-model="generalSort"
                                    class="legacy-sort-select"
                                    aria-label="정렬 기준"
                                >
                                    <option v-for="[key, label] in sortOptions" :key="key" :value="key">
                                        {{ label }}
                                    </option>
                                </select></label
                            >
                            <label
                                >장수 이름<input v-model="generalName" maxlength="64" placeholder="이름 부분 검색"
                            /></label>
                            <label
                                >{{ generalSort === 'id' ? '장수 번호 정렬' : '정렬 방향'
                                }}<select
                                    class="legacy-sort-select"
                                    v-model="generalOrder"
                                    :aria-label="generalSort === 'id' ? '장수 번호 정렬' : '정렬 방향'"
                                >
                                    <option value="asc">오름차순</option>
                                    <option value="desc">내림차순</option>
                                </select></label
                            >
                            <label
                                >도시 번호<input v-model="cityId" type="number" min="0" placeholder="모든 도시"
                            /></label>
                        </template>
                        <button class="legacy-button" type="submit" :disabled="loading">조회</button>
                    </form>
                </PanelCard>
                <PanelCard
                    v-if="authorized && coverage"
                    :title="
                        tab === 'nations'
                            ? '국가 시계열'
                            : tab === 'generals'
                              ? '전체 장수'
                              : tab === 'policies'
                                ? '정책 변경 이력'
                                : tab === 'diplomacy'
                                  ? '외교 이력'
                                  : '도시 상태'
                    "
                >
                    <p v-if="result">조회 시각 {{ result.asOf }} · tick {{ result.tick ?? '없음' }}</p>
                    <p v-if="(tab === 'nations' || tab === 'policies' || tab === 'diplomacy') && !nationId">
                        왼쪽 국가 목록에서 국가를 선택해 주세요. 멸망한 국가는 해당 월말 기준의 국가 목록에서 선택할 수
                        있습니다.
                    </p>
                    <p v-if="tab === 'diplomacy' && !otherNationId">상대 왼쪽 국가 목록에서 국가를 선택해 주세요.</p>
                    <AuditDiplomacyHistory
                        v-if="
                            tab === 'diplomacy' &&
                            route.query.tab === 'diplomacy' &&
                            route.query.nation &&
                            route.query.otherNation
                        "
                        v-bind="appliedDiplomacy"
                    />
                    <AuditPolicyHistory
                        v-if="tab === 'policies' && route.query.tab === 'policies' && route.query.nation"
                        v-bind="appliedPolicy"
                    />
                    <AuditNationSeries v-if="series && tab === 'nations'" :data="series" />
                    <AuditNationSnapshot v-if="nationSnapshot && tab === 'nations'" :data="nationSnapshot" />
                    <template v-if="generals && tab === 'generals'">
                        <p v-if="!generals.collected">선택한 시점의 표본이 없습니다.</p>
                        <p v-else-if="!generals.items.length">조건에 맞는 장수가 없습니다.</p>
                        <div v-else class="table-scroll" tabindex="0" aria-label="장수 목록">
                            <table>
                                <thead>
                                    <tr>
                                        <th>장수</th>
                                        <th>국가·위치</th>
                                        <th>금 / 쌀</th>
                                        <th>병력 / 훈련 / 사기</th>
                                        <th>능력·숙련</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for="general in generals.items"
                                        :key="general.id"
                                        :class="{ 'selected-row': selectedGeneral === general.id }"
                                    >
                                        <th scope="row">
                                            <button
                                                class="legacy-button"
                                                :aria-pressed="selectedGeneral === general.id"
                                                @click="selectGeneral(general.id)"
                                            >
                                                {{ general.name }} (#{{ general.id }})</button
                                            ><br />{{
                                                general.npcState < 2
                                                    ? '유저'
                                                    : general.npcState === 5
                                                      ? '부대장 NPC'
                                                      : 'NPC'
                                            }}
                                        </th>
                                        <td>
                                            {{ nationName(general.nationId) }}<br />도시 #{{ general.cityId }} · 부대
                                            #{{ general.troopId }}
                                        </td>
                                        <td>{{ format(general.gold) }} / {{ format(general.rice) }}</td>
                                        <td>
                                            {{ format(general.crew) }} / {{ format(general.train) }} /
                                            {{ format(general.atmos) }}<br />병종 #{{ general.crewTypeId }}
                                        </td>
                                        <td>
                                            <details>
                                                <summary>상세 보기</summary>
                                                <p>
                                                    통솔 {{ general.stats.leadership }} · 무력
                                                    {{ general.stats.strength }} · 지력 {{ general.stats.intelligence }}
                                                </p>
                                                <p>
                                                    경험 {{ format(general.experience) }} · 공헌
                                                    {{ format(general.dedication) }} · 관직 {{ general.officerLevel }}
                                                </p>
                                                <p>나이 {{ general.age }} · 부상 {{ general.injury }}</p>
                                                <p>
                                                    숙련 (보 / 궁 / 기 / 귀 / 차):
                                                    {{ Object.values(general.dex).map(format).join(' / ') }}
                                                </p>
                                                <p>
                                                    성격 {{ general.role.personality ?? '없음' }} · 내정 특기
                                                    {{ general.role.specialDomestic ?? '없음' }} · 전투 특기
                                                    {{ general.role.specialWar ?? '없음' }}
                                                </p>
                                                <p>
                                                    장비 (말 / 무기 / 책 / 도구):
                                                    {{
                                                        Object.values(general.role.items)
                                                            .map((item) => item ?? '없음')
                                                            .join(' / ')
                                                    }}
                                                </p>
                                            </details>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                    <nav v-if="tab === 'cities'" class="menu-row" aria-label="도시 표시 방식">
                        <RouterLink
                            class="legacy-button"
                            :aria-current="cityView === 'list' ? 'page' : undefined"
                            :to="{ query: { ...route.query, view: 'list' } }"
                            >도시 목록</RouterLink
                        >
                        <RouterLink
                            class="legacy-button"
                            :aria-current="cityView === 'map' ? 'page' : undefined"
                            :to="{ query: { ...route.query, view: 'map' } }"
                            >도시 지도</RouterLink
                        >
                    </nav>
                    <template v-if="cityMap && tab === 'cities' && cityView === 'map'">
                        <p>
                            지도는 선택 시점의 모든 국가 도시를 표시합니다. 도시를 눌러 상세와 주둔 장수를 확인하세요.
                        </p>
                        <p v-if="!cityMap.collected">선택한 시점의 표본이 없습니다.</p>
                        <p v-else-if="cityMap.unmappedCityIds.length">
                            지도 위치가 없는 도시: {{ cityMap.unmappedCityIds.join(', ') }}. 도시 목록에서 조회할 수
                            있습니다.
                        </p>
                        <MapViewer
                            v-if="cityMap.map"
                            :map-data="cityMap.map"
                            :map-layout="cityMap.layout"
                            :loading="loading"
                            :selected-city-id="selectedCity"
                            :detail-mode="false"
                            fit-container
                            :show-current-city-marker="false"
                            @select-city="selectCity"
                        />
                    </template>
                    <template v-if="cities && tab === 'cities'">
                        <p v-if="!cities.collected">선택한 시점의 표본이 없습니다.</p>
                        <p v-else-if="!cities.items.length">조건에 맞는 도시가 없습니다.</p>
                        <div v-else class="table-scroll" tabindex="0" aria-label="도시 목록">
                            <table>
                                <thead>
                                    <tr>
                                        <th>도시</th>
                                        <th>국가</th>
                                        <th>인구</th>
                                        <th>내정 (현재 / 최대)</th>
                                        <th>주둔 장수</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="city in cities.items" :key="city.id">
                                        <th scope="row">
                                            <button class="legacy-button" @click="selectCity(city.id)">
                                                {{ city.name }} (#{{ city.id }})
                                            </button>
                                        </th>
                                        <td>{{ nationName(city.nationId) }}</td>
                                        <td>{{ format(city.population) }} / {{ format(city.populationMax) }}</td>
                                        <td>
                                            <details>
                                                <summary>내정 보기</summary>
                                                <p>
                                                    농업 {{ city.agriculture }} / {{ city.agricultureMax }} · 상업
                                                    {{ city.commerce }} / {{ city.commerceMax }}
                                                </p>
                                                <p>
                                                    치안 {{ city.security }} / {{ city.securityMax }} · 성벽
                                                    {{ city.wall }} / {{ city.wallMax }} · 수비 {{ city.defence }} /
                                                    {{ city.defenceMax }}
                                                </p>
                                                <p>
                                                    민심 {{ city.trust }} · 보급 {{ city.supplyState }} · 전방
                                                    {{ city.frontState }} · 상태 {{ city.state }} · 규모
                                                    {{ city.level }}
                                                </p>
                                            </details>
                                        </td>
                                        <td>
                                            <button
                                                class="legacy-button"
                                                type="button"
                                                :disabled="loading"
                                                @click="showCityGenerals(city.id)"
                                            >
                                                모든 국가의 주둔 장수
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                    <button
                        class="legacy-button"
                        v-if="result?.nextCursor != null"
                        type="button"
                        :disabled="loading"
                        @click="load(true)"
                    >
                        다음 50개 불러오기
                    </button>
                    <button
                        class="legacy-button"
                        v-if="error && authorized"
                        type="button"
                        :disabled="loading"
                        @click="refresh"
                    >
                        다시 조회
                    </button>
                </PanelCard>
            </section>
            <aside ref="inspector" class="audit-inspector" tabindex="-1" aria-label="선택한 대상 상세">
                <PanelCard v-if="selectedGeneral === null && selectedCity === null" title="대상 상세">
                    <p>장수나 도시 이름을 누르면 이곳에 상세 정보가 표시됩니다.</p>
                    <p v-if="nationId">선택 국가: {{ nationName(Number(nationId)) }}</p>
                    <RouterLink class="legacy-button" :to="menuTarget('generals')">선택 국가 장수 보기</RouterLink>
                </PanelCard>
                <AuditGeneralDetail
                    v-if="authorized && selectedGeneral !== null"
                    :general-id="selectedGeneral"
                    :at="selectedAt"
                    @close="closeGeneral"
                />
                <AuditCityDetail
                    v-if="authorized && selectedCity !== null"
                    :city-id="selectedCity"
                    :at="selectedAt"
                    @close="closeCity"
                    @generals="showCityGenerals"
                />
            </aside>
        </div>
    </main>
</template>

<style scoped>
.audit-workspace {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
}
.audit-sidebar,
.audit-content,
.audit-inspector {
    min-width: 0;
}
.audit-content {
    display: grid;
    gap: 12px;
}
.audit-sidebar,
.audit-inspector {
    position: sticky;
    top: 12px;
    max-height: calc(100vh - 24px);
    overflow: auto;
}
.audit-sidebar {
    padding: 10px;
    border: 1px solid #536b60;
    border-radius: 6px;
    background: #14231c;
}
.audit-inspector:focus-visible {
    outline: 2px solid #d1e6a1;
    outline-offset: 2px;
}
.nation-browser {
    display: grid;
    gap: 6px;
}
.nation-browser h2 {
    margin: 8px 0;
    font-size: var(--sammo-font-size-emphasis);
}
.nation-browser input {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 6px;
    background: #000;
    color: #fff;
    border: 1px solid #91a39a;
}
.nation-choice {
    text-align: left;
    overflow-wrap: anywhere;
}
.nation-browser [aria-pressed='true'],
.selected-row {
    background: #254e3c;
    border-color: #b6d6c2;
}
.period-shortcuts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}
.selected-nation {
    flex-basis: 100%;
    margin: 0;
    font-weight: bold;
}
@media (min-width: 1200px) {
    .audit-sidebar .menu-row {
        flex-direction: column;
    }
}
@media (max-width: 1199px) {
    .audit-workspace {
        grid-template-columns: 180px minmax(0, 1fr);
    }
    .audit-inspector {
        grid-column: 2;
        position: static;
        max-height: none;
    }
}
@media (max-width: 700px) {
    .audit-workspace {
        grid-template-columns: minmax(0, 1fr);
    }
    .audit-sidebar,
    .audit-inspector {
        position: static;
        max-height: none;
        grid-column: 1;
    }
    .nation-browser {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .nation-browser h2,
    .nation-browser input {
        grid-column: 1 / -1;
    }
}

.audit-page {
    max-width: 1920px;
    margin: 0 auto;
    padding: 8px;
    display: grid;
    gap: 12px;
}
.audit-page :deep(.panel-card) {
    min-width: 0;
}
.audit-navigation {
    display: grid;
    gap: 8px;
    margin: 12px 0;
}
.menu-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.menu-row a {
    padding: 6px 12px;
    text-decoration: none;
}
.menu-row .selected {
    background: #254e3c;
    border-color: #b6d6c2;
    color: #fff;
}
.menu-row a:focus-visible {
    outline: 2px solid #d1e6a1;
    outline-offset: 2px;
}
.secondary-menu {
    padding-top: 8px;
    border-top: 1px solid #536b60;
}
.filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
}
.filters label {
    display: grid;
    gap: 4px;
    max-width: 100%;
}
.filters input {
    width: 100px;
    padding: 2px 4px;
    border: 1px solid #91a39a;
    background: #000;
    color: #fff;
}
.filters select {
    max-width: 100%;
}
.table-scroll {
    overflow-x: auto;
}
table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
}
th,
td {
    border: 1px solid gray;
    padding: 6px;
    text-align: left;
}
details {
    min-width: 120px;
    max-width: 300px;
}
summary {
    cursor: pointer;
}
[role='alert'] {
    color: #ffb9b9;
}
button,
select,
input {
    font: inherit;
}
</style>
