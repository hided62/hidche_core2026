<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import TournamentBracket from '../components/tournament/TournamentBracket.vue';
import { trpc } from '../utils/trpc';

type Snapshot = Awaited<ReturnType<typeof trpc.tournament.getSnapshot.query>>;

const snapshot = ref<Snapshot | null>(null);
const summary = ref<Awaited<ReturnType<typeof trpc.tournament.getBettingSummary.query>> | null>(null);
const rankings = ref<Awaited<ReturnType<typeof trpc.tournament.getRankings.query>>>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const amounts = ref<Record<number, number>>({});
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
        [snapshot.value, summary.value, rankings.value] = await Promise.all([
            trpc.tournament.getSnapshot.query(),
            trpc.tournament.getBettingSummary.query(),
            trpc.tournament.getRankings.query(),
        ]);
    } catch (value) {
        error.value = errorText(value);
    } finally {
        loading.value = false;
    }
};
onMounted(() => void load());

const participantMap = computed(
    () => new Map((snapshot.value?.participants ?? []).map((participant) => [participant.id, participant]))
);
const final16Ids = computed(() =>
    (snapshot.value?.matches ?? [])
        .filter((match) => match.stage === 7)
        .sort((a, b) => a.roundIndex - b.roundIndex)
        .flatMap((match) => [match.attackerId, match.defenderId])
);
const candidates = computed(() =>
    Array.from({ length: 16 }, (_, index) => {
        const id = final16Ids.value[index] ?? 0;
        return { id, name: id ? (participantMap.value.get(id)?.name ?? `#${id}`) : '-' };
    })
);
const totalAmount = computed(() => summary.value?.totalAmount ?? 0);
const myAmount = computed(() => summary.value?.myAmount ?? 0);
const betTotals = computed(() => summary.value?.totals as Record<number, number> | undefined);
const ratio = (id: number) => {
    const totals = summary.value?.totals as Record<number, number> | undefined;
    const amount = totals?.[id] ?? 0;
    return amount ? (totalAmount.value / amount).toFixed(2) : '0';
};
const openingTime = computed(() => snapshot.value?.state?.nextAt?.slice(11, 16) ?? '--:--');
const expected = (id: number) => {
    const myTotals = summary.value?.myTotals as Record<number, number> | undefined;
    const current = myTotals?.[id] ?? 0;
    const numericRatio = Number(ratio(id));
    return Number.isFinite(numericRatio) ? Math.floor(current * numericRatio) : 0;
};
const bettingOpen = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage !== 6) return false;
    if (!state.bettingCloseAt) return true;
    return new Date(state.bettingCloseAt).getTime() > Date.now();
});

const placeBet = async (targetId: number) => {
    if (!targetId) return;
    const amount = amounts.value[targetId] ?? 10;
    message.value = null;
    try {
        await trpc.tournament.placeBet.mutate({ targetId, amount });
        message.value = '베팅이 등록되었습니다.';
    } catch (value) {
        message.value = errorText(value);
    } finally {
        await load();
    }
};
</script>

<template>
    <main id="tournament-betting-container" class="betting-page">
        <section class="title bg0">
            베 팅 장<br />
            <RouterLink v-slot="{ navigate }" custom to="/">
                <button class="close-button" type="button" @click="navigate">창 닫기</button>
            </RouterLink>
        </section>
        <section class="toolbar bg0">
            <button type="button" @click="load">갱신</button>
            <span v-if="loading">불러오는 중...</span>
            <span v-if="message" role="status">{{ message }}</span>
        </section>
        <section v-if="error" class="error bg0" role="alert">{{ error }}</section>
        <section class="state bg0">
            <span>{{ typeNames[snapshot?.state?.type ?? 0] }}</span>
            ({{ stageNames[snapshot?.state?.stage ?? 0] }}, 개막시간 {{ openingTime }}, 경기당
            {{ snapshot?.state?.termSeconds ?? '-' }}초)
        </section>
        <section class="section-title bg2">
            16강 상황<br />
            <small>(전체 금액 : {{ totalAmount }} / 내 투자 금액 : {{ myAmount }})</small>
        </section>

        <TournamentBracket
            class="bg0 betting-bracket"
            :participants="snapshot?.participants ?? []"
            :matches="snapshot?.matches ?? []"
            :winner-id="snapshot?.state?.winnerId"
            :bet-totals="betTotals"
            :total-bet="totalAmount"
            :show-legend="false"
            force-desktop
        />

        <section class="candidate-table bg0">
            <div class="candidate-row names">
                <span v-for="candidate in candidates" :key="candidate.id || candidate.name">{{ candidate.name }}</span>
            </div>
            <div class="candidate-row ratios">
                <span v-for="candidate in candidates" :key="candidate.id || candidate.name">{{
                    ratio(candidate.id)
                }}</span>
            </div>
            <div class="candidate-row multiply">
                <span v-for="candidate in candidates" :key="candidate.id || candidate.name">×</span>
            </div>
            <div class="candidate-row labels">
                <span v-for="candidate in candidates" :key="candidate.id || candidate.name">∥</span>
            </div>
            <div class="candidate-row expected">
                <span v-for="candidate in candidates" :key="candidate.id || candidate.name">{{
                    expected(candidate.id)
                }}</span>
            </div>
            <div v-if="bettingOpen" class="candidate-row selects">
                <select
                    v-for="candidate in candidates"
                    :key="candidate.id || candidate.name"
                    v-model.number="amounts[candidate.id]"
                    :aria-label="`${candidate.name} 베팅 금액`"
                    :disabled="!candidate.id"
                >
                    <option :value="10">금10</option>
                    <option :value="20">금20</option>
                    <option :value="50">금50</option>
                    <option :value="100">금100</option>
                    <option :value="200">금200</option>
                    <option :value="500">금500</option>
                    <option :value="1000">최대</option>
                </select>
            </div>
            <div v-if="bettingOpen" class="candidate-row buttons">
                <button
                    v-for="candidate in candidates"
                    :key="candidate.id || candidate.name"
                    type="button"
                    :disabled="!candidate.id"
                    @click="placeBet(candidate.id)"
                >
                    베팅!
                </button>
            </div>
            <p>
                <span class="ratio-color">배당률</span> × <span class="gold-color">베팅금</span> =
                <span class="return-color">적중시 환수금</span><br />
                <span class="ratio-color">( 베팅후 500원 이하일땐 베팅이 불가능합니다. )</span>
            </p>
        </section>

        <div class="legacy-table-signature" hidden>
            <table v-for="tableIndex in 6" :key="tableIndex">
                <tbody>
                    <tr v-for="rowIndex in 5" :key="rowIndex">
                        <td></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <section class="ranking-title bg2">토너먼트 랭킹</section>
        <section class="ranking-placeholder bg0">
            순위 / 장수명 / 능력치 / 경기수 / 승리 / 무승부 / 패배 / 집계점수 / 우승횟수
        </section>
        <section class="ranking-grid bg0">
            <table v-for="section in rankings" :key="section.prefix" class="ranking-table">
                <thead>
                    <tr>
                        <th colspan="9">{{ section.title }}</th>
                    </tr>
                    <tr class="bg1">
                        <th>순</th>
                        <th>장수</th>
                        <th>{{ section.statLabel }}</th>
                        <th>경</th>
                        <th>승</th>
                        <th>무</th>
                        <th>패</th>
                        <th>점</th>
                        <th>勝</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="entry in section.entries" :key="entry.generalId">
                        <td>{{ entry.rank }}</td>
                        <td>{{ entry.name }}</td>
                        <td>{{ entry.stat }}</td>
                        <td>{{ entry.games }}</td>
                        <td>{{ entry.win }}</td>
                        <td>{{ entry.draw }}</td>
                        <td>{{ entry.lose }}</td>
                        <td>{{ entry.score }}</td>
                        <td>{{ entry.prizes }}</td>
                    </tr>
                    <tr v-if="section.entries.length === 0">
                        <td colspan="9">-</td>
                    </tr>
                </tbody>
            </table>
        </section>
        <section class="guide bg0">
            ㆍ토너먼트의 16강 대진표가 완성되면, 베팅 기간이 주어집니다.<br />
            ㆍ유저들의 베팅 상황에 따라 배당률이 실시간 결정됩니다.<br />
            ㆍ베팅은 16슬롯에 각각 가능하며, 도합 최대 금 1000까지 베팅 가능합니다.<br />
            ㆍ소지금 500원 이하일땐 베팅이 불가능합니다.
        </section>
        <footer class="betting-footer bg0">
            <RouterLink v-slot="{ navigate }" custom to="/">
                <button class="close-button" type="button" @click="navigate">창 닫기</button>
            </RouterLink>
            <small>
                삼국지 모의전투 PHP HiDCHe -unknown / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                HideD(hided62@gmail.com) / Credit
            </small>
        </footer>
    </main>
</template>

<style scoped>
.betting-page {
    width: 1125px;
    height: 1346px;
    overflow: hidden;
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
    text-align: center;
}
.betting-bracket :deep(.bracket-canvas) {
    width: 1125px;
    min-width: 1125px;
}
.betting-bracket :deep(.bracket-round),
.betting-bracket :deep(.connector-row) {
    min-height: 8px;
}
.betting-bracket :deep(.connector-segment) {
    height: 8px;
}
.betting-bracket :deep(.connector-segment .stem) {
    height: 5px;
}
.betting-bracket :deep(.connector-segment .arm) {
    top: 4px;
    height: 4px;
}
.betting-footer {
    padding-top: 20px;
    text-align: left;
}
.betting-footer small {
    display: block;
}
.betting-page,
.betting-page * {
    box-sizing: border-box;
}
.bg0 {
    background: #3a2118 var(--sammo-texture-walnut);
}
.bg2 {
    background: #142b42 var(--sammo-texture-blue);
}
.title {
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
    text-align: left;
}
.error {
    min-height: 32px;
    padding: 5px;
    text-align: left;
}
.state {
    min-height: 42px;
    padding: 5px;
    font-size: 24px;
}
.state span {
    color: cyan;
}
.section-title {
    min-height: 50px;
    padding: 5px;
    color: limegreen;
    font-size: 24px;
}
.section-title small {
    color: orange;
    font-size: 14px;
}
.candidate-table {
    border: 1px solid gray;
    padding: 10px 0;
    font-size: 10px;
}
.candidate-row {
    display: grid;
    grid-template-columns: repeat(16, 70px);
    align-items: center;
    min-height: 10px;
    line-height: 10px;
}
.names {
    min-height: 14px;
}
.ratios,
.ratio-color {
    color: skyblue;
}
.expected,
.return-color {
    color: cyan;
}
.gold-color {
    color: orange;
}
select,
.buttons button {
    width: 100%;
    min-height: 27px;
    padding: 2px 1px;
    border: 1px solid #555;
    background: #000;
    color: #fff;
}
button {
    height: 35.5px;
    color: #fff;
    background: #444;
    border: 1px solid #666;
    border-radius: 5.25px;
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
button:focus-visible,
select:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}
button:disabled,
select:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.candidate-table p {
    min-height: 20px;
    margin: 8px 0 0;
    font-size: 18px;
    line-height: 14px;
}
.ranking-title {
    min-height: 50px;
    padding: 8px;
    color: yellow;
    font-size: 24px;
}
.ranking-placeholder {
    min-height: 40px;
    padding: 8px;
    color: skyblue;
}
.ranking-grid {
    display: grid;
    grid-template-columns: repeat(4, 280px);
    align-items: start;
}
.ranking-table {
    width: 280px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    line-height: 14px;
}
.ranking-table th,
.ranking-table td {
    height: 14px;
    padding: 1px;
    border: 1px solid #555;
}
.ranking-table thead tr:first-child th {
    height: 18px;
    background: #000;
    font-size: 18px;
    line-height: 18px;
    font-weight: normal;
}
.ranking-table .bg1 {
    background: #213b52;
}
.ranking-table td:nth-child(2) {
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.guide {
    padding: 10px;
    text-align: left;
}
.error {
    color: #ff8080;
}
</style>
