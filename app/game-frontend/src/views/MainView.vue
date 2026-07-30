<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useMediaQuery } from '@vueuse/core';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import MapViewer from '../components/main/MapViewer.vue';
import CommandListPanel from '../components/main/CommandListPanel.vue';
import GeneralBasicCard from '../components/main/GeneralBasicCard.vue';
import CityBasicCard from '../components/main/CityBasicCard.vue';
import NationBasicCard from '../components/main/NationBasicCard.vue';
import MessagePanel from '../components/main/MessagePanel.vue';
import SelectedCityPanel from '../components/main/SelectedCityPanel.vue';
import RecordPanel from '../components/main/RecordPanel.vue';
import MainFrontStatus from '../components/main/MainFrontStatus.vue';
import MainGlobalMenu from '../components/main/MainGlobalMenu.vue';
import MainNationMenu from '../components/main/MainNationMenu.vue';
import MainMobileBottomBar from '../components/main/MainMobileBottomBar.vue';
import type { QuickNavigationItem } from '../components/main/mainNavigation';
import { formatLog } from '../utils/formatLog';
import { useSessionStore } from '../stores/session';
import { useMainDashboardStore } from '../stores/mainDashboard';
import { trpc } from '../utils/trpc';

const session = useSessionStore();
const dashboard = useMainDashboardStore();
const isMobile = useMediaQuery('(max-width: 939.98px)');

const mobileTabs = [
    { key: 'map', label: '지도' },
    { key: 'commands', label: '명령' },
    { key: 'status', label: '상태' },
    { key: 'world', label: '동향' },
    { key: 'messages', label: '메시지' },
] as const;

type MobileTabKey = (typeof mobileTabs)[number]['key'];

const mobileTab = ref<MobileTabKey>('map');
const tournamentStage = ref(0);
const npcMode = ref(0);

const {
    loading,
    error,
    recordsError,
    frontStatusError,
    realtimeEnabled,
    general,
    city,
    nation,
    worldMap,
    mapLayout,
    selectedCity,
    commandTable,
    messages,
    boardAccess,
    reservedGeneralTurns,
    reservedNationTurns,
    globalRecords,
    generalRecords,
    worldHistory,
    frontStatus,
    surveyNotice,
    messageDraftText,
    targetMailbox,
    mailboxGroups,
    statusLine,
    realtimeLabel,
} = storeToRefs(dashboard);

const nationAccess = computed(() => ({
    permission: boardAccess.value?.permission ?? -1,
    officerLevel: general.value?.officerLevel ?? 0,
    nationLevel: nation.value?.level ?? 0,
}));
const nationColor = computed(() => nation.value?.color ?? '#000000');
const voteActive = computed(() => Boolean(frontStatus.value?.latestVote));

let surveyNoticeTimer: ReturnType<typeof setTimeout> | null = null;
watch(surveyNotice, (notice) => {
    if (surveyNoticeTimer) {
        clearTimeout(surveyNoticeTimer);
        surveyNoticeTimer = null;
    }
    if (notice) {
        surveyNoticeTimer = setTimeout(() => dashboard.dismissSurveyNotice(), 60_000);
    }
});
onUnmounted(() => {
    if (surveyNoticeTimer) {
        clearTimeout(surveyNoticeTimer);
    }
});

const reserveGeneralTurn = (payload: { index: number; action: string; args: Record<string, unknown> }) => {
    void dashboard.setGeneralTurn(payload.index, payload.action, payload.args);
};

const shiftGeneralTurns = (amount: number) => {
    void dashboard.shiftGeneralTurns(amount);
};

const reserveNationTurn = (payload: { index: number; action: string; args: Record<string, unknown> }) => {
    void dashboard.setNationTurn(payload.index, payload.action, payload.args);
};

const shiftNationTurns = (amount: number) => {
    void dashboard.shiftNationTurns(amount);
};

const loadMainData = async () => {
    const [, state, worldState] = await Promise.all([
        dashboard.loadMainData(),
        trpc.tournament.getState.query().catch(() => null),
        trpc.world.getState.query().catch(() => null),
    ]);
    tournamentStage.value = state?.stage ?? 0;
    npcMode.value = worldState?.config.npcMode ?? 0;
};

const moveLobby = () => {
    window.location.replace(import.meta.env.VITE_GATEWAY_WEB_URL?.trim() || '/gateway/');
};

const quickNavigate = async (item: QuickNavigationItem) => {
    mobileTab.value = item.tab;
    await nextTick();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    document.querySelector<HTMLElement>(item.selector)?.scrollIntoView({ behavior: 'auto', block: 'start' });
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
</script>

<template>
    <main class="game-shell main-page">
        <MainGlobalMenu data-menu-position="top" :npc-mode="npcMode" :vote-active="voteActive" />

        <header class="game-shell__header">
            <div>
                <h1 class="game-shell__title">전장 현황</h1>
                <p class="game-shell__subtitle">{{ statusLine }}</p>
            </div>
            <div class="game-shell__actions desktop-action-controls">
                <button
                    class="game-shell__action toggle"
                    :class="{ active: realtimeEnabled }"
                    type="button"
                    @click="dashboard.setRealtimeEnabled(!realtimeEnabled)"
                >
                    실시간 동기화: {{ realtimeLabel }}
                </button>
                <button class="game-shell__action" type="button" @click="loadMainData">갱 신</button>
                <button class="game-shell__action" type="button" @click="moveLobby">로비로</button>
            </div>
        </header>

        <MainNationMenu :access="nationAccess" :tournament-stage="tournamentStage" :nation-color="nationColor" />

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>
        <div v-if="frontStatusError" class="front-status-error" role="alert">{{ frontStatusError }}</div>

        <div v-if="session.needsGeneral" class="warning">
            장수가 아직 생성되지 않았습니다. <RouterLink to="/join">장수 생성/빙의</RouterLink>
        </div>

        <div data-main-target="policy">
            <MainFrontStatus :status="frontStatus" />
        </div>

        <aside v-if="surveyNotice" class="survey-notice" role="status" aria-live="polite">
            <div class="survey-notice-title">
                <strong>설문조사 안내</strong>
                <button type="button" aria-label="설문조사 알림 닫기" @click="dashboard.dismissSurveyNotice">×</button>
            </div>
            <RouterLink to="/survey">새로운 설문조사가 있습니다.</RouterLink>
        </aside>

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

            <div v-if="mobileTab === 'map'" class="mobile-panel">
                <PanelCard title="지도" data-main-target="map">
                    <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
                <PanelCard title="선택 도시">
                    <SelectedCityPanel :city="selectedCity" :loading="loading" />
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'commands'" class="mobile-panel">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역" data-main-target="commands">
                    <CommandListPanel
                        :command-table="commandTable"
                        :loading="loading"
                        :selected-city="selectedCity"
                        :reserved-general-turns="reservedGeneralTurns"
                        :reserved-nation-turns="reservedNationTurns"
                        :general="general"
                        @set-general-turn="reserveGeneralTurn"
                        @shift-general-turns="shiftGeneralTurns"
                        @set-nation-turn="reserveNationTurn"
                        @shift-nation-turns="shiftNationTurns"
                    />
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'status'" class="mobile-panel">
                <PanelCard title="장수 스탯" data-main-target="general">
                    <GeneralBasicCard :general="general" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 정보" data-main-target="city">
                    <CityBasicCard :city="city" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보" data-main-target="nation">
                    <NationBasicCard :nation="nation" :loading="loading" />
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'world'" class="mobile-panel record-zone-mobile">
                <RecordPanel title="장수 동향" data-main-target="global-records">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="global">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in globalRecords"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatLog(entry.text)"
                        />
                        <div v-if="globalRecords.length === 0" class="record-empty">기록이 없습니다.</div>
                    </div>
                </RecordPanel>
                <RecordPanel title="개인 기록" data-main-target="general-records">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="general">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in generalRecords"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatLog(entry.text)"
                        />
                        <div v-if="generalRecords.length === 0" class="record-empty">기록이 없습니다.</div>
                    </div>
                </RecordPanel>
                <RecordPanel title="중원 정세" data-main-target="world-history">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="history">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in worldHistory"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatLog(entry.text)"
                        />
                        <div v-if="worldHistory.length === 0" class="record-empty">기록이 없습니다.</div>
                    </div>
                </RecordPanel>
            </div>

            <MainGlobalMenu
                class="common-menu-middle"
                data-menu-position="middle"
                :npc-mode="npcMode"
                :vote-active="voteActive"
            />

            <div v-if="mobileTab === 'messages'" class="mobile-panel">
                <MessagePanel
                    class="mobile-message-panel"
                    :messages="messages"
                    :loading="loading"
                    :target-mailbox="targetMailbox"
                    :draft-text="messageDraftText"
                    :mailbox-groups="mailboxGroups"
                    :general-id="general?.id ?? 0"
                    :general-name="general?.name ?? ''"
                    :nation-id="general?.nationId ?? 0"
                    :can-respond-diplomacy="messages?.canRespondDiplomacy ?? false"
                    @update:target-mailbox="targetMailbox = $event"
                    @update:draft-text="messageDraftText = $event"
                    @send="dashboard.sendMessage"
                    @load-older="dashboard.loadOlderMessages"
                    @refresh="dashboard.refreshMessages"
                    @respond="dashboard.respondToMessage"
                    @read-latest="dashboard.readLatestMessage"
                    @delete="dashboard.deleteMessage"
                />
            </div>
        </section>

        <section v-else class="layout-desktop">
            <div class="stack">
                <PanelCard title="지도" subtitle="실시간 지도 + 도시 상황" data-main-target="map">
                    <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
                <PanelCard title="선택 도시">
                    <SelectedCityPanel :city="selectedCity" :loading="loading" />
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역" data-main-target="commands">
                    <CommandListPanel
                        :command-table="commandTable"
                        :loading="loading"
                        :selected-city="selectedCity"
                        :reserved-general-turns="reservedGeneralTurns"
                        :reserved-nation-turns="reservedNationTurns"
                        :general="general"
                        @set-general-turn="reserveGeneralTurn"
                        @shift-general-turns="shiftGeneralTurns"
                        @set-nation-turn="reserveNationTurn"
                        @shift-nation-turns="shiftNationTurns"
                    />
                </PanelCard>
                <PanelCard title="장수 스탯" data-main-target="general">
                    <GeneralBasicCard :general="general" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 정보" data-main-target="city">
                    <CityBasicCard :city="city" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보" data-main-target="nation">
                    <NationBasicCard :nation="nation" :loading="loading" />
                </PanelCard>
            </div>
            <section class="record-zone">
                <RecordPanel title="장수 동향" data-main-target="global-records">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="global">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in globalRecords"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatLog(entry.text)"
                        />
                        <div v-if="globalRecords.length === 0" class="record-empty">기록이 없습니다.</div>
                    </div>
                </RecordPanel>
                <RecordPanel title="개인 기록" data-main-target="general-records">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="general">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in generalRecords"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatLog(entry.text)"
                        />
                        <div v-if="generalRecords.length === 0" class="record-empty">기록이 없습니다.</div>
                    </div>
                </RecordPanel>
                <RecordPanel class="world-history-panel" title="중원 정세" data-main-target="world-history">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="history">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in worldHistory"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatLog(entry.text)"
                        />
                        <div v-if="worldHistory.length === 0" class="record-empty">기록이 없습니다.</div>
                    </div>
                </RecordPanel>
            </section>
            <MainGlobalMenu
                class="common-menu-middle"
                data-menu-position="middle"
                :npc-mode="npcMode"
                :vote-active="voteActive"
            />
            <MessagePanel
                class="desktop-message-panel"
                :messages="messages"
                :loading="loading"
                :target-mailbox="targetMailbox"
                :draft-text="messageDraftText"
                :mailbox-groups="mailboxGroups"
                :general-id="general?.id ?? 0"
                :general-name="general?.name ?? ''"
                :nation-id="general?.nationId ?? 0"
                :can-respond-diplomacy="messages?.canRespondDiplomacy ?? false"
                @update:target-mailbox="targetMailbox = $event"
                @update:draft-text="messageDraftText = $event"
                @send="dashboard.sendMessage"
                @load-older="dashboard.loadOlderMessages"
                @refresh="dashboard.refreshMessages"
                @respond="dashboard.respondToMessage"
                @read-latest="dashboard.readLatestMessage"
                @delete="dashboard.deleteMessage"
            />
        </section>

        <MainGlobalMenu
            class="common-menu-repeat"
            data-menu-position="bottom"
            :npc-mode="npcMode"
            :vote-active="voteActive"
        />

        <MainMobileBottomBar
            :access="nationAccess"
            :tournament-stage="tournamentStage"
            :nation-color="nationColor"
            :npc-mode="npcMode"
            @refresh="loadMainData"
            @lobby="moveLobby"
            @quick="quickNavigate"
        />
    </main>
</template>

<style scoped>
button {
    font-family: inherit;
    background: none;
    border: none;
    color: inherit;
}

.toggle.active {
    background: rgba(201, 164, 90, 0.2);
}

.game-shell__action.highlight {
    border-color: #f39c12;
    background: #8a5b13;
    color: #fff;
}

.game-shell__action.disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.front-status-error {
    color: #ff8a80;
    font-size: 0.85rem;
}

.warning {
    color: #f5d08a;
    font-size: 0.85rem;
}

.survey-notice {
    position: fixed;
    z-index: 1080;
    right: 16px;
    bottom: 16px;
    box-sizing: border-box;
    width: min(350px, calc(100vw - 32px));
    border: 1px solid rgba(255, 193, 7, 0.75);
    border-radius: 4px;
    background: rgba(32, 28, 16, 0.96);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 14px;
    line-height: 1.3;
}

.survey-notice-title {
    display: flex;
    min-height: 35px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 193, 7, 0.45);
    padding: 8px 12px;
    color: #ffc107;
}

.survey-notice-title button {
    padding: 0 4px;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
}

.survey-notice > a {
    display: block;
    padding: 12px;
    color: #fff;
    text-decoration: none;
}

.survey-notice > a:hover,
.survey-notice > a:focus-visible {
    background: rgba(255, 193, 7, 0.12);
    text-decoration: underline;
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

.desktop-message-panel {
    grid-column: 1 / -1;
}

.common-menu-middle {
    grid-column: 1 / -1;
}

.record-zone {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    width: calc(100% + 48px);
    margin-left: -24px;
}

.world-history-panel {
    grid-column: 1 / -1;
}

.record-list {
    min-height: 21px;
    line-height: 21px;
}

.record-line {
    overflow-wrap: anywhere;
}

.record-empty {
    color: #aaa;
}

.record-error {
    color: #ff8a80;
}

.record-zone-mobile {
    width: 100vw;
    margin-left: -24px;
    gap: 0;
}

.mobile-message-panel {
    width: 100vw;
    min-width: 0;
    margin-left: -24px;
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

@media (max-width: 939.98px) {
    .main-page {
        padding-bottom: 61px;
    }

    .desktop-action-controls {
        display: none;
    }

    .survey-notice {
        z-index: 90;
        bottom: 61px;
    }
}
</style>
