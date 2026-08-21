<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import GeneralDirectoryTable from '../components/directory/GeneralDirectoryTable.vue';
import LegacySortControls from '../components/ui/LegacySortControls.vue';
import { useGameFeedback } from '../composables/useGameFeedback';
import type { GeneralDirectoryGeneral } from '../types/directory';
import {
    advanceGeneralDirectorySort,
    sortGeneralDirectory,
    type GeneralDirectorySortCriterion,
    type GeneralDirectorySortKey,
} from '../utils/generalDirectorySort';
import { trpc } from '../utils/trpc';

const sortOptions: Array<{ value: GeneralDirectorySortKey; label: string }> = [
    { value: 0, label: '이름' },
    { value: 1, label: '국가' },
    { value: 2, label: '통솔' },
    { value: 3, label: '무력' },
    { value: 4, label: '지력' },
    { value: 5, label: '명성' },
    { value: 6, label: '계급' },
    { value: 7, label: '관직' },
    { value: 8, label: '삭턴' },
    { value: 9, label: '벌점' },
    { value: 10, label: 'Lv' },
    { value: 11, label: '성격' },
    { value: 12, label: '내특' },
    { value: 13, label: '전특' },
    { value: 14, label: '연령' },
    { value: 15, label: 'NPC' },
];

const selectedSort = ref<GeneralDirectorySortKey>(9);
const sourceGenerals = ref<GeneralDirectoryGeneral[]>([]);
const sortCriteria = ref<GeneralDirectorySortCriterion[]>([]);
const loading = ref(false);
const error = ref('');
const router = useRouter();
const { info: showInfoToast } = useGameFeedback();

const generals = computed(() => sortGeneralDirectory(sourceGenerals.value, sortCriteria.value));

const loadDirectory = async () => {
    if (loading.value) {
        showInfoToast('이미 장수 일람을 갱신하고 있습니다.');
        return;
    }
    loading.value = true;
    error.value = '';
    try {
        const result = await trpc.world.getGeneralDirectory.query({ sort: 9 });
        sourceGenerals.value = Array.isArray(result.generals) ? result.generals : [];
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '장수일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const updateSort = (value: number): void => {
    selectedSort.value = value as GeneralDirectorySortKey;
};

const sortByHeader = (value: number): void => {
    updateSort(value);
    sortCriteria.value = advanceGeneralDirectorySort(sortCriteria.value, selectedSort.value);
};

onMounted(() => {
    void loadDirectory();
});
</script>

<template>
    <main class="directory-page" data-page="general-directory">
        <table class="directory-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        장 수 일 람<br />
                        <button class="legacy-button" type="button" @click="router.push('/')">창 닫기</button>
                        <button
                            class="legacy-button"
                            type="button"
                            :aria-busy="loading || undefined"
                            @click="loadDirectory"
                        >
                            갱 신
                        </button>
                    </td>
                </tr>
                <tr>
                    <td>
                        <LegacySortControls
                            control-id="viewType"
                            :model-value="selectedSort"
                            :options="sortOptions"
                            :busy="loading"
                            @update:model-value="updateSort"
                            @submit="sortByHeader(selectedSort)"
                        />
                    </td>
                </tr>
            </tbody>
        </table>

        <p v-if="error" class="directory-error" role="alert">{{ error }}</p>
        <GeneralDirectoryTable
            :generals="generals"
            :loading="loading"
            :sort-criteria="sortCriteria"
            @sort="sortByHeader"
        />

        <table class="directory-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td><button class="legacy-button" type="button" @click="router.push('/')">창 닫기</button></td>
                </tr>
                <tr>
                    <td><small>삼국지 모의전투 HiDCHe</small></td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.directory-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.3;
}
.directory-table {
    width: 1000px;
    border-collapse: collapse;
    table-layout: auto;
    padding: 0;
    font-size: 14px;
    word-break: break-all;
}
.directory-table td {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}
/* Ref's title table keeps the default cell alignment and zero cell padding. */
.directory-page > .title-table:first-child {
    height: 80.875px;
}
.legacy-button {
    padding: 5px 10px;
    font-size: 14px;
}
.directory-error {
    width: 998px;
    margin: 0;
    border: 1px solid gray;
    padding: 8px 0;
    text-align: center;
    color: #ff7373;
}

@media (max-width: 600px) {
    .directory-page {
        width: 100%;
        max-width: 500px;
        margin: 0;
    }
    .directory-table {
        width: 100%;
    }
    .directory-error {
        box-sizing: border-box;
        width: 100%;
    }
}
</style>
