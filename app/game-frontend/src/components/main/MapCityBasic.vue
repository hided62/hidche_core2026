<script setup lang="ts">
interface MapCityView {
    id: number;
    name: string;
    level: number;
    state: number;
    nationId: number;
    nationName: string;
    color: string;
    x: number;
    y: number;
    isCapital: boolean;
    isMyCity: boolean;
}

const props = defineProps<{
    city: MapCityView;
    showName: boolean;
}>();

const emit = defineEmits<{
    (event: 'hover', cityId: number): void;
    (event: 'leave'): void;
}>();
</script>

<template>
    <div
        class="map-city"
        :class="{ mine: props.city.isMyCity }"
        :style="{ left: `${props.city.x}px`, top: `${props.city.y}px` }"
        @mouseenter="emit('hover', props.city.id)"
        @mouseleave="emit('leave')"
    >
        <div class="city-dot" :style="{ backgroundColor: props.city.color }">
            <span v-if="props.city.isCapital" class="capital" />
        </div>
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
    width: 12px;
    height: 12px;
    border: 1px solid rgba(232, 221, 196, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
}

.capital {
    width: 6px;
    height: 6px;
    background: rgba(232, 221, 196, 0.9);
}

.map-city.mine .city-dot {
    box-shadow: 0 0 0 2px rgba(201, 164, 90, 0.6);
}

.city-name {
    white-space: nowrap;
}
</style>
