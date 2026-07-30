<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
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
import { formatLog } from '../utils/formatLog';
import { useSessionStore } from '../stores/session';
import { useMainDashboardStore } from '../stores/mainDashboard';
import { trpc } from '../utils/trpc';

const session = useSessionStore();
const dashboard = useMainDashboardStore();
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
const tournamentStage = ref(0);

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
    const [, state] = await Promise.all([dashboard.loadMainData(), trpc.tournament.getState.query().catch(() => null)]);
    tournamentStage.value = state?.stage ?? 0;
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
        <header class="game-shell__header">
            <div>
                <h1 class="game-shell__title">전장 현황</h1>
                <p class="game-shell__subtitle">{{ statusLine }}</p>
            </div>
            <div class="game-shell__actions">
                <RouterLink v-if="boardAccess?.canMeeting" class="game-shell__action" to="/board">회의실</RouterLink>
                <span v-else class="game-shell__action disabled" aria-disabled="true">회의실</span>
                <RouterLink v-if="boardAccess?.canSecret" class="game-shell__action" to="/board/secret">기밀실</RouterLink>
                <span v-else class="game-shell__action disabled" aria-disabled="true">기밀실</span>
                <RouterLink class="game-shell__action" to="/nation/info">세력 정보</RouterLink>
                <RouterLink class="game-shell__action" to="/nation/cities">세력 도시</RouterLink>
                <RouterLink class="game-shell__action" to="/global-info">중원 정보</RouterLink>
                <RouterLink class="game-shell__action" to="/nation-list">세력일람</RouterLink>
                <RouterLink class="game-shell__action" to="/general-list">장수일람</RouterLink>
                <RouterLink class="game-shell__action" to="/current-city">현재 도시</RouterLink>
                <RouterLink class="game-shell__action" to="/nation/generals">세력 장수</RouterLink>
                <RouterLink v-if="(boardAccess?.permission ?? -1) >= 1" class="game-shell__action" to="/nation/secret"
                    >암행부</RouterLink
                >
                <span v-else class="game-shell__action disabled" aria-disabled="true">암행부</span>
                <RouterLink class="game-shell__action" to="/nation/personnel">인사부</RouterLink>
                <RouterLink class="game-shell__action" to="/troop">부대 편성</RouterLink>
                <RouterLink class="game-shell__action" to="/nation/finance">내무부</RouterLink>
                <RouterLink class="game-shell__action" to="/diplomacy">외교부</RouterLink>
                <RouterLink class="game-shell__action" to="/chief-center">사령부</RouterLink>
                <RouterLink class="game-shell__action" to="/battle-center">감찰부</RouterLink>
                <RouterLink class="game-shell__action" to="/best-general">명장일람</RouterLink>
                <RouterLink class="game-shell__action" to="/hall-of-fame">명예의 전당</RouterLink>
                <RouterLink class="game-shell__action" to="/dynasty">왕조일람</RouterLink>
                <RouterLink class="game-shell__action" to="/yearbook">연감</RouterLink>
                <RouterLink class="game-shell__action" to="/nation-betting">천통국 베팅</RouterLink>
                <RouterLink class="game-shell__action" to="/traffic">접속량정보</RouterLink>
                <RouterLink class="game-shell__action" to="/npc-list">빙의일람</RouterLink>
                <a class="game-shell__action" href="/xe/community" target="_blank" rel="noopener">게시판</a>
                <RouterLink class="game-shell__action" to="/battle-simulator">전투 시뮬레이터</RouterLink>
                <RouterLink class="game-shell__action" to="/my-page">내 정보&amp;설정</RouterLink>
                <RouterLink class="game-shell__action" to="/past-plays">내 지난 플레이</RouterLink>
                <RouterLink class="game-shell__action" :class="{ highlight: tournamentStage === 1 }" to="/tournament"
                    >토너먼트</RouterLink
                >
                <RouterLink class="game-shell__action" :class="{ highlight: tournamentStage === 6 }" to="/betting"
                    >베팅장</RouterLink
                >
                <RouterLink class="game-shell__action" to="/auction">거래장</RouterLink>
                <RouterLink class="game-shell__action" to="/survey">설문조사</RouterLink>
                <RouterLink class="game-shell__action" to="/npc-control">NPC 정책</RouterLink>
                <RouterLink class="game-shell__action" to="/inherit">유산 강화</RouterLink>
                <button
                    class="game-shell__action toggle"
                    :class="{ active: realtimeEnabled }"
                    @click="dashboard.setRealtimeEnabled(!realtimeEnabled)"
                >
                    실시간 동기화: {{ realtimeLabel }}
                </button>
                <button class="game-shell__action" @click="loadMainData">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>
        <div v-if="frontStatusError" class="front-status-error" role="alert">{{ frontStatusError }}</div>

        <div v-if="session.needsGeneral" class="warning">
            장수가 아직 생성되지 않았습니다. <RouterLink to="/join">장수 생성/빙의</RouterLink>
        </div>

        <MainFrontStatus :status="frontStatus" />

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
                <PanelCard title="지도">
                    <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
                <PanelCard title="선택 도시">
                    <SelectedCityPanel :city="selectedCity" :loading="loading" />
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'commands'" class="mobile-panel">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역">
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
                <PanelCard title="장수 스탯">
                    <GeneralBasicCard :general="general" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 정보">
                    <CityBasicCard :city="city" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보">
                    <NationBasicCard :nation="nation" :loading="loading" />
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'world'" class="mobile-panel record-zone-mobile">
                <RecordPanel title="장수 동향">
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
                <RecordPanel title="개인 기록">
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
                <RecordPanel title="중원 정세">
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
                <PanelCard title="지도" subtitle="실시간 지도 + 도시 상황">
                    <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
                <PanelCard title="선택 도시">
                    <SelectedCityPanel :city="selectedCity" :loading="loading" />
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역">
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
                <PanelCard title="장수 스탯">
                    <GeneralBasicCard :general="general" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 정보">
                    <CityBasicCard :city="city" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보">
                    <NationBasicCard :nation="nation" :loading="loading" />
                </PanelCard>
            </div>
            <section class="record-zone">
                <RecordPanel title="장수 동향">
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
                <RecordPanel title="개인 기록">
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
                <RecordPanel class="world-history-panel" title="중원 정세">
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
</style>
