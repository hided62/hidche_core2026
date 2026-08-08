<script setup lang="ts">
import { computed } from 'vue';
import { configuredGameAssetUrl } from '../utils/imageAssets';

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

const assetBase = computed(configuredGameAssetUrl);
const season = computed(() => {
    if (props.mapData.month <= 3) return 'spring';
    if (props.mapData.month <= 6) return 'summer';
    if (props.mapData.month <= 9) return 'fall';
    return 'winter';
});
const mapBackground = computed(() => {
    const theme = props.mapLayout.mapName;
    if (theme === 'ludo_rathowm') return `${assetBase.value}/map/ludo_rathowm/back.jpg`;
    if (theme === 'chess') return `${assetBase.value}/map/chess/chessboard.png`;
    if (theme === 'pokemon_v1') return `${assetBase.value}/map/pokemon_v1/back_pal8.png`;
    if (theme === 'cr') return `${assetBase.value}/map/cr/bg-fs8.png`;
    return `${assetBase.value}/map/che/bg_${season.value}.jpg`;
});

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
            x: (layoutCity.x / BASE_MAP_WIDTH) * 100,
            y: (layoutCity.y / BASE_MAP_HEIGHT) * 100,
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
        <div class="map-preview-body" :style="{ backgroundImage: `url('${mapBackground}')` }">
            <div
                v-for="city in cityDots"
                :key="city.id"
                class="city-dot"
                :class="{ capital: city.isCapital }"
                :title="city.name"
                :style="{ left: `${city.x}%`, top: `${city.y}%`, backgroundColor: city.color }"
            />
        </div>
    </div>
</template>

<style scoped>
.map-preview {
    display: flex;
    width: 100%;
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
    width: 100%;
    aspect-ratio: 7 / 5;
    overflow: hidden;
    border: 1px solid #444;
    background-color: #080808;
    background-position: center;
    background-size: 100% 100%;
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
