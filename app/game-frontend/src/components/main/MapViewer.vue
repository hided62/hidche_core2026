<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useMediaQuery, useMouseInElement } from '@vueuse/core';
import SkeletonLines from '../ui/SkeletonLines.vue';
import MapCityBasic from './MapCityBasic.vue';
import MapCityDetail from './MapCityDetail.vue';
import { useMapViewerStore } from '../../stores/mapViewer';

interface MapSummary {
    year: number;
    month: number;
    cityList: [number, number, number, number, number, number][];
    nationList: [number, string, string, number][];
    myCity?: number | null;
    myNation?: number | null;
}

interface CityView {
    id: number;
    name: string;
    level: number;
    state: number;
    nationId: number;
    nationName: string;
    color: string;
    region: number;
    supply: boolean;
    x: number;
    y: number;
    isCapital: boolean;
    isMyCity: boolean;
}

const props = defineProps<{
    mapData: MapSummary | null;
    loading: boolean;
}>();

const isWide = useMediaQuery('(min-width: 1024px)');
const mapStore = useMapViewerStore();
const { showCityName, detailMode, hoveredCityId } = storeToRefs(mapStore);

const mapArea = ref<HTMLElement | null>(null);
const { elementX, elementY } = useMouseInElement(mapArea);

const nationById = computed(() => {
    const map = new Map<number, { name: string; color: string; capitalCityId: number }>();
    if (!props.mapData) {
        return map;
    }
    for (const nation of props.mapData.nationList) {
        const [id, name, color, capitalCityId] = nation;
        map.set(id, {
            name,
            color,
            capitalCityId: capitalCityId ?? 0,
        });
    }
    return map;
});

const cityViews = computed<CityView[]>(() => {
    if (!props.mapData) {
        return [];
    }

    const columns = isWide.value ? 12 : 8;
    const spacing = isWide.value ? 46 : 36;

    return props.mapData.cityList.map((entry, index) => {
        const [id, level, state, nationId, region, supplyFlag] = entry;
        const nation = nationById.value.get(nationId);
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = column * spacing + 20 + (region % 3) * 6;
        const y = row * spacing + 20 + (region % 4) * 4;

        return {
            id,
            name: `도시 ${id}`,
            level,
            state,
            nationId,
            nationName: nation?.name ?? '무주',
            color: nation?.color ?? '#444444',
            region,
            supply: supplyFlag > 0,
            x,
            y,
            isCapital: nation?.capitalCityId === id,
            isMyCity: props.mapData?.myCity === id,
        };
    });
});

const mapSummary = computed(() => {
    if (!props.mapData) {
        return '';
    }
    return `${props.mapData.year}년 ${props.mapData.month}월`;
});

const mapHeight = computed(() => {
    if (!cityViews.value.length) {
        return '240px';
    }
    const columns = isWide.value ? 12 : 8;
    const rows = Math.ceil(cityViews.value.length / columns);
    const spacing = isWide.value ? 46 : 36;
    return `${rows * spacing + 40}px`;
});

const hoveredCity = computed(() => {
    if (!hoveredCityId.value) {
        return null;
    }
    return cityViews.value.find((city) => city.id === hoveredCityId.value) ?? null;
});

const setHoveredCity = (cityId: number | null) => {
    mapStore.setHoveredCity(cityId);
};
</script>

<template>
    <div class="map-viewer">
        <div class="map-top">
            <div class="map-title">{{ mapSummary }}</div>
            <div class="map-controls">
                <button class="map-toggle" :class="{ active: showCityName }" @click="mapStore.toggleCityName">
                    도시명
                </button>
                <button class="map-toggle" :class="{ active: detailMode }" @click="mapStore.toggleDetailMode">
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
            <div ref="mapArea" class="map-area" :style="{ height: mapHeight }">
                <div class="map-placeholder">지도 렌더러 이식 중</div>
                <component
                    :is="detailMode ? MapCityDetail : MapCityBasic"
                    v-for="city in cityViews"
                    :key="city.id"
                    :city="city"
                    :show-name="showCityName"
                    @hover="setHoveredCity"
                    @leave="setHoveredCity(null)"
                />
                <div v-if="hoveredCity" class="map-tooltip" :style="{ left: `${elementX + 16}px`, top: `${elementY + 16}px` }">
                    <div class="tooltip-title">{{ hoveredCity.name }}</div>
                    <div class="tooltip-body">{{ hoveredCity.nationName }} · Lv {{ hoveredCity.level }}</div>
                </div>
            </div>
            <div class="map-meta">
                <span>도시 {{ props.mapData.cityList.length }}</span>
                <span>세력 {{ props.mapData.nationList.length }}</span>
            </div>
            <div class="map-footnote">
                도시명/좌표 데이터는 추후 서버 API로 치환 예정
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
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.map-area {
    position: relative;
    border: 1px dashed rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.6);
    overflow: hidden;
}

.map-placeholder {
    position: absolute;
    top: 8px;
    left: 8px;
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
}

.map-tooltip {
    position: absolute;
    pointer-events: none;
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.9);
    padding: 4px 6px;
    font-size: 0.65rem;
}

.tooltip-title {
    font-weight: 600;
}

.tooltip-body {
    color: rgba(232, 221, 196, 0.6);
}

.map-meta {
    display: flex;
    gap: 12px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.map-footnote {
    font-size: 0.65rem;
    color: rgba(232, 221, 196, 0.5);
}

.map-empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
