<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { trpc } from '../utils/trpc';

type RankEntry = {
    id: number;
    name: string;
    ownerName: string | null;
    nationName: string;
    bgColor: string;
    fgColor: string;
    picture: string | null;
    imageServer: number;
    value: number;
    printValue: string;
};

type RankSection = {
    title: string;
    valueType: 'int' | 'percent';
    entries: RankEntry[];
};

type UniqueOwner = {
    id: number;
    name: string;
    nationName: string;
    bgColor: string;
    fgColor: string;
};

type UniqueItemSection = {
    title: string;
    slot: string;
    owners: UniqueOwner[];
};

type BestGeneralPayload = {
    isUnited: boolean;
    sections: RankSection[];
    uniqueItems: UniqueItemSection[];
};

const viewMode = ref<'user' | 'npc'>('user');
const loading = ref(false);
const errorMessage = ref('');
const data = ref<BestGeneralPayload | null>(null);

const refresh = async () => {
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.ranking.getBestGeneral.query({ view: viewMode.value });
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '명장일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const emptyLabel = computed(() => (loading.value ? '불러오는 중...' : '표시할 데이터가 없습니다.'));

onMounted(() => {
    void refresh();
});

watch(viewMode, () => {
    void refresh();
});
</script>

<template>
    <main class="main-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">명장일람</h1>
                <p class="page-subtitle">전장 기록을 기준으로 장수 순위를 확인합니다.</p>
            </div>
            <div class="header-actions">
                <button class="ghost" :class="{ active: viewMode === 'user' }" @click="viewMode = 'user'">
                    유저 보기
                </button>
                <button class="ghost" :class="{ active: viewMode === 'npc' }" @click="viewMode = 'npc'">
                    NPC 보기
                </button>
                <button class="ghost" @click="refresh">새로고침</button>
            </div>
        </header>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-else-if="!data" class="placeholder">{{ emptyLabel }}</div>

        <section v-if="data" class="grid gap-4">
            <div v-for="section in data.sections" :key="section.title" class="bg-zinc-900 border border-zinc-800 rounded p-4">
                <h2 class="text-base font-semibold mb-3">{{ section.title }}</h2>
                <div v-if="section.entries.length === 0" class="text-xs text-zinc-500">{{ emptyLabel }}</div>
                <ul v-else class="space-y-2">
                    <li
                        v-for="entry in section.entries"
                        :key="entry.id"
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

        <section v-if="data" class="mt-6 bg-zinc-900 border border-zinc-800 rounded p-4">
            <h2 class="text-base font-semibold mb-3">유니크 아이템 소유자</h2>
            <div class="grid md:grid-cols-2 gap-4">
                <div v-for="item in data.uniqueItems" :key="item.title" class="bg-zinc-950 border border-zinc-800 rounded p-3">
                    <h3 class="text-sm font-semibold mb-2">{{ item.title }}</h3>
                    <ul class="space-y-1 text-xs">
                        <li v-for="owner in item.owners" :key="owner.id" class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: owner.bgColor }" />
                            <span>{{ owner.name }}</span>
                            <span class="text-zinc-500">{{ owner.nationName }}</span>
                        </li>
                    </ul>
                </div>
            </div>
        </section>
    </main>
</template>
