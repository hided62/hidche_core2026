<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common';
import { computed } from 'vue';
import { resolveTournamentStageName } from '../../utils/tournamentStatus';

const props = defineProps<{
    tournamentStage: number;
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
const lastExecutedStatus = computed(() =>
    formatServerDateTime(props.status?.lastExecuted, { format: 'monthDayTime', fallback: '기록 없음' })
);
</script>

<template>
    <section class="front-status" aria-label="접속 현황과 국가 방침">
        <div class="activity-status" aria-label="동작 시각, 토너먼트와 설문 진행 현황">
            <div class="status-row execution-status" :class="{ 'execution-status--empty': !status?.lastExecuted }">
                동작 시각: {{ lastExecutedStatus }}
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

.vote-label {
    color: cyan;
}

.vote-empty {
    color: magenta;
}
</style>
