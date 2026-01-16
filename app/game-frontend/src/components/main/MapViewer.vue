<script setup lang="ts">
import { computed, ref } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';

interface MapSummary {
    year: number;
    month: number;
    cityList: [number, number, number, number, number, number][];
    nationList: [number, string, string, number][];
    myCity?: number | null;
    myNation?: number | null;
}

const props = defineProps<{
    mapData: MapSummary | null;
    loading: boolean;
}>();

const showCityName = ref(true);
const detailMode = ref(false);

const nationById = computed(() => {
    const map = new Map<number, { name: string; color: string }>();
    if (!props.mapData) {
        return map;
    }
    for (const nation of props.mapData.nationList) {
        const [id, name, color] = nation;
        map.set(id, { name, color });
    }
    return map;
});

const cityEntries = computed(() => {
    if (!props.mapData) {
        return [];
    }
    return props.mapData.cityList.map((entry) => {
        const [id, level, state, nationId, region, supplyFlag] = entry;
        const nation = nationById.value.get(nationId);
        return {
            id,
            level,
            state,
            nationId,
            region,
            supply: supplyFlag > 0,
            nationName: nation?.name ?? '무주',
            color: nation?.color ?? '#444444',
        };
    });
});

const mapSummary = computed(() => {
    if (!props.mapData) {
        return '';
    }
    return `${props.mapData.year}년 ${props.mapData.month}월`;
});
</script>

<template>
    <div class="map-viewer">
        <div class="map-top">
            <div class="map-title">{{ mapSummary }}</div>
            <div class="map-controls">
                <button class="map-toggle" :class="{ active: showCityName }" @click="showCityName = !showCityName">
                    도시명
                </button>
                <button class="map-toggle" :class="{ active: detailMode }" @click="detailMode = !detailMode">
                    상세
                </button>
            </div>
        </div>
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.mapData" class="map-empty">
            지도 데이터를 불러오지 못했습니다.
        </div>
        <div v-else class="map-body">
            <div class="map-placeholder">
                <div class="map-placeholder-text">레거시 지도 렌더러 이식 대기</div>
                <div class="map-meta">
                    <span>도시 {{ props.mapData.cityList.length }}</span>
                    <span>세력 {{ props.mapData.nationList.length }}</span>
                </div>
            </div>
            <div class="city-list">
                <div
                    v-for="city in cityEntries.slice(0, detailMode ? 20 : 10)"
                    :key="city.id"
                    class="city-row"
                    :class="{ mine: props.mapData.myCity === city.id }"
                >
                    <span class="nation" :style="{ backgroundColor: city.color }" />
                    <span class="name">{{ showCityName ? `도시 ${city.id}` : `#${city.id}` }}</span>
                    <span class="meta">Lv {{ city.level }} · 지역 {{ city.region }}</span>
                    <span class="state">보급 {{ city.supply ? 'O' : 'X' }}</span>
                </div>
                <div v-if="cityEntries.length === 0" class="city-empty">표시할 도시가 없습니다.</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.map-viewer {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.map-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.map-title {
    font-size: 0.95rem;
    font-weight: 600;
}

.map-controls {
    display: flex;
    gap: 6px;
}

.map-toggle {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 4px 8px;
    font-size: 0.75rem;
    cursor: pointer;
}

.map-toggle.active {
    background: rgba(201, 164, 90, 0.2);
}

.map-body {
    display: grid;
    gap: 12px;
}

.map-placeholder {
    border: 1px dashed rgba(201, 164, 90, 0.4);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(16, 16, 16, 0.6);
}

.map-placeholder-text {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.8);
}

.map-meta {
    display: flex;
    gap: 12px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.city-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.city-row {
    display: grid;
    grid-template-columns: 14px 1fr auto auto;
    gap: 8px;
    align-items: center;
    padding: 4px 6px;
    border: 1px solid rgba(201, 164, 90, 0.2);
    font-size: 0.75rem;
}

.city-row.mine {
    background: rgba(201, 164, 90, 0.15);
}

.city-row .nation {
    width: 12px;
    height: 12px;
    border: 1px solid rgba(232, 221, 196, 0.6);
}

.city-row .name {
    color: rgba(232, 221, 196, 0.9);
}

.city-row .meta,
.city-row .state {
    color: rgba(232, 221, 196, 0.6);
}

.city-empty {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.6);
}

.map-empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
