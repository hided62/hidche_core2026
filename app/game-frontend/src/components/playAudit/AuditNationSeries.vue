<script setup lang="ts">
import { computed, ref } from 'vue';
import AuditLineChart from './AuditLineChart.vue';
import type { trpc } from '../../utils/trpc';

type Series = Awaited<ReturnType<typeof trpc.playAudit.nationSeries.query>>;
type Point = Series['items'][number];
const props = defineProps<{ data: Series }>();
const population = ref<'human' | 'npc' | 'troopNpc'>('human');
const metric = ref('gold');
const metrics = [
    ['gold', '국고 금'],
    ['rice', '국고 쌀'],
    ['crew', '총 병사수'],
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
        case 'crew':
            return totalCrew(point);
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
const totalCrew = (point: Point): number | null => {
    if (!point.stock) return null;
    const groups = Object.values(point.stock.populations);
    return groups.some((group) => group.crew == null) ? null : groups.reduce((sum, group) => sum + group.crew!, 0);
};
const chartLabels = computed(() => props.data.items.map((point) => `${point.year}년 ${point.month}월`));
const resourceLines = computed(() => [
    { label: '국고 금', color: '#f5cc64', values: props.data.items.map((point) => point.stock?.gold ?? null) },
    { label: '국고 쌀', color: '#91d9a0', values: props.data.items.map((point) => point.stock?.rice ?? null) },
]);
const crewLines = computed(() => [{ label: '총 병사수', color: '#83cafa', values: props.data.items.map(totalCrew) }]);
const dexLines = computed(() =>
    (['dex1', 'dex2', 'dex3', 'dex4', 'dex5'] as const).map((key, index) => ({
        label: ['보병', '궁병', '기병', '귀병', '차병'][index]!,
        color: ['#f5cc64', '#91d9a0', '#83cafa', '#e2a3f3', '#ff9c88'][index]!,
        values: props.data.items.map((point) => point.stock?.populations[population.value].averageDex[key] ?? null),
    }))
);
const incomeLines = computed(() => [
    { label: '실제 금 수입', color: '#f5cc64', values: props.data.items.map((point) => point.flows.incomeGold) },
    { label: '실제 쌀 수입', color: '#91d9a0', values: props.data.items.map((point) => point.flows.incomeRice) },
]);
const format = (number: number | null) =>
    number === null ? '자료 없음' : number.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const maximum = computed(() => Math.max(1, ...props.data.items.map((row) => Math.abs(value(row) ?? 0))));
const date = (point: { year: number; month: number } | null) =>
    point ? `${point.year}년 ${point.month}월` : '자료 없음';
</script>

<template>
    <section v-if="data.currentSettlement" class="settlement-now" aria-label="당월 정산">
        <h3>{{ data.currentSettlement.year }}년 {{ data.currentSettlement.month }}월 정산</h3>
        <p>금은 1월, 쌀은 7월에 정산됩니다. 저장된 실제 수입·지급액은 월말 전에 확인할 수 있습니다.</p>
        <div class="settlement-values">
            <p v-for="resource in ['gold', 'rice'] as const" :key="resource">
                <strong>{{ resource === 'gold' ? '금' : '쌀' }}</strong>
                <template v-if="data.currentSettlement[resource]">
                    수입 {{ format(data.currentSettlement[resource]!.income) }} · 지급
                    {{ format(data.currentSettlement[resource]!.paid) }}
                    <span>{{ data.currentSettlement.complete ? '정산 관측됨' : '부분 관측' }}</span>
                </template>
                <span v-else>당월 관측된 정산 없음</span>
            </p>
        </div>
    </section>
    <div class="chart-grid">
        <AuditLineChart title="국가 금·쌀 변화" :labels="chartLabels" :lines="resourceLines" />
        <AuditLineChart title="총 병사수 변화" :labels="chartLabels" :lines="crewLines" />
        <AuditLineChart title="실제 금·쌀 수입" :labels="chartLabels" :lines="incomeLines" />
    </div>
    <div class="population-buttons" aria-label="숙련도 장수 집단">
        <button
            v-for="[key, text] in [
                ['human', '유저'],
                ['npc', 'NPC'],
                ['troopNpc', '부대장 NPC'],
            ] as const"
            :key="key"
            class="legacy-button"
            :aria-pressed="population === key"
            @click="population = key"
        >
            {{ text }}
        </button>
    </div>
    <AuditLineChart title="병종별 평균 숙련도 변화" :labels="chartLabels" :lines="dexLines" />
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
.chart-grid {
    display: grid;
    gap: 16px;
    margin: 16px 0;
}
.population-buttons {
    display: flex;
    gap: 8px;
    margin: 16px 0 8px;
    flex-wrap: wrap;
}
.population-buttons [aria-pressed='true'] {
    background: #254e3c;
    border-color: #b6d6c2;
}
.settlement-now {
    padding: 12px;
    border: 1px solid #8aa986;
    background: #203428;
}
.settlement-now h3 {
    margin-top: 0;
}
.settlement-values {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
}
.settlement-values span {
    margin-left: 8px;
}
.series-controls {
    margin-top: 20px;
}

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
