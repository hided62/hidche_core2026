<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import MapViewer from '../components/main/MapViewer.vue';
import CommandListPanel from '../components/main/CommandListPanel.vue';
import GeneralBasicCard from '../components/main/GeneralBasicCard.vue';
import CityBasicCard from '../components/main/CityBasicCard.vue';
import NationBasicCard from '../components/main/NationBasicCard.vue';
import MessagePanel from '../components/main/MessagePanel.vue';
import { trpc } from '../utils/trpc';
import { useSessionStore } from '../stores/session';

type GeneralContext = Awaited<ReturnType<typeof trpc.general.me.query>>;
type LobbyInfo = Awaited<ReturnType<typeof trpc.lobby.info.query>>;
type CommandTable = Awaited<ReturnType<typeof trpc.turns.getCommandTable.query>>;
type WorldMapResult = Awaited<ReturnType<typeof trpc.world.getMap.query>>;
type MessageBundle = Awaited<ReturnType<typeof trpc.messages.getRecent.query>>;

type GeneralInfo = NonNullable<GeneralContext>['general'];
type CityInfo = NonNullable<GeneralContext>['city'];
type NationInfo = NonNullable<GeneralContext>['nation'];

const session = useSessionStore();
const isMobile = useMediaQuery('(max-width: 1024px)');

const mobileTabs = [
    { key: 'map', label: '지도' },
    { key: 'commands', label: '명령' },
    { key: 'status', label: '상태' },
    { key: 'world', label: '동향' },
    { key: 'messages', label: '메시지' },
] as const;

type MobileTabKey = (typeof mobileTabs)[number]['key'];

const mobileTab = ref<MobileTabKey>('map');
const realtimeEnabled = ref(true);
const realtimeStatus = ref<'idle' | 'connected' | 'paused'>('connected');

const loading = ref(false);
const error = ref<string | null>(null);

const generalInfo = ref<GeneralInfo | null>(null);
const cityInfo = ref<CityInfo | null>(null);
const nationInfo = ref<NationInfo | null>(null);
const lobbyInfo = ref<LobbyInfo | null>(null);
const worldMap = ref<WorldMapResult | null>(null);
const commandTable = ref<CommandTable | null>(null);
const messages = ref<MessageBundle | null>(null);

const statusLine = computed(() => {
    if (!lobbyInfo.value) {
        return '상태 정보를 불러오는 중';
    }
    return `${lobbyInfo.value.year}년 ${lobbyInfo.value.month}월 · 턴 ${lobbyInfo.value.turnTerm}분`;
});

const realtimeLabel = computed(() => {
    if (!realtimeEnabled.value) {
        return '끔';
    }
    if (realtimeStatus.value === 'connected') {
        return '연결됨';
    }
    return '대기중';
});

const loadMainData = async () => {
    if (loading.value) {
        return;
    }

    loading.value = true;
    error.value = null;

    try {
        const generalContext = await trpc.general.me.query();
        if (!generalContext) {
            generalInfo.value = null;
            cityInfo.value = null;
            nationInfo.value = null;
            loading.value = false;
            return;
        }

        generalInfo.value = generalContext.general;
        cityInfo.value = generalContext.city;
        nationInfo.value = generalContext.nation;

        const generalId = generalContext.general.id;
        const [lobby, map, commands, messageData] = await Promise.all([
            trpc.lobby.info.query(),
            trpc.world.getMap.query({ generalId, showMe: true, useCache: true }),
            trpc.turns.getCommandTable.query({ generalId }),
            trpc.messages.getRecent.query({ generalId }),
        ]);

        lobbyInfo.value = lobby;
        worldMap.value = map;
        commandTable.value = commands;
        messages.value = messageData;
    } catch (err) {
        error.value = '메인 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

watch(
    () => [session.isReady, session.hasGeneral],
    ([ready, hasGeneral]) => {
        if (ready && hasGeneral) {
            void loadMainData();
        }
    },
    { immediate: true }
);

watch(realtimeEnabled, (enabled) => {
    realtimeStatus.value = enabled ? 'connected' : 'paused';
});
</script>

<template>
    <main class="main-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">전장 현황</h1>
                <p class="page-subtitle">{{ statusLine }}</p>
            </div>
            <div class="header-actions">
                <button class="toggle" :class="{ active: realtimeEnabled }" @click="realtimeEnabled = !realtimeEnabled">
                    실시간 동기화: {{ realtimeLabel }}
                </button>
                <button class="ghost" @click="loadMainData">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <div v-if="session.needsGeneral" class="warning">
            장수가 아직 생성되지 않았습니다. <RouterLink to="/join">장수 생성/빙의</RouterLink>
        </div>

        <section v-if="isMobile" class="layout-mobile">
            <div class="mobile-tabs">
                <button
                    v-for="tab in mobileTabs"
                    :key="tab.key"
                    :class="{ active: mobileTab === tab.key }"
                    @click="mobileTab = tab.key"
                >
                    {{ tab.label }}
                </button>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'map'">
                <PanelCard title="지도">
                    <MapViewer :map-data="worldMap" :loading="loading" />
                </PanelCard>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'commands'">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역">
                    <CommandListPanel :command-table="commandTable" :loading="loading" />
                </PanelCard>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'status'">
                <PanelCard title="장수 스탯">
                    <GeneralBasicCard :general="generalInfo" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 정보">
                    <CityBasicCard :city="cityInfo" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보">
                    <NationBasicCard :nation="nationInfo" :loading="loading" />
                </PanelCard>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'world'">
                <PanelCard title="장수 동향">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="placeholder">장수 동향은 실시간 스트림으로 연결 예정</div>
                </PanelCard>
                <PanelCard title="개인 기록">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="placeholder">개인 기록 영역</div>
                </PanelCard>
                <PanelCard title="중원 정세">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="placeholder">
                        <div>유저 {{ lobbyInfo?.userCnt ?? '-' }} / {{ lobbyInfo?.maxUserCnt ?? '-' }}</div>
                        <div>NPC {{ lobbyInfo?.npcCnt ?? '-' }}</div>
                        <div>세력 {{ lobbyInfo?.nationCnt ?? '-' }}</div>
                    </div>
                </PanelCard>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'messages'">
                <PanelCard title="메시지함">
                    <MessagePanel :messages="messages" :loading="loading" />
                </PanelCard>
            </div>
        </section>

        <section v-else class="layout-desktop">
            <div class="stack">
                <PanelCard title="지도" subtitle="실시간 지도 + 도시 상황">
                    <MapViewer :map-data="worldMap" :loading="loading" />
                </PanelCard>
                <PanelCard title="중원 정세">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else class="placeholder">
                        <div>유저 {{ lobbyInfo?.userCnt ?? '-' }} / {{ lobbyInfo?.maxUserCnt ?? '-' }}</div>
                        <div>NPC {{ lobbyInfo?.npcCnt ?? '-' }}</div>
                        <div>세력 {{ lobbyInfo?.nationCnt ?? '-' }}</div>
                    </div>
                </PanelCard>
                <PanelCard title="메시지함">
                    <MessagePanel :messages="messages" :loading="loading" />
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역">
                    <CommandListPanel :command-table="commandTable" :loading="loading" />
                </PanelCard>
                <PanelCard title="장수 스탯">
                    <GeneralBasicCard :general="generalInfo" :loading="loading" />
                </PanelCard>
                <PanelCard title="장수 동향">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="placeholder">장수 동향은 실시간 스트림으로 연결 예정</div>
                </PanelCard>
                <PanelCard title="도시 정보">
                    <CityBasicCard :city="cityInfo" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보">
                    <NationBasicCard :nation="nationInfo" :loading="loading" />
                </PanelCard>
                <PanelCard title="개인 기록">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="placeholder">개인 기록 영역</div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.main-page {
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

button {
    font-family: inherit;
    background: none;
    border: none;
    color: inherit;
}

.toggle,
.ghost {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
    cursor: pointer;
}

.toggle.active {
    background: rgba(201, 164, 90, 0.2);
}

.ghost {
    background: rgba(16, 16, 16, 0.6);
}

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.warning {
    color: #f5d08a;
    font-size: 0.85rem;
}

.layout-desktop {
    display: grid;
    grid-template-columns: minmax(320px, 1.4fr) minmax(320px, 1fr);
    gap: 16px;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.layout-mobile {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.mobile-tabs {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
}

.mobile-tabs button {
    padding: 6px 4px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    font-size: 0.75rem;
    cursor: pointer;
}

.mobile-tabs button.active {
    background: rgba(201, 164, 90, 0.2);
}

.mobile-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.placeholder {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
    display: flex;
    flex-direction: column;
    gap: 6px;
}
</style>
