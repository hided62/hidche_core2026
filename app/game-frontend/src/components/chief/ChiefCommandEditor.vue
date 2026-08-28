<script setup lang="ts">
import { computed } from 'vue';
import ReservedCommandEditor from '../command/ReservedCommandEditor.vue';
import type {
    CommandMapData,
    CommandMapLayout,
    CommandPatternEntry,
    CommandTable,
    ReservedCommandRow,
} from '../command/types';

type ReservationCompletion = (success: boolean) => void;

const props = defineProps<{
    officerLevelText: string;
    name: string | null;
    npcState: number | null;
    rows: Array<ReservedCommandRow & { actionCode?: string }>;
    commandTable: CommandTable | null;
    loading: boolean;
    generalId: number;
    officerLevel: number;
    mobile?: boolean;
    mapData?: CommandMapData | null;
    mapLayout?: CommandMapLayout | null;
}>();

const commandRows = computed(() => props.rows.map((row) => ({ ...row, action: row.actionCode ?? row.action })));

const emit = defineEmits<{
    (event: 'reserve-bulk', entries: CommandPatternEntry[], complete?: ReservationCompletion): void;
    (event: 'shift', amount: number): void;
    (event: 'repeat', amount: number): void;
}>();

const reserveBulk = (entries: CommandPatternEntry[], complete?: ReservationCompletion) => {
    emit('reserve-bulk', entries, complete);
};
</script>

<template>
    <ReservedCommandEditor
        data-testid="chief-command-editor"
        scope="nation"
        :rows="commandRows"
        :command-table="props.commandTable"
        :loading="props.loading"
        :storage-key="`core2026:nation:${props.generalId}:${props.officerLevel}`"
        :compact="true"
        :mobile="props.mobile"
        :title="props.officerLevelText"
        :name="props.name"
        :current-time="props.rows[0]?.time"
        :map-data="props.mapData"
        :map-layout="props.mapLayout"
        @reserve-bulk="reserveBulk"
        @shift="emit('shift', $event)"
        @repeat="emit('repeat', $event)"
    />
</template>
