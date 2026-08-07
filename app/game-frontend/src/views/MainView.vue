<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
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
import type { CommandPatternEntry } from '../components/command/types';

const session = useSessionStore();
const dashboard = useMainDashboardStore();
const isMobile = useMediaQuery('(max-width: 939.98px)');

const tournamentStage = ref(0);
const npcMode = ref(0);

const {
    loading,
    refreshing,
    error,
    recordsError,
    frontStatusError,
    realtimeEnabled,
    lobbyInfo,
    general,
    city,
    nation,
    worldMap,
    mapLayout,
    commandTable,
    messages,
    boardAccess,
    reservedGeneralTurns,
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
const formatRecord = (entry: { text: string; createdAt?: string | Date }, appendTime = false): string => {
    if (!appendTime || /\d{2}:\d{2}\s*$/u.test(entry.text)) return formatLog(entry.text);
    const parsed = entry.createdAt ? new Date(entry.createdAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return formatLog(entry.text);
    const time = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(parsed);
    return formatLog(`${entry.text} ${time}`);
};

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

const shiftGeneralTurns = (amount: number) => {
    void dashboard.shiftGeneralTurns(amount);
};

const reserveGeneralTurns = (entries: CommandPatternEntry[]) => {
    void dashboard.setGeneralTurns(entries);
};

const repeatGeneralTurns = (amount: number) => {
    void dashboard.repeatGeneralTurns(amount);
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

const moveQuick = (item: QuickNavigationItem) => {
    document.querySelector(item.selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                <h1 class="game-shell__title">
                    {{ isMobile ? '전장 현황' : lobbyInfo?.scenarioTitle || '전장 현황' }}
                </h1>
                <p class="game-shell__subtitle">
                    {{
                        !isMobile && lobbyInfo?.scenarioTitle ? `${lobbyInfo.scenarioTitle} ${statusLine}` : statusLine
                    }}
                </p>
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
                <button
                    class="game-shell__action game-shell__action--navigation"
                    type="button"
                    :disabled="refreshing"
                    :aria-busy="refreshing"
                    @click="loadMainData"
                >
                    갱 신
                </button>
                <button class="game-shell__action" type="button" @click="moveLobby">로비로</button>
            </div>
        </header>

        <section v-if="lobbyInfo" class="legacy-game-info" aria-label="게임 진행 정보">
            <span>현재: {{ lobbyInfo.year }}년 {{ lobbyInfo.month }}월</span>
            <span>턴: {{ lobbyInfo.turnTerm }}분</span>
            <span>등록 장수: {{ lobbyInfo.userCnt }} / {{ lobbyInfo.maxUserCnt }}</span>
            <span>NPC: {{ lobbyInfo.npcCnt }}</span>
            <span>국가: {{ lobbyInfo.nationCnt }}</span>
            <span>사실/가상: {{ lobbyInfo.fictionMode }}</span>
            <span>최근 턴: {{ lobbyInfo.turntime || '-' }}</span>
            <span>{{ lobbyInfo.otherTextInfo || '진행 정보 없음' }}</span>
        </section>

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
            <div class="mobile-panel">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역" data-main-target="commands">
                    <CommandListPanel
                        :command-table="commandTable"
                        :loading="loading"
                        :reserved-general-turns="reservedGeneralTurns"
                        :general="general"
                        :current-year="lobbyInfo?.year"
                        :current-month="lobbyInfo?.month"
                        :turn-term-minutes="lobbyInfo?.turnTerm"
                        @set-general-turns="reserveGeneralTurns"
                        @shift-general-turns="shiftGeneralTurns"
                        @repeat-general-turns="repeatGeneralTurns"
                    />
                </PanelCard>
            </div>

            <div class="mobile-panel">
                <MainNationMenu
                    class="nation-menu-middle"
                    :access="nationAccess"
                    :tournament-stage="tournamentStage"
                    :nation-color="nationColor"
                />
            </div>

            <div class="mobile-panel">
                <PanelCard title="국가 정보" data-main-target="nation">
                    <NationBasicCard :nation="nation" :loading="loading" />
                </PanelCard>
                <PanelCard title="장수 스탯" data-main-target="general">
                    <GeneralBasicCard :general="general" :loading="loading" />
                </PanelCard>
                <PanelCard title="도시 정보" data-main-target="city">
                    <CityBasicCard :city="city" :loading="loading" />
                </PanelCard>
            </div>

            <div class="mobile-panel">
                <PanelCard title="지도" data-main-target="map">
                    <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
            </div>

            <div class="mobile-panel record-zone-mobile">
                <RecordPanel title="장수 동향" data-main-target="global-records">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else-if="recordsError" class="record-error" role="alert">{{ recordsError }}</div>
                    <div v-else class="record-list" data-record-bucket="global">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <div
                            v-for="entry in globalRecords"
                            :key="entry.id"
                            class="record-line"
                            v-html="formatRecord(entry)"
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
                            v-html="formatRecord(entry, true)"
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
                            v-html="formatRecord(entry)"
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

            <div class="mobile-panel">
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
            <PanelCard title="지도" subtitle="실시간 지도 + 도시 상황" data-main-target="map">
                <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
            </PanelCard>
            <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역" data-main-target="commands">
                <CommandListPanel
                    :command-table="commandTable"
                    :loading="loading"
                    :reserved-general-turns="reservedGeneralTurns"
                    :general="general"
                    :current-year="lobbyInfo?.year"
                    :current-month="lobbyInfo?.month"
                    :turn-term-minutes="lobbyInfo?.turnTerm"
                    @set-general-turns="reserveGeneralTurns"
                    @shift-general-turns="shiftGeneralTurns"
                    @repeat-general-turns="repeatGeneralTurns"
                />
            </PanelCard>
            <PanelCard title="도시 정보" data-main-target="city">
                <CityBasicCard :city="city" :loading="loading" />
            </PanelCard>
            <PanelCard title="국가 정보" data-main-target="nation">
                <NationBasicCard :nation="nation" :loading="loading" />
            </PanelCard>
            <PanelCard title="장수 스탯" data-main-target="general">
                <GeneralBasicCard :general="general" :loading="loading" />
            </PanelCard>
            <MainNationMenu
                class="nation-menu-middle"
                :access="nationAccess"
                :tournament-stage="tournamentStage"
                :nation-color="nationColor"
            />
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
                            v-html="formatRecord(entry)"
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
                            v-html="formatRecord(entry, true)"
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
                            v-html="formatRecord(entry)"
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
    </main>
    <div v-if="isMobile" class="main-mobile-bottom-spacer" aria-hidden="true"></div>
    <MainMobileBottomBar
        v-if="isMobile"
        :access="nationAccess"
        :tournament-stage="tournamentStage"
        :nation-color="nationColor"
        :npc-mode="npcMode"
        @refresh="loadMainData"
        @lobby="moveLobby"
        @quick="moveQuick"
    />
</template>

<style scoped>
button {
    font-family: inherit;
    background: none;
    border: none;
    color: inherit;
}

/*
 * Ref's main document does not clip horizontally; the map panel below manages
 * its own overflow.
 */
.main-page {
    box-sizing: border-box;
    width: 100%;
    min-width: 500px;
    max-width: 1000px;
    margin: 0 auto;
    padding: 0;
    gap: 10px;
    background-color: transparent;
    background-image: var(--sammo-texture-walnut);
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

.legacy-game-info {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    box-sizing: border-box;
    height: 18px;
    overflow: hidden;
    border-top: 1px solid #666;
    background: #302016 var(--sammo-texture-walnut);
    color: #fff;
    font-size: 12px;
    line-height: 17px;
    text-align: center;
}

.legacy-game-info > span {
    overflow: hidden;
    border-right: 1px solid #666;
    white-space: nowrap;
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
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 0;
    align-items: start;
}

.layout-desktop > [data-main-target='map'] {
    grid-column: 1 / 8;
    grid-row: 1;
    height: 520px;
    overflow: hidden;
}

.layout-desktop > [data-main-target='commands'] {
    grid-column: 8 / 11;
    grid-row: 1;
    height: 589px;
    width: 290px;
    margin-left: 10px;
    overflow-y: auto;
}

.layout-desktop > [data-main-target='city'] {
    grid-column: 1 / 8;
    grid-row: 1;
    min-height: 125px;
    margin-top: 520px;
}

.layout-desktop > [data-main-target='nation'] {
    grid-column: 1 / 6;
    grid-row: 1;
    min-height: 193px;
    margin-top: 645px;
}

.layout-desktop > [data-main-target='general'] {
    grid-column: 6 / 11;
    grid-row: 1;
    min-height: 193px;
    margin-top: 645px;
}

.layout-desktop > [data-main-target],
.layout-mobile [data-main-target] {
    border: none;
    background-color: transparent;
    background-image: none;
}

.layout-desktop > [data-main-target='commands'],
.layout-mobile [data-main-target='commands'] {
    background-color: #222;
}

.nation-menu-middle {
    grid-column: 1 / -1;
}

[data-main-target='map'] :deep(.panel-header),
[data-main-target='map'] :deep(.map-meta),
[data-main-target='map'] :deep(.map-footnote) {
    display: none;
}

[data-main-target='map'] :deep(.panel-body) {
    padding: 0;
}

[data-main-target='map'] :deep(.map-viewer),
[data-main-target='map'] :deep(.map-body) {
    gap: 0;
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
    width: 100%;
}

.world-history-panel {
    grid-column: 1 / -1;
}

.record-list {
    min-height: 21px;
    line-height: 21px;
}

.record-line {
    overflow: hidden;
    overflow-wrap: normal;
    white-space: nowrap;
}

.record-line :deep(.hidden_but_copyable) {
    color: transparent !important;
    font-size: 0;
}

.record-empty {
    color: #aaa;
}

.record-error {
    color: #ff8a80;
}

.record-zone-mobile {
    width: 500px;
    gap: 0;
}

.mobile-message-panel {
    width: 500px;
    min-width: 0;
}

.layout-mobile {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mobile-panel {
    display: flex;
    flex-direction: column;
    width: 500px;
    gap: 12px;
}

.mobile-panel.record-zone-mobile {
    gap: 0;
}

.layout-mobile > .mobile-panel:nth-of-type(3) {
    gap: 0;
}

.layout-mobile [data-main-target='commands'] {
    height: 586px;
    overflow-y: auto;
}

.layout-mobile [data-main-target='nation'],
.layout-mobile [data-main-target='general'] {
    min-height: 193px;
}

.layout-mobile [data-main-target='city'] {
    min-height: 147px;
}

.layout-mobile [data-main-target='map'] {
    height: 377px;
    overflow: hidden;
}

.layout-mobile .record-zone-mobile {
    margin-top: 31px;
}

/*
 * Ref renders these dashboard controls with the Lumen navigation family: no top
 * border, 1px sides and a 4px bottom edge that shortens on hover and press
 * while the control moves down.
 */
.desktop-action-controls .game-shell__action {
    border-color: #004f28;
    border-style: solid;
    border-width: 0 1px 4px;
    background: #006b36;
    color: #fff;
}

.desktop-action-controls .game-shell__action:hover {
    margin-top: 1px;
    border-bottom-width: 3px;
    background: #00582c;
}

.desktop-action-controls .game-shell__action:active {
    margin-top: 2px;
    border-bottom-width: 2px;
    background: #005128;
}

.placeholder {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

@media (max-width: 939.98px) {
    .main-mobile-bottom-spacer {
        height: 45px;
    }

    .main-page {
        width: 502px;
        min-height: 3688px;
    }

    .legacy-game-info {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        height: 156px;
        line-height: 40px;
    }

    .legacy-game-info > span {
        border-bottom: 1px solid #666;
    }

    .survey-notice {
        z-index: 90;
        bottom: 16px;
    }

    .layout-mobile [data-main-target='world-history'] {
        height: 359px;
        min-height: 0;
        overflow: hidden;
    }

    .mobile-message-panel {
        height: 1394.5px;
        margin-bottom: -10px;
    }
}

@media (min-width: 940px) {
    .main-page {
        min-height: 2706px;
    }
}
</style>
