<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { addMinutes } from 'date-fns';
import ReservedCommandEditor from '../command/ReservedCommandEditor.vue';
import { formatLocalDateTime, formatLocalTimeSeconds } from '../../utils/legacyDateTime';
import type {
    CommandMapData,
    CommandMapLayout,
    CommandPatternEntry,
    CommandTable,
    ReservedCommandRow,
} from '../command/types';

const props = defineProps<{
    commandTable: CommandTable | null;
    loading: boolean;
    reservedGeneralTurns: Array<{ index: number; action: string; args?: unknown }> | null;
    general: { id: number; turnTime?: string } | null;
    currentYear?: number;
    currentMonth?: number;
    turnTermMinutes?: number;
    serverTime?: string;
    serverWallTime?: string;
    clockMode?: 'realtime' | 'manual';
    clockRunning?: boolean;
    clockStartsAt?: string | null;
    autorunLimit?: number | null;
    storageKey?: string;
    mapData?: CommandMapData | null;
    mapLayout?: CommandMapLayout | null;
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
    const baseYear = props.currentYear ?? 0;
    const baseMonth = props.currentMonth ?? 1;
    const currentAbsoluteMonth = baseYear * 12 + baseMonth - 1;
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
    const currentTimeLabel = expiresAt ? formatLocalDateTime(expiresAt) : '현재시각 확인 불가';
    return `${untilYear}年 ${untilMonth}月 · ${currentTimeLabel}까지`;
});

const currentServerTime = ref('--:--:--');
const MAX_SERVER_CLOCK_TIMER_DELAY_MS = 60_000;
let sampledServerTimeMs: number | null = null;
let sampledClientTimeMs = 0;
let sampledStartDelayMs: number | null = 0;
let serverClockTimer: ReturnType<typeof setTimeout> | undefined;

const updateServerClock = () => {
    if (serverClockTimer !== undefined) clearTimeout(serverClockTimer);
    serverClockTimer = undefined;
    if (sampledServerTimeMs === null) {
        currentServerTime.value = '--:--:--';
        return;
    }
    const clientElapsedMs = Math.max(0, Date.now() - sampledClientTimeMs);
    const elapsedGameMs =
        props.clockMode === 'manual' || sampledStartDelayMs === null
            ? 0
            : Math.max(0, clientElapsedMs - sampledStartDelayMs);
    const projectedTime = new Date(sampledServerTimeMs + elapsedGameMs);
    currentServerTime.value = formatLocalTimeSeconds(projectedTime);
    if (props.clockMode !== 'manual' && sampledStartDelayMs !== null) {
        const untilStartMs = sampledStartDelayMs - clientElapsedMs;
        serverClockTimer = setTimeout(
            updateServerClock,
            untilStartMs > 0
                ? Math.min(untilStartMs, MAX_SERVER_CLOCK_TIMER_DELAY_MS)
                : 1_000 - projectedTime.getMilliseconds()
        );
    }
};

watch(
    () => [props.serverTime, props.serverWallTime, props.clockMode, props.clockRunning, props.clockStartsAt] as const,
    ([serverTime, serverWallTime, clockMode, clockRunning, clockStartsAt]) => {
        const parsed = serverTime ? new Date(serverTime).getTime() : Number.NaN;
        sampledServerTimeMs = Number.isFinite(parsed) ? parsed : null;
        sampledClientTimeMs = Date.now();
        if (clockMode === 'manual') {
            sampledStartDelayMs = null;
        } else if (clockRunning !== false) {
            sampledStartDelayMs = 0;
        } else {
            const wallTimeMs = serverWallTime ? new Date(serverWallTime).getTime() : Number.NaN;
            const startsAtMs = clockStartsAt ? new Date(clockStartsAt).getTime() : Number.NaN;
            sampledStartDelayMs =
                Number.isFinite(wallTimeMs) && Number.isFinite(startsAtMs)
                    ? Math.max(0, startsAtMs - wallTimeMs)
                    : null;
        }
        updateServerClock();
    },
    { immediate: true }
);

onUnmounted(() => {
    if (serverClockTimer !== undefined) clearTimeout(serverClockTimer);
});
</script>

<template>
    <ReservedCommandEditor
        scope="general"
        :rows="rows"
        :command-table="props.commandTable"
        :loading="props.loading"
        :storage-key="props.storageKey ?? `core2026:general:${props.general?.id ?? 0}`"
        :current-time="currentServerTime"
        :map-data="props.mapData"
        :map-layout="props.mapLayout"
        :autonomous-until="autonomousUntil"
        @reserve-bulk="emit('set-general-turns', $event)"
        @shift="emit('shift-general-turns', $event)"
        @repeat="emit('repeat-general-turns', $event)"
    />
</template>
