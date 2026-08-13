<script setup lang="ts">
import { computed, ref } from 'vue';
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
    regionMap: Record<number, string>;
    levelMap: Record<number, string>;
}

type DetailSize = {
    bgWidth: number;
    bgHeight: number;
    iconWidth: number;
    iconHeight: number;
    flagRight: number;
    flagTop: number;
};

interface CityPreview {
    id: number;
    name: string;
    level: number;
    levelName: string;
    regionName: string;
    state: number;
    nationId: number;
    nationName: string;
    color: string;
    colorToken: string | null;
    supply: boolean;
    isCapital: boolean;
    x: number;
    y: number;
    detailSize: DetailSize;
}

const props = withDefaults(
    defineProps<{
        mapData: MapSummary;
        mapLayout: MapLayout;
        mode?: 'basic' | 'detail';
    }>(),
    {
        mode: 'detail',
    }
);

const BASE_MAP_WIDTH = 700;
const BASE_MAP_HEIGHT = 500;
const CITY_BASE_WIDTH = 40;
const CITY_BASE_HEIGHT = 30;
const TOOLTIP_MIN_WIDTH = 120;
const TOOLTIP_CURSOR_OFFSET = 10;
const DETAIL_SIZES: DetailSize[] = [
    { bgWidth: 48, bgHeight: 45, iconWidth: 16, iconHeight: 15, flagRight: -8, flagTop: -4 },
    { bgWidth: 60, bgHeight: 42, iconWidth: 20, iconHeight: 14, flagRight: -8, flagTop: -4 },
    { bgWidth: 42, bgHeight: 42, iconWidth: 14, iconHeight: 14, flagRight: -8, flagTop: -4 },
    { bgWidth: 60, bgHeight: 45, iconWidth: 20, iconHeight: 15, flagRight: -6, flagTop: -3 },
    { bgWidth: 72, bgHeight: 48, iconWidth: 24, iconHeight: 16, flagRight: -6, flagTop: -4 },
    { bgWidth: 78, bgHeight: 54, iconWidth: 26, iconHeight: 18, flagRight: -6, flagTop: -4 },
    { bgWidth: 84, bgHeight: 60, iconWidth: 28, iconHeight: 20, flagRight: -6, flagTop: -4 },
    { bgWidth: 96, bgHeight: 72, iconWidth: 32, iconHeight: 24, flagRight: -6, flagTop: -3 },
];
const BASIC_SIZES: ReadonlyArray<readonly [number, number]> = [
    [12, 12],
    [12, 12],
    [14, 14],
    [16, 14],
    [18, 16],
    [20, 16],
    [22, 18],
    [24, 18],
];

const assetBase = computed(configuredGameAssetUrl);
const assetUrl = (path: string): string => `${assetBase.value}/${path.replace(/^\/+/, '')}`;
const normalizeColorToken = (color: string): string | null => {
    const token = color.trim().replace(/^#/, '').toUpperCase();
    return token || null;
};
const clampedLevelIndex = (level: number): number => Math.min(Math.max(level, 1), DETAIL_SIZES.length) - 1;
const percentOf = (value: number, total: number): string => `${(value / total) * 100}%`;

const season = computed(() => {
    if (props.mapData.month <= 3) return 'spring';
    if (props.mapData.month <= 6) return 'summer';
    if (props.mapData.month <= 9) return 'fall';
    return 'winter';
});
const mapBackground = computed(() => {
    const theme = props.mapLayout.mapName;
    if (theme === 'ludo_rathowm') return assetUrl('map/ludo_rathowm/back.jpg');
    if (theme === 'chess') return assetUrl('map/chess/chessboard.png');
    if (theme === 'pokemon_v1') return assetUrl('map/pokemon_v1/back_pal8.png');
    if (theme === 'cr') return assetUrl('map/cr/bg-fs8.png');
    return assetUrl(`map/che/bg_${season.value}.jpg`);
});
const mapRoad = computed(() => {
    const theme = props.mapLayout.mapName;
    if (theme === 'che') return assetUrl('map/che/che_road.png');
    if (theme === 'miniche' || theme === 'miniche_b' || theme === 'miniche_clean') {
        return assetUrl('map/che/miniche_road.png');
    }
    if (theme === 'ludo_rathowm') return assetUrl('map/ludo_rathowm/road.png');
    return null;
});

const nationById = computed(() => {
    const map = new Map<number, { name: string; color: string; capitalCityId: number }>();
    for (const [id, name, color, capitalCityId] of props.mapData.nationList) {
        map.set(id, { name, color, capitalCityId });
    }
    return map;
});

const dynamicCityById = computed(() => {
    const map = new Map<number, [number, number, number, number, number]>();
    for (const [id, level, state, nationId, region, supplyFlag] of props.mapData.cityList) {
        map.set(id, [level, state, nationId, region, supplyFlag]);
    }
    return map;
});

const cities = computed<CityPreview[]>(() =>
    props.mapLayout.cityList.map((layoutCity) => {
        const dynamic = dynamicCityById.value.get(layoutCity.id);
        const [level = layoutCity.level, state = 0, nationId = 0, region = layoutCity.region, supplyFlag = 0] =
            dynamic ?? [];
        const nation = nationById.value.get(nationId);
        const color = nation?.color ?? '#ffffff';
        return {
            id: layoutCity.id,
            name: layoutCity.name,
            level,
            levelName: props.mapLayout.levelMap[level] ?? '-',
            regionName: props.mapLayout.regionMap[region] ?? '-',
            state,
            nationId,
            nationName: nation?.name ?? '',
            color,
            colorToken: normalizeColorToken(color),
            supply: supplyFlag > 0,
            isCapital: nation?.capitalCityId === layoutCity.id,
            x: layoutCity.x,
            y: layoutCity.y,
            detailSize: DETAIL_SIZES[clampedLevelIndex(level)]!,
        };
    })
);

const mapBody = ref<HTMLElement | null>(null);
const tooltipElement = ref<HTMLElement | null>(null);
const hoveredCityId = ref<number | null>(null);
const pointerPosition = ref({ x: 0, y: 0 });
const hoveredCity = computed(() => cities.value.find((city) => city.id === hoveredCityId.value) ?? null);
const hoveredCityTitle = computed(() => {
    const city = hoveredCity.value;
    return city ? `【${city.regionName}|${city.levelName}】${city.name}` : '';
});
const tooltipPosition = computed(() => {
    const mapWidth = mapBody.value?.clientWidth ?? BASE_MAP_WIDTH;
    const tooltipWidth = tooltipElement.value?.offsetWidth ?? TOOLTIP_MIN_WIDTH;
    const { x, y } = pointerPosition.value;
    const left = x + tooltipWidth + TOOLTIP_CURSOR_OFFSET > mapWidth ? x - tooltipWidth - 5 : x + TOOLTIP_CURSOR_OFFSET;
    return {
        left: `${Math.max(0, left)}px`,
        top: `${y + 30}px`,
    };
});

const updatePointerPosition = (event: PointerEvent): void => {
    const rect = mapBody.value?.getBoundingClientRect();
    if (!rect) return;
    pointerPosition.value = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
};

const showCityTooltip = (cityId: number, event: PointerEvent): void => {
    hoveredCityId.value = cityId;
    updatePointerPosition(event);
};

const hideCityTooltip = (): void => {
    hoveredCityId.value = null;
};

const cityBaseStyle = (city: CityPreview) => ({
    left: percentOf(city.x, BASE_MAP_WIDTH),
    top: percentOf(city.y, BASE_MAP_HEIGHT),
    width: percentOf(CITY_BASE_WIDTH, BASE_MAP_WIDTH),
    height: percentOf(CITY_BASE_HEIGHT, BASE_MAP_HEIGHT),
});
const cityBackgroundStyle = (city: CityPreview) => ({
    width: percentOf(city.detailSize.bgWidth, CITY_BASE_WIDTH),
    height: percentOf(city.detailSize.bgHeight, CITY_BASE_HEIGHT),
    backgroundColor: props.mapLayout.mapName === 'cr' ? city.color : undefined,
    backgroundImage:
        props.mapLayout.mapName !== 'cr' && city.colorToken
            ? `url('${assetUrl(`b${city.colorToken}.png`)}')`
            : undefined,
});
const cityImageStyle = (city: CityPreview) => ({
    width: percentOf(city.detailSize.iconWidth, CITY_BASE_WIDTH),
    height: percentOf(city.detailSize.iconHeight, CITY_BASE_HEIGHT),
});
const flagStyle = (city: CityPreview) => ({
    width: percentOf(12, city.detailSize.iconWidth),
    height: percentOf(12, city.detailSize.iconHeight),
    right: percentOf(city.detailSize.flagRight, city.detailSize.iconWidth),
    top: percentOf(city.detailSize.flagTop, city.detailSize.iconHeight),
});
const cityNameStyle = (city: CityPreview) => ({
    bottom: percentOf(-10, city.detailSize.iconHeight),
});
const basicCityStyle = (city: CityPreview) => {
    const [width, height] = BASIC_SIZES[clampedLevelIndex(city.level)]!;
    return {
        width: percentOf(width, CITY_BASE_WIDTH),
        height: percentOf(height, CITY_BASE_HEIGHT),
        backgroundColor: city.color,
    };
};
const basicCitySize = (city: CityPreview): readonly [number, number] => BASIC_SIZES[clampedLevelIndex(city.level)]!;
const basicCapitalStyle = (city: CityPreview) => {
    const [width, height] = basicCitySize(city);
    return {
        width: percentOf(5, width),
        height: percentOf(5, height),
        top: percentOf(-2, height),
        right: percentOf(-2, width),
    };
};
const basicStateStyle = (city: CityPreview) => {
    const [width, height] = basicCitySize(city);
    return {
        width: percentOf(10, width),
        height: percentOf(10, height),
        top: percentOf(-2, height),
        left: percentOf(-4, width),
    };
};
const basicCityNameStyle = (city: CityPreview) => {
    const [, height] = basicCitySize(city);
    return {
        bottom: percentOf(-10, height),
    };
};
const stateClass = (state: number): string => {
    if (state < 10) return 'state-good';
    if (state < 40) return 'state-bad';
    if (state < 50) return 'state-war';
    return 'state-wrong';
};
</script>

<template>
    <div class="map-preview" :class="`map-preview-${props.mode}`">
        <div class="map-preview-header">
            <span class="map-preview-title">{{ props.mapLayout.mapName }}</span>
            <span class="map-preview-date">{{ props.mapData.year }}년 {{ props.mapData.month }}월</span>
        </div>
        <div ref="mapBody" class="map-preview-body" :style="{ backgroundImage: `url('${mapBackground}')` }">
            <div
                v-if="mapRoad"
                class="map-preview-road"
                data-testid="map-preview-road"
                :style="{ backgroundImage: `url('${mapRoad}')` }"
            />
            <div
                v-for="city in cities"
                :key="city.id"
                class="city-base"
                :class="[`city-level-${city.level}`, { capital: city.isCapital }]"
                :style="cityBaseStyle(city)"
                data-testid="map-preview-city"
                @pointerenter="showCityTooltip(city.id, $event)"
                @pointermove="updatePointerPosition"
                @pointerleave="hideCityTooltip"
            >
                <template v-if="props.mode === 'detail'">
                    <div
                        v-if="city.nationId > 0"
                        class="city-bg"
                        :class="{ 'city-bg-cr': props.mapLayout.mapName === 'cr' }"
                        :style="cityBackgroundStyle(city)"
                        data-testid="map-preview-city-background"
                    />
                    <div class="city-image" :style="cityImageStyle(city)">
                        <img
                            class="castle-image"
                            :src="assetUrl(`cast_${city.level}.gif`)"
                            alt=""
                            data-testid="map-preview-castle"
                        />
                        <div v-if="city.nationId > 0 && city.colorToken" class="city-flag" :style="flagStyle(city)">
                            <img :src="assetUrl(`${city.supply ? 'f' : 'd'}${city.colorToken}.gif`)" alt="" />
                            <img v-if="city.isCapital" class="capital-image" :src="assetUrl('event51.gif')" alt="" />
                        </div>
                        <span class="city-name" :style="cityNameStyle(city)">{{ city.name }}</span>
                    </div>
                    <img
                        v-if="city.state > 0"
                        class="city-state-image"
                        :src="assetUrl(`event${city.state}.gif`)"
                        alt=""
                    />
                </template>
                <div v-else class="basic-city" :style="basicCityStyle(city)">
                    <span v-if="city.isCapital" class="basic-capital" :style="basicCapitalStyle(city)" />
                    <span
                        v-if="city.state > 0"
                        class="basic-state"
                        :class="stateClass(city.state)"
                        :style="basicStateStyle(city)"
                    />
                    <span class="city-name" :style="basicCityNameStyle(city)">{{ city.name }}</span>
                </div>
            </div>
            <div
                v-if="hoveredCity"
                ref="tooltipElement"
                class="map-preview-tooltip"
                :style="tooltipPosition"
                role="tooltip"
                data-testid="map-preview-city-tooltip"
            >
                <div class="tooltip-city-name">{{ hoveredCityTitle }}</div>
                <div class="tooltip-nation-name">{{ hoveredCity.nationName }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.map-preview {
    display: flex;
    width: min(100%, 700px);
    margin-inline: auto;
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
    background-color: #080808;
    background-position: center;
    background-size: 100% 100%;
}

.map-preview-road {
    position: absolute;
    z-index: 1;
    inset: 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
}

.map-preview-tooltip {
    position: absolute;
    z-index: 16;
    min-width: 120px;
    border: 1px solid gray;
    background: rgb(30, 164, 255);
    color: #fff;
    font-size: 14px;
    line-height: 15px;
    pointer-events: none;
    white-space: nowrap;
}

.tooltip-city-name,
.tooltip-nation-name {
    height: 15px;
}

.tooltip-nation-name {
    border-top: 1px solid gray;
    text-align: right;
}

.city-base {
    position: absolute;
    z-index: 2;
    transform: translate(-50%, -50%);
}

.city-bg,
.city-image,
.basic-city {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
}

.city-bg {
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
}

.city-bg-cr {
    opacity: 0.5;
}

.castle-image,
.city-flag > img:first-child,
.capital-image,
.city-state-image {
    display: block;
    width: 100%;
    height: 100%;
}

.city-flag {
    position: absolute;
}

.capital-image {
    position: absolute;
    top: 0;
    right: -8.333%;
    width: 83.333%;
    height: 83.333%;
}

.city-state-image {
    position: absolute;
    left: 0;
    top: 16.667%;
    width: 37.5%;
    height: 50%;
}

.city-name {
    position: absolute;
    left: 70%;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: clamp(6px, 1.43vw, 10px);
    line-height: 1;
    white-space: nowrap;
}

.basic-city {
    min-width: 1px;
    min-height: 1px;
}

.basic-capital,
.basic-state {
    position: absolute;
    display: block;
}

.basic-capital {
    background: yellow;
}

.basic-state {
    background: #fff;
}

.basic-state.state-good {
    background: blue;
}

.basic-state.state-bad {
    background: orange;
}

.basic-state.state-war {
    background: red;
}
</style>
