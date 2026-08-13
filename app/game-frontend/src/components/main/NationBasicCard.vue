<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';
import { legacyNationTextColor } from '../../utils/legacyNationColor';
import { formatOfficerLevelText } from '../../utils/nationFormat';
import { getNpcColor } from '../../utils/npcColor';

interface NationChief {
    id: number;
    name: string;
    npcState: number;
}

interface NationInfo {
    id: number;
    name: string;
    color: string;
    level: number;
    gold: number;
    rice: number;
    tech: number;
    typeName: string;
    typePros: string;
    typeCons: string;
    population: { cityCount: number; current: number; max: number };
    crew: { generalCount: number; current: number; max: number };
    power: number;
    bill: number;
    taxRate: number;
    strategicCommandLimit: number;
    diplomaticLimit: number;
    prohibitScout: boolean;
    prohibitWar: boolean;
    techLevel: number;
    techLimited: boolean;
    topChiefs: Record<number, NationChief | undefined>;
    impossibleStrategicCommands: Array<{
        name: string;
        remainingTurns: number;
        availableYear: number;
        availableMonth: number;
    }>;
}

const props = defineProps<{
    nation: NationInfo | null;
    loading: boolean;
}>();

const number = (value: number): string => value.toLocaleString('ko-KR');
const displayChiefName = (chief: NationChief | undefined): string => {
    if (!chief) return '-';
    return chief.npcState > 0 && !/^[ⓜⓝ㉥]/u.test(chief.name) ? `ⓝ${chief.name}` : chief.name;
};
</script>

<template>
    <div class="nation-card" data-nation-basic-card>
        <div v-if="props.loading" class="loading"><SkeletonLines :lines="6" /></div>
        <div v-else-if="!props.nation" class="empty">국가 정보를 불러오지 못했습니다.</div>
        <div v-else class="nation-grid">
            <div
                class="title"
                :style="{ backgroundColor: props.nation.color, color: legacyNationTextColor(props.nation.color) }"
            >
                {{ props.nation.name }}
            </div>

            <span class="head">성향</span>
            <strong class="body type-body">
                {{ props.nation.typeName }} (<span class="pros">{{ props.nation.typePros }}</span>
                <span class="cons">{{ props.nation.typeCons }}</span
                >)
            </strong>

            <span class="head">{{ formatOfficerLevelText(12, props.nation.level) }}</span>
            <strong class="body" :style="{ color: getNpcColor(props.nation.topChiefs[12]?.npcState ?? 1) }">
                {{ displayChiefName(props.nation.topChiefs[12]) }}
            </strong>
            <span class="head">{{ formatOfficerLevelText(11, props.nation.level) }}</span>
            <strong class="body" :style="{ color: getNpcColor(props.nation.topChiefs[11]?.npcState ?? 1) }">
                {{ displayChiefName(props.nation.topChiefs[11]) }}
            </strong>

            <span class="head">총 주민</span>
            <strong class="body">{{
                props.nation.id === 0
                    ? '해당 없음'
                    : `${number(props.nation.population.current)} / ${number(props.nation.population.max)}`
            }}</strong>
            <span class="head">총 병사</span>
            <strong class="body">{{
                props.nation.id === 0
                    ? '해당 없음'
                    : `${number(props.nation.crew.current)} / ${number(props.nation.crew.max)}`
            }}</strong>

            <span class="head">국고</span>
            <strong class="body">{{ props.nation.id === 0 ? '해당 없음' : number(props.nation.gold) }}</strong>
            <span class="head">병량</span>
            <strong class="body">{{ props.nation.id === 0 ? '해당 없음' : number(props.nation.rice) }}</strong>

            <span class="head">지급률</span>
            <strong class="body">{{ props.nation.id === 0 ? '해당 없음' : `${props.nation.bill}%` }}</strong>
            <span class="head">세율</span>
            <strong class="body">{{ props.nation.id === 0 ? '해당 없음' : `${props.nation.taxRate}%` }}</strong>

            <span class="head">속령</span>
            <strong class="body">{{
                props.nation.id === 0 ? '해당 없음' : number(props.nation.population.cityCount)
            }}</strong>
            <span class="head">장수</span>
            <strong class="body">{{
                props.nation.id === 0 ? '해당 없음' : number(props.nation.crew.generalCount)
            }}</strong>

            <span class="head">국력</span>
            <strong class="body">{{ props.nation.id === 0 ? '해당 없음' : number(props.nation.power) }}</strong>
            <span class="head">기술력</span>
            <strong class="body">
                <template v-if="props.nation.id === 0">해당 없음</template>
                <template v-else>
                    {{ props.nation.techLevel }}등급 /
                    <span :class="props.nation.techLimited ? 'tech-limited' : 'available'">{{
                        number(Math.floor(props.nation.tech))
                    }}</span>
                </template>
            </strong>

            <span class="head">전략</span>
            <strong
                class="body strategic"
                :class="{ 'has-tooltip': props.nation.impossibleStrategicCommands.length > 0 }"
                :tabindex="props.nation.impossibleStrategicCommands.length > 0 ? 0 : undefined"
            >
                <template v-if="props.nation.id === 0">해당 없음</template>
                <span v-else-if="props.nation.strategicCommandLimit" class="blocked"
                    >{{ number(props.nation.strategicCommandLimit) }}턴</span
                >
                <span v-else :class="props.nation.impossibleStrategicCommands.length > 0 ? 'warning' : 'available'"
                    >가능</span
                >
                <span
                    v-if="props.nation.impossibleStrategicCommands.length > 0"
                    class="cooldown-tooltip"
                    role="tooltip"
                >
                    <span v-for="command in props.nation.impossibleStrategicCommands" :key="command.name">
                        {{ command.name }}: {{ number(command.remainingTurns) }}턴 뒤({{ command.availableYear }}년
                        {{ command.availableMonth }}월부터)
                    </span>
                </span>
            </strong>
            <span class="head">외교</span>
            <strong class="body">
                <template v-if="props.nation.id === 0">해당 없음</template>
                <span v-else-if="props.nation.diplomaticLimit" class="blocked"
                    >{{ number(props.nation.diplomaticLimit) }}턴</span
                >
                <span v-else class="available">가능</span>
            </strong>

            <span class="head">임관</span>
            <strong class="body">
                <template v-if="props.nation.id === 0">해당 없음</template>
                <span v-else :class="props.nation.prohibitScout ? 'blocked' : 'available'">{{
                    props.nation.prohibitScout ? '금지' : '허가'
                }}</span>
            </strong>
            <span class="head">전쟁</span>
            <strong class="body">
                <template v-if="props.nation.id === 0">해당 없음</template>
                <span v-else :class="props.nation.prohibitWar ? 'blocked' : 'available'">{{
                    props.nation.prohibitWar ? '금지' : '허가'
                }}</span>
            </strong>
        </div>
    </div>
</template>

<style scoped>
.nation-card {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 193px;
    color: #fff;
    font-size: 12px;
}

.nation-grid {
    display: grid;
    box-sizing: border-box;
    width: 100%;
    height: 193px;
    grid-template-columns: 14% 36% 14% 36%;
    grid-template-rows: repeat(10, calc(192px / 10));
    border-right: 1px solid gray;
    border-bottom: 1px solid gray;
    background-color: #172a52;
    background-image: var(--sammo-texture-blue);
}

.nation-grid > * {
    box-sizing: border-box;
    min-width: 0;
    border-top: 1px solid gray;
    border-left: 1px solid gray;
    padding: 0;
    overflow: hidden;
    line-height: calc(193px / 10);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.title {
    grid-column: 1 / 5;
    font-weight: 700;
}

.head {
    background-color: rgb(20 75 42 / 70%);
}

.body {
    position: relative;
    font-weight: 400;
}

.type-body {
    grid-column: 2 / 5;
}

.pros {
    color: cyan;
}

.cons,
.tech-limited {
    color: magenta;
}

.blocked {
    color: red;
}

.available {
    color: limegreen;
}

.warning {
    color: yellow;
}

.strategic.has-tooltip {
    overflow: visible;
    text-decoration: underline dashed red;
}

.cooldown-tooltip {
    position: absolute;
    z-index: 20;
    bottom: calc(100% + 3px);
    left: 50%;
    display: none;
    width: max-content;
    max-width: 280px;
    transform: translateX(-50%);
    border: 1px solid #888;
    padding: 4px 7px;
    background: #111;
    color: #fff;
    line-height: 1.35;
    text-align: left;
    white-space: normal;
}

.cooldown-tooltip > span {
    display: block;
}

.has-tooltip:hover .cooldown-tooltip,
.has-tooltip:focus .cooldown-tooltip {
    display: block;
}

.loading,
.empty {
    box-sizing: border-box;
    min-height: 193px;
    padding: 8px;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
