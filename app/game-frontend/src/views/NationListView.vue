<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { formatNationLevelText, formatOfficerLevelText } from '../utils/nationFormat';
import { getNpcColor } from '../utils/npcColor';
import { trpc } from '../utils/trpc';

type Directory = Awaited<ReturnType<typeof trpc.world.getNationDirectory.query>>;
type Nation = Directory[number];

const nations = ref<Directory>([]);
const loading = ref(false);
const error = ref('');

const whiteTextColors = new Set([
    '',
    '#330000',
    '#ff0000',
    '#800000',
    '#a0522d',
    '#ff6347',
    '#808000',
    '#008000',
    '#2e8b57',
    '#008080',
    '#6495ed',
    '#0000ff',
    '#000080',
    '#483d8b',
    '#7b68ee',
    '#800080',
    '#a9a9a9',
    '#000000',
]);

const loadDirectory = async () => {
    loading.value = true;
    error.value = '';
    try {
        nations.value = await trpc.world.getNationDirectory.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const headerTextColor = (color: string): string => (whiteTextColors.has(color.toLowerCase()) ? '#ffffff' : '#000000');

const officerName = (nation: Nation, officerLevel: number) =>
    nation.officers.find((officer) => officer.officerLevel === officerLevel)?.general;
const displayGeneralName = (general: { name: string; npcState: number }) =>
    general.npcState > 0 && !/^[ⓜⓝ㉥]/u.test(general.name) ? `ⓝ${general.name}` : general.name;
const displayAmbassadorName = (nation: Nation, name: string) => {
    const general = nation.generals.find((candidate) => candidate.name === name);
    return general ? displayGeneralName(general) : name;
};

const roamingCityName = (nation: Nation): string => {
    const chief = officerName(nation, 12);
    return nation.cities.find((city) => city.id === chief?.cityId)?.name ?? '-';
};
const closeWindow = () => window.close();

onMounted(() => {
    void loadDirectory();
});
</script>

<template>
    <main class="directory-page" data-page="nation-directory">
        <table class="directory-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        세 력 일 람<br /><button class="legacy-button" type="button" @click="closeWindow">
                            창 닫기
                        </button>
                        <input type="button" value="장수 일람 연동" />
                    </td>
                </tr>
            </tbody>
        </table>

        <p v-if="error" class="directory-error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="directory-loading">불러오는 중...</p>

        <template v-for="nation in nations" :key="nation.id">
            <table v-if="nation.id !== 0" class="directory-table nation-table legacy-bg2" :data-nation-id="nation.id">
                <tbody>
                    <tr>
                        <td
                            colspan="8"
                            class="center nation-title"
                            :style="{ color: headerTextColor(nation.color), backgroundColor: nation.color }"
                        >
                            【 {{ nation.name }} 】
                        </td>
                    </tr>
                    <tr>
                        <td class="label-cell">성 향</td>
                        <td class="value-wide type-name">{{ Array.from(nation.type.name).join(' ') }}</td>
                        <td class="label-cell">작 위</td>
                        <td class="value-wide">{{ formatNationLevelText(nation.level) }}</td>
                        <td class="label-cell">국 력</td>
                        <td class="value-wide">{{ nation.power }}</td>
                        <td class="label-cell">장수 / 속령</td>
                        <td class="value-wide">{{ nation.generalCount }} / {{ nation.cityCount }}</td>
                    </tr>
                    <tr v-for="row in 2" :key="row">
                        <template v-for="column in 4" :key="column">
                            <td class="label-cell">
                                {{ formatOfficerLevelText(13 - ((row - 1) * 4 + column), nation.level) }}
                            </td>
                            <td class="value-wide">
                                <span
                                    v-if="officerName(nation, 13 - ((row - 1) * 4 + column))"
                                    :style="{
                                        color: getNpcColor(
                                            officerName(nation, 13 - ((row - 1) * 4 + column))?.npcState ?? 0
                                        ),
                                    }"
                                >
                                    {{ displayGeneralName(officerName(nation, 13 - ((row - 1) * 4 + column))!) }}
                                </span>
                                <template v-else>-</template>
                            </td>
                        </template>
                    </tr>
                    <tr>
                        <td class="label-cell">외교권자</td>
                        <td colspan="5">
                            {{ nation.ambassadorNames.map((name) => displayAmbassadorName(nation, name)).join(', ') }}
                        </td>
                        <td class="label-cell">조언자</td>
                        <td class="value-wide">{{ nation.auditorCount }}명</td>
                    </tr>
                    <tr>
                        <td colspan="8">
                            <template v-if="nation.level > 0">
                                속령 일람 :
                                <template v-for="city in nation.cities" :key="city.id">
                                    <span :class="{ capital: city.capital }">{{
                                        city.capital ? `[${city.name}]` : city.name
                                    }}</span
                                    >,
                                </template>
                            </template>
                            <template v-else
                                >현재 위치 : <span class="roaming-city">{{ roamingCityName(nation) }}</span></template
                            >
                        </td>
                    </tr>
                    <tr>
                        <td colspan="8">
                            장수 일람 :
                            <template v-for="general in nation.generals" :key="general.id">
                                <span :style="{ color: getNpcColor(general.npcState) }">{{
                                    displayGeneralName(general)
                                }}</span
                                >,
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
            <br v-if="nation.id !== 0" />

            <table v-else class="directory-table neutral-table legacy-bg2" data-nation-id="0">
                <tbody>
                    <tr>
                        <td colspan="5" class="center">【 재 야 】</td>
                    </tr>
                    <tr>
                        <td class="neutral-spacer">&nbsp;</td>
                        <td class="neutral-label">장 수</td>
                        <td class="neutral-value">{{ nation.generalCount }}</td>
                        <td class="neutral-label">속 령</td>
                        <td class="neutral-value">{{ nation.cityCount }}</td>
                    </tr>
                    <tr>
                        <td colspan="5">
                            속령 일람 :
                            <template v-for="city in nation.cities" :key="city.id">{{ city.name }}, </template>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="5">
                            장수 일람 :
                            <template v-for="general in nation.generals" :key="general.id">
                                <span :style="{ color: getNpcColor(general.npcState) }">{{
                                    displayGeneralName(general)
                                }}</span
                                >,
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
        </template>

        <div class="legacy-analysis-helper" aria-hidden="true">
            <table>
                <thead>
                    <tr>
                        <td v-for="column in 15" :key="column"></td>
                    </tr>
                </thead>
            </table>
        </div>

        <table class="directory-table title-table footer-table legacy-bg0">
            <tbody>
                <tr>
                    <td><button class="legacy-button" type="button" @click="closeWindow">창 닫기</button></td>
                </tr>
                <tr>
                    <td>
                        <small>
                            삼국지 모의전투 PHP HiDCHe - unknown / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                            HideD(hided62@gmail.com) /
                            <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                        </small>
                    </td>
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
    font-size: 14px;
    word-break: break-all;
    background-color: transparent;
}
.directory-table td {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}
.title-table {
    text-align: left;
}
.directory-page > .title-table:first-child {
    height: 55.6875px;
}
.title-table td {
    padding: 1px;
}
.legacy-button {
    border: 0;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    background-color: rgb(55 90 127);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    line-height: 21px;
    cursor: pointer;
}
.nation-title {
    height: 19px;
}
.label-cell {
    width: 80px;
    text-align: center;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}
.value-wide {
    width: 170px;
    text-align: center;
}
.type-name {
    color: yellow;
}
.capital {
    color: cyan;
}
.roaming-city {
    color: yellow;
}
.neutral-spacer {
    width: 498px;
    text-align: center;
}
.neutral-label,
.neutral-value {
    width: 123px;
    text-align: center;
}
.neutral-label {
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}
.center {
    text-align: center;
}
.footer-table {
    margin-top: 0;
}
.footer-table a {
    color: inherit;
}
.legacy-analysis-helper {
    display: none;
}
.directory-error,
.directory-loading {
    width: 998px;
    margin: 0;
    border: 1px solid gray;
    padding: 8px 0;
    text-align: center;
}
.directory-error {
    color: #ff7373;
}
</style>
