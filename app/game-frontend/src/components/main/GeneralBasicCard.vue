<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';

interface GeneralStats {
    leadership: number;
    strength: number;
    intelligence: number;
}

interface GeneralInfo {
    id: number;
    name: string;
    npcState: number;
    officerLevel: number;
    stats: GeneralStats;
    gold: number;
    rice: number;
    crew: number;
    train: number;
    atmos: number;
    injury: number;
    experience: number;
    dedication: number;
}

const props = defineProps<{
    general: GeneralInfo | null;
    loading: boolean;
}>();
</script>

<template>
    <div class="general-card">
        <div v-if="props.loading">
            <SkeletonLines :lines="5" />
        </div>
        <div v-else-if="!props.general" class="empty">장수 정보를 불러오지 못했습니다.</div>
        <div v-else class="general-body">
            <div class="general-header">
                <span class="name">{{ props.general.name }}</span>
                <span class="meta">ID {{ props.general.id }} · 관직 {{ props.general.officerLevel }}</span>
            </div>
            <div class="stats">
                <div>통솔 {{ props.general.stats.leadership }}</div>
                <div>무력 {{ props.general.stats.strength }}</div>
                <div>지력 {{ props.general.stats.intelligence }}</div>
            </div>
            <div class="resources">
                <div>금 {{ props.general.gold }}</div>
                <div>쌀 {{ props.general.rice }}</div>
                <div>병 {{ props.general.crew }}</div>
            </div>
            <div class="status">
                <div>훈련 {{ props.general.train }}</div>
                <div>사기 {{ props.general.atmos }}</div>
                <div>부상 {{ props.general.injury }}</div>
                <div>경험 {{ props.general.experience }}</div>
                <div>공헌 {{ props.general.dedication }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.general-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.general-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.general-header .name {
    font-size: 1.1rem;
    font-weight: 600;
}

.general-header .meta {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.stats,
.resources,
.status {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 6px;
    font-size: 0.85rem;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
