import { computed, ref, shallowRef } from 'vue';
import { useStorage } from '@vueuse/core';
import { formatServerDateTime, type ServerDateTimeOptions } from '@sammo-ts/common/time/ServerDateTime';
import { gameFrontendRuntimeConfig } from '../config/runtimeConfig';
import {
    projectRecoveryTime,
    projectServerClock,
    sampleServerClock,
    type ServerClockProjectionInput,
} from '../utils/serverClockProjection';

export const clockDisplayStorageKey = `sammo-clock-display:${gameFrontendRuntimeConfig.profile}:${gameFrontendRuntimeConfig.appBasePath}`;
const storedMode = useStorage<string>(clockDisplayStorageKey, 'game');
const mode = computed({
    get: () => (storedMode.value === 'real' ? 'real' : 'game'),
    set: (value: string) => {
        storedMode.value = value === 'real' ? 'real' : 'game';
    },
});
const sample = shallowRef<ReturnType<typeof sampleServerClock>>(null);
const preopenLogicalSample = shallowRef<ReturnType<typeof sampleServerClock>>(null);
const now = ref(Date.now());
const engineRunning = ref<boolean | null>(null);
const haltedAt = ref<number | null>(null);

export const receiveClockEngineState = (running: boolean | null): void => {
    engineRunning.value = running;
    haltedAt.value = running === false ? (haltedAt.value ?? Date.now()) : null;
};

export const receiveClockSample = (
    input: ServerClockProjectionInput & { turnEngineRunning?: boolean | null }
): void => {
    if (!input.serverTime) return;
    const wallTime = input.serverWallTime ? new Date(input.serverWallTime).getTime() : undefined;
    const startsAt = input.clockStartsAt ? new Date(input.clockStartsAt).getTime() : NaN;
    const isPreopenSample =
        input.clockMode === 'realtime' && wallTime !== undefined && Number.isFinite(startsAt) && wallTime < startsAt;
    // 메인 화면의 이전 표본을 heartbeat가 재전달해도 더 최신 lobby 표본을 되감지 않는다.
    if (
        wallTime !== undefined &&
        sample.value?.serverWallTimeMs !== undefined &&
        wallTime < sample.value.serverWallTimeMs
    )
        return;
    if (
        sample.value &&
        wallTime !== undefined &&
        wallTime === sample.value.serverWallTimeMs &&
        new Date(input.serverTime).getTime() === sample.value.serverTimeMs &&
        input.turnEngineRunning === engineRunning.value &&
        isPreopenSample === (preopenLogicalSample.value !== null)
    )
        return;
    const sampledAt = Date.now();
    // PREOPEN's displayed clock is intentionally frozen. Its negative logical tick
    // still advances, so candidate deadlines need the unpaused server sample.
    preopenLogicalSample.value = isPreopenSample ? sampleServerClock(input, sampledAt) : null;
    receiveClockEngineState(input.turnEngineRunning ?? null);
    sample.value = sampleServerClock(
        input.turnEngineRunning === false ? { ...input, clockRunning: false, clockStartsAt: null } : input,
        sampledAt
    );
    now.value = sampledAt;
};

export const advanceClockDisplay = (): void => {
    now.value = Date.now();
};
export const clockSampleIsStale = (): boolean =>
    !sample.value || Date.now() - sample.value.sampledClientTimeMs >= 30_000;

const projection = computed(() =>
    sample.value ? projectServerClock(sample.value, haltedAt.value ?? now.value) : null
);
// 마감 판정은 표시 모드와 무관하게 서버가 투영한 GAME 시각을 사용한다.
const gameTime = computed(() => {
    const preopen = preopenLogicalSample.value;
    if (preopen) {
        return new Date(preopen.serverTimeMs + Math.max(0, now.value - preopen.sampledClientTimeMs));
    }
    return projection.value?.time ?? null;
});
const accelerated = computed(() => projection.value?.rate === 2 && engineRunning.value !== false);
const label = computed(() => (mode.value === 'real' ? '실제 시간 기준' : '게임 시간 기준'));
const time = computed(() => {
    const projected = projection.value?.time;
    if (!projected) return null;
    return mode.value === 'real' && accelerated.value ? projectRecoveryTime(sample.value, projected) : projected;
});
const toggle = (): void => {
    if (accelerated.value) mode.value = mode.value === 'real' ? 'game' : 'real';
};

const projectTime = (value: string | Date): Date => {
    // timezone 없는 API 값은 기존 고정 UTC+9 서버 벽시계 계약을 유지한다.
    const normalized =
        typeof value === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(value)
            ? `${value.replace(' ', 'T')}+09:00`
            : value;
    const date = normalized instanceof Date ? normalized : new Date(normalized);
    return mode.value === 'real' ? projectRecoveryTime(sample.value, date) : date;
};
const formatTime = (value: string | Date | null | undefined, options?: ServerDateTimeOptions): string =>
    formatServerDateTime(value ? projectTime(value) : value, options);

export const useClockDisplay = () => ({
    mode,
    label,
    time,
    gameTime,
    accelerated,
    toggle,
    projectTime,
    formatTime,
    engineRunning,
});
