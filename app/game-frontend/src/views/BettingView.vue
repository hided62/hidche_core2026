<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { storeToRefs } from 'pinia';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import TournamentBracket from '../components/tournament/TournamentBracket.vue';
import TournamentPageHeader from '../components/tournament/TournamentPageHeader.vue';
import GeneralIdentity from '../components/ui/GeneralIdentity.vue';
import { useGameFeedback } from '../composables/useGameFeedback';
import { useTournamentPagesStore } from '../stores/tournamentPages';
import type { TournamentBracketSlot } from '../utils/tournamentBracket';
import { trpc } from '../utils/trpc';

const tournamentPages = useTournamentPagesStore();
const { snapshot, betting: summary, rankings, loading, error } = storeToRefs(tournamentPages);
const amounts = ref<Record<number, number>>({});
const selectedTarget = ref<TournamentBracketSlot | null>(null);
const betDialog = ref<HTMLDialogElement | null>(null);
const betAmountSelect = ref<HTMLSelectElement | null>(null);
const placingBet = ref(false);
const betError = ref<string | null>(null);
const activeRankingPrefix = ref('tt');
const { success: showSuccessToast } = useGameFeedback();
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
const load = () => tournamentPages.loadBettingPage();
onMounted(() => {
    tournamentPages.startRealtime();
    void load();
});
onUnmounted(() => tournamentPages.stopRealtime());

const totalAmount = computed(() => summary.value?.totalAmount ?? 0);
const myAmount = computed(() => summary.value?.myAmount ?? 0);
const betTotals = computed(() => summary.value?.totals as Record<number, number> | undefined);
const myBetTotals = computed(() => summary.value?.myTotals as Record<number, number> | undefined);
const ratio = (id: number) => {
    const totals = summary.value?.totals as Record<number, number> | undefined;
    const amount = totals?.[id] ?? 0;
    return amount ? (totalAmount.value / amount).toFixed(2) : '0';
};
const openingTime = computed(() =>
    formatServerDateTime(snapshot.value?.state?.nextAt, { format: 'hourMinute', fallback: '--:--' })
);
const selectedAmount = computed({
    get: () => {
        const targetId = selectedTarget.value?.id;
        return targetId === null || targetId === undefined ? 10 : (amounts.value[targetId] ?? 10);
    },
    set: (amount: number) => {
        const targetId = selectedTarget.value?.id;
        if (targetId === null || targetId === undefined) return;
        amounts.value[targetId] = amount;
    },
});
const selectedRatio = computed(() => {
    const targetId = selectedTarget.value?.id;
    return targetId === null || targetId === undefined ? '0' : ratio(targetId);
});
const selectedExpectedReturn = computed(() => {
    const numericRatio = Number(selectedRatio.value);
    return Number.isFinite(numericRatio) ? Math.round(selectedAmount.value * numericRatio) : 0;
});
const bettingOpen = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage !== 6) return false;
    if (!state.bettingCloseAt) return true;
    return new Date(state.bettingCloseAt).getTime() > Date.now();
});

const openBetDialog = async (target: TournamentBracketSlot) => {
    if (target.id === null || !bettingOpen.value) return;
    selectedTarget.value = target;
    betError.value = null;
    if (amounts.value[target.id] === undefined) amounts.value[target.id] = 10;
    await nextTick();
    betDialog.value?.showModal();
    betAmountSelect.value?.focus();
};
const closeBetDialog = () => {
    betDialog.value?.close();
};
const placeBet = async () => {
    const targetId = selectedTarget.value?.id;
    if (targetId === null || targetId === undefined || placingBet.value) return;
    const amount = selectedAmount.value;
    betError.value = null;
    placingBet.value = true;
    try {
        await trpc.tournament.placeBet.mutate({ targetId, amount });
        showSuccessToast('베팅이 등록되었습니다.');
        await load();
        closeBetDialog();
    } catch (value) {
        betError.value = errorText(value);
    } finally {
        placingBet.value = false;
    }
};
</script>

<template>
    <main id="tournament-betting-container" class="betting-page">
        <TournamentPageHeader class="bg0" active-page="betting" title="베 팅 장" />
        <section class="toolbar bg0">
            <button
                class="legacy-button legacy-button--secondary legacy-button--fixed-height"
                type="button"
                @click="load"
            >
                갱신
            </button>
            <span v-if="loading">불러오는 중...</span>
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
            :my-bet-totals="myBetTotals"
            :total-bet="totalAmount"
            :tournament-type="snapshot?.state?.type ?? 0"
            :show-legend="false"
            :betting-open="bettingOpen"
            @request-bet="openBetDialog"
        />

        <dialog
            ref="betDialog"
            class="bet-dialog viewport-centered-dialog"
            aria-labelledby="bet-dialog-title"
            @close="selectedTarget = null"
        >
            <form v-if="selectedTarget" class="bet-dialog-content" @submit.prevent="placeBet">
                <header>
                    <h2 id="bet-dialog-title">베팅하기</h2>
                    <button type="button" aria-label="베팅 창 닫기" :disabled="placingBet" @click="closeBetDialog">
                        ×
                    </button>
                </header>
                <GeneralIdentity
                    :name="selectedTarget.name"
                    :picture="selectedTarget.picture"
                    :image-server="selectedTarget.imageServer"
                />
                <label class="bet-amount-field">
                    <span>베팅 금액</span>
                    <select ref="betAmountSelect" v-model.number="selectedAmount" :disabled="placingBet">
                        <option :value="10">금10</option>
                        <option :value="20">금20</option>
                        <option :value="50">금50</option>
                        <option :value="100">금100</option>
                        <option :value="200">금200</option>
                        <option :value="500">금500</option>
                        <option :value="1000">최대 금1000</option>
                    </select>
                </label>
                <output class="bet-return-preview" aria-live="polite">
                    <span class="ratio-color">배당 {{ selectedRatio }}</span>
                    <span aria-hidden="true">×</span>
                    <span class="gold-color">금{{ selectedAmount }}</span>
                    <span aria-hidden="true">=</span>
                    <strong class="return-color"
                        >예상 환수금 {{ selectedExpectedReturn.toLocaleString('ko-KR') }}</strong
                    >
                </output>
                <p class="bet-preview-note">
                    현재 배당 기준 예상값이며, 베팅 상황에 따라 최종 배당은 달라질 수 있습니다.
                </p>
                <p v-if="betError" class="bet-dialog-error" role="alert">{{ betError }}</p>
                <footer>
                    <button type="button" :disabled="placingBet" @click="closeBetDialog">취소</button>
                    <button type="submit" class="bet-submit" :disabled="placingBet">
                        {{ placingBet ? '등록 중...' : '베팅 등록' }}
                    </button>
                </footer>
            </form>
        </dialog>

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
        <div class="ranking-tabs bg0" role="tablist" aria-label="토너먼트 랭킹 종목 선택">
            <button
                v-for="section in rankings"
                :key="`ranking-tab-${section.prefix}`"
                type="button"
                role="tab"
                :aria-selected="activeRankingPrefix === section.prefix"
                :class="{ active: activeRankingPrefix === section.prefix }"
                @click="activeRankingPrefix = section.prefix"
            >
                {{ section.title.replaceAll(' ', '') }}
            </button>
        </div>
        <section class="ranking-grid bg0">
            <table
                v-for="section in rankings"
                :key="section.prefix"
                class="ranking-table"
                :class="{ 'mobile-active': activeRankingPrefix === section.prefix }"
            >
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
                        <td class="ranking-general">
                            <GeneralIdentity
                                :name="entry.name"
                                :picture="entry.picture"
                                :image-server="entry.imageServer"
                            />
                        </td>
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
                <button class="legacy-button legacy-button--navigation close-button" type="button" @click="navigate">
                    창 닫기
                </button>
            </RouterLink>
            <small>
                삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD(hided62@gmail.com) / Credit
            </small>
        </footer>
    </main>
</template>

<style scoped>
.betting-page {
    width: 100%;
    max-width: 1200px;
    min-width: 0;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
    text-align: center;
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
.toolbar {
    min-height: 46px;
    padding: 1px;
    text-align: left;
}
.toolbar button {
    --legacy-button-height: 44px;
    min-width: 72px;
    padding: 10px 16px;
    font-size: 14px;
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
select {
    width: 100%;
    min-height: 27px;
    padding: 2px 1px;
    border: 1px solid #555;
    background: #000;
    color: #fff;
}
button:not(.legacy-button) {
    height: 35.5px;
    color: #fff;
    background: #444;
    border: 1px solid #666;
    border-radius: 5.25px;
    cursor: pointer;
}
button:not(.legacy-button):hover,
button:not(.legacy-button):focus {
    filter: brightness(1.25);
}
button:not(.legacy-button):focus-visible,
select:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}
button:not(.legacy-button):disabled,
select:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.bet-dialog {
    width: min(420px, calc(100vw - 24px));
    max-width: none;
    padding: 0;
    border: 1px solid #8d713d;
    border-radius: 8px;
    color: #fff;
    background: #3a2118 var(--sammo-texture-walnut);
    box-shadow: 0 18px 56px rgb(0 0 0 / 75%);
}
.bet-dialog::backdrop {
    background: rgb(0 0 0 / 72%);
}
.bet-dialog-content {
    display: grid;
    gap: 14px;
    padding: 16px;
}
.bet-dialog-content header,
.bet-dialog-content footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.bet-dialog-content h2 {
    margin: 0;
    color: #ffd25e;
    font-size: 20px;
}
.bet-dialog-content header button {
    width: 36px;
    height: 36px;
    padding: 0;
    font-size: 22px;
}
.bet-dialog-content :deep(.general-identity) {
    justify-content: flex-start;
    text-align: left;
}
.bet-amount-field {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    text-align: left;
}
.bet-return-preview {
    display: grid;
    grid-template-columns: auto auto auto auto minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    padding: 12px;
    border: 1px solid #66563c;
    background: rgb(0 0 0 / 28%);
    font-variant-numeric: tabular-nums;
}
.bet-preview-note,
.bet-dialog-error {
    margin: 0;
    text-align: left;
    font-size: 12px;
}
.bet-preview-note {
    color: #c9c1b2;
}
.bet-dialog-error {
    color: #ff8080;
}
.bet-dialog-content footer {
    justify-content: flex-end;
}
.bet-dialog-content footer button {
    min-width: 80px;
}
.bet-dialog-content .bet-submit {
    border-color: #9a7632;
    background: #59400e;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: 8px;
    padding: 8px;
}
.ranking-table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    line-height: 14px;
}
.ranking-table th,
.ranking-table td {
    height: 28px;
    padding: 1px;
    border: 1px solid #555;
}
.ranking-table tbody tr:has(.general-identity) td {
    height: 66px;
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
.ranking-table th:nth-child(2),
.ranking-table td:nth-child(2) {
    width: 130px;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ranking-general {
    text-align: left;
}
.ranking-tabs {
    display: none;
}
.guide {
    padding: 10px;
    text-align: left;
}
.error {
    color: #ff8080;
}
@media (max-width: 800px) {
    .betting-page {
        max-width: 100%;
        font-size: 13px;
    }
    .state {
        font-size: 18px;
    }
    .section-title,
    .ranking-title {
        font-size: 20px;
    }
    .bet-return-preview {
        grid-template-columns: auto auto auto;
    }
    .bet-return-preview .return-color {
        grid-column: 1 / -1;
    }
    .ranking-placeholder {
        display: none;
    }
    .ranking-tabs {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 5px;
        padding: 8px;
    }
    .ranking-tabs button {
        height: 36px;
        margin: 0;
        border-radius: 3px;
    }
    .ranking-tabs button.active {
        border-color: #f39c12;
        background: #8a5b13;
    }
    .ranking-grid {
        display: block;
        overflow-x: auto;
        padding: 0;
    }
    .ranking-table {
        display: none;
        min-width: 390px;
        font-size: 11px;
    }
    .ranking-table.mobile-active {
        display: table;
    }
    .ranking-table th:nth-child(2),
    .ranking-table td:nth-child(2) {
        width: 112px;
        max-width: 112px;
    }
    .guide,
    .betting-footer {
        padding: 10px;
    }
    .betting-footer small {
        white-space: normal;
    }
}
</style>
