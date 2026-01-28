<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import GeneralBasicCard from '../components/main/GeneralBasicCard.vue';
import CityBasicCard from '../components/main/CityBasicCard.vue';
import NationBasicCard from '../components/main/NationBasicCard.vue';
import { trpc } from '../utils/trpc';
import { formatLog } from '../utils/formatLog';

const SCREEN_MODE_KEY = 'sammo-screen-mode';

type MyGeneralResponse = Awaited<ReturnType<typeof trpc.general.me.query>>;

type WorldStateSnapshot = {
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    config: Record<string, unknown>;
    meta: Record<string, unknown>;
} | null;

type LogType = 'generalHistory' | 'battleDetail' | 'battleResult' | 'generalAction';

type LogLine = {
    id: number;
    html: string;
};

type ItemSlotKey = 'horse' | 'weapon' | 'book' | 'item';

type ItemSlot = {
    key: ItemSlotKey;
    label: string;
    code: string | null;
};

const logTypes: LogType[] = ['generalHistory', 'battleDetail', 'battleResult', 'generalAction'];
const logLabels: Record<LogType, string> = {
    generalHistory: '장수 열전',
    battleDetail: '전투 기록',
    battleResult: '전투 결과',
    generalAction: '개인 기록',
};

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<MyGeneralResponse | null>(null);
const worldState = ref<WorldStateSnapshot>(null);

const logs = reactive<Record<LogType, LogLine[]>>({
    generalHistory: [],
    battleDetail: [],
    battleResult: [],
    generalAction: [],
});

const logLoading = reactive<Record<LogType, boolean>>({
    generalHistory: false,
    battleDetail: false,
    battleResult: false,
    generalAction: false,
});

const logHasMore = reactive<Record<LogType, boolean>>({
    generalHistory: true,
    battleDetail: true,
    battleResult: true,
    generalAction: true,
});

const activeLogTab = ref<LogType>('generalAction');
const isMobile = useMediaQuery('(max-width: 1024px)');
const screenMode = ref<'auto' | '500px' | '1000px'>('auto');

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const resolveNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const statusLine = computed(() => {
    if (!worldState.value) {
        return '내 정보를 불러오는 중';
    }

    const turnTerm = resolveNumber((worldState.value.config as Record<string, unknown>)?.turnTermMinutes, 0);
    const termLabel = turnTerm > 0 ? ` · 턴 ${turnTerm}분` : '';
    return `${worldState.value.currentYear}년 ${worldState.value.currentMonth}월${termLabel}`;
});

const itemSlots = computed<ItemSlot[]>(() => {
    const items = data.value?.general?.items;
    return [
        { key: 'horse', label: '말', code: items?.horse ?? null },
        { key: 'weapon', label: '무기', code: items?.weapon ?? null },
        { key: 'book', label: '서적', code: items?.book ?? null },
        { key: 'item', label: '아이템', code: items?.item ?? null },
    ];
});

const actionAvailability = computed(() => {
    const general = data.value?.general;
    const meta = (worldState.value?.meta ?? {}) as Record<string, unknown>;
    const config = (worldState.value?.config ?? {}) as Record<string, unknown>;
    const autorunUser = (meta.autorun_user ?? {}) as Record<string, unknown>;

    const turntime = meta.turntime ? new Date(String(meta.turntime)) : null;
    const opentime = meta.opentime ? new Date(String(meta.opentime)) : null;
    const preopen = Boolean(turntime && opentime && turntime.getTime() <= opentime.getTime());

    const npcMode = resolveNumber(config.npcMode, 0);

    return {
        canDieOnPrestart: Boolean(preopen && general && general.npcState === 0 && general.nationId === 0),
        canBuildNationCandidate: Boolean(preopen && general && general.nationId === 0),
        canVacation: !(autorunUser.limit_minutes ?? false),
        canInstantRetreat: Boolean(general && general.nationId > 0),
        canSelectOtherGeneral: Boolean(npcMode === 2 && general && general.npcState === 0),
    };
});

const loadLogs = async () => {
    if (!data.value?.general?.id) {
        return;
    }

    await Promise.all(
        logTypes.map((type) => loadLog(type))
    );
};

const loadLog = async (type: LogType, beforeId?: number) => {
    if (logLoading[type]) {
        return;
    }

    logLoading[type] = true;
    try {
        const response = await trpc.general.getMyLog.query({ type, beforeId });
        const formatted = response.logs.map((entry) => ({
            id: entry.id,
            html: formatLog(entry.text),
        }));

        if (beforeId) {
            logs[type].push(...formatted);
        } else {
            logs[type] = formatted;
        }

        logHasMore[type] = formatted.length >= 24;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        logLoading[type] = false;
    }
};

const loadMyPage = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        const general = await trpc.general.me.query();
        const world = await (trpc.world.getState.query as unknown as () => Promise<WorldStateSnapshot>)();
        data.value = general;
        worldState.value = world ?? null;
        await loadLogs();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const confirmAction = async (message: string, action: () => Promise<void>) => {
    if (!confirm(message)) {
        return;
    }
    try {
        await action();
        await loadMyPage();
    } catch (err) {
        alert(`실패했습니다: ${resolveErrorMessage(err)}`);
    }
};

const handleDieOnPrestart = () =>
    confirmAction('정말로 삭제하시겠습니까?', async () => {
        await trpc.general.dieOnPrestart.mutate();
        window.location.reload();
    });

const handleBuildNationCandidate = () =>
    confirmAction('거병 이후 장수를 삭제할 수 없습니다. 거병하시겠습니까?', async () => {
        await trpc.general.buildNationCandidate.mutate();
    });

const handleInstantRetreat = () =>
    confirmAction('아군 접경으로 이동할까요?', async () => {
        await trpc.general.instantRetreat.mutate();
    });

const handleVacation = () =>
    confirmAction('휴가 기능을 신청할까요?', async () => {
        await trpc.general.vacation.mutate();
    });

const handleDropItem = (slot: ItemSlot) =>
    confirmAction(`${slot.label}(${slot.code ?? '-'})을(를) 파기하시겠습니까?`, async () => {
        await trpc.general.dropItem.mutate({ itemType: slot.key });
    });

const refreshScreenMode = () => {
    if (typeof window === 'undefined') {
        return;
    }
    const mode = window.localStorage.getItem(SCREEN_MODE_KEY);
    if (mode === '500px' || mode === '1000px') {
        screenMode.value = mode;
    } else {
        screenMode.value = 'auto';
    }
};

watch(
    () => isMobile.value,
    (value) => {
        if (value && !logTypes.includes(activeLogTab.value)) {
            activeLogTab.value = 'generalAction';
        }
    }
);

onMounted(() => {
    refreshScreenMode();
    void loadMyPage();
});
</script>

<template>
    <main class="my-page" :class="`screen-${screenMode}`">
        <header class="page-header">
            <div>
                <h1 class="page-title">내 정보</h1>
                <p class="page-subtitle">{{ statusLine }}</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <RouterLink class="ghost" to="/my-settings">게임 설정</RouterLink>
                <button class="ghost" @click="loadMyPage">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <section class="layout-grid">
            <div class="stack">
                <PanelCard title="장수 상태">
                    <GeneralBasicCard :general="data?.general ?? null" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 상태">
                    <CityBasicCard :city="data?.city ?? null" :loading="loading" />
                </PanelCard>
                <PanelCard title="세력 상태">
                    <NationBasicCard :nation="data?.nation ?? null" :loading="loading" />
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="장수 상태 변경" subtitle="중요 액션은 확인 후 실행됩니다.">
                    <div class="action-grid">
                        <button
                            v-if="actionAvailability.canVacation"
                            class="action-btn"
                            type="button"
                            @click="handleVacation"
                        >
                            휴가 신청
                        </button>
                        <button
                            v-if="actionAvailability.canDieOnPrestart"
                            class="action-btn"
                            type="button"
                            @click="handleDieOnPrestart"
                        >
                            장수 삭제
                        </button>
                        <button
                            v-if="actionAvailability.canBuildNationCandidate"
                            class="action-btn"
                            type="button"
                            @click="handleBuildNationCandidate"
                        >
                            사전 거병
                        </button>
                        <button
                            v-if="actionAvailability.canInstantRetreat"
                            class="action-btn"
                            type="button"
                            @click="handleInstantRetreat"
                        >
                            접경 귀환
                        </button>
                        <RouterLink
                            v-if="actionAvailability.canSelectOtherGeneral"
                            class="action-btn link"
                            to="/join"
                        >
                            다른 장수 선택
                        </RouterLink>
                    </div>
                </PanelCard>

                <PanelCard title="아이템 파기" subtitle="소지 중인 장비를 선택합니다.">
                    <div class="item-grid">
                        <button
                            v-for="slot in itemSlots"
                            :key="slot.key"
                            class="item-btn"
                            type="button"
                            :disabled="!slot.code"
                            @click="handleDropItem(slot)"
                        >
                            {{ slot.label }}: {{ slot.code ?? '-' }}
                        </button>
                    </div>
                </PanelCard>

                <PanelCard v-if="isMobile" title="장수 기록">
                    <div class="log-tabs">
                        <button
                            v-for="type in logTypes"
                            :key="type"
                            :class="{ active: activeLogTab === type }"
                            @click="activeLogTab = type"
                        >
                            {{ logLabels[type] }}
                        </button>
                    </div>
                    <div class="log-block">
                        <div class="log-title">{{ logLabels[activeLogTab] }}</div>
                        <SkeletonLines v-if="loading || logLoading[activeLogTab]" :lines="4" />
                        <!-- eslint-disable vue/no-v-html -->
                        <template v-else>
                            <div v-if="logs[activeLogTab].length === 0" class="empty">기록이 없습니다.</div>
                            <div
                                v-for="entry in logs[activeLogTab]"
                                :key="entry.id"
                                class="log-line"
                                v-html="entry.html"
                            />
                            <button
                                v-if="logHasMore[activeLogTab]"
                                class="ghost log-more"
                                @click="loadLog(activeLogTab, logs[activeLogTab].at(-1)?.id)"
                            >
                                이전 로그 불러오기
                            </button>
                        </template>
                        <!-- eslint-enable vue/no-v-html -->
                    </div>
                </PanelCard>

                <PanelCard v-else title="장수 기록" subtitle="개인 기록 및 전투 로그">
                    <div class="log-grid">
                        <div v-for="type in logTypes" :key="type" class="log-block">
                            <div class="log-title">{{ logLabels[type] }}</div>
                            <SkeletonLines v-if="loading || logLoading[type]" :lines="3" />
                            <!-- eslint-disable vue/no-v-html -->
                            <template v-else>
                                <div v-if="logs[type].length === 0" class="empty">기록이 없습니다.</div>
                                <div v-for="entry in logs[type]" :key="entry.id" class="log-line" v-html="entry.html" />
                                <button
                                    v-if="logHasMore[type]"
                                    class="ghost log-more"
                                    @click="loadLog(type, logs[type].at(-1)?.id)"
                                >
                                    이전 로그 불러오기
                                </button>
                            </template>
                            <!-- eslint-enable vue/no-v-html -->
                        </div>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.my-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    transition: width 0.2s ease;
    margin: 0 auto;
}

.my-page.screen-500px {
    max-width: 500px;
}

.my-page.screen-1000px {
    max-width: 1000px;
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

.action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
}

.action-btn {
    border: 1px solid rgba(201, 164, 90, 0.5);
    background: rgba(12, 12, 12, 0.6);
    color: inherit;
    padding: 8px 12px;
    font-size: 0.85rem;
    cursor: pointer;
    text-align: center;
}

.action-btn.link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.item-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
}

.item-btn {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(12, 12, 12, 0.6);
    color: inherit;
    padding: 8px 10px;
    font-size: 0.82rem;
    cursor: pointer;
    text-align: left;
}

.item-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.log-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

.log-more {
    margin-top: 8px;
}

.log-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
}

.log-tabs button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    font-size: 0.8rem;
    cursor: pointer;
}

.log-tabs button.active {
    background: rgba(201, 164, 90, 0.2);
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.5);
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    font-size: 0.8rem;
    cursor: pointer;
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

    .log-grid {
        grid-template-columns: 1fr;
    }
}
</style>
