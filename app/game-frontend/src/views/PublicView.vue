<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import MapViewer from '../components/main/MapViewer.vue';
import RecentLogList from '../components/main/RecentLogList.vue';
import { trpc } from '../utils/trpc';
import { sortGeneralsByTypeThenName } from '../utils/generalOrder';
import { useSessionStore } from '../stores/session';

type MapData = Awaited<ReturnType<typeof trpc.public.getCachedMap.query>>;
type MapLayout = Awaited<ReturnType<typeof trpc.public.getMapLayout.query>>;
type WorldTrend = Awaited<ReturnType<typeof trpc.public.getWorldTrend.query>>;
type NationSummary = Awaited<ReturnType<typeof trpc.public.getNationList.query>>[number];
type GeneralSummary = Awaited<ReturnType<typeof trpc.public.getGeneralList.query>>[number];

const session = useSessionStore();
const isMobile = useMediaQuery('(max-width: 1024px)');

const loading = ref(false);
const error = ref<string | null>(null);

const mapData = ref<MapData | null>(null);
const mapLayout = ref<MapLayout | null>(null);
const worldTrend = ref<WorldTrend | null>(null);
const nationList = ref<NationSummary[]>([]);
const generalList = ref<GeneralSummary[]>([]);

const generalFilter = ref('');

const filteredGenerals = computed(() => {
    const keyword = generalFilter.value.trim().toLowerCase();
    const filtered = keyword
        ? generalList.value.filter((general) => {
              return general.name.toLowerCase().includes(keyword) || general.nationName.toLowerCase().includes(keyword);
          })
        : generalList.value;
    return sortGeneralsByTypeThenName(filtered);
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

const loadPublicData = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        const layoutPromise = mapLayout.value ? Promise.resolve(mapLayout.value) : trpc.public.getMapLayout.query();
        const [layout, map, trend, nations, generals] = await Promise.all([
            layoutPromise,
            trpc.public.getCachedMap.query(),
            trpc.public.getWorldTrend.query(),
            trpc.public.getNationList.query(),
            trpc.public.getGeneralList.query(),
        ]);

        mapLayout.value = layout;
        mapData.value = map;
        worldTrend.value = trend;
        nationList.value = nations;
        generalList.value = generals;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const refreshPublicData = async () => {
    await loadPublicData();
};

const trendSummary = computed(() => {
    if (!worldTrend.value) {
        return '동향 정보를 불러오는 중';
    }
    return `${worldTrend.value.year}년 ${worldTrend.value.month}월 · ${worldTrend.value.turnTerm}분 턴`;
});

onMounted(() => {
    void loadPublicData();
});
</script>

<template>
    <main class="game-shell public-page">
        <header class="game-shell__header">
            <div>
                <h1 class="game-shell__title">공개 동향</h1>
                <p class="game-shell__subtitle">{{ trendSummary }}</p>
                <p class="page-hint">지도/정세는 10분 캐시된 정보로 제공됩니다.</p>
            </div>
            <div class="game-shell__actions">
                <RouterLink v-if="!session.isAuthed" class="game-shell__action" to="/login">로그인</RouterLink>
                <RouterLink v-else-if="session.needsGeneral" class="game-shell__action" to="/join">장수 생성/빙의</RouterLink>
                <RouterLink v-else class="game-shell__action" to="/">메인으로</RouterLink>
                <RouterLink class="game-shell__action" to="/npc-list">빙의일람</RouterLink>
                <RouterLink class="game-shell__action" to="/traffic">접속량정보</RouterLink>
                <button class="game-shell__action" @click="refreshPublicData">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>

        <section v-if="isMobile" class="layout-mobile">
            <PanelCard title="캐시 지도">
                <MapViewer :map-data="mapData" :map-layout="mapLayout" :loading="loading" />
            </PanelCard>
            <PanelCard title="중원 정세">
                <SkeletonLines v-if="loading" :lines="3" />
                <RecentLogList v-else :logs="mapData?.history" />
            </PanelCard>
            <PanelCard title="세력 일람">
                <SkeletonLines v-if="loading" :lines="4" />
                <div v-else class="table-scroll">
                    <table class="public-table">
                        <thead>
                            <tr>
                                <th>세력</th>
                                <th>장수</th>
                                <th>도시</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="nation in nationList" :key="nation.id">
                                <td>
                                    <span class="nation-swatch" :style="{ backgroundColor: nation.color }" />
                                    {{ nation.name }}
                                </td>
                                <td>{{ nation.generalCount }}</td>
                                <td>{{ nation.cityCount }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </PanelCard>
            <PanelCard title="장수 일람">
                <div class="list-head">
                    <input v-model="generalFilter" class="filter-input" placeholder="장수/국가 검색" />
                    <div class="list-count">총 {{ filteredGenerals.length }}명</div>
                </div>
                <SkeletonLines v-if="loading" :lines="5" />
                <div v-else class="table-scroll">
                    <table class="public-table">
                        <thead>
                            <tr>
                                <th>이름</th>
                                <th>국가</th>
                                <th>통솔</th>
                                <th>무력</th>
                                <th>지력</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="general in filteredGenerals" :key="general.id">
                                <td>
                                    <span v-if="general.npcState > 0" class="npc-tag">NPC</span>
                                    {{ general.name }}
                                </td>
                                <td>{{ general.nationName }}</td>
                                <td>{{ general.leadership }}</td>
                                <td>{{ general.strength }}</td>
                                <td>{{ general.intelligence }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </PanelCard>
        </section>

        <section v-else class="layout-desktop">
            <div class="stack">
                <PanelCard title="캐시 지도" subtitle="10분 캐시된 공개 지도">
                    <MapViewer :map-data="mapData" :map-layout="mapLayout" :loading="loading" />
                </PanelCard>
                <PanelCard title="중원 정세">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <RecentLogList v-else :logs="mapData?.history" />
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="세력 일람">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="table-scroll">
                        <table class="public-table">
                            <thead>
                                <tr>
                                    <th>세력</th>
                                    <th>장수</th>
                                    <th>도시</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="nation in nationList" :key="nation.id">
                                    <td>
                                        <span class="nation-swatch" :style="{ backgroundColor: nation.color }" />
                                        {{ nation.name }}
                                    </td>
                                    <td>{{ nation.generalCount }}</td>
                                    <td>{{ nation.cityCount }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </PanelCard>
                <PanelCard title="장수 일람">
                    <div class="list-head">
                        <input v-model="generalFilter" class="filter-input" placeholder="장수/국가 검색" />
                        <div class="list-count">총 {{ filteredGenerals.length }}명</div>
                    </div>
                    <SkeletonLines v-if="loading" :lines="6" />
                    <div v-else class="table-scroll">
                        <table class="public-table">
                            <thead>
                                <tr>
                                    <th>이름</th>
                                    <th>국가</th>
                                    <th>통솔</th>
                                    <th>무력</th>
                                    <th>지력</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="general in filteredGenerals" :key="general.id">
                                    <td>
                                        <span v-if="general.npcState > 0" class="npc-tag">NPC</span>
                                        {{ general.name }}
                                    </td>
                                    <td>{{ general.nationName }}</td>
                                    <td>{{ general.leadership }}</td>
                                    <td>{{ general.strength }}</td>
                                    <td>{{ general.intelligence }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.page-hint {
    margin-top: 6px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.5);
}

.layout-desktop {
    display: grid;
    grid-template-columns: minmax(320px, 1.3fr) minmax(320px, 1fr);
    gap: 16px;
}

.layout-mobile {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.placeholder {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.table-scroll {
    overflow-x: auto;
    max-height: 360px;
    overflow-y: auto;
}

.public-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
}

.public-table th,
.public-table td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.2);
    text-align: left;
}

.public-table thead th {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.nation-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.4);
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

.list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.filter-input {
    flex: 1;
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.8);
    color: rgba(232, 221, 196, 0.9);
    padding: 6px 8px;
    font-size: 0.75rem;
}

.list-count {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
    white-space: nowrap;
}
</style>
