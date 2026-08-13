<script setup lang="ts">
import { computed } from 'vue';

import SkeletonLines from '../ui/SkeletonLines.vue';
import LegacyProgressBar from '../ui/LegacyProgressBar.vue';
import { formatSeoulTimeSeconds } from '../../utils/legacyDateTime';
import { legacyExperiencePercent, ratioPercent } from '../../utils/legacyProgress';
import { DEFAULT_GENERAL_ICON_URL, resolveGeneralIconBackgroundImage } from '../../utils/generalIcon';
import { configuredGameAssetUrl } from '../../utils/imageAssets';

interface GeneralStats {
    leadership: number;
    strength: number;
    intelligence: number;
}

interface GeneralProgression {
    experienceLevel: number;
    dedicationLevel: number;
    dedicationText?: string;
    statExperience?: { leadership: number; strength: number; intelligence: number };
    statUpgradeLimit?: number;
}

interface ItemDisplayNames {
    horse?: string | null;
    weapon?: string | null;
    book?: string | null;
    item?: string | null;
}

interface GeneralTroopDisplay {
    name: string;
    status: 'inactive' | 'present' | 'away';
    leaderCityName?: string | null;
}

interface GeneralRefreshScore {
    current: number;
    total: number;
    text: string;
}

interface GeneralInfo {
    id: number;
    name: string;
    picture?: string | null;
    imageServer?: number | null;
    npcState: number;
    officerLevel: number;
    officerLevelText: string;
    officerCityName?: string | null;
    generalType?: string;
    leadershipBonus?: number;
    stats: GeneralStats;
    gold: number;
    rice: number;
    crew: number;
    train: number;
    atmos: number;
    injury: number;
    experience: number;
    dedication: number;
    age?: number;
    retirementYear?: number;
    turnTime?: string | null;
    defenceTrain?: number;
    killTurn?: number;
    remainingMinutes?: number | null;
    troopId?: number;
    troop?: GeneralTroopDisplay | null;
    refreshScore?: GeneralRefreshScore;
    crewTypeId?: number;
    crewTypeName?: string;
    traits?: { personal: string; specialWar: string; specialDomestic: string };
    progression?: GeneralProgression;
    itemNames?: ItemDisplayNames;
    equipmentNames?: ItemDisplayNames;
}

const props = withDefaults(
    defineProps<{
        general: GeneralInfo | null;
        loading: boolean;
        nationColor?: string | null;
        defenceText?: string | null;
        killTurn?: number | null;
        remainingMinutes?: number | null;
        troopText?: string | null;
        penaltyText?: string | number | null;
    }>(),
    {
        nationColor: '#173d27',
        defenceText: null,
        killTurn: null,
        remainingMinutes: null,
        troopText: null,
        penaltyText: null,
    }
);

const statRows = computed(() => {
    const general = props.general;
    if (!general) return [];
    const limit = general.progression?.statUpgradeLimit ?? 30;
    const accumulated = general.progression?.statExperience;
    return [
        {
            key: 'leadership',
            label: '통솔',
            value: Math.round((general.stats.leadership * (100 - general.injury)) / 100),
            bonus: general.leadershipBonus ?? 0,
            accumulated: accumulated?.leadership ?? 0,
        },
        {
            key: 'strength',
            label: '무력',
            value: Math.round((general.stats.strength * (100 - general.injury)) / 100),
            bonus: 0,
            accumulated: accumulated?.strength ?? 0,
        },
        {
            key: 'intelligence',
            label: '지력',
            value: Math.round((general.stats.intelligence * (100 - general.injury)) / 100),
            bonus: 0,
            accumulated: accumulated?.intelligence ?? 0,
        },
    ].map((entry) => ({ ...entry, limit, percent: ratioPercent(entry.accumulated, limit) }));
});

const experiencePercent = computed(() =>
    legacyExperiencePercent(props.general?.experience ?? 0, props.general?.progression?.experienceLevel ?? 0)
);

const itemNames = computed<ItemDisplayNames>(() => props.general?.itemNames ?? props.general?.equipmentNames ?? {});

const generalIconBackground = computed(() => resolveGeneralIconBackgroundImage(props.general ?? {}));

const crewTypeIconBackground = computed(() => {
    const crewTypeId = props.general?.crewTypeId;
    if (crewTypeId === undefined || !Number.isFinite(crewTypeId)) {
        return `url(${JSON.stringify(DEFAULT_GENERAL_ICON_URL)})`;
    }
    const crewTypeUrl = `${configuredGameAssetUrl()}/crewtype${Math.trunc(crewTypeId)}.png`;
    return `url(${JSON.stringify(crewTypeUrl)}), url(${JSON.stringify(DEFAULT_GENERAL_ICON_URL)})`;
});

const injuryInfo = computed(() => {
    const injury = props.general?.injury ?? 0;
    if (injury > 60) return { text: '위독', color: '#ff0000' };
    if (injury > 40) return { text: '심각', color: '#ff00ff' };
    if (injury > 20) return { text: '중상', color: '#ffa500' };
    if (injury > 0) return { text: '경상', color: '#ffff00' };
    return { text: '건강', color: '#ffffff' };
});

const isBrightColor = (color: string): boolean => {
    const normalized = /^#[0-9a-f]{6}$/iu.test(color) ? color.slice(1) : '173d27';
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 >= 150;
};

const titleStyle = computed(() => {
    const backgroundColor = props.nationColor || '#173d27';
    return {
        backgroundColor,
        color: isBrightColor(backgroundColor) ? '#000000' : '#ffffff',
    };
});

const ageColor = computed(() => {
    const general = props.general;
    const age = general?.age;
    if (!general || age === undefined) return '#ffffff';
    const retirementYear = general.retirementYear ?? 70;
    if (age < retirementYear * 0.75) return '#32cd32';
    if (age < retirementYear) return '#ffff00';
    return '#ff0000';
});

const displayTroop = computed<GeneralTroopDisplay | null>(() => {
    if (props.general?.troop) return props.general.troop;
    if (props.troopText && props.troopText !== '-') {
        return { name: props.troopText, status: 'present' };
    }
    return null;
});
const displayPenalty = computed(() => {
    const refreshScore = props.general?.refreshScore;
    if (refreshScore) {
        return `${refreshScore.text} ${refreshScore.total.toLocaleString('ko-KR')}점(${refreshScore.current})`;
    }
    const penalty = props.penaltyText ?? '-';
    return String(penalty);
});
const displayDefence = computed(() => {
    if (props.general?.defenceTrain !== undefined) {
        return props.general.defenceTrain === 999
            ? { text: '수비 안함', active: false }
            : { text: `수비 함(훈사${props.general.defenceTrain})`, active: true };
    }
    return { text: props.defenceText ?? '-', active: null };
});
const displayKillTurn = computed(() => props.general?.killTurn ?? props.killTurn);
const displayRemainingMinutes = computed(() => props.general?.remainingMinutes ?? props.remainingMinutes);
const specialText = computed(() => {
    const traits = props.general?.traits;
    return traits ? `${traits.specialDomestic || '-'} / ${traits.specialWar || '-'}` : '-';
});
</script>

<template>
    <div class="general-card" data-general-basic-card>
        <div v-if="props.loading" class="general-loading">
            <SkeletonLines :lines="5" />
        </div>
        <div v-else-if="!props.general" class="empty">장수 정보를 불러오지 못했습니다.</div>
        <template v-else>
            <div class="general-basic-grid general-body">
                <span
                    class="general-image general-icon"
                    role="img"
                    :aria-label="`${props.general.name} 초상`"
                    :style="{ backgroundImage: generalIconBackground }"
                />
                <div class="general-title battle-general-name" :style="titleStyle">
                    {{ props.general.name }} 【
                    <template v-if="props.general.officerCityName">{{ props.general.officerCityName }} </template>
                    {{ props.general.officerLevelText }} | {{ props.general.generalType ?? '-' }} |
                    <span :style="{ color: injuryInfo.color }">{{ injuryInfo.text }}</span> 】
                    <span data-general-turn-time>{{
                        props.general.turnTime ? formatSeoulTimeSeconds(props.general.turnTime) : '-'
                    }}</span>
                </div>

                <template v-for="stat of statRows" :key="stat.key">
                    <span class="cell-label">{{ stat.label }}</span>
                    <strong class="stat-value" :style="{ color: injuryInfo.color }">
                        <span>{{ stat.value }}</span>
                        <span v-if="stat.bonus > 0" class="leadership-bonus">+{{ stat.bonus }}</span>
                        <span class="bar-cell" :data-stat-progress="stat.key">
                            <LegacyProgressBar
                                :percent="stat.percent"
                                :label="`${stat.label} 성장 ${stat.accumulated} / ${stat.limit}`"
                            />
                        </span>
                    </strong>
                </template>

                <span class="cell-label">명마</span><strong>{{ itemNames.horse ?? '-' }}</strong>
                <span class="cell-label">무기</span><strong>{{ itemNames.weapon ?? '-' }}</strong>
                <span class="cell-label">서적</span><strong>{{ itemNames.book ?? '-' }}</strong>

                <span
                    class="general-image general-crew-type-icon"
                    role="img"
                    :aria-label="`${props.general.crewTypeName ?? '병종'} 이미지`"
                    :style="{ backgroundImage: crewTypeIconBackground }"
                />
                <span class="cell-label">자금</span><strong>{{ props.general.gold.toLocaleString('ko-KR') }}</strong>
                <span class="cell-label">군량</span><strong>{{ props.general.rice.toLocaleString('ko-KR') }}</strong>
                <span class="cell-label">도구</span><strong>{{ itemNames.item ?? '-' }}</strong>

                <span class="cell-label">병종</span><strong>{{ props.general.crewTypeName ?? '-' }}</strong>
                <span class="cell-label">병사</span><strong>{{ props.general.crew.toLocaleString('ko-KR') }}</strong>
                <span class="cell-label">성격</span><strong>{{ props.general.traits?.personal ?? '-' }}</strong>

                <span class="cell-label">훈련</span><strong>{{ props.general.train }}</strong>
                <span class="cell-label">사기</span><strong>{{ props.general.atmos }}</strong>
                <span class="cell-label">특기</span><strong :title="specialText">{{ specialText }}</strong>

                <span class="cell-label level-label">Lv</span>
                <strong class="level-value">{{ props.general.progression?.experienceLevel ?? 0 }}</strong>
                <span class="experience-bar" data-experience-progress>
                    <LegacyProgressBar
                        :percent="experiencePercent"
                        :label="`경험 레벨 진행 ${experiencePercent.toFixed(1)}%`"
                    />
                </span>
                <span class="cell-label age-label">연령</span>
                <strong class="age-value" :style="{ color: ageColor }">{{ props.general.age ?? '-' }}세</strong>

                <span class="cell-label defence-label">수비</span>
                <strong
                    class="defence-value"
                    :class="{
                        'defence-value--active': displayDefence.active === true,
                        'defence-value--inactive': displayDefence.active === false,
                    }"
                    >{{ displayDefence.text }}</strong
                >
                <span class="cell-label kill-label">삭턴</span>
                <strong class="kill-value">{{ displayKillTurn === null ? '-' : `${displayKillTurn} 턴` }}</strong>
                <span class="cell-label execute-label">실행</span>
                <strong class="execute-value">{{
                    displayRemainingMinutes === null ? '-' : `${displayRemainingMinutes}분 남음`
                }}</strong>

                <span class="cell-label troop-label">부대</span>
                <strong class="troop-value">
                    <s v-if="displayTroop?.status === 'inactive'" class="troop-value--inactive">{{
                        displayTroop.name
                    }}</s>
                    <span v-else-if="displayTroop?.status === 'away'" class="troop-value--away">
                        {{ displayTroop.name
                        }}<template v-if="displayTroop.leaderCityName">({{ displayTroop.leaderCityName }})</template>
                    </span>
                    <span v-else>{{ displayTroop?.name ?? '-' }}</span>
                </strong>
                <span class="cell-label penalty-label">벌점</span>
                <strong class="penalty-value">{{ displayPenalty }}</strong>
            </div>
            <slot name="details" />
        </template>
    </div>
</template>

<style scoped>
.general-card {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    background-color: #172a52;
    background-image: var(--sammo-texture-blue);
    color: #fff;
    font-size: 12px;
}

.general-basic-grid {
    display: grid;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    grid-template-columns: 64px repeat(3, minmax(30px, 2fr) minmax(60px, 5fr));
    grid-template-rows: repeat(9, calc(64px / 3));
    border-right: 1px solid #777;
    border-bottom: 1px solid #777;
    text-align: center;
}

.general-basic-grid > * {
    box-sizing: border-box;
    min-width: 0;
    min-height: 0;
    border-top: 1px solid #777;
    border-left: 1px solid #777;
    padding: 1px 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.general-basic-grid > strong {
    font-weight: 500;
    text-align: center;
}

.cell-label {
    background-color: rgb(20 75 42 / 70%);
}

.general-image {
    display: block;
    width: 64px;
    height: 64px;
    padding: 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
    user-select: none;
    -webkit-user-drag: none;
}

.general-icon {
    grid-column: 1;
    grid-row: 1 / 4;
}

.general-title {
    grid-column: 2 / 8;
    grid-row: 1;
    font-size: 12px;
    font-weight: 700;
    line-height: 18px;
}

.stat-value {
    display: grid;
    grid-template-columns: minmax(22px, auto) auto minmax(26px, 1fr);
    align-items: center;
    gap: 2px;
}

.leadership-bonus {
    color: #00ffff;
}

.stat-value > .bar-cell {
    grid-column: 3;
}

.bar-cell,
.experience-bar {
    display: grid;
    align-content: center;
    padding: 0 1px;
}

.general-crew-type-icon {
    grid-column: 1;
    grid-row: 4 / 7;
}

.level-label {
    grid-column: 1;
    grid-row: 7;
}

.level-value {
    grid-column: 2;
    grid-row: 7;
}

.experience-bar {
    grid-column: 3 / 6;
    grid-row: 7;
}

.age-label {
    grid-column: 6;
    grid-row: 7;
}

.age-value {
    grid-column: 7;
    grid-row: 7;
}

.defence-label {
    grid-column: 1;
    grid-row: 8;
}

.defence-value {
    grid-column: 2 / 4;
    grid-row: 8;
}

.kill-label {
    grid-column: 4;
    grid-row: 8;
}

.kill-value {
    grid-column: 5;
    grid-row: 8;
}

.execute-label {
    grid-column: 6;
    grid-row: 8;
}

.execute-value {
    grid-column: 7;
    grid-row: 8;
}

.troop-label {
    grid-column: 1;
    grid-row: 9;
}

.troop-value {
    grid-column: 2 / 4;
    grid-row: 9;
}

.penalty-label {
    grid-column: 4;
    grid-row: 9;
}

.penalty-value {
    grid-column: 5 / 8;
    grid-row: 9;
}

.defence-value--active {
    color: #32cd32;
}

.defence-value--inactive {
    color: #ff0000;
}

.troop-value--inactive {
    color: #808080;
}

.troop-value--away {
    color: #ffa500;
}

.general-loading,
.empty {
    min-height: 192px;
    padding: 8px;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
