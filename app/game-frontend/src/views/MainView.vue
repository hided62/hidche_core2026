<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common';
import type { RuntimeNavigationConfig } from '@sammo-ts/common/navigation/menuConfig';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
import {
    defaultGlobalNavigation,
    type MainNavigationEntry,
    type MainNavigationLink,
    type QuickNavigationItem,
} from '../components/main/mainNavigation';
import { formatLog } from '../utils/formatLog';
import { useSessionStore } from '../stores/session';
import { useMainDashboardStore } from '../stores/mainDashboard';
import { useGameFeedback } from '../composables/useGameFeedback';
import { trpc } from '../utils/trpc';
import type { CommandPatternEntry } from '../components/command/types';
import {
    loadMobileMainPanelOrder,
    MOBILE_MAIN_PANEL_ORDER_CHANGED_EVENT,
    MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY,
    type MobileMainPanelId,
} from '../utils/mobileMainPanelOrder';

const session = useSessionStore();
const dashboard = useMainDashboardStore();
const { info: showInfoToast } = useGameFeedback();
const isMobile = useMediaQuery('(max-width: 939.98px)');

const npcMode = ref(0);
const globalNavigation = ref<MainNavigationEntry[]>(defaultGlobalNavigation);
const versionDialog = ref<HTMLDialogElement | null>(null);
const mobilePanelOrder = ref(loadMobileMainPanelOrder());
const navigationUrl = (import.meta.env.VITE_GATEWAY_API_URL ?? '/api/trpc').replace(/\/trpc\/?$/u, '/navigation');

const reloadMobilePanelOrder = () => {
    mobilePanelOrder.value = loadMobileMainPanelOrder();
};
const handleMobilePanelStorage = (event: StorageEvent) => {
    if (event.key === MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY) reloadMobilePanelOrder();
};
const isFlushMobilePanel = (panelId: MobileMainPanelId, index: number): boolean => {
    const previous = mobilePanelOrder.value[index - 1];
    return (panelId === 'general' && previous === 'nation') || (panelId === 'city' && previous === 'general');
};

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
    reservedGeneralAutorunLimit,
    globalRecords,
    generalRecords,
    worldHistory,
    frontStatus,
    tournamentStage,
    surveyNotice,
    messageDraftText,
    targetMailbox,
    mailboxGroups,
    realtimeLabel,
} = storeToRefs(dashboard);

const nationAccess = computed(() => ({
    permission: boardAccess.value?.permission ?? -1,
    officerLevel: general.value?.officerLevel ?? 0,
    nationLevel: nation.value?.level ?? 0,
}));
const nationColor = computed(() => nation.value?.color ?? '#000000');
const voteActive = computed(() => Boolean(frontStatus.value?.latestVote));
const profileLabels: Record<string, string> = {
    che: '체',
    kwe: '퀘',
    pwe: '풰',
    twe: '퉤',
    nya: '냐',
    pya: '퍄',
    hwe: '훼',
};
const gameProfileLabel = computed(() => {
    const profile = lobbyInfo.value?.profile?.trim();
    return profile ? (profileLabels[profile] ?? profile) : '';
});
const gameTitle = computed(() => {
    const scenarioTitle = lobbyInfo.value?.scenarioTitle || '전장 현황';
    const profileLabel = gameProfileLabel.value;
    const gameIdx = lobbyInfo.value?.gameIdx;
    return profileLabel && typeof gameIdx === 'number' && Number.isInteger(gameIdx) && gameIdx > 0
        ? `${scenarioTitle} ${profileLabel}섭 ${gameIdx}기`
        : scenarioTitle;
});
const recordTimeSuffixPattern = /\d{2}:\d{2}(?:<\/>)?\s*$/u;
const formatRecord = (entry: { text: string; createdAt?: string | Date }, appendTime = false): string => {
    if (!appendTime || recordTimeSuffixPattern.test(entry.text)) return formatLog(entry.text);
    const time = formatServerDateTime(entry.createdAt, { format: 'hourMinute', fallback: '' });
    if (!time) return formatLog(entry.text);
    return formatLog(`${entry.text} <1>${time}</>`);
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
    dashboard.stopRealtime();
    window.removeEventListener('storage', handleMobilePanelStorage);
    document.removeEventListener(MOBILE_MAIN_PANEL_ORDER_CHANGED_EVENT, reloadMobilePanelOrder);
});

onMounted(() => {
    dashboard.startRealtime();
    window.addEventListener('storage', handleMobilePanelStorage);
    document.addEventListener(MOBILE_MAIN_PANEL_ORDER_CHANGED_EVENT, reloadMobilePanelOrder);
    void fetch(navigationUrl, { headers: { Accept: 'application/json' } })
        .then(async (response) => {
            if (!response.ok) throw new Error(`메뉴 설정 조회 실패: HTTP ${response.status}`);
            return (await response.json()) as RuntimeNavigationConfig;
        })
        .then((config) => {
            globalNavigation.value = config.game.items;
        })
        .catch((error: unknown) => {
            console.warn('운영 메뉴 설정을 불러오지 못해 기본 메뉴를 사용합니다.', error);
        });
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
    const [, worldState] = await Promise.all([dashboard.loadMainData(), trpc.world.getState.query().catch(() => null)]);
    npcMode.value = worldState?.config.npcMode ?? 0;
};

const requestManualRefresh = () => {
    if (refreshing.value) {
        showInfoToast('이미 정보를 갱신하고 있습니다.');
        return;
    }
    void loadMainData();
};

const moveLobby = () => {
    window.location.replace(import.meta.env.VITE_GATEWAY_WEB_URL?.trim() || '/gateway/');
};

const moveQuick = (item: QuickNavigationItem) => {
    document.querySelector(item.selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const handleNavigationAction = (action: NonNullable<MainNavigationLink['action']>) => {
    if (action === 'show-version') versionDialog.value?.showModal();
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
        <MainGlobalMenu
            data-menu-position="top"
            :npc-mode="npcMode"
            :vote-active="voteActive"
            :entries="globalNavigation"
            @action="handleNavigationAction"
        />

        <header class="game-shell__header">
            <h1 class="game-shell__title">
                {{ gameTitle }}
            </h1>
            <div class="game-shell__actions desktop-action-controls">
                <button
                    class="game-shell__action toggle legacy-button legacy-button--navigation"
                    :class="{ active: realtimeEnabled }"
                    type="button"
                    @click="dashboard.setRealtimeEnabled(!realtimeEnabled)"
                >
                    실시간 동기화: {{ realtimeLabel }}
                </button>
                <button
                    class="game-shell__action legacy-button legacy-button--navigation"
                    type="button"
                    :aria-busy="refreshing"
                    @click="requestManualRefresh"
                >
                    갱 신
                </button>
                <button
                    class="game-shell__action legacy-button legacy-button--navigation"
                    type="button"
                    @click="moveLobby"
                >
                    로비로
                </button>
            </div>
        </header>

        <section v-if="lobbyInfo" class="legacy-game-info" aria-label="게임 진행 정보">
            <span>현재: {{ lobbyInfo.year }}년 {{ lobbyInfo.month }}월</span>
            <span>턴: {{ lobbyInfo.turnTerm }}분</span>
            <span>등록 장수: {{ lobbyInfo.userCnt }} / {{ lobbyInfo.maxUserCnt }}</span>
            <span>NPC: {{ lobbyInfo.npcCnt }}</span>
            <span>국가: {{ lobbyInfo.nationCnt }}</span>
            <span>사실/가상: {{ lobbyInfo.fictionMode }}</span>
            <span>{{ lobbyInfo.otherTextInfo || '진행 정보 없음' }}</span>
        </section>

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>
        <div v-if="frontStatusError" class="front-status-error" role="alert">{{ frontStatusError }}</div>

        <div v-if="session.needsGeneral" class="warning">
            장수가 아직 생성되지 않았습니다. <RouterLink to="/join">장수 생성/빙의</RouterLink>
        </div>

        <div data-main-target="policy">
            <MainFrontStatus :status="frontStatus" :tournament-stage="tournamentStage" />
        </div>

        <aside v-if="surveyNotice" class="survey-notice" role="status" aria-live="polite">
            <div class="survey-notice-title">
                <strong>설문조사 안내</strong>
                <button type="button" aria-label="설문조사 알림 닫기" @click="dashboard.dismissSurveyNotice">×</button>
            </div>
            <RouterLink to="/survey">새로운 설문조사가 있습니다.</RouterLink>
        </aside>

        <section v-if="isMobile" class="layout-mobile">
            <template v-for="(panelId, panelIndex) in mobilePanelOrder" :key="panelId">
                <div v-if="panelId === 'commands'" class="mobile-panel" data-mobile-panel-id="commands">
                    <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역" data-main-target="commands">
                        <CommandListPanel
                            :command-table="commandTable"
                            :loading="loading"
                            :reserved-general-turns="reservedGeneralTurns"
                            :general="general"
                            :current-year="lobbyInfo?.year"
                            :current-month="lobbyInfo?.month"
                            :turn-term-minutes="lobbyInfo?.turnTerm"
                            :server-time="lobbyInfo?.serverTime"
                            :clock-mode="lobbyInfo?.clockMode"
                            :autorun-limit="reservedGeneralAutorunLimit"
                            :map-data="worldMap"
                            :map-layout="mapLayout"
                            @set-general-turns="reserveGeneralTurns"
                            @shift-general-turns="shiftGeneralTurns"
                            @repeat-general-turns="repeatGeneralTurns"
                        />
                    </PanelCard>
                </div>

                <div v-else-if="panelId === 'nation-menu'" class="mobile-panel" data-mobile-panel-id="nation-menu">
                    <MainNationMenu
                        class="nation-menu-middle"
                        :access="nationAccess"
                        :tournament-stage="tournamentStage"
                        :nation-color="nationColor"
                    />
                </div>

                <div v-else-if="panelId === 'nation'" class="mobile-panel" data-mobile-panel-id="nation">
                    <PanelCard title="국가 정보" data-main-target="nation">
                        <NationBasicCard :nation="nation" :loading="loading" />
                    </PanelCard>
                </div>

                <div
                    v-else-if="panelId === 'general'"
                    class="mobile-panel"
                    :class="{ 'mobile-panel--flush': isFlushMobilePanel(panelId, panelIndex) }"
                    data-mobile-panel-id="general"
                >
                    <PanelCard title="장수 스탯" data-main-target="general">
                        <GeneralBasicCard :general="general" :loading="loading" :nation-color="nation?.color" />
                    </PanelCard>
                </div>

                <div
                    v-else-if="panelId === 'city'"
                    class="mobile-panel"
                    :class="{ 'mobile-panel--flush': isFlushMobilePanel(panelId, panelIndex) }"
                    data-mobile-panel-id="city"
                >
                    <PanelCard title="도시 정보" data-main-target="city">
                        <CityBasicCard :city="city" :loading="loading" />
                    </PanelCard>
                </div>

                <div v-else-if="panelId === 'map'" class="mobile-panel" data-mobile-panel-id="map">
                    <PanelCard title="지도" data-main-target="map">
                        <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                    </PanelCard>
                </div>

                <div
                    v-else-if="panelId === 'records'"
                    class="mobile-panel record-zone-mobile"
                    data-mobile-panel-id="records"
                >
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
                    v-else-if="panelId === 'global-menu'"
                    class="common-menu-middle"
                    data-menu-position="middle"
                    data-mobile-panel-id="global-menu"
                    :npc-mode="npcMode"
                    :vote-active="voteActive"
                    :entries="globalNavigation"
                    @action="handleNavigationAction"
                />

                <div v-else class="mobile-panel" data-mobile-panel-id="messages">
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
            </template>
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
                    :server-time="lobbyInfo?.serverTime"
                    :clock-mode="lobbyInfo?.clockMode"
                    :autorun-limit="reservedGeneralAutorunLimit"
                    :map-data="worldMap"
                    :map-layout="mapLayout"
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
                <GeneralBasicCard :general="general" :loading="loading" :nation-color="nation?.color" />
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
                :entries="globalNavigation"
                @action="handleNavigationAction"
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
            :entries="globalNavigation"
            @action="handleNavigationAction"
        />
    </main>
    <div v-if="isMobile" class="main-mobile-bottom-spacer" aria-hidden="true"></div>
    <MainMobileBottomBar
        v-if="isMobile"
        :access="nationAccess"
        :tournament-stage="tournamentStage"
        :nation-color="nationColor"
        :npc-mode="npcMode"
        :realtime-enabled="realtimeEnabled"
        :refreshing="refreshing"
        :entries="globalNavigation"
        @refresh="requestManualRefresh"
        @toggle-realtime="dashboard.setRealtimeEnabled(!realtimeEnabled)"
        @lobby="moveLobby"
        @quick="moveQuick"
        @action="handleNavigationAction"
    />
    <dialog ref="versionDialog" class="game-version-dialog" aria-labelledby="game-version-title">
        <h2 id="game-version-title">게임 정보</h2>
        <p>{{ lobbyInfo?.scenarioTitle || 'Core2026' }}</p>
        <p>삼국지 모의전투 Core2026</p>
        <form method="dialog"><button class="legacy-button legacy-button--navigation" type="submit">닫기</button></form>
    </dialog>
</template>

<style scoped>
button {
    font-family: inherit;
    background: none;
    border: none;
    color: inherit;
}

.game-version-dialog {
    width: min(420px, calc(100vw - 32px));
    border: 1px solid #555;
    border-radius: 4px;
    padding: 18px;
    background: #202020;
    color: #fff;
    text-align: center;
}

.game-version-dialog::backdrop {
    background: rgb(0 0 0 / 65%);
}

.game-version-dialog h2,
.game-version-dialog p {
    margin: 0 0 12px;
}

.game-version-dialog form {
    display: flex;
    justify-content: center;
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
    grid-template-rows: 520px minmax(125px, auto) auto;
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
    grid-row: 1 / 3;
    min-height: 645px;
    width: 290px;
    margin-left: 10px;
    overflow: visible;
}

.layout-desktop > [data-main-target='city'] {
    grid-column: 1 / 8;
    grid-row: 2;
    align-self: stretch;
    min-height: 125px;
}

.layout-desktop > [data-main-target='nation'] {
    grid-column: 1 / 6;
    grid-row: 3;
    align-self: stretch;
    min-height: 193px;
}

.layout-desktop > [data-main-target='general'] {
    grid-column: 6 / 11;
    grid-row: 3;
    align-self: stretch;
    min-height: 193px;
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

[data-main-target='city'] :deep(.panel-header) {
    display: none;
}

[data-main-target='map'] :deep(.panel-body),
[data-main-target='city'] :deep(.panel-body) {
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
    box-sizing: border-box;
    height: 21px;
    margin: 0;
    overflow: hidden;
    overflow-wrap: normal;
    line-height: 21px;
    white-space: nowrap;
}

.record-line :deep(.small_war_log) {
    height: 21px;
    line-height: 21px;
    vertical-align: top;
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

.layout-mobile > .mobile-panel--flush {
    margin-top: -4px;
}

.layout-mobile [data-main-target='commands'] {
    min-height: 645px;
    overflow: visible;
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

.desktop-action-controls .game-shell__action {
    font-weight: 400;
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

    .desktop-action-controls {
        gap: 4px;
    }

    .desktop-action-controls .game-shell__action {
        padding-right: 4px;
        padding-left: 4px;
    }

    .main-page {
        width: 500px;
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
