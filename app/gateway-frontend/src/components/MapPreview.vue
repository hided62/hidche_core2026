<script setup lang="ts">
import { computed } from 'vue';

interface MapSummary {
    year: number;
    month: number;
    cityList: [number, number, number, number, number, number][];
    nationList: [number, string, string, number][];
}

interface MapLayoutCity {
    id: number;
    name: string;
    level: number;
    region: number;
    x: number;
    y: number;
    path: number[];
}

interface MapLayout {
    mapName: string;
    cityList: MapLayoutCity[];
}

interface CityDot {
    id: number;
    name: string;
    x: number;
    y: number;
    color: string;
    isCapital: boolean;
}

const props = defineProps<{
    mapData: MapSummary;
    mapLayout: MapLayout;
}>();

const BASE_MAP_WIDTH = 700;
const BASE_MAP_HEIGHT = 500;
const MAP_SCALE = 0.45;

const mapWidth = computed(() => `${BASE_MAP_WIDTH * MAP_SCALE}px`);
const mapHeight = computed(() => `${BASE_MAP_HEIGHT * MAP_SCALE}px`);

const nationById = computed(() => {
    const map = new Map<number, { name: string; color: string; capitalCityId: number }>();
    for (const nation of props.mapData.nationList) {
        const [id, name, color, capitalCityId] = nation;
        map.set(id, {
            name,
            color,
            capitalCityId,
        });
    }
    return map;
});

const dynamicCityById = computed(() => {
    const map = new Map<number, [number, number, number, number, number]>();
    for (const entry of props.mapData.cityList) {
        const [id, level, state, nationId, region, supplyFlag] = entry;
        map.set(id, [level, state, nationId, region, supplyFlag]);
    }
    return map;
});

const cityDots = computed<CityDot[]>(() => {
    return props.mapLayout.cityList.map((layoutCity) => {
        const dynamic = dynamicCityById.value.get(layoutCity.id);
        const [, , nationId = 0] = dynamic ?? [];
        const nation = nationById.value.get(nationId);
        return {
            id: layoutCity.id,
            name: layoutCity.name,
            x: layoutCity.x * MAP_SCALE,
            y: layoutCity.y * MAP_SCALE,
            color: nation?.color ?? '#666666',
            isCapital: nation?.capitalCityId === layoutCity.id,
        };
    });
});
</script>

<template>
    <div class="map-preview">
        <div class="map-preview-header">
            <span class="map-preview-title">{{ props.mapLayout.mapName }}</span>
            <span class="map-preview-date">{{ props.mapData.year }}년 {{ props.mapData.month }}월</span>
        </div>
        <div class="map-preview-body" :style="{ width: mapWidth, height: mapHeight }">
            <div
                v-for="city in cityDots"
                :key="city.id"
                class="city-dot"
                :class="{ capital: city.isCapital }"
                :title="city.name"
                :style="{ left: `${city.x}px`, top: `${city.y}px`, backgroundColor: city.color }"
            />
        </div>
    </div>
</template>

<style scoped>
.map-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.map-preview-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.7);
}

.map-preview-title {
    font-weight: 600;
}

.map-preview-body {
    position: relative;
    border: 1px dashed rgba(201, 164, 90, 0.4);
    background: rgba(8, 8, 8, 0.7);
}

.city-dot {
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.5);
}

.city-dot.capital {
    width: 8px;
    height: 8px;
    box-shadow: 0 0 6px rgba(255, 221, 164, 0.7);
    border-color: rgba(255, 221, 164, 0.8);
}
</style>
