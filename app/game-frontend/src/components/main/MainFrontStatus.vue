<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, onUnmounted, ref, watch } from 'vue';
import { resolveTournamentStageName } from '../../utils/tournamentStatus';
import {
    GAME_SERVER_ACTIVITY_FRESHNESS_MS,
    gameServerActivity,
    isRecentGameServerActivity,
} from '../../utils/gameServerActivity';
import {
    millisecondsUntilNextMinute,
    projectServerClock,
    sampleServerClock,
    type SampledServerClock,
} from '../../utils/serverClockProjection';

const props = defineProps<{
    tournamentStage: number;
    serverTime?: string;
    serverWallTime?: string;
    clockMode?: 'realtime' | 'manual';
    clockRunning?: boolean;
    clockStartsAt?: string | null;
    status: {
        onlineUserCount: number;
        onlineNations: string;
        onlineGenerals: string;
        nationNotice: string;
        lastExecuted: string | null;
        latestVote: {
            id: number;
            title: string;
            hasVoted: boolean;
        } | null;
    } | null;
}>();

const tournamentStatus = computed(() => resolveTournamentStageName(props.tournamentStage));
const currentServerTime = ref('기록 없음');
const hasServerClock = ref(false);
const serverClockFresh = ref(false);
const serverClockTitle = computed(() => {
    if (!hasServerClock.value) return '서버 시각을 아직 받지 못했습니다.';
    if (!serverClockFresh.value) return '최근 45초 동안 서버 통신이 없어 시각 갱신을 멈췄습니다.';
    return undefined;
});

let serverClockSample: SampledServerClock | null = null;
let serverClockTimer: ReturnType<typeof setTimeout> | undefined;

const updateServerClock = () => {
    if (serverClockTimer !== undefined) clearTimeout(serverClockTimer);
    serverClockTimer = undefined;
    if (serverClockSample === null) {
        currentServerTime.value = '기록 없음';
        hasServerClock.value = false;
        serverClockFresh.value = false;
        return;
    }

    const now = Date.now();
    const projection = projectServerClock(serverClockSample, now);
    currentServerTime.value = formatServerDateTime(projection.time, {
        format: 'monthDayTime',
        fallback: '기록 없음',
    });
    hasServerClock.value = true;

    const lastContactAt = gameServerActivity.lastContactAt.value;
    serverClockFresh.value = isRecentGameServerActivity(lastContactAt, now);
    if (!serverClockFresh.value || lastContactAt === null) return;

    const nextDelays = [lastContactAt + GAME_SERVER_ACTIVITY_FRESHNESS_MS - now + 1];
    if (serverClockSample.clockMode !== 'manual' && serverClockSample.startDelayMs !== null) {
        const untilStartMs = serverClockSample.startDelayMs - projection.clientElapsedMs;
        nextDelays.push(untilStartMs > 0 ? untilStartMs : millisecondsUntilNextMinute(projection.time));
    }
    serverClockTimer = setTimeout(updateServerClock, Math.max(1, Math.min(...nextDelays)));
};

watch(
    () => [props.serverTime, props.serverWallTime, props.clockMode, props.clockRunning, props.clockStartsAt] as const,
    ([serverTime, serverWallTime, clockMode, clockRunning, clockStartsAt]) => {
        serverClockSample = sampleServerClock({ serverTime, serverWallTime, clockMode, clockRunning, clockStartsAt });
        updateServerClock();
    },
    { immediate: true }
);
watch(() => gameServerActivity.lastContactAt.value, updateServerClock);

onUnmounted(() => {
    if (serverClockTimer !== undefined) clearTimeout(serverClockTimer);
});
</script>

<template>
    <section class="front-status" aria-label="접속 현황과 국가 방침">
        <div class="activity-status" aria-label="현재 시각, 토너먼트와 설문 진행 현황">
            <div
                class="status-row execution-status"
                :class="{
                    'execution-status--empty': !hasServerClock,
                    'execution-status--stale': hasServerClock && !serverClockFresh,
                }"
                :title="serverClockTitle"
            >
                현재 시각: {{ currentServerTime }}
            </div>
            <div class="status-row tournament-status">
                <RouterLink to="/tournament">
                    <span class="tournament-label">토너먼트: </span>{{ tournamentStatus }}
                </RouterLink>
            </div>
            <div class="status-row vote-status">
                <RouterLink v-if="status?.latestVote" to="/survey">
                    <span class="vote-label">설문: </span>{{ status.latestVote.title }}
                </RouterLink>
                <span v-else class="vote-empty">설문: 진행 중인 설문 없음</span>
            </div>
        </div>
        <div class="status-row online-nations">접속중인 국가: {{ status?.onlineNations ?? '' }}</div>
        <div class="status-row online-users">【 접속자 】 {{ status?.onlineGenerals ?? '' }}</div>
        <div class="status-row nation-notice">
            <div class="notice-title">【 국가방침 】</div>
            <!-- 레거시 국가 방침은 같은 저장 형식의 HTML 본문을 그대로 표시한다. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="nation-notice-body" v-html="status?.nationNotice ?? ''" />
        </div>
    </section>
</template>

<style scoped>
.front-status {
    box-sizing: border-box;
    width: 100%;
    margin-left: 0;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
    color: #fff;
    font-size: 14px;
    font-weight: 400;
    line-height: 21px;
}

.status-row {
    box-sizing: border-box;
    min-height: 36px;
    border-top: 1px solid gray;
    padding: 7px;
}

.nation-notice {
    padding: 7px 0;
}

.notice-title {
    padding: 0 7px;
}

.nation-notice-body {
    overflow-wrap: anywhere;
}

.nation-notice-body :deep(p) {
    min-height: 1em;
    margin: 0;
}

.activity-status {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
}

.activity-status .status-row {
    padding-right: 0;
    padding-left: 0;
    text-align: center;
}

.activity-status a {
    color: #fff;
    text-decoration: gray underline;
}

.tournament-label {
    color: #ffc107;
}

.execution-status {
    color: cyan;
}

.execution-status--empty {
    color: magenta;
}

.execution-status--stale {
    color: magenta;
}

.vote-label {
    color: cyan;
}

.vote-empty {
    color: magenta;
}
</style>
