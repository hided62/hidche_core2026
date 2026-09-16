<script setup lang="ts">
import { computed, ref } from 'vue';
import { trpc } from '../../utils/trpc';

type Series = Awaited<ReturnType<typeof trpc.playAudit.nationSeries.query>>;
type Point = Series['items'][number];
const props = defineProps<{ data: Series }>();
const population = ref<'human' | 'npc' | 'troopNpc'>('human');
const metric = ref('gold');
const metrics = [
    ['gold', '국고 금'],
    ['rice', '국고 쌀'],
    ['tech', '기술력'],
    ['appliedRate', '적용 세율'],
    ['incomeGold', '실제 금 수입'],
    ['incomeRice', '실제 쌀 수입'],
    ['paidGold', '지급 금'],
    ['paidRice', '지급 쌀'],
    ['averageGold', '평균 금'],
    ['averageRice', '평균 쌀'],
    ['totalGold', '장수 보유 금 합계'],
    ['totalRice', '장수 보유 쌀 합계'],
    ['count', '장수 수'],
    ['dex1', '평균 보병 숙련'],
    ['dex2', '평균 궁병 숙련'],
    ['dex3', '평균 기병 숙련'],
    ['dex4', '평균 귀병 숙련'],
    ['dex5', '평균 차병 숙련'],
] as const;
const label = computed(() => metrics.find(([key]) => key === metric.value)?.[1] ?? '');
const value = (point: Point): number | null => {
    const stock = point.stock;
    switch (metric.value) {
        case 'totalGold':
            return stock?.populations[population.value].gold ?? null;
        case 'totalRice':
            return stock?.populations[population.value].rice ?? null;
        case 'gold':
        case 'rice':
        case 'tech':
        case 'appliedRate':
            return stock?.[metric.value] ?? null;
        case 'incomeGold':
        case 'incomeRice':
        case 'paidGold':
        case 'paidRice':
            return point.flows[metric.value];
        case 'count':
        case 'averageGold':
        case 'averageRice':
            return stock?.populations[population.value][metric.value] ?? null;
        case 'dex1':
        case 'dex2':
        case 'dex3':
        case 'dex4':
        case 'dex5':
            return stock?.populations[population.value].averageDex[metric.value] ?? null;
        default:
            return null;
    }
};
const format = (number: number | null) =>
    number === null ? '자료 없음' : number.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const maximum = computed(() => Math.max(1, ...props.data.items.map((row) => Math.abs(value(row) ?? 0))));
const date = (point: { year: number; month: number } | null) =>
    point ? `${point.year}년 ${point.month}월` : '자료 없음';
</script>

<template>
    <div class="series-controls">
        <label
            >지표
            <select class="legacy-sort-select" v-model="metric" aria-label="지표">
                <option v-for="[key, text] in metrics" :key="key" :value="key">{{ text }}</option>
            </select></label
        >
        <label
            >장수 집단
            <select class="legacy-sort-select" v-model="population" aria-label="장수 집단">
                <option value="human">유저</option>
                <option value="npc">NPC</option>
                <option value="troopNpc">부대장 NPC</option>
            </select></label
        >
    </div>
    <p>
        수입·지급은 기간 합계, 국고·기술·장수 통계는 마지막 수집 월의 값입니다. 미수집 구간은 0으로 표시하지 않습니다.
    </p>
    <div class="table-scroll" tabindex="0" aria-label="국가 시계열 표">
        <table>
            <caption>
                {{
                    label
                }}
                — 그래프와 수치
            </caption>
            <thead>
                <tr>
                    <th scope="col">기간</th>
                    <th scope="col">{{ label }}</th>
                    <th scope="col">비교</th>
                    <th scope="col">마지막 표본</th>
                    <th scope="col">수집 상태</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="point in data.items" :key="`${point.year}-${point.month}`">
                    <th scope="row">{{ date(point.from) }} ~ {{ date(point.to) }}</th>
                    <td>{{ format(value(point)) }}</td>
                    <td class="bar-cell">
                        <span
                            v-if="value(point) !== null"
                            class="bar"
                            :style="{ width: `${(Math.abs(value(point) ?? 0) / maximum) * 100}%` }"
                            aria-hidden="true"
                        />
                    </td>
                    <td>{{ date(point.stockAsOf) }}</td>
                    <td>
                        <details>
                            <summary>{{ point.complete ? '월별 표본 수집됨' : '일부 기간·자료 없음' }}</summary>
                            <ul>
                                <li v-for="month in point.months" :key="`${month.year}-${month.month}`">
                                    {{ date(month) }}:
                                    {{
                                        !month.collected
                                            ? '미수집'
                                            : !month.nationPresent
                                              ? '국가 없음'
                                              : !month.settlementsComplete
                                                ? '정산 불완전'
                                                : '수집됨'
                                    }}
                                </li>
                            </ul>
                        </details>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.series-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}
.table-scroll {
    overflow-x: auto;
}
table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
}
th,
td {
    padding: 6px;
    border: 1px solid gray;
    text-align: left;
}
caption {
    padding: 8px;
    text-align: left;
}
.bar-cell {
    min-width: 100px;
    width: 25%;
}
.bar {
    display: block;
    height: 12px;
    background: #7ac9e7;
}
summary {
    cursor: pointer;
}
</style>
