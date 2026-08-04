<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getNpcColor } from '../utils/npcColor';
import { cityLevelMap, regionMap } from '../utils/nationFormat';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getCityOverview.query>>;
type City = Result['cities'][number];
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
const data = ref<Result | null>(null);
const error = ref('');
const sort = ref<Sort>(10);
const extraSort = ref<
    | 'name'
    | 'populationRate'
    | 'populationRemain'
    | 'agricultureRemain'
    | 'commerceRemain'
    | 'securityRemain'
    | 'defenceRemain'
    | 'wallRemain'
    | 'generalCount'
    | null
>(null);
const router = useRouter();
const options = ['기본', '인구', '인구율', '민심', '농업', '상업', '치안', '수비', '성벽', '시세', '지역', '규모'];
const generalsForCity = (cityId: number) => data.value?.generals.filter((general) => general.cityId === cityId) ?? [];
const displayGeneralName = (general: Result['generals'][number]) =>
    general.npcState > 0 && !/^[ⓜⓝ]/u.test(general.name) ? `ⓝ${general.name}` : general.name;
const generalCount = (cityId: number) =>
    data.value?.generals.filter((general) => general.cityId === cityId).length ?? 0;
const cities = computed(() => {
    const values = [...(data.value?.cities ?? [])];
    if (extraSort.value) {
        const key = extraSort.value;
        return values.sort((a, b) => {
            if (key === 'name') return a.name.localeCompare(b.name);
            if (key === 'populationRate') return a.population / a.populationMax - b.population / b.populationMax;
            if (key === 'populationRemain') return a.population - a.populationMax - (b.population - b.populationMax);
            if (key === 'agricultureRemain')
                return a.agriculture - a.agricultureMax - (b.agriculture - b.agricultureMax);
            if (key === 'commerceRemain') return a.commerce - a.commerceMax - (b.commerce - b.commerceMax);
            if (key === 'securityRemain') return a.security - a.securityMax - (b.security - b.securityMax);
            if (key === 'defenceRemain') return a.defence - a.defenceMax - (b.defence - b.defenceMax);
            if (key === 'wallRemain') return a.wall - a.wallMax - (b.wall - b.wallMax);
            return generalCount(b.id) - generalCount(a.id);
        });
    }
    return values.sort((a, b) => {
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
    });
});
const setExtraSort = (value: NonNullable<typeof extraSort.value>) => {
    extraSort.value = value;
};
const remain = (value: number, maximum: number) => value - maximum;
const warnRemain = (
    kind: 'agriculture' | 'commerce' | 'security' | 'defence' | 'wall',
    value: number,
    maximum: number
) => {
    const threshold = kind === 'defence' || kind === 'wall' ? -700 : -1000;
    return remain(value, maximum) > threshold;
};
const developmentClass = (
    kind: 'population' | 'agriculture' | 'commerce' | 'security' | 'defence' | 'wall',
    value: number,
    maximum: number
) => {
    const ratio = value / maximum;
    if (kind === 'population')
        return ratio > 0.9 ? 'development-high' : ratio > 0.7 ? 'development-mid' : 'development-low';
    if (kind === 'defence' || kind === 'wall')
        return ratio > 0.6 ? 'development-high' : ratio > 0.3 ? 'development-mid' : 'development-low';
    return ratio > 0.8 ? 'development-high' : ratio > 0.4 ? 'development-mid' : 'development-low';
};
const isRegionBreak = (city: City, index: number) =>
    sort.value === 10 && extraSort.value === null && (index === 0 || cities.value[index - 1]?.region !== city.region);
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
                    <td>
                        세 력 도 시<br /><button class="back-button" type="button" @click="router.push('/')">
                            돌아가기
                        </button>
                    </td>
                </tr>
                <tr>
                    <td>
                        <form @submit.prevent="extraSort = null">
                            정렬순서 :
                            <select v-model.number="sort">
                                <option v-for="(label, index) in options" :key="label" :value="index + 1">
                                    {{ label }}
                                </option>
                            </select>
                            <input type="submit" value="정렬하기" />
                            <button type="button">암행부 연동</button>
                        </form>
                    </td>
                </tr>
                <tr>
                    <td class="sort-more">
                        재 정렬 순서 :
                        <button type="button" @click="setExtraSort('name')">도시명</button>
                        <button type="button" @click="setExtraSort('populationRate')">인구율</button>
                        <button type="button" @click="setExtraSort('populationRemain')">남은 주민</button>
                        <button type="button" @click="setExtraSort('agricultureRemain')">남은 농업</button>
                        <button type="button" @click="setExtraSort('commerceRemain')">남은 상업</button>
                        <button type="button" @click="setExtraSort('securityRemain')">남은 치안</button>
                        <button type="button" @click="setExtraSort('defenceRemain')">남은 수비</button>
                        <button type="button" @click="setExtraSort('wallRemain')">남은 성벽</button>
                        <button type="button" @click="setExtraSort('generalCount')">배치 장수 수</button>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error">{{ error }}</p>
        <table
            v-for="(city, index) in cities"
            :key="city.id"
            class="legacy-table city legacy-bg2"
            :class="{ 'region-break': isRegionBreak(city, index) }"
        >
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
                    <td :class="developmentClass('population', city.population, city.populationMax)">
                        {{ city.population }}/{{ city.populationMax }}
                    </td>
                    <th>인구율</th>
                    <td :class="developmentClass('population', city.population, city.populationMax)">
                        {{ Number(((city.population / city.populationMax) * 100).toFixed(2)) }}%
                    </td>
                    <th>자금 수입</th>
                    <td>{{ city.incomes.gold.toLocaleString() }}</td>
                    <th>군량 수입</th>
                    <td>{{ city.incomes.rice.toLocaleString() }}</td>
                    <th>둔전 수입</th>
                    <td>{{ city.incomes.wall.toLocaleString() }}</td>
                </tr>
                <tr>
                    <th>농업</th>
                    <td :class="developmentClass('agriculture', city.agriculture, city.agricultureMax)">
                        {{ city.agriculture }}/{{ city.agricultureMax
                        }}<span v-if="warnRemain('agriculture', city.agriculture, city.agricultureMax)" class="remain"
                            >[{{ remain(city.agriculture, city.agricultureMax) }}]</span
                        >
                    </td>
                    <th>상업</th>
                    <td :class="developmentClass('commerce', city.commerce, city.commerceMax)">
                        {{ city.commerce }}/{{ city.commerceMax
                        }}<span v-if="warnRemain('commerce', city.commerce, city.commerceMax)" class="remain"
                            >[{{ remain(city.commerce, city.commerceMax) }}]</span
                        >
                    </td>
                    <th>치안</th>
                    <td :class="developmentClass('security', city.security, city.securityMax)">
                        {{ city.security }}/{{ city.securityMax
                        }}<span v-if="warnRemain('security', city.security, city.securityMax)" class="remain"
                            >[{{ remain(city.security, city.securityMax) }}]</span
                        >
                    </td>
                    <th>수비</th>
                    <td :class="developmentClass('defence', city.defence, city.defenceMax)">
                        {{ city.defence }}/{{ city.defenceMax
                        }}<span v-if="warnRemain('defence', city.defence, city.defenceMax)" class="remain"
                            >[{{ remain(city.defence, city.defenceMax) }}]</span
                        >
                    </td>
                    <th>성벽</th>
                    <td :class="developmentClass('wall', city.wall, city.wallMax)">
                        {{ city.wall }}/{{ city.wallMax
                        }}<span v-if="warnRemain('wall', city.wall, city.wallMax)" class="remain"
                            >[{{ remain(city.wall, city.wallMax) }}]</span
                        >
                    </td>
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
                    <td colspan="9" class="general-list">
                        <template v-if="generalsForCity(city.id).length">
                            <template v-for="(general, index) in generalsForCity(city.id)" :key="general.id">
                                <span v-if="index">, </span
                                ><span :style="{ color: getNpcColor(general.npcState) }">{{
                                    displayGeneralName(general)
                                }}</span>
                            </template>
                        </template>
                        <template v-else>-</template>
                    </td>
                </tr>
            </tbody>
        </table>
        <table class="legacy-table legacy-bg0 title footer">
            <tbody>
                <tr>
                    <td><button class="back-button" type="button" @click="router.push('/')">돌아가기</button></td>
                </tr>
                <tr>
                    <td class="legacy-banner">
                        삼국지 모의전투 PHP HiDCHe - unknown / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                        <a href="mailto:hided62@gmail.com">HideD(hided62@gmail.com)</a> /
                        <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                    </td>
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
    line-height: 1.3;
}
.legacy-table {
    width: 100%;
    border-collapse: collapse;
    background-color: transparent;
}
.legacy-table td,
.legacy-table th {
    border: 1px solid #808080;
    padding: 0;
    font-weight: 400;
}
.title {
    text-align: left;
}
.city {
    margin-top: 0;
}
.city.region-break {
    margin-top: 18px;
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
    margin-top: 0;
}
.nation-cities-page button,
.nation-cities-page input[type='submit'] {
    border: 2px outset #fff;
    background-color: buttonface;
    color: buttontext;
    cursor: pointer;
    padding: 1px 6px;
}
.nation-cities-page .back-button {
    border: 0;
    padding: 5.25px 10.5px;
    background-color: rgb(55 90 127);
    color: #fff;
    font-weight: 700;
    line-height: 21px;
}
.sort-more button {
    margin: 0;
}
.development-high {
    color: lightgreen;
}
.development-mid,
.remain {
    color: yellow;
}
.development-low {
    color: orangered;
}
.legacy-banner a {
    color: inherit;
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
