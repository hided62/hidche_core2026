<script setup lang="ts">
import { computed } from 'vue';
import { formatLog } from '../../utils/formatLog';

type LogEntry = {
    id: number;
    text: string;
};

const props = withDefaults(
    defineProps<{
        logs?: LogEntry[] | null;
        emptyText?: string;
    }>(),
    {
        logs: null,
        emptyText: '기록 없음',
    }
);

const formattedLogs = computed(() =>
    (props.logs ?? []).map((entry) => ({
        id: entry.id,
        html: formatLog(entry.text),
    }))
);
</script>

<template>
    <div class="recent-log-list">
        <template v-if="formattedLogs.length">
            <!-- 레거시 색상 tag만 formatLog가 span으로 변환한다. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-for="entry in formattedLogs" :key="entry.id" class="recent-log-line" v-html="entry.html" />
        </template>
        <div v-else class="recent-log-empty">{{ emptyText }}</div>
    </div>
</template>

<style scoped>
.recent-log-list {
    min-width: 0;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.35;
}

.recent-log-line {
    overflow-wrap: anywhere;
}

.recent-log-empty {
    color: #aaa;
    text-align: center;
}
</style>
