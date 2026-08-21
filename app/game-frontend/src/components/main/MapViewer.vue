<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { storeToRefs } from 'pinia';
import { onClickOutside, useElementSize, useMediaQuery, useMouseInElement } from '@vueuse/core';
import SkeletonLines from '../ui/SkeletonLines.vue';
import MapCityBasic from './MapCityBasic.vue';
import MapCityDetail from './MapCityDetail.vue';
import { useMapViewerStore } from '../../stores/mapViewer';
import { buildAssetUrl } from '../../utils/mapAssets';
import { configuredGameAssetUrl } from '../../utils/imageAssets';

interface MapSummary {
    year: number;
    month: number;
    startYear: number;
    techLevelLimit?: {
        maxLevel: number;
        initialLevel: number;
        increaseYears: number;
    };
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

const props = withDefaults(
    defineProps<{
        mapData: MapSummary | null;
        mapLayout: MapLayout | null;
        loading: boolean;
        selectedCityId?: number | null;
        detailMode?: boolean;
        fitContainer?: boolean;
        showCurrentCityMarker?: boolean;
        showSelectionBorder?: boolean;
        readonly?: boolean;
    }>(),
    {
        // Vue casts an absent Boolean prop to false unless undefined is an explicit default.
        detailMode: undefined,
        selectedCityId: undefined,
        showSelectionBorder: true,
    }
);

const emit = defineEmits<{
    (event: 'select-city', cityId: number): void;
}>();

const BASE_MAP_WIDTH = 700;
const BASE_MAP_HEIGHT = 500;
const SMALL_MAP_SCALE = 5 / 7;

const isWide = useMediaQuery('(min-width: 1024px)');
const mapStore = useMapViewerStore();
const {
    showCityName,
    detailMode: storeDetailMode,
    singleTapNavigation,
    hoveredCityId,
    selectedCityId: storeSelectedCityId,
} = storeToRefs(mapStore);
const hasTouchInput = useMediaQuery('(any-pointer: coarse)');

const mapArea = ref<HTMLElement | null>(null);
const mapBody = ref<HTMLElement | null>(null);
const mapControls = ref<HTMLElement | null>(null);
const mapOptionsOpen = ref(false);
const mapOptionsMenuId = `map-options-${useId()}`;
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

const assetBaseUrl = computed(configuredGameAssetUrl);
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
    if (isWide.value && !props.fitContainer) {
        return 1;
    }
    if (mapBodyWidth.value <= 0) {
        return SMALL_MAP_SCALE;
    }
    return Math.min(props.fitContainer ? 1 : SMALL_MAP_SCALE, mapBodyWidth.value / BASE_MAP_WIDTH);
});

const effectiveDetailMode = computed(() => props.detailMode ?? storeDetailMode.value);
const effectiveSelectedCityId = computed(() =>
    props.selectedCityId === undefined ? storeSelectedCityId.value : props.selectedCityId
);
const isSelectionMap = computed(() => props.selectedCityId !== undefined);

const mapWidth = computed(() => `${BASE_MAP_WIDTH * mapScale.value}px`);

const mapHeight = computed(() => `${BASE_MAP_HEIGHT * mapScale.value}px`);

const cityViews = computed<CityView[]>(() => {
    if (!props.mapData || !props.mapLayout) {
        return [];
    }

    const scale = mapScale.value;

    return props.mapLayout.cityList.map((layoutCity) => {
        const dynamic = dynamicCityById.value.get(layoutCity.id);
        const [level = layoutCity.level, state = 0, nationId = 0, region = layoutCity.region, supplyFlag = 0] =
            dynamic ?? [];
        const nation = nationById.value.get(nationId);
        const x = layoutCity.x * scale;
        const y = layoutCity.y * scale;

        return {
            id: layoutCity.id,
            name: layoutCity.name,
            level,
            levelName: props.mapLayout?.levelMap?.[level] ?? '-',
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
            selected: props.showSelectionBorder && effectiveSelectedCityId.value === layoutCity.id,
        };
    });
});

const currentCityMarker = computed(() =>
    props.showCurrentCityMarker ? (cityViews.value.find((city) => city.isMyCity) ?? null) : null
);

const currentCityMarkerStyle = computed(() => {
    const city = currentCityMarker.value;
    if (!city) return undefined;
    const verticalOffset = (effectiveDetailMode.value ? 22 : 14) * mapScale.value;
    return {
        left: `${city.x}px`,
        top: `${city.y - verticalOffset}px`,
    };
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
    return `${props.mapData.year}年 ${props.mapData.month}月`;
});

const titleColor = computed(() => {
    if (!props.mapData) {
        return undefined;
    }
    const { startYear, year } = props.mapData;
    if (year < startYear + 1) {
        return 'magenta';
    }
    if (year < startYear + 2) {
        return 'orange';
    }
    if (year < startYear + 3) {
        return 'yellow';
    }
    return undefined;
});

const titleTooltipLines = computed(() => {
    if (!props.mapData) {
        return [];
    }

    const { startYear, year, month } = props.mapData;
    const lines: string[] = [];
    if (year <= startYear + 3) {
        // Ref uses joinYearMonth(startYear + 3, 0) as the limit boundary.
        const remainingMonths = (startYear + 3) * 12 - 1 - (year * 12 + month - 1);
        const remainYear = Math.trunc(remainingMonths / 12);
        const remainMonth = (remainingMonths % 12) + 1;
        lines.push(
            `초반제한 기간 : ${remainYear}년${remainMonth > 0 ? ` ${remainMonth}개월` : ''} (${startYear + 3}년)`
        );
    }

    const limit = props.mapData.techLevelLimit ?? {
        maxLevel: 12,
        initialLevel: 1,
        increaseYears: 5,
    };
    const currentLevel = Math.min(
        limit.maxLevel,
        Math.max(1, Math.floor((year - startYear) / limit.increaseYears) + limit.initialLevel)
    );
    if (currentLevel === limit.maxLevel) {
        lines.push(`기술등급 제한 : ${currentLevel}등급 (최종)`);
    } else {
        lines.push(`기술등급 제한 : ${currentLevel}등급 (${currentLevel * limit.increaseYears + startYear}년 해제)`);
    }
    return lines;
});

const titleBandStyle = computed(() =>
    effectiveDetailMode.value
        ? {
              backgroundImage: `url('${resolveAsset('ltitle.jpg')}'), url('${resolveAsset('rtitle.jpg')}')`,
          }
        : {}
);

const titleTextStyle = computed(() =>
    effectiveDetailMode.value
        ? {
              color: titleColor.value,
              backgroundImage: `url('${resolveAsset('ad.gif')}'), url('${resolveAsset(`${mapSeason.value}.gif`)}')`,
          }
        : { color: titleColor.value }
);

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
    effectiveDetailMode.value
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

const hoveredCityTitle = computed(() => {
    if (!hoveredCity.value) {
        return '';
    }
    return `【${hoveredCity.value.regionName}|${hoveredCity.value.levelName}】${hoveredCity.value.name}`;
});

const tooltipPosition = computed(() => {
    const width = 120;
    const offset = 10;
    const mapPixelWidth = BASE_MAP_WIDTH * mapScale.value;
    const left = elementX.value + width + offset > mapPixelWidth ? elementX.value - width - 5 : elementX.value + offset;
    return {
        left: `${Math.max(0, left)}px`,
        top: `${elementY.value + 30}px`,
    };
});

const setHoveredCity = (cityId: number | null) => {
    mapStore.setHoveredCity(cityId);
};

const touchPreviewCityId = ref<number | null>(null);

const clearTouchPreview = () => {
    touchPreviewCityId.value = null;
    setHoveredCity(null);
};

const closeMapOptions = () => {
    mapOptionsOpen.value = false;
};

const toggleMapOptions = () => {
    mapOptionsOpen.value = !mapOptionsOpen.value;
};

onClickOutside(mapControls, closeMapOptions);

const touchCity = (cityId: number, event: TouchEvent) => {
    if (touchPreviewCityId.value !== cityId) {
        touchPreviewCityId.value = cityId;
        setHoveredCity(cityId);
        if (!isSelectionMap.value && !singleTapNavigation.value) {
            event.preventDefault();
        }
    }
};

const toggleSingleTapNavigation = () => {
    clearTouchPreview();
    mapStore.toggleSingleTapNavigation();
};

const selectCity = (cityId: number) => {
    if (props.readonly) return;
    emit('select-city', cityId);
    if (props.selectedCityId === undefined) {
        mapStore.setSelectedCity(cityId);
    }
};
</script>

<template>
    <div class="map-viewer">
        <div class="map-top" :style="titleBandStyle">
            <div class="map-title" tabindex="0" :style="titleTextStyle">
                {{ mapSummary }}
                <div class="map-title-tooltip" role="tooltip">
                    <div v-for="line in titleTooltipLines" :key="line">{{ line }}</div>
                </div>
            </div>
        </div>
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.mapData || !props.mapLayout" class="map-empty">지도 데이터를 불러오지 못했습니다.</div>
        <div v-else ref="mapBody" class="map-body">
            <div
                ref="mapArea"
                class="map-area"
                :class="[mapThemeClass, mapSeasonClass]"
                :style="{ width: mapWidth, height: mapHeight }"
                @click="
                    clearTouchPreview();
                    closeMapOptions();
                "
            >
                <div class="map-layer map-bglayer1" :style="mapBackgroundStyle" />
                <div class="map-layer map-bglayer2" />
                <div v-if="mapRoadImage" class="map-layer map-bgroad" :style="mapRoadStyle" />
                <component
                    :is="effectiveDetailMode ? MapCityDetail : MapCityBasic"
                    v-for="city in cityViews"
                    :key="city.id"
                    :city="city"
                    :map-scale="mapScale"
                    :show-name="showCityName"
                    :select-only="isSelectionMap"
                    :readonly="props.readonly"
                    v-bind="detailProps"
                    @hover="setHoveredCity"
                    @leave="setHoveredCity(null)"
                    @touch="touchCity"
                    @touchleave="clearTouchPreview"
                    @select="selectCity"
                />
                <div
                    v-if="currentCityMarker"
                    class="current-city-marker"
                    :style="currentCityMarkerStyle"
                    data-testid="current-city-marker"
                    role="note"
                    :aria-label="`현재 도시 ${currentCityMarker.name}`"
                >
                    현재
                </div>
                <div v-if="hoveredCity" class="map-tooltip" :style="tooltipPosition">
                    <div class="tooltip-title">{{ hoveredCityTitle }}</div>
                    <div class="tooltip-body">{{ hoveredCity.nationId > 0 ? hoveredCity.nationName : '' }}</div>
                </div>
                <div ref="mapControls" class="map-controls" @keydown.esc.stop="closeMapOptions">
                    <div
                        v-show="mapOptionsOpen"
                        :id="mapOptionsMenuId"
                        class="map-options-menu"
                        role="group"
                        aria-label="지도 옵션 메뉴"
                        @click.stop
                    >
                        <button
                            class="map-toggle"
                            :class="{ active: showCityName }"
                            :aria-pressed="showCityName"
                            @click="mapStore.toggleCityName"
                        >
                            도시명 표기 {{ showCityName ? '끄기' : '켜기' }}
                        </button>
                        <button
                            v-if="hasTouchInput && !isSelectionMap && !props.readonly"
                            class="map-toggle map-toggle-single-tap"
                            :class="{ active: singleTapNavigation }"
                            :aria-pressed="singleTapNavigation"
                            @click="toggleSingleTapNavigation"
                        >
                            두번 탭 해 도시 이동 {{ singleTapNavigation ? '켜기' : '끄기' }}
                        </button>
                    </div>
                    <button
                        type="button"
                        class="map-options-trigger"
                        aria-label="지도 옵션"
                        title="지도 옵션"
                        :aria-controls="mapOptionsMenuId"
                        :aria-expanded="mapOptionsOpen"
                        @click.stop="toggleMapOptions"
                    >
                        <span aria-hidden="true">⚙</span>
                    </button>
                </div>
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
    position: relative;
    display: flex;
    height: 20px;
    align-items: center;
    justify-content: center;
    background: #111;
    background-position:
        left top,
        right top;
    background-repeat: no-repeat;
    line-height: 20px;
}

.map-title {
    position: relative;
    display: block;
    width: 160px;
    height: 20px;
    margin: auto;
    background-position:
        left top,
        right top;
    background-repeat: no-repeat;
    font-size: 14px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
}

.map-title-tooltip {
    position: absolute;
    z-index: 20;
    bottom: calc(100% + 7px);
    left: 50%;
    display: none;
    box-sizing: border-box;
    width: 220px;
    border-radius: 4px;
    padding: 5px 8px;
    background: #000;
    color: #fff;
    font-size: 12px;
    font-weight: 400;
    line-height: 18px;
    text-align: left;
    transform: translateX(-50%);
    white-space: nowrap;
}

.map-title-tooltip::after {
    position: absolute;
    top: 100%;
    left: 50%;
    border: 5px solid transparent;
    border-top-color: #000;
    content: '';
    transform: translateX(-50%);
}

.map-title:hover .map-title-tooltip,
.map-title:focus .map-title-tooltip,
.map-title:focus-within .map-title-tooltip {
    display: block;
}

.map-controls {
    position: absolute;
    z-index: 4;
    inset: 4px;
    pointer-events: none;
}

.map-options-trigger {
    position: absolute;
    right: 0;
    bottom: 0;
    display: grid;
    box-sizing: border-box;
    width: 30px;
    height: 28px;
    place-items: center;
    border: 1px solid #6c757d;
    border-radius: 2px;
    padding: 0;
    background: #345c85;
    color: #fff;
    cursor: pointer;
    font-size: 17px;
    line-height: 1;
    pointer-events: auto;
}

.map-options-trigger:hover,
.map-options-trigger:focus-visible,
.map-options-trigger[aria-expanded='true'] {
    border-color: #b7cadc;
    background: #284969;
}

.map-options-trigger:active {
    background: #1f3a54;
}

.map-options-trigger:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
}

.map-options-menu {
    position: absolute;
    right: 0;
    bottom: 32px;
    display: flex;
    max-width: 100%;
    max-height: calc(100% - 32px);
    flex-direction: column;
    align-items: stretch;
    overflow-y: auto;
    border: 1px solid #6c757d;
    border-radius: 2px;
    padding: 3px;
    background: rgba(11, 11, 11, 0.94);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
    pointer-events: auto;
}

.map-toggle {
    box-sizing: border-box;
    width: max-content;
    max-width: 100%;
    border: 1px solid #6c757d;
    border-radius: 2px;
    padding: 3px 7px;
    background: #345c85;
    color: #fff;
    font-size: 11px;
    line-height: 18px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
}

.map-toggle + .map-toggle {
    margin-top: 3px;
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
    z-index: 16;
    box-sizing: border-box;
    min-width: 120px;
    pointer-events: none;
    border: 1px solid gray;
    padding: 0;
    background: rgb(30, 164, 255);
    color: #fff;
    font-size: 14px;
    line-height: 15px;
    white-space: nowrap;
}

.current-city-marker {
    position: absolute;
    z-index: 12;
    box-sizing: border-box;
    min-width: 30px;
    border: 1px solid #82cfff;
    border-radius: 2px;
    padding: 1px 4px;
    background: rgba(5, 27, 43, 0.92);
    color: #d9f3ff;
    font-size: 10px;
    font-weight: 700;
    line-height: 14px;
    pointer-events: none;
    text-align: center;
    text-shadow: 0 1px #000;
    transform: translate(-50%, -100%);
    white-space: nowrap;
}

.current-city-marker::after {
    position: absolute;
    top: 100%;
    left: 50%;
    width: 0;
    height: 0;
    border: 4px solid transparent;
    border-top-color: #82cfff;
    content: '';
    transform: translateX(-50%);
}

.tooltip-title {
    height: 15px;
}

.tooltip-body {
    height: 15px;
    border-top: 1px solid gray;
    color: #fff;
    text-align: right;
}

.map-empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
