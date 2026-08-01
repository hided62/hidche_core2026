<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { trpc } from '../utils/trpc';

type Snapshot = Awaited<ReturnType<typeof trpc.tournament.getSnapshot.query>>;

const snapshot = ref<Snapshot | null>(null);
const betting = ref<Awaited<ReturnType<typeof trpc.tournament.getBettingSummary.query>> | null>(null);
const myGeneralId = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const adminEnabled = ref(false);

const typeNames = ['전력전', '통솔전', '일기토', '설전'];
const stageNames = [
    '경기 없음',
    '참가 모집중',
    '예선 진행중',
    '본선 추첨중',
    '본선 진행중',
    '16강 배정중',
    '베팅 진행중',
    '16강 진행중',
    '8강 진행중',
    '4강 진행중',
    '결승 진행중',
];

const errorText = (value: unknown) => (value instanceof Error ? value.message : String(value));

const load = async () => {
    loading.value = true;
    error.value = null;
    try {
        const [nextSnapshot, nextBetting, me, admin] = await Promise.all([
            trpc.tournament.getSnapshot.query(),
            trpc.tournament.getBettingSummary.query(),
            trpc.general.me.query(),
            trpc.tournament.getAdminStatus.query().catch(() => null),
        ]);
        snapshot.value = nextSnapshot;
        betting.value = nextBetting;
        myGeneralId.value = me?.general?.id ?? 0;
        adminEnabled.value = !!admin?.ok;
    } catch (value) {
        error.value = errorText(value);
    } finally {
        loading.value = false;
    }
};

onMounted(() => void load());

const participantsById = computed(
    () => new Map((snapshot.value?.participants ?? []).map((participant) => [participant.id, participant]))
);
const matchesAt = (stage: number) =>
    (snapshot.value?.matches ?? [])
        .filter((match) => match.stage === stage)
        .sort((a, b) => a.roundIndex - b.roundIndex);
const nameOf = (id?: number) => (id ? (participantsById.value.get(id)?.name ?? `#${id}`) : '-');
const roundNames = (stage: number, count: number) => {
    const matches = matchesAt(stage);
    const ids = matches.flatMap((match) => [match.attackerId, match.defenderId]);
    return Array.from({ length: count }, (_, index) => nameOf(ids[index]));
};
const champion = computed(() => {
    const winner = snapshot.value?.state?.winnerId ?? matchesAt(10)[0]?.winnerId;
    return nameOf(winner);
});
const finalists = computed(() => roundNames(10, 2));
const semiFinalists = computed(() => roundNames(9, 4));
const quarterFinalists = computed(() => roundNames(8, 8));
const top16 = computed(() => roundNames(7, 16));
const totalBet = computed(() => betting.value?.totalAmount ?? 0);
const odds = (id?: number) => {
    if (!id) return '0';
    const totals = betting.value?.totals as Record<number, number> | undefined;
    const amount = totals?.[id] ?? 0;
    if (!amount) return '∞';
    return (totalBet.value / amount).toFixed(2);
};
const isParticipant = computed(() =>
    (snapshot.value?.participants ?? []).some((participant) => participant.id === myGeneralId.value)
);
const groups = computed(() =>
    Array.from({ length: 8 }, (_, index) =>
        (snapshot.value?.participants ?? [])
            .filter((participant) => participant.groupId === index + 10)
            .sort((a, b) => (a.finalRank ?? 99) - (b.finalRank ?? 99) || (a.groupNo ?? 99) - (b.groupNo ?? 99))
    )
);
const currentMatch = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage < 7 || state.stage > 10) return null;
    return matchesAt(state.stage).find((match) => !match.winnerId) ?? matchesAt(state.stage)[state.phase] ?? null;
});

const join = async () => {
    actionMessage.value = null;
    try {
        await trpc.tournament.join.mutate();
        actionMessage.value = '참가 신청이 반영되었습니다.';
    } catch (value) {
        actionMessage.value = errorText(value);
    } finally {
        await load();
    }
};

const cancel = async () => {
    try {
        await trpc.tournament.cancel.mutate();
        actionMessage.value = '토너먼트가 중단되었습니다.';
        await load();
    } catch (value) {
        actionMessage.value = errorText(value);
    }
};

const start = async () => {
    const now = new Date();
    try {
        await trpc.tournament.setState.mutate({
            stage: 1,
            phase: 0,
            type: 0,
            auto: true,
            openYear: snapshot.value?.state?.openYear ?? now.getUTCFullYear(),
            openMonth: snapshot.value?.state?.openMonth ?? now.getUTCMonth() + 1,
            termSeconds: snapshot.value?.state?.termSeconds ?? 60,
            nextAt: new Date(Date.now() + 60_000).toISOString(),
            bettingSettled: false,
            rewardSettled: false,
        });
        actionMessage.value = '토너먼트를 개최했습니다.';
        await load();
    } catch (value) {
        actionMessage.value = errorText(value);
    }
};
</script>

<template>
    <main id="tournament-container" class="legacy-page">
        <section class="legacy-title bg0">
            <div>삼모전 토너먼트</div>
            <RouterLink class="close-button" to="/">창 닫기</RouterLink>
        </section>

        <section class="toolbar bg0">
            <button type="button" @click="load">갱신</button>
            <button
                v-if="snapshot?.state?.stage === 1 && !isParticipant"
                type="button"
                class="join-button"
                @click="join"
            >
                참가
            </button>
            <span v-if="loading">불러오는 중...</span>
            <span v-if="actionMessage" role="status">{{ actionMessage }}</span>
        </section>

        <section v-if="error" class="error-row bg0" role="alert">{{ error }}</section>
        <section class="operator-row bg0">운영자 메세지 : <span></span></section>
        <section class="state-row bg0">
            <span class="type">{{ typeNames[snapshot?.state?.type ?? 0] }}</span>
            ({{ stageNames[snapshot?.state?.stage ?? 0] ?? '상태 확인 중' }},
            {{ snapshot?.state?.termSeconds ?? '-' }}초 간격)
        </section>
        <section class="section-title bg2">16강 승자전</section>

        <section class="bracket bg0" aria-label="토너먼트 대진표">
            <div class="round champion">
                <span>{{ champion }}</span>
            </div>
            <div class="connector">┻</div>
            <div class="round final">
                <span v-for="(name, index) in finalists" :key="index">{{ name }}</span>
            </div>
            <div class="connector">┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓</div>
            <div class="round semi">
                <span v-for="(name, index) in semiFinalists" :key="index">{{ name }}</span>
            </div>
            <div class="connector">┏━━━━━━━━━━┻━━━━━━━━━━┓&emsp;┏━━━━━━━━━━┻━━━━━━━━━━┓</div>
            <div class="round quarter">
                <span v-for="(name, index) in quarterFinalists" :key="index">{{ name }}</span>
            </div>
            <div class="connector">┏━━━━┻━━━━┓&emsp;┏━━━━┻━━━━┓&emsp;┏━━━━┻━━━━┓&emsp;┏━━━━┻━━━━┓</div>
            <div class="round top16">
                <span v-for="(name, index) in top16" :key="index">{{ name }}</span>
            </div>
            <div class="round odds">
                <span v-for="(matchName, index) in top16" :key="index" :data-candidate="matchName">
                    {{ odds(matchesAt(7).flatMap((match) => [match.attackerId, match.defenderId])[index]) }}
                </span>
            </div>
            <p>배당률이 낮을수록 베팅된 금액이 많고 유저들이 우승후보로 많이 선택한 장수입니다.</p>
        </section>

        <section v-if="currentMatch" class="fight bg0">
            <h2>{{ nameOf(currentMatch.attackerId) }} vs {{ nameOf(currentMatch.defenderId) }}</h2>
            <p v-for="(line, index) in currentMatch.log ?? []" :key="index">{{ line }}</p>
        </section>

        <section class="section-title groups-title bg2">조별 본선 순위</section>
        <section class="group-grid bg0">
            <table v-for="(group, groupIndex) in groups" :key="groupIndex">
                <caption>
                    {{
                        ['一', '二', '三', '四', '五', '六', '七', '八'][groupIndex]
                    }}조
                </caption>
                <thead>
                    <tr>
                        <th>순</th>
                        <th>장수</th>
                        <th>경</th>
                        <th>승</th>
                        <th>무</th>
                        <th>패</th>
                        <th>점</th>
                        <th>득</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="rowIndex in 4" :key="rowIndex">
                        <td>{{ rowIndex }}</td>
                        <td>{{ group[rowIndex - 1]?.name ?? '' }}</td>
                        <td>
                            {{
                                group[rowIndex - 1]
                                    ? (group[rowIndex - 1]!.win ?? 0) +
                                      (group[rowIndex - 1]!.draw ?? 0) +
                                      (group[rowIndex - 1]!.lose ?? 0)
                                    : ''
                            }}
                        </td>
                        <td>{{ group[rowIndex - 1]?.win ?? '' }}</td>
                        <td>{{ group[rowIndex - 1]?.draw ?? '' }}</td>
                        <td>{{ group[rowIndex - 1]?.lose ?? '' }}</td>
                        <td>
                            {{
                                group[rowIndex - 1]
                                    ? (group[rowIndex - 1]!.win ?? 0) * 3 + (group[rowIndex - 1]!.draw ?? 0)
                                    : ''
                            }}
                        </td>
                        <td>{{ group[rowIndex - 1]?.gl ?? '' }}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section v-if="adminEnabled" class="admin-row bg0">
            <strong>관리자 메뉴</strong>
            <button type="button" @click="start">개최</button>
            <button type="button" @click="cancel">중단</button>
        </section>
    </main>
</template>

<style scoped>
.legacy-page {
    width: 2009px;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
    text-align: center;
}
.legacy-page,
.legacy-page * {
    box-sizing: border-box;
}
.bg0 {
    background: #3a2118 var(--sammo-texture-walnut);
}
.bg2 {
    background: #142b42 var(--sammo-texture-blue);
}
.legacy-title {
    height: 55.6875px;
    padding: 0;
    font-size: 14px;
    line-height: 19.1875px;
}
.close-button {
    display: block;
    width: 62px;
    height: 35.5px;
    padding: 8px 12px;
    border: 1px solid #375a7f;
    border-radius: 5.25px;
    background: #375a7f;
    color: #fff;
    font-size: 14px;
    line-height: 18px;
    text-decoration: none;
}
.toolbar {
    min-height: 36.5px;
    padding: 1px;
}
.operator-row,
.state-row,
.error-row,
.admin-row {
    min-height: 32px;
    padding: 5px;
}
button {
    height: 35.5px;
    margin: 0 2px;
    border: 1px solid #666;
    border-radius: 5.25px;
    background: #444;
    color: #fff;
    cursor: pointer;
}
button:hover,
button:focus {
    filter: brightness(1.25);
}
.close-button:hover,
.close-button:focus {
    filter: brightness(1.2);
}
button:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}
.join-button {
    background: #8a5b13;
}
.operator-row span {
    color: orange;
    font-size: 24px;
}
.state-row {
    font-size: 24px;
}
.state-row .type {
    color: cyan;
}
.section-title {
    min-height: 38px;
    padding: 5px;
    color: magenta;
    font-size: 24px;
}
.bracket {
    padding: 10px 0;
}
.round {
    display: grid;
    align-items: center;
    min-height: 24px;
}
.champion {
    grid-template-columns: 1fr;
}
.final {
    grid-template-columns: repeat(2, 1fr);
}
.semi {
    grid-template-columns: repeat(4, 1fr);
}
.quarter {
    grid-template-columns: repeat(8, 1fr);
}
.top16,
.odds {
    grid-template-columns: repeat(16, 125px);
}
.connector {
    min-height: 24px;
    white-space: pre;
    color: #fff;
}
.odds {
    color: skyblue;
}
.bracket p {
    color: skyblue;
    font-size: 18px;
}
.fight {
    padding: 8px;
    text-align: left;
}
.fight h2 {
    margin: 0;
    text-align: center;
    color: orange;
    font-size: 18px;
}
.fight p {
    margin: 2px 10px;
}
.groups-title {
    color: orange;
}
.group-grid {
    display: grid;
    grid-template-columns: repeat(8, 250px);
    align-items: start;
}
table {
    width: 250px;
    border-collapse: collapse;
    table-layout: auto;
}
caption {
    padding: 3px;
    background: #000;
    color: #fff;
}
th {
    background: #154b2a var(--sammo-texture-green);
    font-weight: 400;
}
th,
td {
    height: 22px;
    border: 1px solid #555;
    padding: 1px 3px;
}
.admin-row {
    text-align: left;
}
.error-row {
    color: #ff8080;
}
</style>
