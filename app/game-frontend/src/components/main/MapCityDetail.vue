<script setup lang="ts">
import { computed } from 'vue';
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

const props = defineProps<{
    city: MapCityView;
    showName: boolean;
    imageBaseUrl: string;
    themeName: string;
    mapScale: number;
}>();

const emit = defineEmits<{
    (event: 'hover', cityId: number): void;
    (event: 'leave'): void;
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

const baseSize = computed(() => ({
    width: 40 * props.mapScale,
    height: 30 * props.mapScale,
}));

const cityBaseStyle = computed(() => ({
    left: `${props.city.x}px`,
    top: `${props.city.y}px`,
    width: `${baseSize.value.width}px`,
    height: `${baseSize.value.height}px`,
}));

const cityBgStyle = computed(() => {
    if (!colorToken.value || props.city.nationId <= 0) {
        return null;
    }
    const style: Record<string, string> = {
        width: `${detailSize.value.bgWidth}px`,
        height: `${detailSize.value.bgHeight}px`,
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
    marginLeft: `${-detailSize.value.bgWidth / 2}px`,
    marginTop: `${-detailSize.value.bgHeight / 2}px`,
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

const cityStateStyle = computed(() => ({
    width: `${12 * props.mapScale}px`,
    height: `${12 * props.mapScale}px`,
    top: `${6 * props.mapScale}px`,
}));
</script>

<template>
    <div
        class="city-base"
        :class="[{ mine: props.city.isMyCity, selected: props.city.selected, 'supply-off': !props.city.supply }]"
        :style="cityBaseStyle"
        @mouseenter="emit('hover', props.city.id)"
        @mouseleave="emit('leave')"
        @click.stop="emit('select', props.city.id)"
    >
        <div v-if="cityBgStyle" class="city-bg" :style="[cityBgWrapperStyle, cityBgStyle]" />
        <div class="city-img">
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
    </div>
</template>

<style scoped>
.city-base {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 0.65rem;
    color: rgba(232, 221, 196, 0.9);
}

.city-bg {
    position: absolute;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
}

.city-img {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
}

.city-icon {
    display: block;
}

.city-filler {
    position: absolute;
    inset: -2px;
    pointer-events: none;
}

.city-base.mine .city-icon {
    box-shadow: 0 0 0 1px rgba(201, 164, 90, 0.7);
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
}
</style>
