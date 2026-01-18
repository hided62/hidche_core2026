<script setup lang="ts">
import { computed } from 'vue';
import { getNpcColor } from '../../utils/npcColor';

type TurnRow = {
    index: number;
    time: string;
    action: string;
    isRest: boolean;
};

const props = defineProps<{
    officerLevelText: string;
    name: string | null;
    npcState: number | null;
    rows: TurnRow[];
    selected?: boolean;
    compact?: boolean;
    isMe?: boolean;
    clickable?: boolean;
}>();

const emit = defineEmits<{
    (event: 'select'): void;
}>();

const nameColor = computed(() => (props.npcState !== null ? getNpcColor(props.npcState) : undefined));

const handleClick = () => {
    if (props.clickable) {
        emit('select');
    }
};
</script>

<template>
    <article
        class="chief-card"
        :class="{ selected: props.selected, compact: props.compact, clickable: props.clickable }"
        @click="handleClick"
    >
        <header class="chief-header">
            <div class="chief-title">
                <span class="chief-level">{{ props.officerLevelText }}</span>
                <span class="chief-name" :style="{ color: nameColor }">
                    {{ props.name ?? '-' }}
                </span>
            </div>
            <span v-if="props.isMe" class="chief-me">ME</span>
        </header>
        <div class="chief-rows">
            <div v-for="row in props.rows" :key="row.index" class="chief-row" :class="{ rest: row.isRest }">
                <span class="row-index">#{{ row.index + 1 }}</span>
                <span class="row-time">{{ row.time }}</span>
                <span class="row-action">{{ row.action }}</span>
            </div>
        </div>
    </article>
</template>

<style scoped>
.chief-card {
    border: 1px solid rgba(201, 164, 90, 0.3);
    background: rgba(12, 12, 12, 0.7);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.chief-card.clickable {
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.chief-card.clickable:hover {
    border-color: rgba(201, 164, 90, 0.6);
    box-shadow: 0 0 12px rgba(201, 164, 90, 0.15);
}

.chief-card.selected {
    border-color: rgba(201, 164, 90, 0.8);
    box-shadow: 0 0 16px rgba(201, 164, 90, 0.2);
}

.chief-card.compact {
    padding: 8px;
    font-size: 0.75rem;
}

.chief-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
}

.chief-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.chief-level {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.chief-name {
    font-size: 0.95rem;
    font-weight: 600;
}

.chief-me {
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 999px;
    background: rgba(201, 164, 90, 0.2);
    color: rgba(232, 221, 196, 0.8);
}

.chief-rows {
    display: grid;
    gap: 4px;
}

.chief-row {
    display: grid;
    grid-template-columns: 36px 56px 1fr;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid rgba(201, 164, 90, 0.15);
    font-size: 0.75rem;
}

.chief-card.compact .chief-row {
    grid-template-columns: 28px 48px 1fr;
    font-size: 0.7rem;
}

.chief-row.rest {
    color: rgba(232, 221, 196, 0.5);
}

.row-index {
    color: rgba(232, 221, 196, 0.6);
}

.row-time {
    font-variant-numeric: tabular-nums;
}

.row-action {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
