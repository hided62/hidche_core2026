<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import GeneralBasicCard from '../components/main/GeneralBasicCard.vue';
import { trpc } from '../utils/trpc';
import { getNpcColor } from '../utils/npcColor';
import { formatLog } from '../utils/formatLog';

type BattleCenterResponse = Awaited<ReturnType<typeof trpc.nation.getBattleCenter.query>>;
type GeneralEntry = BattleCenterResponse['generals'][number];

type LogType = 'generalHistory' | 'battleResult' | 'battleDetail' | 'generalAction';
type LogLine = { id: number; html: string };

const logTypes: LogType[] = ['generalHistory', 'battleDetail', 'battleResult', 'generalAction'];

const logLabels: Record<LogType, string> = {
    generalHistory: '장수 열전',
    battleDetail: '전투 기록',
    battleResult: '전투 결과',
    generalAction: '개인 기록',
};

const orderOptions = [
    { key: 'recentWar', label: '최근 전투' },
    { key: 'warnum', label: '전투 횟수' },
    { key: 'turnTime', label: '최근 턴' },
    { key: 'name', label: '이름' },
] as const;

type OrderKey = (typeof orderOptions)[number]['key'];

const loading = ref(false);
const logLoading = ref(false);
const error = ref<string | null>(null);
const data = ref<BattleCenterResponse | null>(null);

const orderBy = ref<OrderKey>('turnTime');
const selectedGeneralId = ref<number>(0);

const logs = reactive<Record<LogType, LogLine[]>>({
    generalHistory: [],
    battleDetail: [],
    battleResult: [],
    generalAction: [],
});

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const parseGeneralId = (value: unknown): number => {
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return 0;
};

const route = useRoute();

const loadBattleCenter = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        data.value = await trpc.nation.getBattleCenter.query();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const orderedGenerals = computed(() => {
    const list = data.value?.generals ?? [];
    const key = orderBy.value;

    const sorted = [...list].sort((lhs, rhs) => {
        switch (key) {
            case 'recentWar': {
                const lhsVal = lhs.recentWar ?? '';
                const rhsVal = rhs.recentWar ?? '';
                return rhsVal.localeCompare(lhsVal);
            }
            case 'warnum':
                return rhs.warnum - lhs.warnum;
            case 'name': {
                const lhsVal = `${lhs.npcState}${lhs.name}`;
                const rhsVal = `${rhs.npcState}${rhs.name}`;
                return lhsVal.localeCompare(rhsVal);
            }
            case 'turnTime':
            default: {
                const lhsVal = lhs.turnTime ?? '';
                const rhsVal = rhs.turnTime ?? '';
                return rhsVal.localeCompare(lhsVal);
            }
        }
    });

    return sorted;
});

const selectedGeneral = computed(() => {
    const list = data.value?.generals ?? [];
    return list.find((general) => general.id === selectedGeneralId.value) ?? null;
});

const statusLine = computed(() => {
    if (!data.value) {
        return '감찰부 정보를 불러오는 중';
    }
    return `${data.value.currentYear}년 ${data.value.currentMonth}월 · 턴 ${data.value.turnTermMinutes}분`;
});

const formatGeneralLabel = (general: GeneralEntry): string => {
    const name = general.officerLevel > 4 ? `*${general.name}*` : general.name;
    const time = general.turnTime ? general.turnTime.slice(-5) : '--:--';
    if (orderBy.value === 'recentWar') {
        return `${name} (${general.recentWar ? general.recentWar.slice(-5) : '--:--'})`;
    }
    if (orderBy.value === 'warnum') {
        return `${name} (${general.warnum}회)`;
    }
    return `${name} (${time})`;
};

let logRequestId = 0;

const loadLogs = async (generalId: number) => {
    if (!generalId) {
        return;
    }
    logLoading.value = true;
    const requestId = (logRequestId += 1);

    try {
        const responses = await Promise.all(
            logTypes.map((type) => trpc.nation.getGeneralLog.query({ generalId, type }))
        );
        if (requestId !== logRequestId || selectedGeneralId.value !== generalId) {
            return;
        }
        for (const response of responses) {
            const formatted = response.logs.map((entry) => ({
                id: entry.id,
                html: formatLog(entry.text),
            }));
            logs[response.type] = formatted;
        }
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        if (requestId === logRequestId) {
            logLoading.value = false;
        }
    }
};

const changeTargetByOffset = (offset: number) => {
    const list = orderedGenerals.value;
    if (!list.length || !selectedGeneralId.value) {
        return;
    }
    const index = list.findIndex((general) => general.id === selectedGeneralId.value);
    if (index < 0) {
        return;
    }
    let nextIndex = (index + offset) % list.length;
    if (nextIndex < 0) {
        nextIndex += list.length;
    }
    selectedGeneralId.value = list[nextIndex].id;
};

watch(
    () => orderedGenerals.value,
    (list) => {
        if (!list.length) {
            selectedGeneralId.value = 0;
            return;
        }
        if (!selectedGeneralId.value || !list.some((general) => general.id === selectedGeneralId.value)) {
            selectedGeneralId.value = list[0].id;
        }
    }
);

watch(
    () => selectedGeneralId.value,
    (generalId) => {
        if (generalId) {
            void loadLogs(generalId);
        }
    }
);

watch(
    () => route.query,
    (query) => {
        const queryId = parseGeneralId(query.generalId ?? query.gen);
        if (queryId) {
            selectedGeneralId.value = queryId;
        }
    },
    { immediate: true }
);

onMounted(() => {
    void loadBattleCenter();
});
</script>

<template>
    <main class="battle-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">감찰부</h1>
                <p class="page-subtitle">{{ statusLine }}</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <RouterLink class="ghost" to="/nation/finance">내무부</RouterLink>
                <button class="ghost" @click="loadBattleCenter">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <section class="layout-grid">
            <div class="stack">
                <PanelCard title="대상 선택" subtitle="정렬 기준과 장수를 선택합니다.">
                    <div class="selector-row">
                        <button class="ghost" @click="changeTargetByOffset(-1)">◀ 이전</button>
                        <select v-model="orderBy" class="select-input">
                            <option v-for="option in orderOptions" :key="option.key" :value="option.key">
                                {{ option.label }}
                            </option>
                        </select>
                        <select v-model.number="selectedGeneralId" class="select-input">
                            <option
                                v-for="general in orderedGenerals"
                                :key="general.id"
                                :value="general.id"
                                :style="{ color: getNpcColor(general.npcState) ?? undefined }"
                            >
                                {{ formatGeneralLabel(general) }}
                            </option>
                        </select>
                        <button class="ghost" @click="changeTargetByOffset(1)">다음 ▶</button>
                    </div>
                </PanelCard>

                <PanelCard title="장수 정보">
                    <GeneralBasicCard :general="selectedGeneral" :loading="loading" />
                    <div v-if="selectedGeneral" class="general-meta">
                        <div>최근 턴: {{ selectedGeneral.turnTime ? selectedGeneral.turnTime.slice(-5) : '-' }}</div>
                        <div>최근 전투: {{ selectedGeneral.recentWar || '-' }}</div>
                        <div>전투 횟수: {{ selectedGeneral.warnum }}</div>
                    </div>
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="장수 기록" subtitle="열전과 전투 기록">
                    <div class="log-grid">
                        <div v-for="type in logTypes" :key="type" class="log-block">
                            <div class="log-title">{{ logLabels[type] }}</div>
                            <SkeletonLines v-if="loading || logLoading" :lines="3" />
                            <template v-else>
                                <div v-if="logs[type].length === 0" class="empty">기록이 없습니다.</div>
                                <div
                                    v-for="entry in logs[type]"
                                    :key="entry.id"
                                    class="log-line"
                                    v-html="entry.html"
                                />
                            </template>
                        </div>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.battle-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.page-title {
    font-size: 1.6rem;
    font-weight: 700;
}

.page-subtitle {
    color: rgba(232, 221, 196, 0.7);
    margin-top: 6px;
}

.header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.layout-grid {
    display: grid;
    grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
    gap: 18px;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.selector-row {
    display: grid;
    grid-template-columns: auto minmax(140px, 1fr) minmax(180px, 2fr) auto;
    gap: 8px;
    align-items: center;
}

.select-input {
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(12, 12, 12, 0.7);
    color: inherit;
    font-size: 0.85rem;
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.5);
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    font-size: 0.8rem;
    cursor: pointer;
}

.general-meta {
    margin-top: 10px;
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.75);
    display: grid;
    gap: 4px;
}

.log-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
}

.log-block {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 8px;
    background: rgba(12, 12, 12, 0.6);
    min-height: 160px;
}

.log-title {
    font-weight: 600;
    margin-bottom: 6px;
    font-size: 0.9rem;
}

.log-line {
    padding: 4px 0;
    border-bottom: 1px dashed rgba(201, 164, 90, 0.2);
}

.log-line:last-child {
    border-bottom: none;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
    font-size: 0.85rem;
}

.error {
    color: #f08a5d;
    font-size: 0.9rem;
}

@media (max-width: 1024px) {
    .layout-grid {
        grid-template-columns: 1fr;
    }

    .selector-row {
        grid-template-columns: 1fr;
    }
}
</style>
