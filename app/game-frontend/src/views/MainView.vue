<script setup lang="ts">
import { ref, watch } from 'vue';
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
import { useSessionStore } from '../stores/session';
import { useMainDashboardStore } from '../stores/mainDashboard';

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

const {
    loading,
    error,
    realtimeEnabled,
    general,
    city,
    nation,
    lobbyInfo,
    worldMap,
    mapLayout,
    selectedCity,
    commandTable,
    messages,
    messageDraftText,
    targetMailbox,
    mailboxOptions,
    statusLine,
    realtimeLabel,
} = storeToRefs(dashboard);

const loadMainData = async () => {
    await dashboard.loadMainData();
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
    <main class="main-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">전장 현황</h1>
                <p class="page-subtitle">{{ statusLine }}</p>
            </div>
            <div class="header-actions">
                <button
                    class="toggle"
                    :class="{ active: realtimeEnabled }"
                    @click="dashboard.setRealtimeEnabled(!realtimeEnabled)"
                >
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
                    <MapViewer :map-data="worldMap" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
                <PanelCard title="선택 도시">
                    <SelectedCityPanel :city="selectedCity" :loading="loading" />
                </PanelCard>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'commands'">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역">
                    <CommandListPanel :command-table="commandTable" :loading="loading" :selected-city="selectedCity" />
                </PanelCard>
            </div>

            <div class="mobile-panel" v-if="mobileTab === 'status'">
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
                    <MessagePanel
                        :messages="messages"
                        :loading="loading"
                        :target-mailbox="targetMailbox"
                        :draft-text="messageDraftText"
                        :mailbox-options="mailboxOptions"
                        @update:target-mailbox="targetMailbox = $event"
                        @update:draft-text="messageDraftText = $event"
                        @send="dashboard.sendMessage"
                        @load-older="dashboard.loadOlderMessages"
                        @refresh="dashboard.refreshMessages"
                    />
                </PanelCard>
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
                <PanelCard title="중원 정세">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else class="placeholder">
                        <div>유저 {{ lobbyInfo?.userCnt ?? '-' }} / {{ lobbyInfo?.maxUserCnt ?? '-' }}</div>
                        <div>NPC {{ lobbyInfo?.npcCnt ?? '-' }}</div>
                        <div>세력 {{ lobbyInfo?.nationCnt ?? '-' }}</div>
                    </div>
                </PanelCard>
                <PanelCard title="메시지함">
                    <MessagePanel
                        :messages="messages"
                        :loading="loading"
                        :target-mailbox="targetMailbox"
                        :draft-text="messageDraftText"
                        :mailbox-options="mailboxOptions"
                        @update:target-mailbox="targetMailbox = $event"
                        @update:draft-text="messageDraftText = $event"
                        @send="dashboard.sendMessage"
                        @load-older="dashboard.loadOlderMessages"
                        @refresh="dashboard.refreshMessages"
                    />
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="명령 목록" subtitle="예턴/명령 배치 영역">
                    <CommandListPanel :command-table="commandTable" :loading="loading" :selected-city="selectedCity" />
                </PanelCard>
                <PanelCard title="장수 스탯">
                    <GeneralBasicCard :general="general" :loading="loading" />
                </PanelCard>
                <PanelCard title="장수 동향">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="placeholder">장수 동향은 실시간 스트림으로 연결 예정</div>
                </PanelCard>
                <PanelCard title="도시 정보">
                    <CityBasicCard :city="city" :loading="loading" />
                </PanelCard>
                <PanelCard title="국가 정보">
                    <NationBasicCard :nation="nation" :loading="loading" />
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
