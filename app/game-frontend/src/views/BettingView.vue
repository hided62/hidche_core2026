<script setup lang="ts">
import { useClockDisplay } from '../composables/useClockDisplay';
const { formatTime: formatGameTime } = useClockDisplay();
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import TournamentBracket from '../components/tournament/TournamentBracket.vue';
import TournamentPageHeader from '../components/tournament/TournamentPageHeader.vue';
import GeneralIdentity from '../components/ui/GeneralIdentity.vue';
import { useTournamentPagesStore } from '../stores/tournamentPages';
import type { TournamentBracketSlot } from '../utils/tournamentBracket';
import { trpc } from '../utils/trpc';

const tournamentPages = useTournamentPagesStore();
const { snapshot, betting: summary, rankings, loading, error } = storeToRefs(tournamentPages);
const defaultAmount = ref<number | string>(10);
const amounts = ref<Record<number, number | string>>({});
const pendingBets = ref<Record<number, number>>({});
const betMessages = ref<Record<number, { text: string; error: boolean }>>({});
const presetAmounts = [10, 20, 50, 100, 200, 500, 1000];
const activeRankingPrefix = ref('tt');
const amountFor = (id: number): number | string => amounts.value[id] ?? defaultAmount.value;
const remainingAmount = computed(() => Math.max(0, 1000 - myAmount.value));
const availableAmount = computed(() =>
    Math.max(0, remainingAmount.value - Object.values(pendingBets.value).reduce((sum, amount) => sum + amount, 0))
);
const validAmount = (amount: number | string): boolean =>
    typeof amount === 'number' && Number.isInteger(amount) && amount >= 10 && amount <= availableAmount.value;
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
const openingTime = computed(() =>
    formatGameTime(snapshot.value?.state?.nextAt, { format: 'hourMinute', fallback: '--:--' })
);
const bettingOpen = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage !== 6) return false;
    if (!state.bettingCloseAt) return true;
    return new Date(state.bettingCloseAt).getTime() > Date.now();
});

const placeBet = async (target: TournamentBracketSlot) => {
    const targetId = target.id;
    if (targetId === null || pendingBets.value[targetId] || !bettingOpen.value) return;
    const amount = amountFor(targetId);
    if (!validAmount(amount) || typeof amount !== 'number') return;
    delete betMessages.value[targetId];
    pendingBets.value[targetId] = amount;
    try {
        await trpc.tournament.placeBet.mutate({ targetId, amount });
        betMessages.value[targetId] = { text: `${amount.toLocaleString('ko-KR')}금 베팅 완료`, error: false };
        await load();
    } catch (value) {
        betMessages.value[targetId] = { text: errorText(value), error: true };
    } finally {
        delete pendingBets.value[targetId];
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

        <section class="bet-settings bg0" aria-label="베팅 금액 설정">
            <label
                >기본 금액
                <input v-model.number="defaultAmount" type="number" min="10" max="1000" step="1" inputmode="numeric" />
            </label>
            <select v-model.number="defaultAmount" aria-label="기본 지정 금액">
                <option v-if="!presetAmounts.includes(Number(defaultAmount))" :value="defaultAmount">직접 입력</option>
                <option v-for="amount in presetAmounts" :key="amount" :value="amount">{{ amount }}금</option>
            </select>
            <span>남은 한도 {{ remainingAmount.toLocaleString('ko-KR') }}금</span>
            <small
                >각 장수에게 추가할 금액입니다. 예상 환수금은 해당 장수 우승 시 금액이며, 최종 배당에 따라
                달라집니다.</small
            >
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
            :betting-mode="true"
        >
            <template #bet-controls="{ candidate: slot }">
                <form v-if="slot.id !== null" class="inline-bet" @submit.prevent="placeBet(slot)">
                    <input
                        :value="amountFor(slot.id)"
                        type="number"
                        min="10"
                        :max="remainingAmount"
                        step="1"
                        inputmode="numeric"
                        :aria-label="`${slot.name} 베팅 금액`"
                        :disabled="Boolean(pendingBets[slot.id])"
                        @input="
                            amounts[slot.id] =
                                ($event.target as HTMLInputElement).value === ''
                                    ? ''
                                    : Number(($event.target as HTMLInputElement).value)
                        "
                    />
                    <select
                        :value="presetAmounts.includes(Number(amountFor(slot.id))) ? amountFor(slot.id) : ''"
                        :aria-label="`${slot.name} 지정 금액`"
                        :disabled="Boolean(pendingBets[slot.id])"
                        @change="amounts[slot.id] = Number(($event.target as HTMLSelectElement).value)"
                    >
                        <option value="" disabled>직접 입력</option>
                        <option
                            v-for="amount in presetAmounts"
                            :key="amount"
                            :value="amount"
                            :disabled="amount > availableAmount"
                        >
                            {{ amount }}금
                        </option>
                    </select>
                    <button
                        type="submit"
                        class="bracket-bet-button"
                        :aria-label="`${slot.name}에게 베팅하기`"
                        :disabled="Boolean(pendingBets[slot.id]) || !validAmount(amountFor(slot.id))"
                    >
                        {{ pendingBets[slot.id] ? '등록 중' : '베팅' }}
                    </button>
                    <small class="bet-message" :class="{ 'bet-error': betMessages[slot.id]?.error }" role="status">
                        {{
                            betMessages[slot.id]?.text ??
                            (!validAmount(amountFor(slot.id)) && !pendingBets[slot.id]
                                ? availableAmount < 10
                                    ? '베팅 한도 부족'
                                    : `10~${availableAmount}금 입력`
                                : '')
                        }}
                    </small>
                </form>
            </template>
        </TournamentBracket>

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
                                :npc-state="entry.npcState"
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
.bet-settings {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px;
    text-align: left;
}
.bet-settings label {
    display: flex;
    align-items: center;
    gap: 8px;
}
.bet-settings input,
.bet-settings select {
    width: 90px;
}
.bet-settings small {
    flex-basis: 100%;
    color: #c9c1b2;
}
.inline-bet {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 80px 64px;
    gap: 4px;
    width: 100%;
}
.inline-bet input,
.inline-bet select,
.inline-bet button,
.bet-settings input,
.bet-settings select {
    box-sizing: border-box;
    min-width: 0;
    height: 44px;
    margin: 0;
    padding: 4px;
    border: 1px solid #8d713d;
    border-radius: 3px;
    color: #fff;
    background: #201610;
    font-size: 16px;
}
.inline-bet .bracket-bet-button {
    background: #59400e;
    font-weight: 700;
}
.inline-bet input:focus-visible,
.bet-settings input:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}
.bet-message {
    grid-column: 1 / -1;
    min-height: 16px;
    font-size: 11px;
    line-height: 16px;
    color: #b8e6ac;
    overflow-wrap: anywhere;
}
.bet-message.bet-error {
    color: #ff9e9e;
}
@media (max-width: 1100px) {
    .inline-bet {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .inline-bet .bracket-bet-button {
        grid-column: 1 / -1;
    }
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
