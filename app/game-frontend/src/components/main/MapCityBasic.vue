<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
interface MapCityView {
    id: number;
    name: string;
    level: number;
    state: number;
    stateClass: 'good' | 'bad' | 'war' | 'wrong';
    nationName: string;
    color: string;
    x: number;
    y: number;
    isCapital: boolean;
    isMyCity: boolean;
    supply: boolean;
    selected: boolean;
}

const props = defineProps<{
    city: MapCityView;
    showName: boolean;
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

const size = computed(() => (6 + props.city.level * 2) * props.mapScale);
const stateSize = computed(() => 8 * props.mapScale);
const stateOffset = computed(() => -6 * props.mapScale);
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
</script>

<template>
    <component
        :is="props.readonly ? 'div' : props.selectOnly ? 'button' : RouterLink"
        class="map-city"
        :type="!props.readonly && props.selectOnly ? 'button' : undefined"
        :to="
            props.selectOnly || props.readonly ? undefined : { name: 'current-city', query: { cityId: props.city.id } }
        "
        :aria-label="props.city.isMyCity ? `${props.city.name}, 현재 도시` : props.city.name"
        :class="[
            `state-${props.city.stateClass}`,
            {
                mine: props.city.isMyCity,
                selected: props.city.selected,
                'supply-off': !props.city.supply,
                readonly: props.readonly,
            },
        ]"
        :style="{ left: `${props.city.x}px`, top: `${props.city.y}px` }"
        @mouseenter="emit('hover', props.city.id)"
        @mouseleave="emit('leave')"
        @touchstart="touchstart"
        @touchmove="touchmove"
        @touchend="touchend"
        @click.stop="selectCity"
    >
        <div class="city-dot" :style="{ backgroundColor: props.city.color, width: `${size}px`, height: `${size}px` }">
            <span v-if="props.city.isCapital" class="capital" />
        </div>
        <div
            v-if="props.city.state > 0"
            class="city-state"
            :class="`state-${props.city.stateClass}`"
            :style="{
                width: `${stateSize}px`,
                height: `${stateSize}px`,
                left: `${stateOffset}px`,
                top: `${stateOffset}px`,
            }"
        />
        <div v-if="props.showName" class="city-name">{{ props.city.name }}</div>
    </component>
</template>

<style scoped>
.map-city {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    transform: translate(-50%, -50%);
    font-size: 0.65rem;
    color: rgba(232, 221, 196, 0.8);
    cursor: pointer;
    text-decoration: none;
    padding: 0;
    border: 0;
    background: transparent;
}

.map-city.readonly {
    cursor: default;
}

.city-dot {
    position: relative;
    border: 1px solid rgba(232, 221, 196, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
}

.capital {
    width: 5px;
    height: 5px;
    background: rgba(232, 221, 196, 0.9);
}

.map-city.mine .city-dot::after {
    position: absolute;
    inset: -4px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.95);
    border-radius: 2px;
    outline: 2px solid rgb(211, 47, 47);
    box-shadow: 0 0 6px 2px rgba(211, 47, 47, 0.72);
    content: '';
    pointer-events: none;
}

.map-city.selected .city-dot {
    box-shadow: 0 0 0 2px rgba(255, 235, 150, 0.9);
}

.map-city.supply-off {
    opacity: 0.6;
}

.map-city.state-good .city-dot {
    border-color: rgba(120, 220, 120, 0.9);
}

.map-city.state-bad .city-dot {
    border-color: rgba(240, 190, 90, 0.9);
}

.map-city.state-war .city-dot {
    border-color: rgba(240, 90, 90, 0.9);
}

.map-city.state-wrong .city-dot {
    border-color: rgba(150, 150, 150, 0.8);
}

.city-state {
    position: absolute;
    background: rgba(232, 221, 196, 0.8);
}

.city-state.state-war {
    background: rgba(240, 90, 90, 0.9);
}

.city-state.state-bad {
    background: rgba(240, 190, 90, 0.9);
}

.city-state.state-good {
    background: rgba(90, 160, 255, 0.9);
}

.city-name {
    white-space: nowrap;
}
</style>
