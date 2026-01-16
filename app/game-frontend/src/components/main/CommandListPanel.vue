<script setup lang="ts">
import { ref } from 'vue';
import CommandSelectForm from './CommandSelectForm.vue';

interface TurnCommandAvailability {
    key: string;
    name: string;
    status: 'available' | 'blocked' | 'needsInput' | 'unknown';
    possible: boolean;
    reason?: string;
}

interface TurnCommandGroup {
    category: string;
    values: TurnCommandAvailability[];
}

interface TurnCommandTable {
    general: TurnCommandGroup[];
    nation: TurnCommandGroup[];
}

const props = defineProps<{
    commandTable: TurnCommandTable | null;
    loading: boolean;
}>();

const activeCategory = ref('');

const handleSelect = (commandKey: string) => {
    void commandKey;
};
</script>

<template>
    <div class="command-panel">
        <CommandSelectForm
            :command-table="props.commandTable"
            :loading="props.loading"
            :active-category="activeCategory"
            @update:active-category="activeCategory = $event"
            @select="handleSelect"
        />
        <div class="command-placeholder">
            선택한 명령의 상세/예약 UI는 추후 이식 예정
        </div>
    </div>
</template>

<style scoped>
.command-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.command-placeholder {
    border: 1px dashed rgba(201, 164, 90, 0.3);
    padding: 8px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}
</style>
