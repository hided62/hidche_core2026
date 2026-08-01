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
    min-width: 0;
    border: 1px solid #666;
    background-color: #071638;
    background-image: var(--sammo-texture-blue);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
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
    padding: 0;
    font-size: 0.75rem;
}

.chief-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
    gap: 2px;
    padding: 1px 4px;
    background-color: #143b28;
    background-image: var(--sammo-texture-green);
}

.chief-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0;
}

.chief-level {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.chief-name {
    overflow: hidden;
    font-size: 0.8rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chief-me {
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 0;
    background: rgba(201, 164, 90, 0.2);
    color: rgba(232, 221, 196, 0.8);
}

.chief-rows {
    display: grid;
    gap: 0;
}

.chief-row {
    display: grid;
    grid-template-columns: 24px 48px minmax(0, 1fr);
    min-height: 22px;
    gap: 2px;
    align-items: center;
    padding: 0 3px;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.75rem;
}

.chief-card.compact .chief-row {
    grid-template-columns: 18px 36px minmax(0, 1fr);
    box-sizing: border-box;
    height: 13px;
    min-height: 0;
    padding: 0 2px;
    font-size: 0.55rem;
    line-height: 11px;
}

.chief-card.compact .chief-header {
    box-sizing: border-box;
    height: 20px;
    min-height: 0;
    font-size: 0.65rem;
}

.chief-card.compact .chief-level,
.chief-card.compact .chief-name {
    font-size: 0.6rem;
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
