<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatReservedCommandBrief } from '../components/command/reservedCommandBrief';
import type { CommandTable } from '../components/command/types';
import { cityLevelMap, formatOfficerLevelText, regionMap } from '../utils/nationFormat';
import { getNpcColor } from '../utils/npcColor';
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import { legacyNationTextColor } from '../utils/legacyNationColor';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.world.getCurrentCity.query>>;
type General = Result['generals'][number];
type ReservedCommand = General['turns'][number];

const route = useRoute();
const router = useRouter();
const data = ref<Result | null>(null);
const commandTable = ref<CommandTable | null>(null);
const error = ref('');
const selected = ref<number>();
let loadSequence = 0;

const parseCityId = (): number | undefined => {
    const raw = route.query.cityId ?? route.query.citylist;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const cityId = Number(value);
    return Number.isSafeInteger(cityId) && cityId > 0 ? cityId : undefined;
};

const load = async (cityId?: number) => {
    const sequence = ++loadSequence;
    try {
        const result = await trpc.world.getCurrentCity.query(cityId ? { cityId } : undefined);
        const table = await trpc.turns.getCommandTable.query({ generalId: result.me.id });
        if (sequence !== loadSequence) return;
        data.value = result;
        commandTable.value = table;
        selected.value = result.city.id;
        error.value = '';
    } catch (cause) {
        if (sequence !== loadSequence) return;
        error.value = cause instanceof Error ? cause.message : '도시 정보를 불러오지 못했습니다.';
    }
};

watch(
    () => [route.query.cityId, route.query.citylist],
    () => void load(parseCityId()),
    { immediate: true }
);

const selectCity = async () => {
    if (!selected.value) return;
    await router.push({ name: 'current-city', query: { cityId: selected.value } });
};

const city = computed(() => data.value?.city);
const summary = computed(() => data.value?.forceSummary);
const show = (value: number | null) => (value === null ? '?' : value.toLocaleString('ko-KR'));
const showPair = (crew: number, generals: number) => `${show(crew)}/${show(generals)}`;
const populationRate = computed(() => {
    if (!city.value || city.value.population === null) return '?';
    return String(Math.round((city.value.population / city.value.populationMax) * 10_000) / 100);
});
const cityTitleStyle = computed(() => {
    const backgroundColor = city.value?.nationColor.toUpperCase() ?? '#000000';
    return {
        backgroundColor,
        color: legacyNationTextColor(backgroundColor),
    };
});
const woundedStat = (value: number, injury: number) =>
    injury === 0 ? value : Math.floor((value * (100 - injury)) / 100);
const defenceTrainText = (value: number | null) => {
    if (value === null) return '?';
    if (value === 999) return '×';
    if (value >= 90) return '☆';
    if (value >= 80) return '◎';
    if (value >= 60) return '○';
    return '△';
};
const generalImage = (general: General): string => resolveGeneralIconUrl(general);
const commandBrief = (command: ReservedCommand): string =>
    formatReservedCommandBrief('general', command.action, command.args, commandTable.value);
</script>

<template>
    <main class="city-page">
        <table class="legacy-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        도 시 정 보<br /><button
                            class="legacy-button legacy-button--navigation back-link"
                            type="button"
                            @click="router.push('/')"
                        >
                            돌아가기
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        <table class="legacy-table legacy-bg0 selector">
            <tbody>
                <tr>
                    <td>
                        <form @submit.prevent="selectCity">
                            <div>
                                도시선택 :
                                <select id="citySelector" v-model.number="selected" @change="selectCity">
                                    <option v-for="option in data?.options ?? []" :key="option.id" :value="option.id">
                                        【{{ option.name.padEnd(4, '_') }}】{{
                                            option.nationId === data?.me.nationId
                                                ? '본국'
                                                : option.nationId === 0
                                                  ? '공백지'
                                                  : '타국'
                                        }}
                                    </option>
                                </select>
                            </div>
                            <p>명령 화면에서 도시를 클릭하셔도 됩니다.</p>
                        </form>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <template v-if="data && city">
            <table class="legacy-table legacy-bg0 back-row">
                <tbody>
                    <tr>
                        <td>
                            <button
                                class="legacy-button legacy-button--navigation back-link"
                                type="button"
                                @click="router.push('/')"
                            >
                                돌아가기
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <table class="legacy-table legacy-bg2 stats">
                <colgroup>
                    <col class="label-col" />
                    <col class="first-value-col" />
                    <col class="label-col" />
                    <col class="value-col" />
                    <col class="label-col" />
                    <col class="value-col" />
                    <col class="label-col" />
                    <col class="value-col" />
                    <col class="label-col" />
                    <col class="value-col" />
                    <col class="label-col" />
                    <col class="value-col" />
                </colgroup>
                <tbody>
                    <tr>
                        <td colspan="11" class="city-title" :style="cityTitleStyle">
                            【 {{ regionMap[city.region] }} | {{ cityLevelMap[city.level] }} 】 {{ city.name }}
                        </td>
                        <td class="city-title" :style="cityTitleStyle">{{ data.lastExecute }}</td>
                    </tr>
                    <tr>
                        <th>주민</th>
                        <td>{{ show(city.population) }}/{{ show(city.populationMax) }}</td>
                        <th>농업</th>
                        <td>{{ show(city.agriculture) }}/{{ show(city.agricultureMax) }}</td>
                        <th>상업</th>
                        <td>{{ show(city.commerce) }}/{{ show(city.commerceMax) }}</td>
                        <th>치안</th>
                        <td>{{ show(city.security) }}/{{ show(city.securityMax) }}</td>
                        <th>수비</th>
                        <td>{{ show(city.defence) }}/{{ show(city.defenceMax) }}</td>
                        <th>성벽</th>
                        <td>{{ show(city.wall) }}/{{ show(city.wallMax) }}</td>
                    </tr>
                    <tr>
                        <th>민심</th>
                        <td>{{ show(city.trust) }}</td>
                        <th>시세</th>
                        <td>{{ city.trade ?? '- ' }}%</td>
                        <th>인구</th>
                        <td>{{ populationRate }}%</td>
                        <th>태수</th>
                        <td>{{ city.officers[4] }}</td>
                        <th>군사</th>
                        <td>{{ city.officers[3] }}</td>
                        <th>종사</th>
                        <td>{{ city.officers[2] }}</td>
                    </tr>
                    <tr v-if="summary">
                        <th>도시명</th>
                        <td>{{ city.name }}</td>
                        <th>적군</th>
                        <td>
                            {{ show(summary.enemyCrew) }}/{{ show(summary.enemyArmedGenerals) }}({{
                                show(summary.enemyGenerals)
                            }})
                        </td>
                        <th>병장(총)</th>
                        <td>
                            {{ show(summary.ownCrew) }}/{{ show(summary.ownArmedGenerals) }}({{
                                show(summary.ownGenerals)
                            }})
                        </td>
                        <th>90병장</th>
                        <td>{{ showPair(summary.ready90Crew, summary.ready90Generals) }}</td>
                        <th>60병장</th>
                        <td>{{ showPair(summary.ready60Crew, summary.ready60Generals) }}</td>
                        <th>수비○</th>
                        <td>{{ showPair(summary.defenceReadyCrew, summary.defenceReadyGenerals) }}</td>
                    </tr>
                    <tr>
                        <th>장수</th>
                        <td colspan="11" class="general-names">
                            <template v-if="data.visibility.detailed">
                                <template v-if="data.generals.length">
                                    <template v-for="(general, index) in data.generals" :key="general.id">
                                        <span :style="{ color: getNpcColor(general.npcState) }">{{ general.name }}</span
                                        ><template v-if="index < data.generals.length - 1">, </template>
                                    </template>
                                </template>
                                <template v-else>-</template>
                            </template>
                            <span v-else class="unknown">알 수 없음</span>
                        </td>
                    </tr>
                </tbody>
            </table>
            <table v-if="data.visibility.detailed" id="general_list" class="legacy-table legacy-bg0 generals">
                <colgroup>
                    <col style="width: 64px" />
                    <col style="width: 128px" />
                    <col style="width: 48px" />
                    <col style="width: 48px" />
                    <col style="width: 48px" />
                    <col style="width: 78px" />
                    <col style="width: 28px" />
                    <col style="width: 78px" />
                    <col style="width: 78px" />
                    <col style="width: 48px" />
                    <col style="width: 48px" />
                    <col style="width: 280px" />
                </colgroup>
                <thead>
                    <tr>
                        <th>얼 굴</th>
                        <th>이 름</th>
                        <th>통솔</th>
                        <th>무력</th>
                        <th>지력</th>
                        <th>관 직</th>
                        <th>守</th>
                        <th>병 종</th>
                        <th>병 사</th>
                        <th>훈련</th>
                        <th>사기</th>
                        <th>명 령</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="general in data.generals"
                        :key="general.id"
                        :data-is-our-general="general.train !== null"
                        :data-general-wounded="general.injury"
                    >
                        <td class="icon-cell">
                            <img
                                class="general-icon"
                                width="64"
                                height="64"
                                :src="generalImage(general)"
                                @error="useDefaultGeneralIcon"
                            />
                        </td>
                        <td :style="{ color: getNpcColor(general.npcState) }">{{ general.name }}</td>
                        <td :class="{ wounded: general.injury !== 0 }">
                            {{ woundedStat(general.leadership, general.injury)
                            }}<span v-if="general.leadershipBonus" class="leadership-bonus"
                                >+{{ general.leadershipBonus }}</span
                            >
                        </td>
                        <td :class="{ wounded: general.injury !== 0 }">
                            {{ woundedStat(general.strength, general.injury) }}
                        </td>
                        <td :class="{ wounded: general.injury !== 0 }">
                            {{ woundedStat(general.intelligence, general.injury) }}
                        </td>
                        <td>{{ formatOfficerLevelText(general.officerLevel) }}</td>
                        <td>{{ defenceTrainText(general.defenceTrain) }}</td>
                        <td>{{ general.crewTypeName ?? '?' }}</td>
                        <td>{{ general.crew ?? '?' }}</td>
                        <td>{{ general.train ?? '?' }}</td>
                        <td>{{ general.atmos ?? '?' }}</td>
                        <td class="turns" :class="{ 'turns--reserved': general.turns.length > 0 }">
                            <template v-if="general.turns.length">
                                <span
                                    v-for="(turn, index) in general.turns"
                                    :key="index"
                                    class="turn-line"
                                    :title="commandBrief(turn)"
                                    >{{ index + 1 }} : {{ commandBrief(turn) }}</span
                                >
                            </template>
                            <template v-else-if="general.npcState > 1">NPC 장수</template>
                            <template v-else-if="general.nationId !== data.me.nationId">
                                {{ general.nationId === 0 ? '재 야' : `【${general.nationName}】 장수` }}
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
        </template>
        <table class="legacy-table legacy-bg0 footer">
            <tbody>
                <tr>
                    <td>
                        <button
                            class="legacy-button legacy-button--navigation back-link"
                            type="button"
                            @click="router.push('/')"
                        >
                            돌아가기
                        </button>
                    </td>
                </tr>
                <tr>
                    <td class="legacy-banner">
                        삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD(hided62@gmail.com)
                        /
                        <a href="https://sam.hided.net/wiki/hidche/credit" target="_blank" rel="noreferrer">Credit</a>
                    </td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.city-page {
    width: 1000px;
    margin: 0 auto;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
}
.legacy-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 2px;
}
.legacy-table td,
.legacy-table th {
    border: 0;
    padding: 1px;
    font-weight: 400;
}
.center,
.selector,
.stats td,
.stats th,
.generals th,
.generals td:not(:last-child) {
    text-align: center;
}
.selector select {
    display: inline-block;
    min-width: 400px;
    height: 19px;
    padding: 0;
    border: 1px solid #767676;
    background: #6b6b6b;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 13.3333px;
}
.selector {
    transform: translateY(-2px);
}
.selector p {
    margin: 1em 0;
}
.back-row {
    margin-top: 16px;
}
.stats {
    margin-top: 0;
    table-layout: fixed;
}
.stats,
.generals {
    border-collapse: collapse;
    border-spacing: 0;
}
.stats td,
.stats th,
.generals td,
.generals th {
    border: 1px solid gray;
}
.label-col {
    width: 48px;
}
.value-col {
    width: 108px;
}
.first-value-col {
    width: 112px;
}
.stats th,
.generals th {
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}
.city-title {
    text-align: center;
}
.stats {
    height: auto;
}
.stats td,
.stats th {
    white-space: nowrap;
}
.general-names {
    text-align: left !important;
    white-space: normal !important;
}
.unknown {
    color: gray;
}
.generals {
    width: 1000px;
    margin: 18px 0 0 50%;
    table-layout: fixed;
    transform: translateX(-50%);
}
.generals td:last-child {
    text-align: left;
    padding-left: 1em;
}
.icon-cell {
    height: 64px;
    padding: 0 !important;
}
.generals tbody tr {
    height: 64px;
}
.general-icon {
    display: block;
    width: 64px;
    min-width: 64px;
    height: 64px;
    object-fit: fill;
}
.turns--reserved {
    font-size: x-small;
}
.turn-line {
    display: block;
}
.wounded {
    color: red;
}
.leadership-bonus {
    color: cyan;
}
.footer {
    margin-top: 0;
}
.back-link {
    font-family: var(--sammo-font-sans);
    font-size: 14px;
}
.legacy-banner a {
    color: #fff;
    text-decoration: underline;
}
.error {
    text-align: center;
    color: #ff7373;
}
@media (max-width: 700px) {
    .city-page {
        width: 1000px;
        margin-top: 8px;
        transform-origin: top left;
    }
}
</style>
