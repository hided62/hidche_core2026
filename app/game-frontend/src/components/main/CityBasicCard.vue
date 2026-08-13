<script setup lang="ts">
import { computed } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';
import LegacyProgressBar from '../ui/LegacyProgressBar.vue';
import { ratioPercent } from '../../utils/legacyProgress';

interface CityInfo {
    id: number;
    name: string;
    level: number;
    levelName: string;
    regionName: string;
    nationId: number;
    nationName: string;
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
</script>

<template>
    <div class="city-card">
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.city" class="empty">도시 정보를 불러오지 못했습니다.</div>
        <div v-else class="city-body">
            <div class="title">
                【{{ props.city.regionName }} | {{ props.city.levelName }}】 {{ props.city.name }} ·
                {{ props.city.nationId > 0 ? `지배 국가 【 ${props.city.nationName} 】` : '공 백 지' }}
            </div>
            <div class="progress-grid">
                <div
                    v-for="metric of metrics"
                    :key="metric.label"
                    class="city-progress"
                    :data-city-progress="metric.label"
                >
                    <span class="city-progress__label">{{ metric.label }}</span>
                    <div class="city-progress__body">
                        <LegacyProgressBar
                            :height="7"
                            :percent="metric.percent"
                            :label="`${metric.label} ${metric.text}`"
                        />
                        <span class="city-progress__text">{{ metric.text }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.title {
    box-sizing: border-box;
    min-height: 20px;
    padding: 1px 6px;
    border-bottom: 1px solid #666;
    background: #173d27;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
}

.progress-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    font-size: 12px;
}

.city-progress {
    display: grid;
    grid-template-columns: 1fr 2fr;
    min-width: 0;
    min-height: 31px;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
}

.city-progress__label {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(20 75 42 / 70%);
}

.city-progress__body {
    display: grid;
    min-width: 0;
    align-content: center;
    padding: 1px 3px;
}

.city-progress__text {
    overflow: hidden;
    line-height: 14px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}

@media (max-width: 939.98px) {
    .progress-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
