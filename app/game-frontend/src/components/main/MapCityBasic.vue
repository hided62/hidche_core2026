<script setup lang="ts">
import { computed } from 'vue';
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
}>();

const emit = defineEmits<{
    (event: 'hover', cityId: number): void;
    (event: 'leave'): void;
    (event: 'select', cityId: number): void;
}>();

const size = computed(() => (6 + props.city.level * 2) * props.mapScale);
const stateSize = computed(() => 8 * props.mapScale);
const stateOffset = computed(() => -6 * props.mapScale);
</script>

<template>
    <div
        class="map-city"
        :class="[
            `state-${props.city.stateClass}`,
            { mine: props.city.isMyCity, selected: props.city.selected, 'supply-off': !props.city.supply },
        ]"
        :style="{ left: `${props.city.x}px`, top: `${props.city.y}px` }"
        @mouseenter="emit('hover', props.city.id)"
        @mouseleave="emit('leave')"
        @click.stop="emit('select', props.city.id)"
    >
        <div
            class="city-dot"
            :style="{ backgroundColor: props.city.color, width: `${size}px`, height: `${size}px` }"
        >
            <span v-if="props.city.isCapital" class="capital" />
        </div>
        <div
            v-if="props.city.state > 0"
            class="city-state"
            :class="`state-${props.city.stateClass}`"
            :style="{ width: `${stateSize}px`, height: `${stateSize}px`, left: `${stateOffset}px`, top: `${stateOffset}px` }"
        />
        <div v-if="props.showName" class="city-name">{{ props.city.name }}</div>
    </div>
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
}

.city-dot {
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

.map-city.mine .city-dot {
    box-shadow: 0 0 0 2px rgba(201, 164, 90, 0.6);
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
