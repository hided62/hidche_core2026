<script setup lang="ts">
import { computed } from 'vue';
import type { trpc } from '../../utils/trpc';
type Snapshot = Awaited<ReturnType<typeof trpc.playAudit.nationSnapshot.query>>;
const props = defineProps<{ data: Snapshot }>();
const label = computed(() => (props.data.sample?.kind === 'INITIAL' ? '수집 시작 기준' : '최종 표본'));
const format = (value: number | null) =>
    value === null ? '자료 없음' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const groups = [
    ['human', '유저'],
    ['npc', 'NPC'],
    ['troopNpc', '부대장 NPC'],
] as const;
</script>

<template>
    <p v-if="!data.collected">선택한 시점의 표본이 없습니다.</p>
    <p v-else-if="!data.nation">표본에 해당 국가가 없습니다.</p>
    <template v-else>
        <h3>{{ data.nation.name }} · {{ data.sample?.year }}년 {{ data.sample?.month }}월 {{ label }}</h3>
        <p>월말 시계열과 구분되는 표본입니다. 아래 정산은 이 표본을 수집할 때까지 해당 월에 관측한 값입니다.</p>
        <p v-if="!data.sample?.settlementsComplete">정산 수집이 불완전한 월입니다.</p>
        <dl class="nation-values">
            <div>
                <dt>국고 금 / 쌀</dt>
                <dd>{{ format(data.nation.gold) }} / {{ format(data.nation.rice) }}</dd>
            </div>
            <div>
                <dt>기술력 / 적용 세율</dt>
                <dd>{{ format(data.nation.tech) }} / {{ format(data.nation.appliedRate) }}%</dd>
            </div>
            <div>
                <dt>실제 금 / 쌀 수입</dt>
                <dd>{{ format(data.nation.incomeGold) }} / {{ format(data.nation.incomeRice) }}</dd>
            </div>
            <div>
                <dt>지급 금 / 쌀</dt>
                <dd>{{ format(data.nation.paidGold) }} / {{ format(data.nation.paidRice) }}</dd>
            </div>
        </dl>
        <div class="table-scroll" tabindex="0" :aria-label="`${label} 국가 장수 집계`">
            <table>
                <thead>
                    <tr>
                        <th>장수 집단</th>
                        <th>인원</th>
                        <th>보유 금 / 쌀 합계</th>
                        <th>평균 금 / 쌀</th>
                        <th>평균 숙련 (보 / 궁 / 기 / 귀 / 차)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="[key, label] in groups" :key="key">
                        <th scope="row">{{ label }}</th>
                        <td>{{ data.nation.populations[key].count }}</td>
                        <td>
                            {{ format(data.nation.populations[key].gold) }} /
                            {{ format(data.nation.populations[key].rice) }}
                        </td>
                        <td>
                            {{ format(data.nation.populations[key].averageGold) }} /
                            {{ format(data.nation.populations[key].averageRice) }}
                        </td>
                        <td>{{ Object.values(data.nation.populations[key].averageDex).map(format).join(' / ') }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </template>
</template>

<style scoped>
h3 {
    font-size: var(--sammo-font-size-normal);
    font-weight: bold;
}
.nation-values {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}
.nation-values dt {
    font-weight: bold;
}
.nation-values dd {
    margin: 0;
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
    border: 1px solid gray;
    padding: 6px;
    text-align: left;
}
</style>
