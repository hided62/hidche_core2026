<script setup lang="ts">
import { onMounted, ref } from 'vue';

import LegacySortControls from '../components/ui/LegacySortControls.vue';
import { getNpcColor } from '../utils/npcColor';
import { trpc } from '../utils/trpc';

type NpcList = Awaited<ReturnType<typeof trpc.public.getNpcList.query>>;
type NpcListSort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const sort = ref<NpcListSort>(1);
const data = ref<NpcList | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const sortOptions = ['이름', '국가', '종능', '통솔', '무력', '지력', '명성', '계급'].map((label, index) => ({
    value: index + 1,
    label,
}));

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : '요청을 처리하지 못했습니다.';
};

const load = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.public.getNpcList.query({ sort: sort.value });
    } catch (error) {
        // Keep both the selected sort and the last successful table after a failed refresh.
        errorMessage.value = getErrorMessage(error);
    } finally {
        loading.value = false;
    }
};

const closeWindow = () => window.close();
const updateSort = (value: number): void => {
    sort.value = value as NpcListSort;
};
const sortByHeader = (value: NpcListSort): void => {
    updateSort(value);
    void load();
};
const sortIndicator = (value: NpcListSort, direction: 'ascending' | 'descending'): string =>
    sort.value === value ? (direction === 'ascending' ? '▲' : '▼') : '↕';

onMounted(() => {
    void load();
});
</script>

<template>
    <main id="npc-list-container" class="npc-list-page">
        <table class="legacy-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        빙 의 일 람<br />
                        <button class="legacy-close" type="button" @click="closeWindow">창닫기</button>
                    </td>
                </tr>
                <tr>
                    <td>
                        <LegacySortControls
                            control-id="npc-list-sort"
                            :model-value="sort"
                            :options="sortOptions"
                            :busy="loading"
                            @update:model-value="updateSort"
                            @submit="load"
                        />
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="errorMessage" class="npc-error" role="alert">{{ errorMessage }}</div>
        <div v-if="loading && !data" class="npc-loading">불러오는 중...</div>

        <table v-if="data" class="legacy-table npc-table legacy-bg0">
            <colgroup>
                <col class="col-name" />
                <col class="col-owner" />
                <col class="col-level" />
                <col class="col-nation" />
                <col class="col-personality" />
                <col class="col-special" />
                <col class="col-stat" />
                <col class="col-leadership" />
                <col class="col-strength" />
                <col class="col-intelligence" />
                <col class="col-experience" />
                <col class="col-dedication" />
            </colgroup>
            <thead>
                <tr class="legacy-bg1">
                    <th :aria-sort="sort === 1 ? 'ascending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="이름 기준 정렬"
                            @click="sortByHeader(1)"
                        >
                            희생된 장수<span class="legacy-sort-indicator">{{ sortIndicator(1, 'ascending') }}</span>
                        </button>
                    </th>
                    <th>악령 이름</th>
                    <th>레벨</th>
                    <th :aria-sort="sort === 2 ? 'ascending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="국가 기준 정렬"
                            @click="sortByHeader(2)"
                        >
                            국가<span class="legacy-sort-indicator">{{ sortIndicator(2, 'ascending') }}</span>
                        </button>
                    </th>
                    <th>성격</th>
                    <th>특기</th>
                    <th :aria-sort="sort === 3 ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="종능 기준 정렬"
                            @click="sortByHeader(3)"
                        >
                            종능<span class="legacy-sort-indicator">{{ sortIndicator(3, 'descending') }}</span>
                        </button>
                    </th>
                    <th :aria-sort="sort === 4 ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="통솔 기준 정렬"
                            @click="sortByHeader(4)"
                        >
                            통솔<span class="legacy-sort-indicator">{{ sortIndicator(4, 'descending') }}</span>
                        </button>
                    </th>
                    <th :aria-sort="sort === 5 ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="무력 기준 정렬"
                            @click="sortByHeader(5)"
                        >
                            무력<span class="legacy-sort-indicator">{{ sortIndicator(5, 'descending') }}</span>
                        </button>
                    </th>
                    <th :aria-sort="sort === 6 ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="지력 기준 정렬"
                            @click="sortByHeader(6)"
                        >
                            지력<span class="legacy-sort-indicator">{{ sortIndicator(6, 'descending') }}</span>
                        </button>
                    </th>
                    <th :aria-sort="sort === 7 ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="명성 기준 정렬"
                            @click="sortByHeader(7)"
                        >
                            명성<span class="legacy-sort-indicator">{{ sortIndicator(7, 'descending') }}</span>
                        </button>
                    </th>
                    <th :aria-sort="sort === 8 ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="계급 기준 정렬"
                            @click="sortByHeader(8)"
                        >
                            계급<span class="legacy-sort-indicator">{{ sortIndicator(8, 'descending') }}</span>
                        </button>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="general in data.generals" :key="general.id" :data-general-id="general.id">
                    <td :style="{ color: getNpcColor(general.npcState) }">{{ general.name }}</td>
                    <td>{{ general.ownerName }}</td>
                    <td>Lv {{ general.level }}</td>
                    <td>{{ general.nationName }}</td>
                    <td>
                        <span v-if="general.personality" class="trait-tooltip" tabindex="0">
                            {{ general.personality.name }}
                            <span role="tooltip">{{ general.personality.info }}</span>
                        </span>
                        <span v-else>-</span>
                    </td>
                    <td>
                        <span v-if="general.specialDomestic" class="trait-tooltip" tabindex="0">
                            {{ general.specialDomestic.name }}
                            <span role="tooltip">{{ general.specialDomestic.info }}</span>
                        </span>
                        <span v-else>-</span>
                        /
                        <span v-if="general.specialWar" class="trait-tooltip" tabindex="0">
                            {{ general.specialWar.name }}
                            <span role="tooltip">{{ general.specialWar.info }}</span>
                        </span>
                        <span v-else>-</span>
                    </td>
                    <td>{{ general.statTotal }}</td>
                    <td>{{ general.leadership }}</td>
                    <td>{{ general.strength }}</td>
                    <td>{{ general.intelligence }}</td>
                    <td>{{ general.experience }}</td>
                    <td>{{ general.dedication }}</td>
                </tr>
            </tbody>
        </table>

        <table class="legacy-table footer-table legacy-bg0">
            <tbody>
                <tr>
                    <td><button class="legacy-close" type="button" @click="closeWindow">창닫기</button></td>
                </tr>
                <tr>
                    <td class="banner">
                        삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                        <a href="mailto:hided62@gmail.com">HideD(hided62@gmail.com)</a> /
                        <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                    </td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.npc-list-page {
    width: 1000px;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
}

.legacy-table {
    width: 1000px;
    border-collapse: collapse;
    padding: 0;
    table-layout: fixed;
    font-size: 14px;
    word-break: break-all;
}

/* Ref's `.tb_layout td` sets no alignment; individual cells centre themselves. */
.legacy-table td,
.legacy-table th {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}

/* Ref centres every npc row cell with `align=center`; only the title and
 * footer cells keep the default alignment. */
.npc-table td,
.legacy-table th {
    text-align: center;
}

.legacy-bg0 {
    background-color: transparent;
}

.title-table td {
    min-height: 20px;
}

.npc-table {
    margin-top: 0;
}

.npc-table th {
    height: 21px;
    font-weight: 400;
}

.npc-table td {
    height: 21px;
}

.col-name,
.col-owner {
    width: 102px;
}

.col-level,
.col-personality,
.col-stat,
.col-leadership,
.col-strength,
.col-intelligence {
    width: 68px;
}

.col-nation {
    width: 118px;
}

.col-special {
    width: 88px;
}

.col-experience,
.col-dedication {
    width: 78px;
}

.trait-tooltip {
    position: relative;
    cursor: help;
}

.trait-tooltip [role='tooltip'] {
    display: none;
    position: absolute;
    z-index: 10;
    left: 50%;
    bottom: calc(100% + 4px);
    width: 220px;
    padding: 5px 7px;
    transform: translateX(-50%);
    border: 1px solid #888;
    background: #202020;
    color: #fff;
    text-align: left;
    word-break: keep-all;
}

.trait-tooltip:hover [role='tooltip'],
.trait-tooltip:focus [role='tooltip'] {
    display: block;
}

.legacy-close {
    display: inline-grid;
    min-height: 35.5px;
    box-sizing: border-box;
    align-items: center;
    border: 1px solid #0d6efd;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    background: #345c85;
    color: #fff;
    font-weight: 700;
    line-height: 21px;
    text-decoration: none;
    cursor: pointer;
}

.legacy-close:hover,
.legacy-close:focus {
    color: #fff;
    text-decoration: underline;
}

.legacy-close:focus-visible,
.trait-tooltip:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}

.footer-table {
    margin-top: 0;
}

.footer-table td {
    height: 21px;
}

.footer-table tr:first-child td {
    height: 36px;
}

.banner {
    font-size: 12px;
}

.banner a {
    color: inherit;
}

.npc-error,
.npc-loading {
    width: 1000px;
    box-sizing: border-box;
    padding: 6px 10px;
}

.npc-error {
    border: 1px solid #9b4848;
    color: #ffd0d0;
}
</style>
