<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { trpc } from '../utils/trpc';

type DynastyEntry = {
    id: number;
    serverId: string;
    phase: string;
    name: string;
    year: number;
    month: number;
    color: string;
    type: string;
    power: number;
    gennum: number;
    citynum: number;
};

type DynastyListPayload = {
    entries: DynastyEntry[];
};

const loading = ref(false);
const errorMessage = ref('');
const entries = ref<DynastyEntry[]>([]);

const loadDynasty = async () => {
    loading.value = true;
    errorMessage.value = '';
    try {
        const result = (await trpc.dynasty.getList.query()) as DynastyListPayload;
        entries.value = result.entries;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '왕조일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

onMounted(async () => {
    await loadDynasty();
});
</script>

<template>
    <main class="main-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">왕조일람</h1>
                <p class="page-subtitle">천하통일로 정리된 왕조 기록을 확인합니다.</p>
            </div>
            <div class="header-actions">
                <button class="ghost" @click="loadDynasty">목록 새로고침</button>
            </div>
        </header>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-else-if="loading" class="placeholder">불러오는 중...</div>
        <div v-else-if="entries.length === 0" class="placeholder">표시할 왕조 기록이 없습니다.</div>

        <section v-else class="grid gap-4">
            <RouterLink
                v-for="entry in entries"
                :key="entry.id"
                class="block bg-zinc-900 border border-zinc-800 rounded p-4 hover:border-zinc-600 transition"
                :to="`/dynasty/${entry.id}`"
            >
                <div class="flex items-center gap-3 mb-2">
                    <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: entry.color }" />
                    <div>
                        <h2 class="text-lg font-semibold">{{ entry.name }}</h2>
                        <p class="text-xs text-zinc-400">
                            {{ entry.phase }} · {{ entry.year }}년 {{ entry.month }}월
                        </p>
                    </div>
                </div>
                <div class="grid sm:grid-cols-3 gap-2 text-sm text-zinc-300">
                    <div>세력 유형: {{ entry.type || '미상' }}</div>
                    <div>도시: {{ entry.citynum }}개</div>
                    <div>장수: {{ entry.gennum }}명</div>
                    <div class="sm:col-span-3">국력: {{ entry.power }}</div>
                </div>
            </RouterLink>
        </section>
    </main>
</template>
