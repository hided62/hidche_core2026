<script setup lang="ts">
import { computed } from 'vue';
import { useClockDisplay } from '../../composables/useClockDisplay';
import { addMinutes } from 'date-fns';
import ReservedCommandEditor from '../command/ReservedCommandEditor.vue';
import { generalTurnEditorModeStorageKey } from '../command/commandQueue';
import { formatLocalDateTime, formatLocalTimeSeconds } from '../../utils/legacyDateTime';

import { gameFrontendRuntimeConfig } from '../../config/runtimeConfig';
import type {
    CommandMapData,
    CommandMapLayout,
    CommandPatternEntry,
    CommandTable,
    ReservedCommandRow,
} from '../command/types';

const { projectTime, time } = useClockDisplay();
const currentServerTime = computed(() => (time.value ? formatLocalTimeSeconds(time.value) : '--:--:--'));

type ReservationCompletion = (success: boolean) => void;

const props = defineProps<{
    commandTable: CommandTable | null;
    loading: boolean;
    reservedGeneralTurns: Array<{ index: number; action: string; args?: unknown }> | null;
    general: { id: number; turnTime?: string; nextTurnMonthOffset?: 0 | 1 } | null;
    currentYear?: number;
    currentMonth?: number;
    turnTermMinutes?: number;
    serverTime?: string;
    serverWallTime?: string;
    clockMode?: 'realtime' | 'manual';
    clockRunning?: boolean;
    clockStartsAt?: string | null;
    clockRecovery?: { startsAt: string; endsAt: string } | null;
    autorunLimit?: number | null;
    storageKey?: string;
    mapData?: CommandMapData | null;
    mapLayout?: CommandMapLayout | null;
    mobile?: boolean;
}>();

const emit = defineEmits<{
    (event: 'set-general-turns', entries: CommandPatternEntry[], complete?: ReservationCompletion): void;
    (event: 'shift-general-turns', amount: number): void;
    (event: 'repeat-general-turns', amount: number): void;
}>();

const reserveBulk = (entries: CommandPatternEntry[], complete?: ReservationCompletion) => {
    emit('set-general-turns', entries, complete);
};

const editModeStorageKey = generalTurnEditorModeStorageKey(
    gameFrontendRuntimeConfig.profile,
    gameFrontendRuntimeConfig.appBasePath
);

const labelMap = computed(() => {
    const result = new Map<string, string>([['휴식', '휴식']]);
    for (const group of props.commandTable?.general ?? []) {
        for (const command of group.values) result.set(command.key, command.name);
    }
    return result;
});

const firstReservedMonth = computed(
    () => (props.currentYear ?? 0) * 12 + (props.currentMonth ?? 1) - 1 + (props.general?.nextTurnMonthOffset ?? 0)
);

const rows = computed<ReservedCommandRow[]>(() => {
    const base = props.general?.turnTime ? new Date(props.general.turnTime) : null;
    const term = props.turnTermMinutes ?? 0;
    return (props.reservedGeneralTurns ?? []).map((turn, offset) => {
        const absoluteMonth = firstReservedMonth.value + offset;
        const date = base && Number.isFinite(base.getTime()) ? projectTime(addMinutes(base, offset * term)) : null;
        return {
            ...turn,
            args: turn.args ?? {},
            label: labelMap.value.get(turn.action) ?? turn.action,
            year: Math.floor(absoluteMonth / 12),
            month: (absoluteMonth % 12) + 1,
            autonomous: props.autorunLimit != null && absoluteMonth <= props.autorunLimit - 1,
            time: date
                ? term >= 5
                    ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
                    : `${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
                : '--:--',
        };
    });
});

const autonomousUntil = computed(() => {
    if (props.autorunLimit == null) return null;
    const currentAbsoluteMonth = firstReservedMonth.value;
    const lastAutonomousMonth = props.autorunLimit - 1;
    if (lastAutonomousMonth < currentAbsoluteMonth) return null;

    const untilYear = Math.floor(lastAutonomousMonth / 12);
    const untilMonth = (lastAutonomousMonth % 12) + 1;
    const base = props.general?.turnTime ? new Date(props.general.turnTime) : null;
    const term = props.turnTermMinutes ?? 0;
    const expiresAt =
        base && Number.isFinite(base.getTime())
            ? addMinutes(base, (lastAutonomousMonth - currentAbsoluteMonth) * term)
            : null;
    const currentTimeLabel = expiresAt ? formatLocalDateTime(projectTime(expiresAt)) : '현재시각 확인 불가';
    return `${untilYear}年 ${untilMonth}月 · ${currentTimeLabel}까지`;
});
</script>

<template>
    <ReservedCommandEditor
        scope="general"
        :rows="rows"
        :command-table="props.commandTable"
        :loading="props.loading"
        :storage-key="props.storageKey ?? `core2026:general:${props.general?.id ?? 0}`"
        :edit-mode-storage-key="editModeStorageKey"
        :current-time="currentServerTime"
        :map-data="props.mapData"
        :map-layout="props.mapLayout"
        :autonomous-until="autonomousUntil"
        :mobile="props.mobile"
        :max-push-turn="12"
        @reserve-bulk="reserveBulk"
        @shift="emit('shift-general-turns', $event)"
        @repeat="emit('repeat-general-turns', $event)"
    />
</template>
