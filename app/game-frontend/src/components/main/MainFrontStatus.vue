<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, watch } from 'vue';
import { resolveTournamentStageName } from '../../utils/tournamentStatus';
import { receiveClockSample, useClockDisplay } from '../../composables/useClockDisplay';

const props = defineProps<{
    tournamentStage: number;
    serverTime?: string;
    serverWallTime?: string;
    clockMode?: 'realtime' | 'manual';
    clockRunning?: boolean;
    clockStartsAt?: string | null;
    clockRecovery?: { startsAt: string; endsAt: string } | null;
    turnEngineRunning?: boolean | null;
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
const { time, accelerated: recovering, mode, label, toggle, engineRunning } = useClockDisplay();
const currentServerTime = computed(() =>
    formatServerDateTime(time.value, { format: 'monthDayTime', fallback: '기록 없음' })
);
const hasServerClock = computed(() => time.value !== null);
const turnEngineStopped = computed(() => engineRunning.value === false);
const turnEngineStatusUnknown = computed(() => typeof engineRunning.value !== 'boolean');
const serverClockTitle = computed(() => {
    if (!hasServerClock.value) return '서버 시각을 아직 받지 못했습니다.';
    if (turnEngineStopped.value) return '턴 엔진이 정지하여 현재 시각 보정을 멈췄습니다.';
    if (turnEngineStatusUnknown.value) return '턴 엔진 진행 상태를 확인하지 못했습니다.';
    return recovering.value ? `${label.value} · 클릭하여 변경` : label.value;
});
watch(
    () => [
        props.serverTime,
        props.serverWallTime,
        props.clockMode,
        props.clockRunning,
        props.clockStartsAt,
        props.clockRecovery,
    ],
    () => receiveClockSample(props),
    { immediate: true }
);
</script>

<template>
    <section class="front-status" aria-label="접속 현황과 국가 방침">
        <div class="activity-status" aria-label="현재 시각, 토너먼트와 설문 진행 현황">
            <button
                type="button"
                :disabled="!recovering || turnEngineStopped"
                class="status-row execution-status"
                :class="{
                    'execution-status--game': recovering && mode === 'game',
                    'execution-status--real': recovering && mode === 'real',
                    'execution-status--empty': !hasServerClock,
                    'execution-status--stopped': hasServerClock && turnEngineStopped,
                    'execution-status--unknown': hasServerClock && turnEngineStatusUnknown,
                }"
                :title="serverClockTitle"
                @click="toggle"
            >
                현재 시각: {{ currentServerTime
                }}<span v-if="recovering"> · 2배속 · {{ mode === 'real' ? '실제 시간' : '게임 시간' }}</span>
            </button>
            <div class="status-row tournament-status">
                <RouterLink to="/tournament">
                    <span class="tournament-label">토너먼트: </span>{{ tournamentStatus }}
                </RouterLink>
            </div>
            <div class="status-row vote-status">
                <RouterLink v-if="status?.latestVote" to="/survey" target="_blank" rel="noopener noreferrer">
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
    background: transparent;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    font: inherit;
    cursor: pointer;
    color: cyan;
}

.execution-status > span {
    display: block;
    white-space: nowrap;
    font-size: 12px;
}
.execution-status:disabled {
    opacity: 1;
    cursor: default;
}
.execution-status--game {
    color: #ffd180;
}
.execution-status--real {
    color: #a5d6a7;
}

.execution-status--empty {
    color: magenta;
}

.execution-status--stopped {
    color: magenta;
}

.execution-status--unknown {
    color: #aaa;
}

.vote-label {
    color: cyan;
}

.vote-empty {
    color: magenta;
}
</style>
