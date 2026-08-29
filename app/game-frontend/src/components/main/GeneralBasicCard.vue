<script setup lang="ts">
import { computed } from 'vue';

import SkeletonLines from '../ui/SkeletonLines.vue';
import LegacyProgressBar from '../ui/LegacyProgressBar.vue';
import RichTooltip from '../ui/RichTooltip.vue';
import { formatLocalTimeSeconds } from '../../utils/legacyDateTime';
import { legacyExperiencePercent, ratioPercent } from '../../utils/legacyProgress';
import { DEFAULT_GENERAL_ICON_URL, resolveGeneralIconUrl, useDefaultGeneralIcon } from '../../utils/generalIcon';
import { configuredGameAssetUrl } from '../../utils/imageAssets';
import { legacyLuminanceTextColor } from '../../utils/legacyNationColor';

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
    dex?: number[];
}

interface ItemDisplayNames {
    horse?: string | null;
    weapon?: string | null;
    book?: string | null;
    item?: string | null;
}

interface ItemDisplayInfo {
    horse?: string | null;
    weapon?: string | null;
    book?: string | null;
    item?: string | null;
}

interface CrewTypeDisplayInfo {
    name: string;
    info: string[];
    requirements: string[];
    stats: {
        attack: number;
        defence: number;
        speed: number;
        avoid: number;
        magicCoef: number;
        cost: number;
        rice: number;
    };
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

export interface GeneralBasicCardData {
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
    crewTypeInfo?: CrewTypeDisplayInfo | null;
    traits?: { personal: string; specialWar: string; specialDomestic: string };
    traitAges?: { specialWar: number; specialDomestic: number };
    traitInfo?: { personal: string; specialWar: string; specialDomestic: string };
    progression?: GeneralProgression;
    itemNames?: ItemDisplayNames;
    itemInfo?: ItemDisplayInfo;
    equipmentNames?: ItemDisplayNames;
}

const props = withDefaults(
    defineProps<{
        general: GeneralBasicCardData | null;
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

const generalIconUrl = computed(() => resolveGeneralIconUrl(props.general ?? {}));

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

const titleStyle = computed(() => {
    const backgroundColor = props.nationColor || '#173d27';
    return {
        backgroundColor,
        color: legacyLuminanceTextColor(backgroundColor),
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
const resolveSpecialDisplayName = (kind: 'specialDomestic' | 'specialWar') => {
    const general = props.general;
    if (!general) return '-';
    const traitName = general.traits?.[kind];
    if (traitName && traitName !== '-') return traitName;
    const scheduledAge = general.traitAges?.[kind];
    if (general.age === undefined || scheduledAge === undefined) return '-';
    return `${Math.max(general.age + 1, scheduledAge)}세`;
};
const specialDomesticText = computed(() => resolveSpecialDisplayName('specialDomestic'));
const specialWarText = computed(() => resolveSpecialDisplayName('specialWar'));
const specialText = computed(() => {
    return `${specialDomesticText.value} / ${specialWarText.value}`;
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
                <img
                    class="general-image general-icon"
                    :src="generalIconUrl"
                    :alt="`${props.general.name} 초상`"
                    @error="useDefaultGeneralIcon"
                />
                <div class="general-title battle-general-name" :style="titleStyle">
                    {{ props.general.name }} 【
                    <template v-if="props.general.officerCityName">{{ props.general.officerCityName }} </template>
                    {{ props.general.officerLevelText }} | {{ props.general.generalType ?? '-' }} |
                    <span :style="{ color: injuryInfo.color }">{{ injuryInfo.text }}</span> 】
                    <span data-general-turn-time>{{
                        props.general.turnTime ? formatLocalTimeSeconds(props.general.turnTime) : '-'
                    }}</span>
                </div>

                <template v-for="stat of statRows" :key="stat.key">
                    <span class="cell-label">{{ stat.label }}</span>
                    <strong class="stat-value" :style="{ color: injuryInfo.color }">
                        <span>{{ stat.value }}</span>
                        <span v-if="stat.bonus > 0" class="leadership-bonus">+{{ stat.bonus }}</span>
                        <span class="bar-cell">
                            <RichTooltip
                                :title="`${stat.label} 성장`"
                                :description="`${stat.accumulated} / ${stat.limit}`"
                                :test-id="`stat-${stat.key}`"
                            >
                                <span :data-stat-progress="stat.key">
                                    <LegacyProgressBar
                                        :percent="stat.percent"
                                        :label="`${stat.label} 성장 ${stat.accumulated} / ${stat.limit}`"
                                    />
                                </span>
                            </RichTooltip>
                        </span>
                    </strong>
                </template>

                <span class="cell-label">명마</span>
                <strong>
                    <RichTooltip
                        :title="itemNames.horse ?? ''"
                        :description="props.general.itemInfo?.horse"
                        test-id="horse"
                    >
                        {{ itemNames.horse ?? '-' }}
                    </RichTooltip>
                </strong>
                <span class="cell-label">무기</span>
                <strong>
                    <RichTooltip
                        :title="itemNames.weapon ?? ''"
                        :description="props.general.itemInfo?.weapon"
                        test-id="weapon"
                    >
                        {{ itemNames.weapon ?? '-' }}
                    </RichTooltip>
                </strong>
                <span class="cell-label">서적</span>
                <strong>
                    <RichTooltip
                        :title="itemNames.book ?? ''"
                        :description="props.general.itemInfo?.book"
                        test-id="book"
                    >
                        {{ itemNames.book ?? '-' }}
                    </RichTooltip>
                </strong>

                <span
                    class="general-image general-crew-type-icon"
                    role="img"
                    :aria-label="`${props.general.crewTypeName ?? '병종'} 이미지`"
                    :style="{ backgroundImage: crewTypeIconBackground }"
                />
                <span class="cell-label">자금</span><strong>{{ props.general.gold.toLocaleString('ko-KR') }}</strong>
                <span class="cell-label">군량</span><strong>{{ props.general.rice.toLocaleString('ko-KR') }}</strong>
                <span class="cell-label">도구</span>
                <strong>
                    <RichTooltip
                        :title="itemNames.item ?? ''"
                        :description="props.general.itemInfo?.item"
                        test-id="item"
                    >
                        {{ itemNames.item ?? '-' }}
                    </RichTooltip>
                </strong>

                <span class="cell-label">병종</span>
                <strong>
                    <RichTooltip
                        :title="props.general.crewTypeName ?? ''"
                        :description="props.general.crewTypeInfo?.info"
                        test-id="crew-type"
                    >
                        {{ props.general.crewTypeName ?? '-' }}
                        <template v-if="props.general.crewTypeInfo" #content>
                            <span class="rich-tooltip-content__title">{{ props.general.crewTypeInfo.name }}</span>
                            <span
                                v-for="(line, index) in props.general.crewTypeInfo.info"
                                :key="`crew-info:${index}`"
                                class="rich-tooltip-content__line"
                            >
                                {{ line }}
                            </span>
                            <span class="rich-tooltip-content__section">전투 정보</span>
                            <span class="rich-tooltip-content__meta">
                                공격 {{ props.general.crewTypeInfo.stats.attack }} · 방어
                                {{ props.general.crewTypeInfo.stats.defence }} · 속도
                                {{ props.general.crewTypeInfo.stats.speed }} · 회피
                                {{ props.general.crewTypeInfo.stats.avoid }}% · 계략
                                {{ props.general.crewTypeInfo.stats.magicCoef }}%
                            </span>
                            <span class="rich-tooltip-content__meta">
                                병사 100명 기준 금 {{ props.general.crewTypeInfo.stats.cost }} · 쌀
                                {{ props.general.crewTypeInfo.stats.rice }}
                            </span>
                            <template v-if="props.general.crewTypeInfo.requirements.length">
                                <span class="rich-tooltip-content__section">생성 조건</span>
                                <span
                                    v-for="(requirement, index) in props.general.crewTypeInfo.requirements"
                                    :key="`crew-requirement:${index}`"
                                    class="rich-tooltip-content__line"
                                >
                                    {{ requirement }}
                                </span>
                            </template>
                        </template>
                    </RichTooltip>
                </strong>
                <span class="cell-label">병사</span><strong>{{ props.general.crew.toLocaleString('ko-KR') }}</strong>
                <span class="cell-label">성격</span>
                <strong>
                    <RichTooltip
                        :title="props.general.traits?.personal ?? ''"
                        :description="props.general.traitInfo?.personal"
                        test-id="personality"
                    >
                        {{ props.general.traits?.personal ?? '-' }}
                    </RichTooltip>
                </strong>

                <span class="cell-label">훈련</span><strong>{{ props.general.train }}</strong>
                <span class="cell-label">사기</span><strong>{{ props.general.atmos }}</strong>
                <span class="cell-label">특기</span>
                <strong class="special-value" :aria-label="specialText">
                    <RichTooltip
                        :title="`내정특기 · ${specialDomesticText}`"
                        :description="props.general.traitInfo?.specialDomestic"
                        test-id="special-domestic"
                    >
                        {{ specialDomesticText }}
                    </RichTooltip>
                    /
                    <RichTooltip
                        :title="`전투특기 · ${specialWarText}`"
                        :description="props.general.traitInfo?.specialWar"
                        test-id="special-war"
                    >
                        {{ specialWarText }}
                    </RichTooltip>
                </strong>

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
    object-fit: contain;
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

.bar-cell :deep(.rich-tooltip-trigger),
.bar-cell [data-stat-progress] {
    display: block;
    width: 100%;
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
