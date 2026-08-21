<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, onMounted, ref } from 'vue';
import { formatReservedCommandBrief } from '../components/command/reservedCommandBrief';
import type { CommandTable } from '../components/command/types';
import LegacySortControls from '../components/ui/LegacySortControls.vue';
import { trpc } from '../utils/trpc';
type Result = Awaited<ReturnType<typeof trpc.nation.getSecretGeneralList.query>>;
type ReservedCommand = Result['generals'][number]['reservedCommands'][number];
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const data = ref<Result | null>(null);
const commandTable = ref<CommandTable | null>(null);
const error = ref('');
const loading = ref(false);
const sort = ref<Sort>(7);
const selectedSort = ref<Sort>(7);
const sortOptions = ['자금', '군량', '도시', '병종', '병사', '삭제턴', '턴', '부대'].map((label, index) => ({
    value: index + 1,
    label,
}));
const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const result = await trpc.nation.getSecretGeneralList.query();
        const table = await trpc.turns.getCommandTable.query({ generalId: result.viewer.generalId });
        data.value = result;
        commandTable.value = table;
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '암행부를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};
const generals = computed(() =>
    [...(data.value?.generals ?? [])].sort((a, b) => {
        if (sort.value === 1) return b.gold - a.gold || a.id - b.id;
        if (sort.value === 2) return b.rice - a.rice || a.id - b.id;
        if (sort.value === 3) return a.cityId - b.cityId || a.id - b.id;
        if (sort.value === 4) return b.crewTypeId - a.crewTypeId || a.id - b.id;
        if (sort.value === 5) return b.crew - a.crew || a.id - b.id;
        if (sort.value === 6) return a.killTurn - b.killTurn || a.id - b.id;
        if (sort.value === 7) return a.turnTime.localeCompare(b.turnTime) || a.id - b.id;
        return b.troopId - a.troopId || a.id - b.id;
    })
);
const closeWindow = () => window.close();
const displayName = (general: { name: string; npcState: number }) =>
    general.npcState > 0 && !/^[ⓜⓝ㉥]/u.test(general.name) ? `ⓝ${general.name}` : general.name;
const commandBrief = (command: ReservedCommand): string =>
    formatReservedCommandBrief('general', command.action, command.args, commandTable.value);
const updateSelectedSort = (value: number): void => {
    selectedSort.value = value as Sort;
};
const applySelectedSort = (): void => {
    sort.value = selectedSort.value;
};
const sortByHeader = (value: Sort): void => {
    selectedSort.value = value;
    sort.value = value;
};
const sortIndicator = (value: Sort, direction: 'ascending' | 'descending'): string =>
    sort.value === value ? (direction === 'ascending' ? '▲' : '▼') : '↕';
onMounted(load);
</script>

<template>
    <main class="secret-page">
        <table class="layout legacy-bg0 title">
            <tbody>
                <tr>
                    <td>
                        암 행 부<br /><button class="close-button" type="button" @click="closeWindow">창 닫기</button>
                    </td>
                </tr>
                <tr>
                    <td>
                        <LegacySortControls
                            control-id="secret-list-sort"
                            :model-value="selectedSort"
                            :options="sortOptions"
                            @update:model-value="updateSelectedSort"
                            @submit="applySelectedSort"
                        />
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="state error legacy-bg0" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state legacy-bg0">불러오는 중...</p>
        <template v-else-if="data">
            <table class="layout summary legacy-bg0">
                <tbody>
                    <tr>
                        <th>전체 금</th>
                        <td>{{ data.summary.gold.toLocaleString() }}</td>
                        <th>전체 쌀</th>
                        <td>{{ data.summary.rice.toLocaleString() }}</td>
                        <th>평균 금</th>
                        <td>
                            {{
                                data.summary.averageGold.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                })
                            }}
                        </td>
                        <th>평균 쌀</th>
                        <td>
                            {{
                                data.summary.averageRice.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                })
                            }}
                        </td>
                    </tr>
                    <tr>
                        <th>전체 병력/장수</th>
                        <td>{{ data.summary.crew.toLocaleString() }}/{{ data.summary.generalCount }}</td>
                        <template v-for="level in [90, 80, 60] as const" :key="level"
                            ><th>훈사 {{ level }} 병력/장수</th>
                            <td>
                                {{ data.summary.readiness[level].crew.toLocaleString() }}/{{
                                    data.summary.readiness[level].generals
                                }}
                            </td></template
                        >
                    </tr>
                </tbody>
            </table>
            <table id="secret-general-list" class="layout list legacy-bg0">
                <thead>
                    <tr>
                        <th width="98">이 름</th>
                        <th width="98">통무지</th>
                        <th width="98" :aria-sort="sort === 8 ? 'descending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="부대 기준 정렬"
                                @click="sortByHeader(8)"
                            >
                                부 대<span class="legacy-sort-indicator">{{ sortIndicator(8, 'descending') }}</span>
                            </button>
                        </th>
                        <th width="53" :aria-sort="sort === 1 ? 'descending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="자금 기준 정렬"
                                @click="sortByHeader(1)"
                            >
                                자 금<span class="legacy-sort-indicator">{{ sortIndicator(1, 'descending') }}</span>
                            </button>
                        </th>
                        <th width="53" :aria-sort="sort === 2 ? 'descending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="군량 기준 정렬"
                                @click="sortByHeader(2)"
                            >
                                군 량<span class="legacy-sort-indicator">{{ sortIndicator(2, 'descending') }}</span>
                            </button>
                        </th>
                        <th width="48" :aria-sort="sort === 3 ? 'ascending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="도시 기준 정렬"
                                @click="sortByHeader(3)"
                            >
                                도시<span class="legacy-sort-indicator">{{ sortIndicator(3, 'ascending') }}</span>
                            </button>
                        </th>
                        <th width="28">守</th>
                        <th width="58" :aria-sort="sort === 4 ? 'descending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="병종 기준 정렬"
                                @click="sortByHeader(4)"
                            >
                                병 종<span class="legacy-sort-indicator">{{ sortIndicator(4, 'descending') }}</span>
                            </button>
                        </th>
                        <th width="63" :aria-sort="sort === 5 ? 'descending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="병사 기준 정렬"
                                @click="sortByHeader(5)"
                            >
                                병 사<span class="legacy-sort-indicator">{{ sortIndicator(5, 'descending') }}</span>
                            </button>
                        </th>
                        <th width="38">훈련</th>
                        <th width="38">사기</th>
                        <th width="213">명 령</th>
                        <th width="38" :aria-sort="sort === 6 ? 'ascending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="삭제턴 기준 정렬"
                                @click="sortByHeader(6)"
                            >
                                삭턴<span class="legacy-sort-indicator">{{ sortIndicator(6, 'ascending') }}</span>
                            </button>
                        </th>
                        <th width="48" :aria-sort="sort === 7 ? 'ascending' : undefined">
                            <button
                                class="legacy-sort-header"
                                type="button"
                                aria-label="턴 기준 정렬"
                                @click="sortByHeader(7)"
                            >
                                턴<span class="legacy-sort-indicator">{{ sortIndicator(7, 'ascending') }}</span>
                            </button>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="general in generals" :key="general.id" :data-general-id="general.id">
                        <td>{{ displayName(general) }}<br />Lv {{ general.experienceLevel }}</td>
                        <td>
                            {{ general.stats.leadership
                            }}<span v-if="general.leadershipBonus" class="bonus">+{{ general.leadershipBonus }}</span
                            >∥{{ general.stats.strength }}∥{{ general.stats.intelligence }}
                        </td>
                        <td>{{ general.troopName ?? '-' }}</td>
                        <td>{{ general.gold }}</td>
                        <td>{{ general.rice }}</td>
                        <td>{{ general.cityName ?? '-' }}</td>
                        <td>{{ general.defenceTrainText }}</td>
                        <td>{{ general.crewTypeName }}</td>
                        <td>{{ general.crew }}</td>
                        <td>{{ general.train }}</td>
                        <td>{{ general.atmos }}</td>
                        <td class="turns">
                            <template v-if="general.npcState >= 2">NPC 장수</template
                            ><template v-else
                                ><div
                                    v-for="(command, index) in general.reservedCommands"
                                    :key="index"
                                    :title="commandBrief(command)"
                                >
                                    {{ index + 1 }} : {{ commandBrief(command) }}
                                </div></template
                            >
                        </td>
                        <td>{{ general.killTurn }}</td>
                        <td>{{ formatServerDateTime(general.turnTime, { format: 'minuteSecond' }) }}</td>
                    </tr>
                </tbody>
            </table>
        </template>
        <table class="layout legacy-bg0 footer">
            <tbody>
                <tr>
                    <td><button class="close-button" type="button" @click="closeWindow">창 닫기</button></td>
                </tr>
                <tr>
                    <td class="legacy-banner">
                        삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD(hided62@gmail.com)
                        /
                        <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                    </td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.secret-page {
    width: auto;
    margin: 0;
    font: 14px var(--sammo-font-sans);
    color: #fff;
}
.layout {
    width: 1000px;
    border-collapse: collapse;
    table-layout: fixed;
}
td,
th,
.state {
    border: 1px solid gray;
    padding: 0;
    font-size: 14px;
    word-break: break-all;
    text-align: center;
    font-weight: 400;
}
/* Ref Lumen primary: no top border, 1px sides, 4px bottom that shortens. */
.close-button {
    height: 35.5px;
    padding: 5.25px 10.5px;
    border-color: #325172;
    border-style: solid;
    border-width: 0 1px 4px;
    border-radius: 5.25px;
    background: rgb(55, 90, 127);
    vertical-align: middle;
    color: #fff;
    font-weight: 700;
    line-height: 21px;
    cursor: pointer;
    transition:
        color 0.15s,
        background-color 0.15s,
        border-color 0.15s,
        box-shadow 0.15s;
}
.close-button:not(:disabled):hover {
    margin-top: 1px;
    border-bottom-width: 3px;
}

.close-button:not(:disabled):active {
    margin-top: 2px;
    border-bottom-width: 2px;
}

.legacy-bg0 {
    background-color: transparent;
}
.legacy-banner a {
    color: inherit;
}
.summary {
    margin: 5px auto;
}
.summary td,
.summary th {
    padding-block: 1px;
}
.summary th,
.list th {
    background: #14241b var(--sammo-texture-green);
}
.summary th {
    width: 120px;
}
/* Ref collapses this list table; `separate` shifted every row by the spacing. */
.list {
    width: 974px;
    margin: 0 auto;
    border-collapse: collapse;
    table-layout: auto;
}
.list th,
.list td {
    box-sizing: border-box;
}
.list tbody td {
    padding-block: 0;
}
.list tbody tr {
    height: 36.36px;
}
.turns {
    text-align: left;
    font-size: 11px;
}
.bonus {
    color: cyan;
}
.error {
    color: #ff7373;
}
.footer {
    margin-top: 5px;
}
.title,
.footer {
    margin-right: auto;
    margin-left: auto;
}
.title td,
.footer td {
    text-align: left;
}
@media (max-width: 1000px) {
    .list {
        width: 100vw;
        margin-left: 0;
        table-layout: fixed;
    }
    .list th,
    .list td {
        font-size: 14px;
    }
    .list tbody tr {
        height: auto;
    }
    .list tbody td {
        font-size: 12px;
    }
    .list :is(th, td):nth-child(1),
    .list :is(th, td):nth-child(2) {
        width: 34px;
    }
    .list :is(th, td):nth-child(3) {
        width: 32px;
    }
    .list :is(th, td):nth-child(4) {
        width: 22px;
    }
    .list :is(th, td):nth-child(5) {
        width: 19px;
    }
    .list :is(th, td):nth-child(6) {
        width: 21px;
    }
    .list :is(th, td):nth-child(7) {
        width: 17px;
    }
    .list :is(th, td):nth-child(8) {
        width: 22px;
    }
    .list :is(th, td):nth-child(9) {
        width: 23px;
    }
    .list :is(th, td):nth-child(10),
    .list :is(th, td):nth-child(11) {
        width: 18px;
    }
    .list :is(th, td):nth-child(12) {
        width: 54px;
    }
    .list :is(th, td):nth-child(13) {
        width: 26px;
    }
    .list :is(th, td):nth-child(14) {
        width: 22px;
    }
}
</style>
