<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';
import { legacyNationTextColor } from '../../utils/legacyNationColor';

interface NationInfo {
    id: number;
    name: string;
    color: string;
    level: number;
    levelName: string;
    gold: number;
    rice: number;
    tech: number;
    typeCode: string;
    typeName: string;
    capitalCityId: number | null;
    capitalCityName: string | null;
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
            <div
                class="title"
                :style="{ backgroundColor: props.nation.color, color: legacyNationTextColor(props.nation.color) }"
            >
                {{ props.nation.name }}<template v-if="props.nation.id > 0"> ({{ props.nation.levelName }})</template>
            </div>
            <div class="grid">
                <span>국고</span
                ><strong>{{ props.nation.id === 0 ? '해당 없음' : props.nation.gold.toLocaleString() }}</strong>
                <span>국량</span
                ><strong>{{ props.nation.id === 0 ? '해당 없음' : props.nation.rice.toLocaleString() }}</strong>
                <span>기술</span
                ><strong>{{ props.nation.id === 0 ? '해당 없음' : props.nation.tech.toLocaleString() }}</strong>
                <span>체제</span><strong>{{ props.nation.id === 0 ? '해당 없음' : props.nation.typeName }}</strong>
                <span>수도</span
                ><strong>{{ props.nation.id === 0 ? '해당 없음' : (props.nation.capitalCityName ?? '-') }}</strong>
                <span>국가 등급</span
                ><strong>{{ props.nation.id === 0 ? '해당 없음' : props.nation.levelName }}</strong>
            </div>
        </div>
    </div>
</template>

<style scoped>
.title {
    min-height: 24px;
    padding: 2px 6px;
    text-align: center;
    font-weight: 600;
}
.grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
