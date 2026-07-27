<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { cityLevelMap, regionMap } from '../utils/nationFormat';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getCityOverview.query>>;
type City = Result['cities'][number];
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
const data = ref<Result | null>(null);
const error = ref('');
const sort = ref<Sort>(10);
const options = ['기본', '인구', '인구율', '민심', '농업', '상업', '치안', '수비', '성벽', '시세', '지역', '규모'];
const generalNames = (cityId: number) =>
    data.value?.generals
        .filter((g) => g.cityId === cityId)
        .map((g) => g.name)
        .join(', ') || '-';
const cities = computed(() =>
    [...(data.value?.cities ?? [])].sort((a, b) => {
        const key = sort.value;
        if (key === 1) return a.id - b.id;
        if (key === 2) return b.population - a.population;
        if (key === 3) return b.population / b.populationMax - a.population / a.populationMax;
        if (key === 4) return b.trust - a.trust;
        if (key === 5) return b.agriculture - a.agriculture;
        if (key === 6) return b.commerce - a.commerce;
        if (key === 7) return b.security - a.security;
        if (key === 8) return b.defence - a.defence;
        if (key === 9) return b.wall - a.wall;
        if (key === 10) return (b.trade ?? -1) - (a.trade ?? -1);
        if (key === 11) return a.region - b.region || b.level - a.level;
        return b.level - a.level || a.region - b.region;
    })
);
const officer = (city: City, level: 2 | 3 | 4) => city.officers[level]?.name ?? '-';
onMounted(async () => {
    try {
        data.value = await trpc.nation.getCityOverview.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력 도시를 불러오지 못했습니다.';
    }
});
</script>

<template>
    <main class="nation-cities-page">
        <table class="legacy-table legacy-bg0 title">
            <tbody>
                <tr>
                    <td>세 력 도 시<br /><RouterLink to="/">돌아가기</RouterLink></td>
                </tr>
                <tr>
                    <td>
                        정렬순서 :
                        <select v-model.number="sort">
                            <option v-for="(label, index) in options" :key="label" :value="index + 1">
                                {{ label }}
                            </option>
                        </select>
                        <button class="legacy-button">정렬하기</button>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error">{{ error }}</p>
        <table v-for="city in cities" :key="city.id" class="legacy-table city legacy-bg2">
            <tbody>
                <tr>
                    <td colspan="10" class="city-title" :style="{ backgroundColor: data?.nation.color }">
                        【 {{ regionMap[city.region] }} | {{ cityLevelMap[city.level] }} 】
                        <span :class="{ capital: city.id === data?.nation.capitalCityId }">{{
                            city.id === data?.nation.capitalCityId ? `[${city.name}]` : city.name
                        }}</span>
                    </td>
                </tr>
                <tr>
                    <th>주민</th>
                    <td>{{ city.population }}/{{ city.populationMax }}</td>
                    <th>인구율</th>
                    <td>{{ ((city.population / city.populationMax) * 100).toFixed(2) }}%</td>
                    <th>자금 수입</th>
                    <td>{{ city.incomes.gold.toLocaleString() }}</td>
                    <th>군량 수입</th>
                    <td>{{ city.incomes.rice.toLocaleString() }}</td>
                    <th>둔전 수입</th>
                    <td>{{ city.incomes.wall.toLocaleString() }}</td>
                </tr>
                <tr>
                    <th>농업</th>
                    <td>{{ city.agriculture }}/{{ city.agricultureMax }}</td>
                    <th>상업</th>
                    <td>{{ city.commerce }}/{{ city.commerceMax }}</td>
                    <th>치안</th>
                    <td>{{ city.security }}/{{ city.securityMax }}</td>
                    <th>수비</th>
                    <td>{{ city.defence }}/{{ city.defenceMax }}</td>
                    <th>성벽</th>
                    <td>{{ city.wall }}/{{ city.wallMax }}</td>
                </tr>
                <tr>
                    <th>민심</th>
                    <td>{{ city.trust.toFixed(1) }}</td>
                    <th>시세</th>
                    <td>{{ city.trade ?? '-' }}%</td>
                    <th>태수</th>
                    <td>{{ officer(city, 4) }}</td>
                    <th>군사</th>
                    <td>{{ officer(city, 3) }}</td>
                    <th>종사</th>
                    <td>{{ officer(city, 2) }}</td>
                </tr>
                <tr>
                    <th>장수</th>
                    <td colspan="9" class="general-list">{{ generalNames(city.id) }}</td>
                </tr>
            </tbody>
        </table>
        <table class="legacy-table legacy-bg0 title footer">
            <tbody>
                <tr>
                    <td><RouterLink to="/">돌아가기</RouterLink></td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.nation-cities-page {
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
    padding: 3px;
    font-weight: 400;
}
.title {
    text-align: center;
}
.city {
    margin-top: 14px;
}
.city th {
    width: 60px;
    text-align: center;
    background-image: var(--sammo-texture-green);
}
.city td {
    width: 140px;
    text-align: center;
}
.city-title {
    text-align: left !important;
}
.general-list {
    text-align: left !important;
}
.capital {
    color: #0ff;
}
.footer {
    margin-top: 14px;
}
.legacy-button {
    padding: 1px 6px;
    font-weight: 400;
}
.error {
    text-align: center;
    color: #ff7373;
}
@media (max-width: 700px) {
    .nation-cities-page {
        width: 1000px;
        transform-origin: top left;
    }
}
</style>
