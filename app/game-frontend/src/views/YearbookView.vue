<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import MapViewer from '../components/main/MapViewer.vue';
import { formatLog } from '../utils/formatLog';
import { trpc } from '../utils/trpc';

type YearbookRange = Awaited<ReturnType<typeof trpc.yearbook.getRange.query>>;
type MapLayout = Awaited<ReturnType<typeof trpc.public.getMapLayout.query>>;
type HistoryData = {
    year: number;
    month: number;
    map: Awaited<ReturnType<typeof trpc.public.getCachedMap.query>>;
    nations: Array<{
        id: number;
        name: string;
        color: string;
        level: number;
        power: number;
        cities: string[];
    }>;
    globalHistory: string[];
    globalAction: string[];
};

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const errorMessage = ref('');
const range = ref<YearbookRange | null>(null);
const mapLayout = ref<MapLayout | null>(null);
const history = ref<HistoryData | null>(null);
const selectedYearMonth = ref<number | null>(null);
const serverID = computed(() => {
    const value = route.query.serverID;
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
});

const parseYearMonth = (value: number): { year: number; month: number } => ({
    year: Math.floor(value / 12),
    month: (value % 12) + 1,
});

const availableYearMonths = computed(() => {
    if (!range.value) {
        return [];
    }
    const values: Array<{ value: number; label: string }> = [];
    for (let value = range.value.firstYearMonth; value <= range.value.currentYearMonth; value += 1) {
        const { year, month } = parseYearMonth(value);
        const suffix = value === range.value.currentYearMonth ? ' (현재)' : '';
        values.push({ value, label: `${year}년 ${month}월${suffix}` });
    }
    return values;
});

const closePage = async (): Promise<void> => {
    if (window.opener) {
        window.close();
        return;
    }
    await router.push('/');
};

const loadHistory = async (): Promise<void> => {
    if (selectedYearMonth.value === null) {
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        const { year, month } = parseYearMonth(selectedYearMonth.value);
        const result = await trpc.yearbook.getHistory.query({ year, month, serverID: serverID.value });
        if ('data' in result) {
            history.value = result.data;
        }
    } catch (error) {
        history.value = null;
        errorMessage.value = error instanceof Error ? error.message : '연감 데이터를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const moveMonth = (delta: number): void => {
    if (!range.value || selectedYearMonth.value === null) {
        return;
    }
    selectedYearMonth.value = Math.min(
        range.value.currentYearMonth,
        Math.max(range.value.firstYearMonth, selectedYearMonth.value + delta)
    );
};

watch(selectedYearMonth, () => {
    void loadHistory();
});

onMounted(async () => {
    loading.value = true;
    try {
        const [loadedRange, loadedLayout] = await Promise.all([
            trpc.yearbook.getRange.query(serverID.value ? { serverID: serverID.value } : undefined),
            trpc.public.getMapLayout.query(),
        ]);
        range.value = loadedRange;
        mapLayout.value = loadedLayout;
        selectedYearMonth.value = loadedRange.currentYearMonth;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '연감 범위를 불러오지 못했습니다.';
        loading.value = false;
    }
});
</script>

<template>
    <main id="yearbook-container" class="yearbook-page legacy-bg0">
        <header class="yearbook-title legacy-bg2">
            <strong>연 감</strong>
            <button class="legacy-button" type="button" @click="closePage">창 닫기</button>
        </header>

        <section class="year-selector legacy-border">
            <span>연월 선택:</span>
            <button
                class="legacy-button"
                type="button"
                :disabled="selectedYearMonth === range?.firstYearMonth"
                @click="moveMonth(-1)"
            >
                ◀ 이전달
            </button>
            <select v-model="selectedYearMonth" aria-label="연월 선택">
                <option v-for="option in availableYearMonths" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>
            <button
                class="legacy-button"
                type="button"
                :disabled="selectedYearMonth === range?.currentYearMonth"
                @click="moveMonth(1)"
            >
                다음달 ▶
            </button>
        </section>

        <div v-if="errorMessage" class="yearbook-message error" role="alert">{{ errorMessage }}</div>
        <div v-else-if="loading && !history" class="yearbook-message">불러오는 중...</div>

        <section v-if="history" class="history-grid">
            <div class="map-position">
                <MapViewer :map-data="history.map" :map-layout="mapLayout" :loading="loading" />
            </div>
            <aside class="nation-position">
                <div class="section-heading legacy-bg1">세력 일람</div>
                <table>
                    <thead>
                        <tr>
                            <th>국가</th>
                            <th>국력</th>
                            <th>도시</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="nation in history.nations" :key="nation.id">
                            <td :style="{ color: nation.color }">{{ nation.name }}</td>
                            <td>{{ nation.power.toLocaleString() }}</td>
                            <td>{{ nation.cities.length }}</td>
                        </tr>
                    </tbody>
                </table>
            </aside>
            <article class="history-log">
                <div class="section-heading legacy-bg1">중원 정세</div>
                <div class="log-content">
                    <!-- 레거시 색상 tag만 formatLog가 span으로 변환한다. -->
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <div v-for="(item, index) in history.globalHistory" :key="index" v-html="formatLog(item)" />
                </div>
            </article>
            <article class="history-log">
                <div class="section-heading legacy-bg1">장수 동향</div>
                <div class="log-content">
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <div v-for="(item, index) in history.globalAction" :key="index" v-html="formatLog(item)" />
                </div>
            </article>
        </section>

        <footer class="yearbook-footer">
            <button class="legacy-button" type="button" @click="closePage">창 닫기</button>
        </footer>
    </main>
</template>

<style scoped>
:global(body) {
    min-width: 500px;
}

.yearbook-page {
    width: 1000px;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 14px;
}

.yearbook-title {
    position: relative;
    min-height: 42px;
    border: 1px solid gray;
    text-align: center;
    line-height: 42px;
}

.yearbook-title strong {
    font-size: 20px;
    letter-spacing: 0.35em;
}

.yearbook-title .legacy-button {
    position: absolute;
    top: 5px;
    right: 6px;
}

.legacy-border,
.history-grid,
.map-position,
.nation-position,
.history-log {
    border: 1px solid gray;
}

.year-selector {
    display: grid;
    grid-template-columns: 110px 110px minmax(220px, 1fr) 110px;
    justify-content: center;
    align-items: center;
    gap: 4px;
    min-height: 42px;
    padding: 3px 12px;
    text-align: right;
}

.year-selector select {
    height: 32px;
    border: 1px solid gray;
    background: #191919;
    color: #fff;
    text-align: center;
}

.history-grid {
    display: grid;
    grid-template-columns: 700px 300px;
}

.map-position,
.nation-position {
    min-width: 0;
    padding: 4px;
}

.nation-position table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    text-align: center;
}

.nation-position th,
.nation-position td {
    border: 1px solid #555;
    padding: 4px 2px;
}

.section-heading {
    min-height: 28px;
    border-bottom: 1px solid gray;
    font-weight: 700;
    line-height: 28px;
    text-align: center;
}

.history-log {
    grid-column: 1 / -1;
}

.log-content {
    min-height: 72px;
    padding: 7px 10px;
    line-height: 1.35;
}

.yearbook-message {
    min-height: 80px;
    padding: 24px;
    text-align: center;
}

.error {
    color: #ff9c9c;
}

.yearbook-footer {
    padding: 6px;
    text-align: center;
}

@media (max-width: 1023px) {
    .yearbook-page {
        width: 500px;
    }

    .year-selector {
        grid-template-columns: 90px 100px 190px 100px;
        padding: 3px 5px;
    }

    .history-grid {
        display: flex;
        flex-direction: column;
    }

    .map-position,
    .nation-position {
        width: 100%;
        box-sizing: border-box;
    }
}
</style>
