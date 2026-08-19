<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import GeneralDirectoryTable from '../components/directory/GeneralDirectoryTable.vue';
import type { GeneralDirectoryGeneral } from '../types/directory';
import { trpc } from '../utils/trpc';

type SortKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

const sortOptions: Array<{ value: SortKey; label: string }> = [
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

const sort = ref<SortKey>(9);
const generals = ref<GeneralDirectoryGeneral[]>([]);
const loading = ref(false);
const error = ref('');
const router = useRouter();

const loadDirectory = async () => {
    loading.value = true;
    error.value = '';
    try {
        const result = await trpc.world.getGeneralDirectory.query({ sort: sort.value });
        generals.value = result.generals;
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '장수일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
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
                        장 수 일 람<br /><button class="legacy-button" type="button" @click="router.push('/')">
                            창 닫기
                        </button>
                    </td>
                </tr>
                <tr>
                    <td>
                        <form class="sort-form" @submit.prevent="loadDirectory">
                            <label for="viewType">정렬순서 : </label>
                            <select id="viewType" v-model.number="sort" name="type" size="1">
                                <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </option>
                            </select>
                            <input type="submit" value="정렬하기" />
                        </form>
                    </td>
                </tr>
            </tbody>
        </table>

        <p v-if="error" class="directory-error" role="alert">{{ error }}</p>
        <GeneralDirectoryTable :generals="generals" :loading="loading" />

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
.sort-form {
    margin: 0;
}
.sort-form select,
.sort-form button {
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
</style>
