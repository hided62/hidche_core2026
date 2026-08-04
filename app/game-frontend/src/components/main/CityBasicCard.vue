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
            <div class="title">
                {{ props.city.name }} (Lv {{ props.city.level }}) · 국가 {{ props.city.nationId || '무주' }}
            </div>
            <div class="grid">
                <span>인구</span><strong>{{ props.city.population.toLocaleString() }}</strong> <span>농업</span
                ><strong>{{ props.city.agriculture.toLocaleString() }}</strong> <span>상업</span
                ><strong>{{ props.city.commerce.toLocaleString() }}</strong> <span>치안</span
                ><strong>{{ props.city.security.toLocaleString() }}</strong> <span>수비</span
                ><strong>{{ props.city.defence.toLocaleString() }}</strong> <span>성벽</span
                ><strong>{{ props.city.wall.toLocaleString() }}</strong> <span>보급</span
                ><strong>{{ props.city.supplyState }}</strong> <span>전방</span
                ><strong>{{ props.city.frontState }}</strong>
            </div>
        </div>
    </div>
</template>

<style scoped>
.title {
    min-height: 24px;
    padding: 2px 6px;
    border-bottom: 1px solid #666;
    background: #173d27;
    text-align: center;
    font-weight: 600;
}

.grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    font-size: 12px;
}
.grid > * {
    min-height: 23px;
    box-sizing: border-box;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 2px 5px;
}
.grid > span {
    background: rgb(20 75 42 / 70%);
    text-align: center;
}
.grid > strong {
    text-align: right;
    font-weight: 400;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
