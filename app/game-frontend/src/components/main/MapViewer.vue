<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';

interface MapSummary {
    year: number;
    month: number;
    cityList: unknown[];
    nationList: unknown[];
}

const props = defineProps<{
    mapData: MapSummary | null;
    loading: boolean;
}>();
</script>

<template>
    <div class="map-viewer">
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.mapData" class="map-empty">
            지도 데이터를 불러오지 못했습니다.
        </div>
        <div v-else class="map-body">
            <div class="map-meta">
                <span>연월: {{ props.mapData.year }}년 {{ props.mapData.month }}월</span>
                <span>도시 {{ props.mapData.cityList.length }}</span>
                <span>세력 {{ props.mapData.nationList.length }}</span>
            </div>
            <div class="map-placeholder">지도 뷰어는 추후 이식 예정</div>
        </div>
    </div>
</template>

<style scoped>
.map-viewer {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.map-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.8);
}

.map-placeholder {
    height: 240px;
    border: 1px dashed rgba(201, 164, 90, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(232, 221, 196, 0.6);
    background: rgba(16, 16, 16, 0.6);
}

.map-empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
