<script setup lang="ts">
import { computed } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';
import LegacyProgressBar from '../ui/LegacyProgressBar.vue';
import { ratioPercent } from '../../utils/legacyProgress';
import { legacyLuminanceTextColor } from '../../utils/legacyNationColor';
import { getNpcColor } from '../../utils/npcColor';

interface CityOfficer {
    id: number;
    name: string;
    npcState: number;
}

interface CityInfo {
    id: number;
    name: string;
    level: number;
    levelName: string;
    regionName: string;
    nationId: number;
    nationName: string;
    nationColor: string;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    trust: number;
    trade: number | null;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    supplyState: number;
    frontState: number;
    officers?: Partial<Record<2 | 3 | 4, CityOfficer | null>>;
}

const props = defineProps<{
    city: CityInfo | null;
    loading: boolean;
}>();

const metrics = computed(() => {
    const city = props.city;
    if (!city) return [];
    const paired = (label: string, current: number, maximum: number) => ({
        label,
        percent: ratioPercent(current, maximum),
        text: `${current.toLocaleString()} / ${maximum.toLocaleString()}`,
    });
    const tradeText = city.trade ? `${city.trade}%` : '상인 없음';
    return [
        paired('주민', city.population, city.populationMax),
        {
            label: '민심',
            percent: ratioPercent(city.trust, 100),
            text: city.trust.toLocaleString(undefined, { maximumFractionDigits: 1 }),
        },
        paired('농업', city.agriculture, city.agricultureMax),
        paired('상업', city.commerce, city.commerceMax),
        paired('치안', city.security, city.securityMax),
        paired('수비', city.defence, city.defenceMax),
        paired('성벽', city.wall, city.wallMax),
        { label: '시세', percent: city.trade ? ratioPercent(city.trade - 95, 10) : 0, text: tradeText },
    ];
});

const officerRows = computed(() => {
    const city = props.city;
    if (!city) return [];
    return [
        { level: 4 as const, label: '태수', officer: city.officers?.[4] },
        { level: 3 as const, label: '군사', officer: city.officers?.[3] },
        { level: 2 as const, label: '종사', officer: city.officers?.[2] },
    ];
});

const nationStyle = computed(() => {
    const backgroundColor = props.city?.nationColor ?? '#000000';
    return {
        backgroundColor,
        color: legacyLuminanceTextColor(backgroundColor),
    };
});
</script>

<template>
    <div class="city-card" data-city-basic-card>
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.city" class="empty">도시 정보를 불러오지 못했습니다.</div>
        <div v-else class="city-grid">
            <div class="city-title" :style="nationStyle">
                【{{ props.city.regionName }} | {{ props.city.levelName }}】 {{ props.city.name }}
            </div>
            <div class="city-nation" :style="nationStyle">
                {{ props.city.nationId > 0 ? `지배 국가 【 ${props.city.nationName} 】` : '공 백 지' }}
            </div>
            <div
                v-for="metric of metrics"
                :key="metric.label"
                class="city-panel city-progress"
                :class="{ 'city-panel--population': metric.label === '주민' }"
                :data-city-progress="metric.label"
            >
                <span class="city-panel__head city-progress__label">{{ metric.label }}</span>
                <div class="city-panel__body city-progress__body">
                    <LegacyProgressBar
                        :height="7"
                        :percent="metric.percent"
                        :label="`${metric.label} ${metric.text}`"
                    />
                    <span class="city-progress__text">{{ metric.text }}</span>
                </div>
            </div>
            <div
                v-for="row of officerRows"
                :key="row.level"
                class="city-panel city-officer"
                :class="`city-panel--officer-${row.level}`"
                :data-city-officer="row.level"
            >
                <span class="city-panel__head">{{ row.label }}</span>
                <span
                    class="city-panel__body city-officer__name"
                    :style="{ color: getNpcColor(row.officer?.npcState ?? 0) }"
                >
                    {{ row.officer?.name ?? '-' }}
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.city-card,
.city-grid {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
}

.city-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-right: 1px solid gray;
    border-bottom: 1px solid gray;
    background-color: #172a52;
    background-image: var(--sammo-texture-blue);
}

.city-title,
.city-nation {
    grid-column: 1 / -1;
    min-width: 0;
    border-top: 1px solid gray;
    border-left: 1px solid gray;
    overflow: hidden;
    font-weight: 700;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.city-panel {
    display: grid;
    min-width: 0;
    grid-template-columns: 1fr 2fr;
    border-top: 1px solid gray;
    border-left: 1px solid gray;
}

.city-panel--population {
    grid-column: 1 / 3;
    grid-template-columns: 1fr 5fr;
}

.city-panel__head {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(20 75 42 / 70%);
}

.city-panel__body {
    min-width: 0;
}

.city-progress__body {
    display: grid;
    align-content: center;
}

.city-progress__text {
    overflow: hidden;
    line-height: 1.2em;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.city-officer__name {
    display: flex;
    align-items: center;
    justify-content: center;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}

@media (min-width: 940px) {
    .city-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .city-panel--officer-4 {
        grid-column: 4 / 5;
        grid-row: 3 / 4;
    }

    .city-panel--officer-3 {
        grid-column: 4 / 5;
        grid-row: 4 / 5;
    }

    .city-panel--officer-2 {
        grid-column: 4 / 5;
        grid-row: 5 / 6;
    }
}
</style>
