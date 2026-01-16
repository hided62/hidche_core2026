<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';

interface NationInfo {
    id: number;
    name: string;
    color: string;
    level: number;
    gold: number;
    rice: number;
    tech: number;
    typeCode: string;
    capitalCityId: number | null;
}

const props = defineProps<{
    nation: NationInfo | null;
    loading: boolean;
}>();
</script>

<template>
    <div class="nation-card">
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.nation" class="empty">국가 정보를 불러오지 못했습니다.</div>
        <div v-else class="nation-body">
            <div class="title">
                <span class="color" :style="{ backgroundColor: props.nation.color }" />
                {{ props.nation.name }} (Lv {{ props.nation.level }})
            </div>
            <div class="grid">
                <div>국고 {{ props.nation.gold }}</div>
                <div>국량 {{ props.nation.rice }}</div>
                <div>기술 {{ props.nation.tech }}</div>
                <div>체제 {{ props.nation.typeCode }}</div>
                <div>수도 {{ props.nation.capitalCityId ?? '-' }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.nation-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
}

.color {
    width: 14px;
    height: 14px;
    border: 1px solid rgba(232, 221, 196, 0.6);
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
