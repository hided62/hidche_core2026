<script setup lang="ts">
import { computed } from 'vue';
import { addMinutes } from 'date-fns';
import ReservedCommandEditor from '../command/ReservedCommandEditor.vue';
import type { CommandPatternEntry, CommandTable, ReservedCommandRow } from '../command/types';

const props = defineProps<{
    commandTable: CommandTable | null;
    loading: boolean;
    reservedGeneralTurns: Array<{ index: number; action: string; args?: unknown }> | null;
    general: { id: number; turnTime?: string } | null;
    currentYear?: number;
    currentMonth?: number;
    turnTermMinutes?: number;
    storageKey?: string;
}>();

const emit = defineEmits<{
    (event: 'set-general-turns', entries: CommandPatternEntry[]): void;
    (event: 'shift-general-turns', amount: number): void;
    (event: 'repeat-general-turns', amount: number): void;
}>();

const labelMap = computed(() => {
    const result = new Map<string, string>([['휴식', '휴식']]);
    for (const group of props.commandTable?.general ?? []) {
        for (const command of group.values) result.set(command.key, command.name);
    }
    return result;
});

const rows = computed<ReservedCommandRow[]>(() => {
    const base = props.general?.turnTime ? new Date(props.general.turnTime) : null;
    const term = props.turnTermMinutes ?? 0;
    const baseYear = props.currentYear ?? 0;
    const baseMonth = props.currentMonth ?? 1;
    return (props.reservedGeneralTurns ?? []).map((turn, offset) => {
        const absoluteMonth = baseYear * 12 + baseMonth - 1 + offset;
        const date = base && Number.isFinite(base.getTime()) ? addMinutes(base, offset * term) : null;
        return {
            ...turn,
            args: turn.args ?? {},
            label: labelMap.value.get(turn.action) ?? turn.action,
            year: Math.floor(absoluteMonth / 12),
            month: (absoluteMonth % 12) + 1,
            time: date
                ? term >= 5
                    ? `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
                    : `${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`
                : '--:--',
        };
    });
});
</script>

<template>
    <ReservedCommandEditor
        scope="general"
        :rows="rows"
        :command-table="props.commandTable"
        :loading="props.loading"
        :storage-key="props.storageKey ?? `core2026:general:${props.general?.id ?? 0}`"
        :current-time="rows[0]?.time"
        @reserve-bulk="emit('set-general-turns', $event)"
        @shift="emit('shift-general-turns', $event)"
        @repeat="emit('repeat-general-turns', $event)"
    />
</template>
