<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { trpc } from '../utils/trpc';

type EmperorDetail = {
    id: number;
    serverId: string;
    winnerNationId: number | null;
    phase: string;
    nationCount: string;
    nationName: string;
    nationHist: string;
    genCount: string;
    personalHist: string;
    specialHist: string;
    name: string;
    type: string;
    color: string;
    year: number;
    month: number;
    power: number;
    gennum: number;
    citynum: number;
    pop: string;
    poprate: string;
    gold: number;
    rice: number;
    l12name: string;
    l11name: string;
    l10name: string;
    l9name: string;
    l8name: string;
    l7name: string;
    l6name: string;
    l5name: string;
    tiger: string;
    eagle: string;
    gen: string;
    history: string[];
};

type NationEntry = {
    nation: number;
    isWinner: boolean;
    name: string;
    color: string;
    type: string;
    level: number | null;
    tech: number | null;
    maxPower: number | null;
    maxCrew: number | null;
    maxCities: number[];
    generals: number[];
    history: string[];
    date: string;
    generalsFull: Array<{ generalNo: number; name: string; lastYearMonth: number | null }>;
};

type DynastyDetailPayload = {
    emperor: EmperorDetail;
    nations: NationEntry[];
};

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const errorMessage = ref('');
const data = ref<DynastyDetailPayload | null>(null);

const emperorId = computed(() => {
    const idParam = route.params.id;
    const raw = Array.isArray(idParam) ? idParam[0] : idParam;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
});

const dynastyApi = trpc as unknown as {
    dynasty: {
        getDetail: {
            query: (input: { emperorId: number }) => Promise<DynastyDetailPayload>;
        };
    };
};

const loadDetail = async () => {
    if (emperorId.value === null) {
        errorMessage.value = '잘못된 왕조 번호입니다.';
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await dynastyApi.dynasty.getDetail.query({
            emperorId: emperorId.value,
        });
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '왕조 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

watch(emperorId, () => {
    void loadDetail();
});

onMounted(async () => {
    await loadDetail();
});
</script>

<template>
    <main class="main-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">왕조 상세</h1>
                <p class="page-subtitle">통일 세력과 멸망한 국가의 기록입니다.</p>
            </div>
            <div class="header-actions">
                <button class="ghost" @click="router.push('/dynasty')">목록으로</button>
                <button class="ghost" @click="loadDetail">데이터 새로고침</button>
            </div>
        </header>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-else-if="loading" class="placeholder">불러오는 중...</div>
        <div v-else-if="!data" class="placeholder">표시할 데이터가 없습니다.</div>

        <section v-if="data" class="grid gap-4">
            <article class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <div class="flex items-center gap-3 mb-3">
                    <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: data.emperor.color }" />
                    <div>
                        <h2 class="text-lg font-semibold">{{ data.emperor.name }}</h2>
                        <p class="text-xs text-zinc-400">{{ data.emperor.phase }} · {{ data.emperor.year }}년 {{ data.emperor.month }}월</p>
                    </div>
                </div>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm text-zinc-300">
                    <div>국력: {{ data.emperor.power }}</div>
                    <div>도시: {{ data.emperor.citynum }}개</div>
                    <div>장수: {{ data.emperor.gennum }}명</div>
                    <div>인구: {{ data.emperor.pop }}</div>
                    <div>인구율: {{ data.emperor.poprate }}</div>
                    <div>금/쌀: {{ data.emperor.gold }} / {{ data.emperor.rice }}</div>
                </div>
            </article>

            <article class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <h3 class="text-base font-semibold mb-2">왕조 구성</h3>
                <div class="grid sm:grid-cols-2 gap-2 text-sm text-zinc-300">
                    <div>세력 수: {{ data.emperor.nationCount }}</div>
                    <div>장수 수: {{ data.emperor.genCount }}</div>
                    <div>세력 목록: {{ data.emperor.nationName }}</div>
                    <div>세력 유형: {{ data.emperor.nationHist }}</div>
                </div>
            </article>

            <article class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <h3 class="text-base font-semibold mb-2">관직</h3>
                <ul class="grid sm:grid-cols-2 gap-2 text-sm text-zinc-300">
                    <li v-if="data.emperor.l12name">승상: {{ data.emperor.l12name }}</li>
                    <li v-if="data.emperor.l11name">태사: {{ data.emperor.l11name }}</li>
                    <li v-if="data.emperor.l10name">태부: {{ data.emperor.l10name }}</li>
                    <li v-if="data.emperor.l9name">태위: {{ data.emperor.l9name }}</li>
                    <li v-if="data.emperor.l8name">사도: {{ data.emperor.l8name }}</li>
                    <li v-if="data.emperor.l7name">사공: {{ data.emperor.l7name }}</li>
                    <li v-if="data.emperor.l6name">상서령: {{ data.emperor.l6name }}</li>
                    <li v-if="data.emperor.l5name">상서: {{ data.emperor.l5name }}</li>
                </ul>
                <div v-if="!data.emperor.l12name && !data.emperor.l11name" class="text-xs text-zinc-500">등록된 관직 정보가 없습니다.</div>
            </article>

            <article class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <h3 class="text-base font-semibold mb-2">장수 기록</h3>
                <div class="text-sm text-zinc-300 space-y-2">
                    <div>
                        <span class="text-xs text-zinc-400">호랑이(전공):</span>
                        <div>{{ data.emperor.tiger || '기록 없음' }}</div>
                    </div>
                    <div>
                        <span class="text-xs text-zinc-400">독수리(방화):</span>
                        <div>{{ data.emperor.eagle || '기록 없음' }}</div>
                    </div>
                    <div>
                        <span class="text-xs text-zinc-400">헌납 순위:</span>
                        <div>{{ data.emperor.gen || '기록 없음' }}</div>
                    </div>
                </div>
            </article>

            <article class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <h3 class="text-base font-semibold mb-2">통일 세력 연표</h3>
                <div v-if="data.emperor.history.length === 0" class="text-xs text-zinc-500">연표가 없습니다.</div>
                <ul v-else class="space-y-2 text-sm text-zinc-300">
                    <li v-for="(entry, index) in data.emperor.history" :key="`${data.emperor.id}-hist-${index}`">
                        {{ entry }}
                    </li>
                </ul>
            </article>

            <section class="grid gap-4">
                <header class="flex items-center justify-between">
                    <h3 class="text-base font-semibold">국가 기록</h3>
                    <span class="text-xs text-zinc-400">총 {{ data.nations.length }}개</span>
                </header>

                <article
                    v-for="nation in data.nations"
                    :key="nation.nation"
                    class="bg-zinc-900 border border-zinc-800 rounded p-4"
                >
                    <div class="flex items-center gap-3 mb-2">
                        <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: nation.color }" />
                        <div>
                            <h4 class="text-base font-semibold">
                                {{ nation.name }}
                                <span
                                    v-if="nation.isWinner"
                                    class="ml-2 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200"
                                >
                                    통일 세력
                                </span>
                            </h4>
                            <p class="text-xs text-zinc-400">{{ nation.type || '미상' }} · {{ new Date(nation.date).toLocaleString() }}</p>
                        </div>
                    </div>
                    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm text-zinc-300 mb-3">
                        <div>레벨: {{ nation.level ?? '-' }}</div>
                        <div>기술: {{ nation.tech ?? '-' }}</div>
                        <div>최대 국력: {{ nation.maxPower ?? '-' }}</div>
                        <div>최대 병력: {{ nation.maxCrew ?? '-' }}</div>
                        <div>최대 도시: {{ nation.maxCities.join(', ') || '-' }}</div>
                        <div>장수 수: {{ nation.generals.length }}</div>
                    </div>
                    <div class="text-sm text-zinc-300">
                        <h5 class="text-xs text-zinc-400 mb-1">장수 목록</h5>
                        <div v-if="nation.generalsFull.length === 0" class="text-xs text-zinc-500">기록된 장수가 없습니다.</div>
                        <ul v-else class="flex flex-wrap gap-2">
                            <li
                                v-for="general in nation.generalsFull"
                                :key="general.generalNo"
                                class="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs"
                            >
                                {{ general.name }}<span v-if="general.lastYearMonth"> ({{ general.lastYearMonth }})</span>
                            </li>
                        </ul>
                    </div>
                    <div class="text-sm text-zinc-300 mt-3">
                        <h5 class="text-xs text-zinc-400 mb-1">국가 연표</h5>
                        <div v-if="nation.history.length === 0" class="text-xs text-zinc-500">연표가 없습니다.</div>
                        <ul v-else class="space-y-1">
                            <li v-for="(entry, index) in nation.history" :key="`${nation.nation}-hist-${index}`">
                                {{ entry }}
                            </li>
                        </ul>
                    </div>
                </article>
            </section>
        </section>
    </main>
</template>
