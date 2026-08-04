<script setup lang="ts">
defineProps<{
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
</script>

<template>
    <section class="front-status" aria-label="접속 현황과 국가 방침">
        <div class="status-row vote-status">
            <RouterLink v-if="status?.latestVote" to="/survey">
                <span class="vote-label">설문 진행 중: </span>{{ status.latestVote.title }}
            </RouterLink>
            <span v-else class="vote-empty">진행중인 설문 없음</span>
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

.vote-status {
    width: 33.333333%;
    margin-left: auto;
    padding-right: 0;
    padding-left: 0;
    text-align: center;
}

.vote-status a {
    color: #fff;
    text-decoration: gray underline;
}

.vote-label {
    color: cyan;
}

.vote-empty {
    color: magenta;
}

@media (max-width: 991px) {
    .vote-status {
        width: 50%;
    }
}
</style>
