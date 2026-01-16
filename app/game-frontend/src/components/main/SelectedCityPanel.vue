<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';

interface SelectedCityInfo {
    id: number;
    name: string;
    nationName: string;
    nationColor: string;
    regionName: string;
    levelName: string;
    state: number;
    supply: boolean;
    isCapital: boolean;
    isMyCity: boolean;
}

const props = defineProps<{
    city: SelectedCityInfo | null;
    loading: boolean;
}>();
</script>

<template>
    <div class="selected-city">
        <div v-if="props.loading">
            <SkeletonLines :lines="3" />
        </div>
        <div v-else-if="!props.city" class="empty">
            지도를 클릭하면 도시 정보가 표시됩니다.
        </div>
        <div v-else class="city-body">
            <div class="title">
                <span class="flag" :style="{ backgroundColor: props.city.nationColor }" />
                <span>{{ props.city.name }}</span>
                <span v-if="props.city.isCapital" class="tag">수도</span>
                <span v-if="props.city.isMyCity" class="tag">내 도시</span>
            </div>
            <div class="meta">
                <div>국가 {{ props.city.nationName }}</div>
                <div>지역 {{ props.city.regionName }}</div>
                <div>규모 {{ props.city.levelName }}</div>
                <div>상태 {{ props.city.state }}</div>
                <div>보급 {{ props.city.supply ? 'O' : 'X' }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.selected-city {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}

.flag {
    width: 12px;
    height: 12px;
    border: 1px solid rgba(232, 221, 196, 0.6);
}

.tag {
    font-size: 0.65rem;
    padding: 2px 4px;
    border: 1px solid rgba(201, 164, 90, 0.4);
}

.meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 4px;
    font-size: 0.75rem;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
