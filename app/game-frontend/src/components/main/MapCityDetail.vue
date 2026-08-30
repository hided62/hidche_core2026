<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { buildAssetUrl, normalizeColorToken } from '../../utils/mapAssets';

interface MapCityView {
    id: number;
    name: string;
    level: number;
    levelName: string;
    state: number;
    stateClass: 'good' | 'bad' | 'war' | 'wrong';
    nationId: number;
    nationName: string;
    color: string;
    x: number;
    y: number;
    isCapital: boolean;
    isMyCity: boolean;
    supply: boolean;
    selected: boolean;
}

type DetailSize = {
    bgWidth: number;
    bgHeight: number;
    iconWidth: number;
    iconHeight: number;
    flagRight: number;
    flagTop: number;
};

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
const CR_GRID_TILE_SIZE = 40.5;

const props = defineProps<{
    city: MapCityView;
    showName: boolean;
    imageBaseUrl: string;
    themeName: string;
    mapScale: number;
    selectOnly?: boolean;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    (event: 'hover', cityId: number): void;
    (event: 'leave'): void;
    (event: 'touch', cityId: number, touchEvent: TouchEvent): void;
    (event: 'touchleave'): void;
    (event: 'select', cityId: number): void;
}>();

const colorToken = computed(() => normalizeColorToken(props.city.color));

const detailSize = computed(() => {
    const index = Math.min(Math.max(props.city.level, 1), DETAIL_SIZES.length) - 1;
    const base = DETAIL_SIZES[index];
    const scale = props.mapScale;
    return {
        bgWidth: base.bgWidth * scale,
        bgHeight: base.bgHeight * scale,
        iconWidth: base.iconWidth * scale,
        iconHeight: base.iconHeight * scale,
        flagRight: base.flagRight * scale,
        flagTop: base.flagTop * scale,
    };
});

const cityBackgroundSize = computed(() => {
    if (props.themeName === 'cr') {
        const tileSize = CR_GRID_TILE_SIZE * props.mapScale;
        return { bgWidth: tileSize, bgHeight: tileSize };
    }

    return detailSize.value;
});

const cityBaseStyle = computed(() => ({
    left: `${props.city.x}px`,
    top: `${props.city.y}px`,
    width: `${detailSize.value.iconWidth}px`,
    height: `${detailSize.value.iconHeight}px`,
}));

const cityBgStyle = computed(() => {
    if (!colorToken.value || props.city.nationId <= 0) {
        return null;
    }
    const style: Record<string, string> = {
        width: `${cityBackgroundSize.value.bgWidth}px`,
        height: `${cityBackgroundSize.value.bgHeight}px`,
    };

    if (props.themeName === 'cr') {
        style.backgroundColor = props.city.color;
        style.opacity = '0.5';
    } else {
        style.backgroundImage = `url('${buildAssetUrl(props.imageBaseUrl, `b${colorToken.value}.png`)}')`;
    }

    return style;
});

const castleIcon = computed(() => buildAssetUrl(props.imageBaseUrl, `cast_${props.city.level}.gif`));

const stateIcon = computed(() =>
    props.city.state > 0 ? buildAssetUrl(props.imageBaseUrl, `event${props.city.state}.gif`) : null
);

const flagIcon = computed(() => {
    if (props.city.nationId <= 0 || !colorToken.value) {
        return null;
    }
    const prefix = props.city.supply ? 'f' : 'd';
    return buildAssetUrl(props.imageBaseUrl, `${prefix}${colorToken.value}.gif`);
});

const capitalIcon = computed(() => buildAssetUrl(props.imageBaseUrl, 'event51.gif'));

const cityBgWrapperStyle = computed(() => ({
    left: '50%',
    top: '50%',
    marginLeft: `${-cityBackgroundSize.value.bgWidth / 2}px`,
    marginTop: `${-cityBackgroundSize.value.bgHeight / 2}px`,
}));

const cityIconStyle = computed(() => ({
    width: `${detailSize.value.iconWidth}px`,
    height: `${detailSize.value.iconHeight}px`,
}));

const cityFlagStyle = computed(() => ({
    right: `${detailSize.value.flagRight}px`,
    top: `${detailSize.value.flagTop}px`,
    width: `${12 * props.mapScale}px`,
    height: `${12 * props.mapScale}px`,
}));

const capitalIconStyle = computed(() => ({
    width: `${10 * props.mapScale}px`,
    height: `${10 * props.mapScale}px`,
}));

const selectCity = () => {
    if (!props.readonly) emit('select', props.city.id);
};

let touchOnTrack = false;

const touchstart = () => {
    touchOnTrack = true;
};

const touchmove = () => {
    touchOnTrack = false;
};

const touchend = (event: TouchEvent) => {
    if (touchOnTrack) {
        event.stopPropagation();
        emit('touch', props.city.id, event);
        return;
    }
    emit('touchleave');
};

const cityStateStyle = computed(() => ({
    width: `${12 * props.mapScale}px`,
    height: `${12 * props.mapScale}px`,
    top: `${6 * props.mapScale}px`,
}));
</script>

<template>
    <component
        :is="props.readonly ? 'div' : props.selectOnly ? 'button' : RouterLink"
        class="city-base"
        :type="!props.readonly && props.selectOnly ? 'button' : undefined"
        :to="
            props.selectOnly || props.readonly ? undefined : { name: 'current-city', query: { cityId: props.city.id } }
        "
        :aria-label="props.city.isMyCity ? `${props.city.name}, 현재 도시` : props.city.name"
        :class="[
            {
                mine: props.city.isMyCity,
                selected: props.city.selected,
                'supply-off': !props.city.supply,
                readonly: props.readonly,
            },
        ]"
        :style="cityBaseStyle"
        @mouseenter="emit('hover', props.city.id)"
        @mouseleave="emit('leave')"
        @touchstart="touchstart"
        @touchmove="touchmove"
        @touchend="touchend"
        @click.stop="selectCity"
    >
        <div v-if="cityBgStyle" class="city-bg" :style="[cityBgWrapperStyle, cityBgStyle]" />
        <div class="city-img" :style="cityIconStyle">
            <img class="city-icon" :src="castleIcon" :style="cityIconStyle" />
            <div class="city-filler" :class="{ 'my-city': props.city.isMyCity }" />
            <div v-if="flagIcon" class="city-flag" :style="cityFlagStyle">
                <img :src="flagIcon" />
                <div v-if="props.city.isCapital" class="city-capital" :style="capitalIconStyle">
                    <img :src="capitalIcon" />
                </div>
            </div>
            <span v-if="props.showName" class="city-name">{{ props.city.name }}</span>
        </div>
        <div v-if="stateIcon" class="city-state" :style="cityStateStyle">
            <img :src="stateIcon" />
        </div>
    </component>
</template>

<style scoped>
.city-base {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 0.65rem;
    color: #fff;
    cursor: pointer;
    text-decoration: none;
    padding: 0;
    border: 0;
    background: transparent;
}

.city-base.readonly {
    cursor: default;
}

.city-bg {
    position: absolute;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
    pointer-events: none;
}

.city-img {
    position: absolute;
    left: 50%;
    top: 50%;
    pointer-events: none;
    transform: translate(-50%, -50%);
}

.city-icon {
    display: block;
}

.city-filler {
    position: absolute;
    inset: -2px;
    box-sizing: border-box;
    pointer-events: none;
}

.city-filler.my-city {
    inset: -4px;
    border: 1px solid rgba(255, 255, 255, 0.95);
    border-radius: 2px;
    outline: 2px solid rgb(211, 47, 47);
    box-shadow: 0 0 6px 2px rgba(211, 47, 47, 0.72);
}

.city-base.selected .city-icon {
    box-shadow: 0 0 0 2px rgba(255, 235, 150, 0.9);
}

.city-base.supply-off {
    opacity: 0.6;
}

.city-flag {
    position: absolute;
}

.city-flag img,
.city-state img,
.city-capital img {
    width: 100%;
    height: 100%;
}

.city-capital {
    position: absolute;
    top: 0;
    right: -1px;
}

.city-name {
    position: absolute;
    left: 70%;
    bottom: -10px;
    background: rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    font-size: 0.6rem;
    color: rgba(232, 221, 196, 0.9);
}

.city-state {
    position: absolute;
    left: 0;
    pointer-events: none;
}
</style>
