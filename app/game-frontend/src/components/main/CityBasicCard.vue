<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';

interface CityInfo {
    id: number;
    name: string;
    level: number;
    nationId: number;
    population: number;
    agriculture: number;
    commerce: number;
    security: number;
    defence: number;
    wall: number;
    supplyState: number;
    frontState: number;
}

const props = defineProps<{
    city: CityInfo | null;
    loading: boolean;
}>();
</script>

<template>
    <div class="city-card">
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.city" class="empty">도시 정보를 불러오지 못했습니다.</div>
        <div v-else class="city-body">
            <div class="title">{{ props.city.name }} (Lv {{ props.city.level }})</div>
            <div class="grid">
                <div>인구 {{ props.city.population }}</div>
                <div>농업 {{ props.city.agriculture }}</div>
                <div>상업 {{ props.city.commerce }}</div>
                <div>치안 {{ props.city.security }}</div>
                <div>방어 {{ props.city.defence }}</div>
                <div>성벽 {{ props.city.wall }}</div>
                <div>보급 {{ props.city.supplyState }}</div>
                <div>전방 {{ props.city.frontState }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.city-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.title {
    font-weight: 600;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 6px;
    font-size: 0.85rem;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
