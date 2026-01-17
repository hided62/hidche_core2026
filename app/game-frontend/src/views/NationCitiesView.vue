<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import { cityLevelMap, regionMap } from '../utils/nationFormat';

type CityOverviewResponse = Awaited<ReturnType<typeof trpc.nation.getCityOverview.query>>;

type CityEntry = CityOverviewResponse['cities'][number];
type GeneralEntry = CityOverviewResponse['generals'][number];

type CitySortKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

type OfficerLevel = 2 | 3 | 4;

const officerLabels: Record<OfficerLevel, string> = {
    4: '태수',
    3: '군사',
    2: '종사',
};

const officerLevels: OfficerLevel[] = [4, 3, 2];

const sortOptions: Array<{ key: CitySortKey; label: string }> = [
    { key: 1, label: '기본' },
    { key: 2, label: '인구' },
    { key: 3, label: '인구율' },
    { key: 4, label: '민심' },
    { key: 5, label: '농업' },
    { key: 6, label: '상업' },
    { key: 7, label: '치안' },
    { key: 8, label: '수비' },
    { key: 9, label: '성벽' },
    { key: 10, label: '시세' },
    { key: 11, label: '지역' },
    { key: 12, label: '규모' },
];

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<CityOverviewResponse | null>(null);
const sortKey = ref<CitySortKey>(1);
const filterText = ref('');
const showAppointment = ref(false);
const appointmentDraft = reactive<Record<number, Record<number, number>>>({});

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const loadCities = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        data.value = await trpc.nation.getCityOverview.query();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const cityNameMap = computed(() => {
    const map = new Map<number, string>();
    if (data.value) {
        for (const city of data.value.cities) {
            map.set(city.id, city.name);
        }
    }
    return map;
});

const generalMap = computed(() => {
    const map = new Map<number, GeneralEntry>();
    for (const general of data.value?.generals ?? []) {
        map.set(general.id, general);
    }
    return map;
});

const generalsByCity = computed(() => {
    const map = new Map<number, GeneralEntry[]>();
    for (const general of data.value?.generals ?? []) {
        if (!map.has(general.cityId)) {
            map.set(general.cityId, []);
        }
        map.get(general.cityId)?.push(general);
    }
    return map;
});

const canAppoint = computed(() => (data.value?.me.officerLevel ?? 0) >= 5);

const candidatesByLevel = computed(() => {
    const minStat = data.value?.chiefStatMin ?? 0;
    const base = (data.value?.generals ?? []).filter((general) => general.officerLevel !== 12);
    return {
        4: base.filter((general) => general.stats.strength >= minStat),
        3: base.filter((general) => general.stats.intelligence >= minStat),
        2: base,
    } as Record<OfficerLevel, GeneralEntry[]>;
});

const formatCandidateLabel = (general: GeneralEntry): string => {
    const cityName = cityNameMap.value.get(general.cityId);
    const role = general.officerLevel >= 5 ? '수뇌' : general.officerLevel >= 2 ? '관직' : '일반';
    return `${general.name}${cityName ? ` (${cityName})` : ''} · ${role}`;
};

const ensureDraft = (cityId: number, level: OfficerLevel, defaultValue: number) => {
    if (!appointmentDraft[cityId]) {
        appointmentDraft[cityId] = { 2: 0, 3: 0, 4: 0 };
    }
    if (appointmentDraft[cityId][level] === undefined) {
        appointmentDraft[cityId][level] = defaultValue;
    }
};

const resetDrafts = (cities: CityEntry[]) => {
    for (const key of Object.keys(appointmentDraft)) {
        delete appointmentDraft[Number(key)];
    }
    for (const city of cities) {
        appointmentDraft[city.id] = {
            2: city.officers[2]?.id ?? 0,
            3: city.officers[3]?.id ?? 0,
            4: city.officers[4]?.id ?? 0,
        };
    }
};

watch(
    () => data.value,
    (value) => {
        if (value) {
            resetDrafts(value.cities);
        }
    }
);

const sortedCities = computed(() => {
    const list = data.value?.cities ?? [];
    const keyword = filterText.value.trim();
    const filtered = keyword
        ? list.filter((city) => city.name.includes(keyword))
        : list;

    return [...filtered].sort((lhs, rhs) => {
        switch (sortKey.value) {
            case 2:
                return rhs.population - lhs.population;
            case 3:
                return rhs.population / rhs.populationMax - lhs.population / lhs.populationMax;
            case 4:
                return rhs.trust - lhs.trust;
            case 5:
                return rhs.agriculture - lhs.agriculture;
            case 6:
                return rhs.commerce - lhs.commerce;
            case 7:
                return rhs.security - lhs.security;
            case 8:
                return rhs.defence - lhs.defence;
            case 9:
                return rhs.wall - lhs.wall;
            case 10:
                return rhs.trade - lhs.trade;
            case 11: {
                const regionCmp = lhs.region - rhs.region;
                if (regionCmp !== 0) {
                    return regionCmp;
                }
                return rhs.level - lhs.level;
            }
            case 12: {
                const levelCmp = rhs.level - lhs.level;
                if (levelCmp !== 0) {
                    return levelCmp;
                }
                return lhs.region - rhs.region;
            }
            default:
                return lhs.id - rhs.id;
        }
    });
});

const formatPercent = (value: number, max: number): string => {
    if (!max) {
        return '-';
    }
    return `${((value / max) * 100).toFixed(1)}%`;
};

const formatNumber = (value: number): string => new Intl.NumberFormat('ko-KR').format(value);

const resolveOfficerName = (officer: CityEntry['officers'][OfficerLevel]): string => {
    if (!officer) {
        return '-';
    }
    if (officer.cityName) {
        return `${officer.name} (${officer.cityName})`;
    }
    return officer.name;
};

const appointOfficer = async (cityId: number, officerLevel: OfficerLevel) => {
    if (!data.value) {
        return;
    }
    const city = data.value.cities.find((entry) => entry.id === cityId);
    if (!city) {
        return;
    }
    const destGeneralId = appointmentDraft[cityId]?.[officerLevel] ?? 0;
    const general = generalMap.value.get(destGeneralId);
    const officerLabel = officerLabels[officerLevel];
    const targetName = destGeneralId === 0 ? '공석' : general?.name ?? '알 수 없음';
    const message =
        destGeneralId === 0
            ? `${city.name} ${officerLabel} 자리를 비우시겠습니까?`
            : `${targetName}을(를) ${city.name} ${officerLabel}로 임명하시겠습니까?`;

    if (!window.confirm(message)) {
        return;
    }

    try {
        await trpc.nation.appoint.mutate({
            destGeneralId,
            destCityId: cityId,
            officerLevel,
        });
        await loadCities();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

onMounted(() => {
    void loadCities();
});
</script>

<template>
    <main class="nation-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">세력 도시</h1>
                <p class="page-subtitle">세력 도시 현황과 관직 배치를 확인합니다.</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <RouterLink class="ghost" to="/nation/generals">세력 장수</RouterLink>
                <RouterLink class="ghost" to="/nation/personnel">인사부</RouterLink>
                <button class="ghost" @click="loadCities">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <PanelCard title="세력 도시 목록" subtitle="도시별 개발 상태 및 관직 현황">
            <template #actions>
                <div class="toolbar-actions">
                    <select v-model.number="sortKey" class="select-input">
                        <option v-for="option in sortOptions" :key="option.key" :value="option.key">
                            {{ option.label }}
                        </option>
                    </select>
                    <input v-model="filterText" class="filter-input" placeholder="도시 검색" />
                    <button
                        v-if="canAppoint"
                        class="ghost"
                        :class="{ active: showAppointment }"
                        @click="showAppointment = !showAppointment"
                    >
                        관직 임명 모드
                    </button>
                </div>
            </template>

            <div class="list-meta">
                총 {{ sortedCities.length }}개 도시 · 관직 최소 능력 {{ data?.chiefStatMin ?? '-' }}
            </div>

            <SkeletonLines v-if="loading" :lines="8" />
            <section v-else class="city-grid">
                <article v-for="city in sortedCities" :key="city.id" class="city-card">
                    <div class="city-header">
                        <div>
                            <div class="city-title">
                                {{ city.name }}
                                <span v-if="data?.nation.capitalCityId === city.id" class="capital-tag">수도</span>
                            </div>
                            <div class="city-meta">
                                {{ regionMap[city.region] ?? '미지' }} · {{ cityLevelMap[city.level] ?? '-' }} 규모
                            </div>
                        </div>
                        <div class="city-meta">시세 {{ city.trade }}%</div>
                    </div>

                    <div class="city-stats">
                        <div>
                            주민 {{ city.population }}/{{ city.populationMax }}
                            <span class="muted">({{ formatPercent(city.population, city.populationMax) }})</span>
                        </div>
                        <div>농업 {{ city.agriculture }}/{{ city.agricultureMax }}</div>
                        <div>상업 {{ city.commerce }}/{{ city.commerceMax }}</div>
                        <div>치안 {{ city.security }}/{{ city.securityMax }}</div>
                        <div>수비 {{ city.defence }}/{{ city.defenceMax }}</div>
                        <div>성벽 {{ city.wall }}/{{ city.wallMax }}</div>
                        <div>민심 {{ city.trust }}</div>
                    </div>

                    <div class="city-incomes">
                        <div>자금 수입 {{ formatNumber(city.incomes.gold) }}</div>
                        <div>군량 수입 {{ formatNumber(city.incomes.rice) }}</div>
                        <div>둔전 수입 {{ formatNumber(city.incomes.wall) }}</div>
                    </div>

                    <div class="city-officers">
                        <div>
                            <span class="officer-label">태수</span>
                            {{ resolveOfficerName(city.officers[4]) }}
                        </div>
                        <div>
                            <span class="officer-label">군사</span>
                            {{ resolveOfficerName(city.officers[3]) }}
                        </div>
                        <div>
                            <span class="officer-label">종사</span>
                            {{ resolveOfficerName(city.officers[2]) }}
                        </div>
                    </div>

                    <div v-if="showAppointment && canAppoint" class="city-appoint">
                        <div v-for="level in officerLevels" :key="level" class="appoint-row">
                            <span class="officer-label">{{ officerLabels[level] }}</span>
                            <select
                                v-model.number="appointmentDraft[city.id][level]"
                                class="select-input"
                                @focus="ensureDraft(city.id, level, city.officers[level]?.id ?? 0)"
                            >
                                <option :value="0">공석</option>
                                <option
                                    v-for="candidate in candidatesByLevel[level]"
                                    :key="candidate.id"
                                    :value="candidate.id"
                                >
                                    {{ formatCandidateLabel(candidate) }}
                                </option>
                            </select>
                            <button class="ghost" @click="appointOfficer(city.id, level)">임명</button>
                        </div>
                    </div>

                    <div class="city-generals">
                        <div class="muted">장수</div>
                        <div class="general-tags">
                            <span
                                v-for="general in generalsByCity.get(city.id) ?? []"
                                :key="general.id"
                                class="general-tag"
                            >
                                <span v-if="general.npcState > 0" class="npc-tag">NPC</span>
                                {{ general.name }}
                            </span>
                            <span v-if="(generalsByCity.get(city.id) ?? []).length === 0" class="muted">-</span>
                        </div>
                    </div>
                </article>
            </section>
        </PanelCard>
    </main>
</template>

<style scoped>
.nation-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.page-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
    padding-bottom: 12px;
}

.page-title {
    font-size: 1.6rem;
    font-weight: 600;
}

.page-subtitle {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
    cursor: pointer;
    text-decoration: none;
    color: inherit;
    background: rgba(16, 16, 16, 0.6);
}

.ghost.active {
    background: rgba(201, 164, 90, 0.2);
}

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.toolbar-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.select-input {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.8);
    color: rgba(232, 221, 196, 0.9);
    padding: 6px 8px;
    font-size: 0.75rem;
}

.filter-input {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.8);
    color: rgba(232, 221, 196, 0.9);
    padding: 6px 8px;
    font-size: 0.75rem;
}

.list-meta {
    margin-bottom: 12px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.city-grid {
    display: grid;
    gap: 12px;
}

.city-card {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 12px;
    background: rgba(12, 12, 12, 0.75);
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.city-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
}

.city-title {
    font-size: 1rem;
    font-weight: 600;
}

.city-meta {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.capital-tag {
    margin-left: 6px;
    font-size: 0.65rem;
    padding: 2px 6px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: rgba(232, 221, 196, 0.8);
}

.city-stats,
.city-incomes,
.city-officers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 6px;
    font-size: 0.8rem;
}

.city-incomes {
    padding-top: 6px;
    border-top: 1px solid rgba(201, 164, 90, 0.2);
}

.city-officers {
    border-top: 1px solid rgba(201, 164, 90, 0.2);
    padding-top: 6px;
}

.officer-label {
    font-weight: 600;
    margin-right: 6px;
}

.city-appoint {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px dashed rgba(201, 164, 90, 0.2);
    padding-top: 8px;
}

.appoint-row {
    display: grid;
    grid-template-columns: 60px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
}

.city-generals {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.general-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.general-tag {
    padding: 3px 6px;
    border: 1px solid rgba(201, 164, 90, 0.3);
    font-size: 0.75rem;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.npc-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    padding: 1px 3px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: rgba(232, 221, 196, 0.8);
}

.muted {
    color: rgba(232, 221, 196, 0.6);
}
</style>
