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
        class="map-city detail"
        :class="{ mine: props.city.isMyCity }"
        :style="{ left: `${props.city.x}px`, top: `${props.city.y}px` }"
        @mouseenter="emit('hover', props.city.id)"
        @mouseleave="emit('leave')"
    >
        <div class="city-card">
            <div class="header">
                <span class="dot" :style="{ backgroundColor: props.city.color }" />
                <span class="name">{{ props.city.name }}</span>
                <span v-if="props.city.isCapital" class="capital">수도</span>
            </div>
            <div class="meta">Lv {{ props.city.level }} · {{ props.city.nationName }}</div>
        </div>
    </div>
</template>

<style scoped>
.map-city.detail {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 0.65rem;
}

.city-card {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.8);
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.header {
    display: flex;
    align-items: center;
    gap: 4px;
}

.dot {
    width: 10px;
    height: 10px;
    border: 1px solid rgba(232, 221, 196, 0.6);
}

.name {
    font-weight: 600;
    color: rgba(232, 221, 196, 0.9);
}

.capital {
    font-size: 0.6rem;
    color: rgba(232, 221, 196, 0.7);
}

.meta {
    color: rgba(232, 221, 196, 0.6);
}

.map-city.detail.mine .city-card {
    box-shadow: 0 0 0 1px rgba(201, 164, 90, 0.7);
}
</style>
