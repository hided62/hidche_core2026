<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import LegacyGeneralProgress from '../components/ui/LegacyGeneralProgress.vue';
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

const formatGeneralLabel = (general: GeneralEntry): string => {
    const name = general.officerLevel > 4 ? `*${general.name}*` : general.name;
    const time = formatServerDateTime(general.turnTime, { format: 'hourMinute', fallback: '--:--' });
    if (orderBy.value === 'recentWar') {
        return `${name} (${formatServerDateTime(general.recentWar, { format: 'hourMinute', fallback: '--:--' })})`;
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
            const formatted = response.logs.map((entry) => {
                const eventTime =
                    response.type === 'generalAction'
                        ? ` ${formatServerDateTime(entry.createdAt, { format: 'hourMinute' })}`
                        : '';
                return {
                    id: entry.id,
                    html: formatLog(`${entry.text}${eventTime}`),
                };
            });
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
    <main class="ref-shell battle-page">
        <header class="battle-top legacy-bg0">
            <RouterLink v-slot="{ navigate }" custom to="/">
                <button class="battle-nav" type="button" @click="navigate">창 닫기</button>
            </RouterLink>
            <button class="battle-nav" @click="loadBattleCenter">갱신</button>
            <h1>감찰부</h1>
            <div></div>
            <div></div>
        </header>

        <div v-if="error" class="ref-feedback ref-feedback--error" role="alert">{{ error }}</div>

        <section class="layout-grid">
            <div class="stack">
                <PanelCard title="대상 선택" subtitle="정렬 기준과 장수를 선택합니다.">
                    <div class="selector-row">
                        <button class="ref-shell__control" @click="changeTargetByOffset(-1)">◀ 이전</button>
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
                        <button class="ref-shell__control" @click="changeTargetByOffset(1)">다음 ▶</button>
                    </div>
                </PanelCard>

                <PanelCard title="장수 정보">
                    <GeneralBasicCard
                        class="battle-general-card"
                        :general="selectedGeneral"
                        :loading="loading"
                        :nation-color="data?.nation.color"
                    >
                        <template v-if="selectedGeneral" #details>
                            <div class="battle-general-extra">
                                <span>명성</span
                                ><strong>{{ selectedGeneral.experience.toLocaleString('ko-KR') }}</strong>
                                <span>계급</span><strong>{{ selectedGeneral.progression.dedicationText }}</strong>
                                <span>전투</span><strong>{{ selectedGeneral.warnum }}회</strong> <span>승리</span
                                ><strong>{{ selectedGeneral.battleStats.kills }}</strong> <span>패배</span
                                ><strong>{{ selectedGeneral.battleStats.deaths }}</strong> <span>계략</span
                                ><strong>{{ selectedGeneral.battleStats.fire }}</strong> <span>사살</span
                                ><strong>{{ selectedGeneral.battleStats.killCrew.toLocaleString('ko-KR') }}</strong>
                                <span>피살</span
                                ><strong>{{ selectedGeneral.battleStats.deathCrew.toLocaleString('ko-KR') }}</strong>
                                <span>최근 전투</span><strong>{{ selectedGeneral.recentWar || '-' }}</strong>
                            </div>
                            <LegacyGeneralProgress :general="selectedGeneral" :show-primary="false" />
                        </template>
                    </GeneralBasicCard>
                    <div v-if="selectedGeneral" class="general-meta">
                        <div>
                            최근 턴:
                            {{
                                formatServerDateTime(selectedGeneral.turnTime, { format: 'hourMinute', fallback: '-' })
                            }}
                        </div>
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
                                <div v-for="entry in logs[type]" :key="entry.id" class="log-line" v-html="entry.html" />
                            </template>
                        </div>
                    </div>
                </PanelCard>
            </div>
        </section>
        <footer class="battle-footer legacy-bg0">
            <RouterLink v-slot="{ navigate }" custom to="/">
                <button class="battle-nav" type="button" @click="navigate">창 닫기</button>
            </RouterLink>
        </footer>
    </main>
</template>

<style scoped>
.layout-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
}

.stack {
    display: contents;
}

.selector-row {
    display: grid;
    grid-template-columns: 8.333% 33.333% 50% 8.333%;
    gap: 0;
    align-items: center;
}

.select-input {
    min-width: 0;
    height: 36px;
    padding: 4px 6px;
    border: 1px solid #777;
    border-radius: 0;
    background: #303030;
    color: inherit;
    font: inherit;
}

.general-meta {
    margin: 0;
    padding: 6px 8px;
    color: #ccc;
    display: grid;
    gap: 4px;
}

.battle-general-extra {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
}

.battle-general-extra > * {
    min-height: 24px;
    box-sizing: border-box;
    border-right: 1px solid #777;
    border-bottom: 1px solid #777;
    padding: 2px 5px;
}

.battle-general-extra > span {
    background-color: rgb(20 75 42 / 70%);
    text-align: center;
}

.battle-general-extra > strong {
    overflow: hidden;
    font-weight: 500;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.log-grid {
    display: contents;
}

.log-block {
    border: 1px solid #666;
    padding: 0;
    background: #000;
    min-height: 0;
}

.log-title {
    min-height: 34px;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #666;
    color: orange;
    background: #000;
    font-size: 1.3em;
    font-weight: 500;
}

.log-line {
    padding: 2px 8px;
    border-bottom: 0;
}

.log-line :deep(.hidden_but_copyable) {
    color: transparent !important;
    font-size: 0;
}

.empty {
    padding: 2px 8px;
    color: #999;
}

/* PanelCard is retained as a data wrapper, but its presentation follows the
   flat bootstrap rows used by the reference page. */
:deep(.panel-card) {
    height: 100%;
    border: 1px solid #666;
    border-radius: 0;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
    box-shadow: none;
}
.stack:first-child :deep(.panel-card:first-child) {
    grid-column: 1 / -1;
    border: 0;
}
.stack:first-child :deep(.panel-card:first-child .panel-header) {
    display: none;
}
.stack:first-child :deep(.panel-card:first-child .panel-body) {
    padding: 0;
}
.stack:nth-child(2) :deep(.panel-card),
.stack:nth-child(2) :deep(.panel-body) {
    display: contents;
}
.stack:nth-child(2) :deep(.panel-header) {
    display: none;
}
:deep(.panel-header) {
    min-height: 29px;
    justify-content: center;
    padding: 0;
}
:deep(.panel-title) {
    color: skyblue;
    font-size: 18px;
    font-weight: 500;
}
:deep(.panel-header),
.log-title {
    background-image: var(--sammo-texture-green);
}

@media (max-width: 991px) {
    .layout-grid {
        grid-template-columns: 1fr;
    }

    .selector-row {
        grid-template-columns: 16.666% 25% 41.666% 16.666%;
    }

    .log-grid {
        grid-template-columns: 1fr;
    }
}

.battle-page {
    box-sizing: border-box;
    width: 1000px;
    min-height: 0;
    margin: 0 auto;
    padding: 0;
    gap: 0;
    height: 1268px;
    overflow: hidden;
}
.battle-top {
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
}
.battle-top h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 400;
    line-height: 32px;
    text-align: center;
}
.battle-nav {
    box-sizing: border-box;
    height: 32px;
    margin-right: 2px;
    border: 0;
    border-radius: 3px;
    display: grid;
    place-items: center;
    background: #00582c;
    color: #fff;
    font: inherit;
    font-weight: 700;
    text-decoration: none;
}
.battle-footer {
    padding-top: 20px;
}
.battle-footer .battle-nav {
    width: 60px;
}
@media (max-width: 991px) {
    .battle-page {
        width: 500px;
        height: 1411px;
    }
    .battle-top {
        grid-template-columns: 89px 89px 1fr 0 0;
    }
}
</style>
