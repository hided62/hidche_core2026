<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';
import { GENERAL_RECORD_TYPES, type GeneralRecordCollection, type GeneralRecordType } from '../generalRecords';

const props = withDefaults(
    defineProps<{
        records: GeneralRecordCollection;
        loading?: boolean;
        trustedHtml?: boolean;
        unavailable?: GeneralRecordType[];
    }>(),
    {
        loading: false,
        trustedHtml: false,
        unavailable: () => [],
    }
);

const labels: Record<GeneralRecordType, string> = {
    generalHistory: '장수 열전',
    battleDetail: '전투 기록',
    battleResult: '전투 결과',
    generalAction: '개인 기록',
};

const unavailableText: Record<GeneralRecordType, string> = {
    generalHistory: '이 기수에는 장수 열전이 보존되지 않았습니다.',
    battleDetail: '이 기수에는 전투 기록이 보존되지 않았습니다.',
    battleResult: '이 기수에는 전투 결과가 보존되지 않았습니다.',
    generalAction: '이 기수에는 개인 기록이 보존되지 않았습니다.',
};
</script>

<template>
    <div class="log-grid" data-general-record-panels>
        <div v-for="type in GENERAL_RECORD_TYPES" :key="type" class="log-block" :data-log-type="type">
            <div class="log-title">{{ labels[type] }}</div>
            <SkeletonLines v-if="loading" :lines="3" />
            <template v-else-if="props.unavailable.includes(type)">
                <div class="empty unavailable">{{ unavailableText[type] }}</div>
            </template>
            <template v-else>
                <div v-if="(records[type]?.length ?? 0) === 0" class="empty">기록이 없습니다.</div>
                <template v-for="entry in records[type] ?? []" :key="entry.id">
                    <!-- Current-season logs have already passed the trusted formatter boundary. -->
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <div v-if="trustedHtml" class="log-line" v-html="entry.content" />
                    <div v-else class="log-line">{{ entry.content }}</div>
                </template>
            </template>
        </div>
    </div>
</template>

<style scoped>
.log-grid {
    display: contents;
}

.log-block {
    min-height: 0;
    border: 1px solid #666;
    padding: 0;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
}

.log-title {
    display: flex;
    min-height: 34px;
    align-items: center;
    justify-content: center;
    margin: 0;
    border-bottom: 1px solid #666;
    color: orange;
    background-color: #000;
    background-image: var(--sammo-texture-green);
    font-size: 1.3em;
    font-weight: 500;
}

.log-line {
    padding: 2px 8px;
    border-bottom: 0;
}

.log-line :deep(.hidden_but_copyable) {
    color: transparent !important;
    font-size: 0;
}

.empty {
    padding: 2px 8px;
    color: #999;
}

.unavailable {
    color: #bbb;
}
</style>
