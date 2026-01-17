<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import { formatOfficerLevelText } from '../utils/nationFormat';

type GeneralListResponse = Awaited<ReturnType<typeof trpc.nation.getGeneralList.query>>;

type GeneralEntry = GeneralListResponse['generals'][number];

type SortKey =
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15;

const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: 1, label: '관직' },
    { key: 2, label: '공헌' },
    { key: 3, label: '경험' },
    { key: 4, label: '통솔' },
    { key: 5, label: '무력' },
    { key: 6, label: '지력' },
    { key: 7, label: '자금' },
    { key: 8, label: '군량' },
    { key: 9, label: '병사' },
    { key: 10, label: '벌점' },
    { key: 11, label: '성격' },
    { key: 12, label: '내특' },
    { key: 13, label: '전특' },
    { key: 14, label: '사관' },
    { key: 15, label: 'NPC' },
];

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<GeneralListResponse | null>(null);
const sortKey = ref<SortKey>(1);
const filterText = ref('');

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const loadGenerals = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        data.value = await trpc.nation.getGeneralList.query();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const sortGenerals = (list: GeneralEntry[]): GeneralEntry[] => {
    const key = sortKey.value;
    const sorted = [...list].sort((lhs, rhs) => {
        switch (key) {
            case 1:
                return rhs.officerLevel - lhs.officerLevel;
            case 2:
                return rhs.dedication - lhs.dedication;
            case 3:
                return rhs.experience - lhs.experience;
            case 4:
                return rhs.stats.leadership - lhs.stats.leadership;
            case 5:
                return rhs.stats.strength - lhs.stats.strength;
            case 6:
                return rhs.stats.intelligence - lhs.stats.intelligence;
            case 7:
                return rhs.gold - lhs.gold;
            case 8:
                return rhs.rice - lhs.rice;
            case 9:
                return rhs.crew - lhs.crew;
            case 10:
                return 0;
            case 11:
                return (lhs.personality?.name ?? '').localeCompare(rhs.personality?.name ?? '');
            case 12:
                return (lhs.specialDomestic?.name ?? '').localeCompare(rhs.specialDomestic?.name ?? '');
            case 13:
                return (lhs.specialWar?.name ?? '').localeCompare(rhs.specialWar?.name ?? '');
            case 14:
                return rhs.belong - lhs.belong;
            case 15:
                return rhs.npcState - lhs.npcState;
            default:
                return 0;
        }
    });

    if (key === 11 || key === 12 || key === 13) {
        return sorted;
    }

    return sorted;
};

const filteredGenerals = computed(() => {
    const list = data.value?.generals ?? [];
    const keyword = filterText.value.trim().toLowerCase();
    const filtered = keyword
        ? list.filter((general) => {
              return (
                  general.name.toLowerCase().includes(keyword) ||
                  (general.cityName ?? '').toLowerCase().includes(keyword) ||
                  (general.officerCityName ?? '').toLowerCase().includes(keyword)
              );
          })
        : list;

    return sortGenerals(filtered);
});

const nationLevel = computed(() => data.value?.nation.level ?? 0);

const formatSpecial = (general: GeneralEntry): string => {
    const domestic = general.specialDomestic?.name ?? '-';
    const war = general.specialWar?.name ?? '-';
    return `${domestic} / ${war}`;
};

onMounted(() => {
    void loadGenerals();
});
</script>

<template>
    <main class="nation-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">세력 장수</h1>
                <p class="page-subtitle">세력 내 장수 현황 및 정렬</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <RouterLink class="ghost" to="/nation/cities">세력 도시</RouterLink>
                <RouterLink class="ghost" to="/nation/personnel">인사부</RouterLink>
                <button class="ghost" @click="loadGenerals">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <PanelCard title="세력 장수 목록" subtitle="국가 소속 장수들을 확인합니다.">
            <template #actions>
                <div class="toolbar-actions">
                    <select v-model.number="sortKey" class="select-input">
                        <option v-for="option in sortOptions" :key="option.key" :value="option.key">
                            {{ option.label }}
                        </option>
                    </select>
                    <input v-model="filterText" class="filter-input" placeholder="이름/도시 검색" />
                </div>
            </template>

            <div class="list-meta">총 {{ filteredGenerals.length }}명</div>

            <SkeletonLines v-if="loading" :lines="6" />
            <div v-else class="table-scroll">
                <table class="nation-table">
                    <thead>
                        <tr>
                            <th>이름</th>
                            <th>관직</th>
                            <th>공헌</th>
                            <th>경험</th>
                            <th>통솔</th>
                            <th>무력</th>
                            <th>지력</th>
                            <th>자금</th>
                            <th>군량</th>
                            <th>병사</th>
                            <th>성격</th>
                            <th>특기</th>
                            <th>사관</th>
                            <th>현재 도시</th>
                            <th>관직 도시</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="general in filteredGenerals" :key="general.id">
                            <td>
                                <span v-if="general.npcState > 0" class="npc-tag">NPC</span>
                                {{ general.name }}
                            </td>
                            <td>{{ formatOfficerLevelText(general.officerLevel, nationLevel) }}</td>
                            <td>{{ general.dedication }}</td>
                            <td>{{ general.experience }}</td>
                            <td>{{ general.stats.leadership }}</td>
                            <td>{{ general.stats.strength }}</td>
                            <td>{{ general.stats.intelligence }}</td>
                            <td>{{ general.gold }}</td>
                            <td>{{ general.rice }}</td>
                            <td>{{ general.crew }}</td>
                            <td>{{ general.personality?.name ?? '-' }}</td>
                            <td>{{ formatSpecial(general) }}</td>
                            <td>{{ general.belong > 0 ? general.belong : '-' }}</td>
                            <td>{{ general.cityName ?? '-' }}</td>
                            <td>{{ general.officerCityName ?? '-' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
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

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.toolbar-actions {
    display: flex;
    align-items: center;
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
    margin-bottom: 8px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.table-scroll {
    overflow-x: auto;
    max-height: 70vh;
    overflow-y: auto;
}

.nation-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
}

.nation-table th,
.nation-table td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.2);
    text-align: left;
    white-space: nowrap;
}

.nation-table thead th {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.npc-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    padding: 2px 4px;
    margin-right: 6px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: rgba(232, 221, 196, 0.8);
}
</style>
