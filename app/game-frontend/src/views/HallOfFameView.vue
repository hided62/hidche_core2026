<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { trpc } from '../utils/trpc';

type HallOption = {
    season: number;
    scenarios: Array<{ id: number; name: string; count: number }>;
};

type HallEntry = {
    generalId: number;
    name: string;
    nationName: string;
    bgColor: string;
    fgColor: string;
    value: number;
    printValue: string;
    serverName: string;
    serverIdx: number;
    scenarioName: string;
    startTime: string | null;
    unitedTime: string | null;
};

type HallSection = {
    title: string;
    valueType: 'int' | 'percent';
    entries: HallEntry[];
};

type HallPayload = {
    sections: HallSection[];
};

const loading = ref(false);
const errorMessage = ref('');
const options = ref<HallOption[]>([]);
const selectedSeason = ref<number | null>(null);
const selectedScenario = ref<number | null>(null);
const data = ref<HallPayload | null>(null);

const selectedSeasonOptions = computed(() => {
    if (selectedSeason.value === null) {
        return [];
    }
    return options.value.find((season) => season.season === selectedSeason.value)?.scenarios ?? [];
});

const loadOptions = async () => {
    try {
        options.value = await trpc.ranking.getHallOfFameOptions.query();
        if (options.value.length > 0 && selectedSeason.value === null) {
            selectedSeason.value = options.value[0]!.season;
        }
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '명예의 전당 옵션을 불러오지 못했습니다.';
    }
};

const loadHall = async () => {
    if (selectedSeason.value === null) {
        data.value = null;
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        const result = await trpc.ranking.getHallOfFame.query({
            season: selectedSeason.value,
            scenario: selectedScenario.value ?? undefined,
        });
        data.value = result as HallPayload;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '명예의 전당 데이터를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

watch(selectedSeason, () => {
    selectedScenario.value = null;
    void loadHall();
});

watch(selectedScenario, () => {
    void loadHall();
});

onMounted(async () => {
    await loadOptions();
    await loadHall();
});
</script>

<template>
    <main class="main-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">명예의 전당</h1>
                <p class="page-subtitle">시즌별 최고 기록을 확인합니다.</p>
            </div>
            <div class="header-actions">
                <button class="ghost" @click="loadOptions">목록 새로고침</button>
                <button class="ghost" @click="loadHall">데이터 새로고침</button>
            </div>
        </header>

        <div class="bg-zinc-900 border border-zinc-800 rounded p-4 mb-4">
            <div class="grid md:grid-cols-2 gap-4">
                <label class="flex flex-col gap-2 text-sm">
                    <span class="text-xs text-zinc-400">시즌 선택</span>
                    <select v-model.number="selectedSeason" class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2">
                        <option v-for="season in options" :key="season.season" :value="season.season">
                            시즌 {{ season.season }}
                        </option>
                    </select>
                </label>
                <label class="flex flex-col gap-2 text-sm">
                    <span class="text-xs text-zinc-400">시나리오 선택</span>
                    <select v-model.number="selectedScenario" class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2">
                        <option :value="null">전체</option>
                        <option v-for="scenario in selectedSeasonOptions" :key="scenario.id" :value="scenario.id">
                            {{ scenario.name }} ({{ scenario.count }}회)
                        </option>
                    </select>
                </label>
            </div>
        </div>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-else-if="loading" class="placeholder">불러오는 중...</div>
        <div v-else-if="!data" class="placeholder">표시할 데이터가 없습니다.</div>

        <section v-if="data" class="grid gap-4">
            <div v-for="section in data.sections" :key="section.title" class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <h2 class="text-base font-semibold mb-3">{{ section.title }}</h2>
                <div v-if="section.entries.length === 0" class="text-xs text-zinc-500">표시할 데이터가 없습니다.</div>
                <ul v-else class="space-y-2">
                    <li
                        v-for="entry in section.entries"
                        :key="entry.generalId"
                        class="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
                    >
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: entry.bgColor }" />
                            <span class="font-semibold">{{ entry.name }}</span>
                            <span class="text-xs text-zinc-400">{{ entry.nationName }}</span>
                        </div>
                        <div class="text-xs text-zinc-200">{{ entry.printValue }}</div>
                    </li>
                </ul>
            </div>
        </section>
    </main>
</template>
