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
    age?: number;
    turnTime?: string;
    crewTypeId?: number;
    traits?: { personal: string; specialWar: string; specialDomestic: string };
    progression?: { experienceLevel: number; dedicationLevel: number; dex: number[] };
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
            <div class="general-title">
                {{ props.general.name }} · 관직 {{ props.general.officerLevel }} · {{ props.general.age ?? '-' }}세
            </div>
            <div class="legacy-grid">
                <span>통솔</span><strong>{{ props.general.stats.leadership }}</strong> <span>무력</span
                ><strong>{{ props.general.stats.strength }}</strong> <span>지력</span
                ><strong>{{ props.general.stats.intelligence }}</strong> <span>자금</span
                ><strong>{{ props.general.gold.toLocaleString() }}</strong> <span>군량</span
                ><strong>{{ props.general.rice.toLocaleString() }}</strong> <span>병력</span
                ><strong>{{ props.general.crew.toLocaleString() }}</strong> <span>훈련</span
                ><strong>{{ props.general.train }}</strong> <span>사기</span><strong>{{ props.general.atmos }}</strong>
                <span>부상</span><strong>{{ props.general.injury }}</strong> <span>명망</span
                ><strong
                    >Lv {{ props.general.progression?.experienceLevel ?? 0 }} ({{ props.general.experience }})</strong
                >
                <span>계급</span
                ><strong
                    >Lv {{ props.general.progression?.dedicationLevel ?? 0 }} ({{ props.general.dedication }})</strong
                >
                <span>병종</span><strong>{{ props.general.crewTypeId || '-' }}</strong> <span>성격</span
                ><strong>{{ props.general.traits?.personal ?? '-' }}</strong> <span>전투특기</span
                ><strong>{{ props.general.traits?.specialWar ?? '-' }}</strong> <span>내정특기</span
                ><strong>{{ props.general.traits?.specialDomestic ?? '-' }}</strong> <span>다음 턴</span
                ><strong>{{ props.general.turnTime?.slice(11, 16) ?? '-' }}</strong>
            </div>
            <div class="dex">숙련도 {{ props.general.progression?.dex?.join(' / ') ?? '0 / 0 / 0 / 0 / 0' }}</div>
        </div>
    </div>
</template>

<style scoped>
.general-title {
    min-height: 24px;
    padding: 2px 6px;
    border-bottom: 1px solid #777;
    background: #173d27;
    text-align: center;
    font-weight: 700;
}
.legacy-grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    font-size: 12px;
}
.legacy-grid > * {
    min-height: 22px;
    box-sizing: border-box;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 2px 4px;
    overflow: hidden;
    white-space: nowrap;
}
.legacy-grid > span {
    background: rgb(20 75 42 / 70%);
    text-align: center;
}
.legacy-grid > strong {
    text-align: right;
    font-weight: 400;
}
.dex {
    padding: 3px 6px;
    font-size: 12px;
    color: #ddd;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
