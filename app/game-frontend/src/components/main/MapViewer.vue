<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useElementSize, useMediaQuery, useMouseInElement } from '@vueuse/core';
import SkeletonLines from '../ui/SkeletonLines.vue';
import MapCityBasic from './MapCityBasic.vue';
import MapCityDetail from './MapCityDetail.vue';
import { useMapViewerStore } from '../../stores/mapViewer';
import { buildAssetUrl } from '../../utils/mapAssets';

interface MapSummary {
    year: number;
    month: number;
    startYear: number;
    cityList: [number, number, number, number, number, number][];
    nationList: [number, string, string, number][];
    myCity?: number | null;
    myNation?: number | null;
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
    regionMap: Record<number, string>;
    levelMap: Record<number, string>;
}

type CityStateClass = 'good' | 'bad' | 'war' | 'wrong';

interface CityView {
    id: number;
    name: string;
    level: number;
    levelName: string;
    state: number;
    stateClass: CityStateClass;
    nationId: number;
    nationName: string;
    color: string;
    region: number;
    regionName: string;
    supply: boolean;
    x: number;
    y: number;
    isCapital: boolean;
    isMyCity: boolean;
    selected: boolean;
}

const props = defineProps<{
    mapData: MapSummary | null;
    mapLayout: MapLayout | null;
    loading: boolean;
}>();

const BASE_MAP_WIDTH = 700;
const BASE_MAP_HEIGHT = 500;
const SMALL_MAP_SCALE = 5 / 7;

const isWide = useMediaQuery('(min-width: 1024px)');
const mapStore = useMapViewerStore();
const { showCityName, detailMode, hoveredCityId, selectedCityId } = storeToRefs(mapStore);

const mapArea = ref<HTMLElement | null>(null);
const mapBody = ref<HTMLElement | null>(null);
const { width: mapBodyWidth } = useElementSize(mapBody);
const { elementX, elementY } = useMouseInElement(mapArea);

const resolveSeason = (month: number): string => {
    if (month <= 3) {
        return 'spring';
    }
    if (month <= 6) {
        return 'summer';
    }
    if (month <= 9) {
        return 'fall';
    }
    return 'winter';
};

const resolveStateClass = (state: number): CityStateClass => {
    if (state < 10) {
        return 'good';
    }
    if (state < 40) {
        return 'bad';
    }
    if (state < 50) {
        return 'war';
    }
    return 'wrong';
};

const assetBaseUrl = computed(() => import.meta.env.VITE_GAME_ASSET_URL?.trim() || '/image/game');
const resolveAsset = (path: string) => buildAssetUrl(assetBaseUrl.value, path);

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

const dynamicCityById = computed(() => {
    const map = new Map<number, [number, number, number, number, number]>();
    if (!props.mapData) {
        return map;
    }
    for (const entry of props.mapData.cityList) {
        const [id, level, state, nationId, region, supplyFlag] = entry;
        map.set(id, [level, state, nationId, region, supplyFlag]);
    }
    return map;
});

const mapScale = computed(() => {
    if (isWide.value) {
        return 1;
    }
    if (mapBodyWidth.value <= 0) {
        return SMALL_MAP_SCALE;
    }
    return Math.min(SMALL_MAP_SCALE, mapBodyWidth.value / BASE_MAP_WIDTH);
});

const mapWidth = computed(() => `${BASE_MAP_WIDTH * mapScale.value}px`);

const mapHeight = computed(() => `${BASE_MAP_HEIGHT * mapScale.value}px`);

const cityViews = computed<CityView[]>(() => {
    if (!props.mapData || !props.mapLayout) {
        return [];
    }

    const scale = mapScale.value;

    return props.mapLayout.cityList.map((layoutCity) => {
        const dynamic = dynamicCityById.value.get(layoutCity.id);
        const [, state = 0, nationId = 0, region = layoutCity.region, supplyFlag = 0] = dynamic ?? [];
        const nation = nationById.value.get(nationId);
        const x = layoutCity.x * scale;
        const y = layoutCity.y * scale;

        return {
            id: layoutCity.id,
            name: layoutCity.name,
            level: layoutCity.level,
            levelName: props.mapLayout?.levelMap?.[layoutCity.level] ?? '-',
            state,
            stateClass: resolveStateClass(state),
            nationId,
            nationName: nation?.name ?? '무주',
            color: nation?.color ?? '#ffffff',
            region,
            regionName: props.mapLayout?.regionMap?.[region] ?? '-',
            supply: supplyFlag > 0,
            x,
            y,
            isCapital: nation?.capitalCityId === layoutCity.id,
            isMyCity: props.mapData?.myCity === layoutCity.id,
            selected: selectedCityId.value === layoutCity.id,
        };
    });
});

const mapSeason = computed(() => {
    if (!props.mapData) {
        return 'spring';
    }
    return resolveSeason(props.mapData.month);
});

const mapTheme = computed(() => props.mapLayout?.mapName ?? 'che');

const mapSummary = computed(() => {
    if (!props.mapData) {
        return '';
    }
    return `${props.mapData.year}년 ${props.mapData.month}월`;
});

const mapThemeClass = computed(() => {
    return `map-theme-${mapTheme.value}`;
});

const mapSeasonClass = computed(() => {
    return `map-season-${mapSeason.value}`;
});

const mapBackgroundImage = computed(() => {
    const theme = mapTheme.value;
    const season = mapSeason.value;

    if (theme === 'ludo_rathowm') {
        return resolveAsset('map/ludo_rathowm/back.jpg');
    }
    if (theme === 'chess') {
        return resolveAsset('map/chess/chessboard.png');
    }
    if (theme === 'pokemon_v1') {
        return resolveAsset('map/pokemon_v1/back_pal8.png');
    }
    if (theme === 'cr') {
        return resolveAsset('map/cr/bg-fs8.png');
    }

    return resolveAsset(`map/che/bg_${season}.jpg`);
});

const mapRoadImage = computed(() => {
    const theme = mapTheme.value;
    if (theme === 'che') {
        return resolveAsset('map/che/che_road.png');
    }
    if (theme === 'miniche' || theme === 'miniche_b' || theme === 'miniche_clean') {
        return resolveAsset('map/che/miniche_road.png');
    }
    if (theme === 'ludo_rathowm') {
        return resolveAsset('map/ludo_rathowm/road.png');
    }
    return null;
});

const mapBackgroundStyle = computed(() => ({
    backgroundImage: mapBackgroundImage.value ? `url('${mapBackgroundImage.value}')` : 'none',
    backgroundSize: '100% 100%',
}));

const mapRoadStyle = computed(() => ({
    backgroundImage: mapRoadImage.value ? `url('${mapRoadImage.value}')` : 'none',
    backgroundSize: '100% 100%',
}));

const detailProps = computed(() =>
    detailMode.value
        ? {
              imageBaseUrl: assetBaseUrl.value,
              themeName: mapTheme.value,
          }
        : {}
);

const hoveredCity = computed(() => {
    if (!hoveredCityId.value) {
        return null;
    }
    return cityViews.value.find((city) => city.id === hoveredCityId.value) ?? null;
});

const setHoveredCity = (cityId: number | null) => {
    mapStore.setHoveredCity(cityId);
};

const selectCity = (cityId: number) => {
    mapStore.setSelectedCity(cityId);
};
</script>

<template>
    <div class="map-viewer">
        <div class="map-top">
            <div class="map-title">{{ mapSummary }}</div>
            <div class="map-controls">
                <button class="map-toggle" :class="{ active: showCityName }" @click="mapStore.toggleCityName">
                    도시명 표기 {{ showCityName ? '끄기' : '켜기' }}
                </button>
            </div>
        </div>
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.mapData || !props.mapLayout" class="map-empty">
            지도 데이터를 불러오지 못했습니다.
        </div>
        <div v-else ref="mapBody" class="map-body">
            <div
                ref="mapArea"
                class="map-area"
                :class="[mapThemeClass, mapSeasonClass]"
                :style="{ width: mapWidth, height: mapHeight }"
            >
                <div class="map-layer map-bglayer1" :style="mapBackgroundStyle" />
                <div class="map-layer map-bglayer2" />
                <div v-if="mapRoadImage" class="map-layer map-bgroad" :style="mapRoadStyle" />
                <component
                    :is="detailMode ? MapCityDetail : MapCityBasic"
                    v-for="city in cityViews"
                    :key="city.id"
                    :city="city"
                    :map-scale="mapScale"
                    :show-name="showCityName"
                    v-bind="detailProps"
                    @hover="setHoveredCity"
                    @leave="setHoveredCity(null)"
                    @select="selectCity"
                />
                <div
                    v-if="hoveredCity"
                    class="map-tooltip"
                    :style="{ left: `${elementX + 16}px`, top: `${elementY + 16}px` }"
                >
                    <div class="tooltip-title">{{ hoveredCity.name }}</div>
                    <div class="tooltip-body">
                        {{ hoveredCity.nationName }} · {{ hoveredCity.regionName }} · {{ hoveredCity.levelName }}
                    </div>
                </div>
            </div>
            <div class="map-meta">
                <span>도시 {{ props.mapData.cityList.length }}</span>
                <span>세력 {{ props.mapData.nationList.length }}</span>
                <span>테마 {{ props.mapLayout.mapName }}</span>
            </div>
            <div class="map-footnote">
                좌표/도시명은 시나리오 맵 레이아웃을 기준으로 표시됩니다.
            </div>
        </div>
    </div>
</template>

<style scoped>
.map-viewer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0;
}

.map-top {
    display: flex;
    height: 20px;
    align-items: center;
    justify-content: center;
    background: #111;
    line-height: 20px;
}

.map-title {
    font-size: 0.95rem;
    font-weight: 600;
}

.map-controls {
    position: absolute;
    z-index: 4;
    right: 4px;
    bottom: 4px;
    display: flex;
}

.map-toggle {
    border: 1px solid #6c757d;
    border-radius: 2px;
    padding: 3px 7px;
    background: #345c85;
    color: #fff;
    font-size: 11px;
    line-height: 18px;
    cursor: pointer;
}

.map-toggle.active {
    background: rgba(201, 164, 90, 0.2);
}

.map-body {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-x: auto;
}

.map-area {
    position: relative;
    box-sizing: border-box;
    border: 0;
    background: #0b0b0b;
    overflow: hidden;
    max-width: 100%;
}

.map-layer {
    position: absolute;
    inset: 0;
    background-repeat: no-repeat;
    background-position: left top;
    pointer-events: none;
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
    flex-wrap: wrap;
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
