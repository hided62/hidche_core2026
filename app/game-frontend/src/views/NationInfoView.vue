<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getNationInfo.query>>;
const data = ref<Result | null>(null);
const router = useRouter();
const error = ref('');
const number = (value: number) => value.toLocaleString('ko-KR');
const diff = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
const nationLevel = computed(
    () => ['두목', '영주', '군벌', '주자사', '주목', '공', '왕', '황제'][data.value?.nation.level ?? 0] ?? '-'
);
onMounted(async () => {
    try {
        data.value = await trpc.nation.getNationInfo.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력 정보를 불러오지 못했습니다.';
    }
});
</script>

<template>
    <main class="legacy-info-page">
        <table class="legacy-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>세 력 정 보<br /><button type="button" @click="router.push('/')">돌아가기</button></td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error">{{ error }}</p>
        <table v-if="data" class="legacy-table info-table legacy-bg2">
            <tbody>
                <tr>
                    <td colspan="8" class="nation-title" :style="{ backgroundColor: data.nation.color }">
                        【{{ data.nation.name }}】
                    </td>
                </tr>
                <tr>
                    <th>총주민</th>
                    <td>{{ number(data.population.current) }}/{{ number(data.population.max) }}</td>
                    <th>총병사</th>
                    <td>{{ number(data.crew.current) }}/{{ number(data.crew.max) }}</td>
                    <th>국 력</th>
                    <td colspan="3">{{ data.nation.power }}</td>
                </tr>
                <tr>
                    <th>국 고</th>
                    <td>{{ number(data.nation.gold) }}</td>
                    <th>병 량</th>
                    <td>{{ number(data.nation.rice) }}</td>
                    <th>세 율</th>
                    <td colspan="3">{{ data.nation.rate }} %</td>
                </tr>
                <tr>
                    <th>세금/단기</th>
                    <td>+{{ number(data.income.goldCity) }} / +{{ number(data.income.goldWar) }}</td>
                    <th>세곡/둔전</th>
                    <td>+{{ number(data.income.riceCity) }} / +{{ number(data.income.riceWall) }}</td>
                    <th>지급률</th>
                    <td colspan="3">{{ data.nation.bill }} %</td>
                </tr>
                <tr>
                    <th>수입/지출</th>
                    <td>+{{ number(data.income.goldTotal) }} / -{{ number(data.income.outcome) }}</td>
                    <th>수입/지출</th>
                    <td>+{{ number(data.income.riceTotal) }} / -{{ number(data.income.outcome) }}</td>
                    <th>속 령</th>
                    <td>{{ data.cities.length }}</td>
                    <th>장 수</th>
                    <td>{{ data.nation.generalCount }}</td>
                </tr>
                <tr>
                    <th>국고 예산</th>
                    <td>{{ number(data.budget.gold) }} ({{ diff(data.income.goldTotal - data.income.outcome) }})</td>
                    <th>병량 예산</th>
                    <td>{{ number(data.budget.rice) }} ({{ diff(data.income.riceTotal - data.income.outcome) }})</td>
                    <th>기술력</th>
                    <td>{{ number(data.nation.tech) }}</td>
                    <th>작 위</th>
                    <td>{{ nationLevel }}</td>
                </tr>
                <tr>
                    <th>속령일람 :</th>
                    <td colspan="7">
                        <template v-for="(city, index) in data.cities" :key="city.id"
                            ><span v-if="city.capital" class="capital">{{ city.name }}</span
                            ><span v-else>{{ city.name }}</span
                            ><span v-if="index + 1 < data.cities.length">, </span></template
                        >
                    </td>
                </tr>
                <tr>
                    <th>국가열전</th>
                    <td colspan="7" class="history legacy-bg0">
                        <div v-for="entry in data.history" :key="entry.id">
                            {{ entry.year }}년 {{ entry.month }}월: {{ entry.text }}
                        </div>
                        <span v-if="!data.history.length">-</span>
                    </td>
                </tr>
            </tbody>
        </table>
        <table class="legacy-table footer-table legacy-bg0">
            <tbody>
                <tr>
                    <td><button type="button" @click="router.push('/')">돌아가기</button></td>
                </tr>
                <tr>
                    <td class="credit">삼국지 모의전투 PHP HiDCHe / KOEI의 이미지를 사용했습니다 / 제작: Hide.D</td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.legacy-info-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
}
.legacy-table {
    width: 100%;
    border-collapse: collapse;
}
.legacy-table td,
.legacy-table th {
    border: 1px solid #777;
    padding: 4px;
    font-weight: 400;
}
.title-table,
.footer-table {
    text-align: left;
}
.title-table {
    margin-bottom: 14px;
}
.footer-table {
    margin-top: 14px;
}
.info-table th {
    width: 98px;
    text-align: center;
    background-image: var(--sammo-texture-green);
}
.info-table td {
    text-align: center;
}
.info-table td:nth-child(2),
.info-table td:nth-child(4) {
    width: 198px;
}
.nation-title {
    text-align: center;
}
.capital {
    color: #0ff;
}
.history {
    text-align: left !important;
}
.title-table button,
.footer-table button {
    border: 0;
    border-radius: 3px;
    padding: 8px 12px;
    background: #345c85;
    color: #fff;
    cursor: pointer;
}
.credit { padding: 0 !important; }
.error {
    color: #ff7373;
    text-align: center;
}
</style>
