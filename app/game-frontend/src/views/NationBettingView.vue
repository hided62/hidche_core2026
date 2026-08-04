<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { trpc } from '../utils/trpc';

type BettingListItem = {
    id: number;
    type: string;
    name: string;
    finished: boolean;
    selectCnt: number;
    isExclusive: boolean | null;
    reqInheritancePoint: boolean;
    openYearMonth: number;
    closeYearMonth: number;
    winner: unknown;
    totalAmount: number;
};
type BettingList = {
    bettingList: Record<string, BettingListItem>;
    year: number;
    month: number;
};
type BettingDetail = {
    bettingInfo: Omit<BettingListItem, 'totalAmount'> & {
        candidates: unknown;
    };
    bettingDetail: ReadonlyArray<readonly [string, number]>;
    myBetting: ReadonlyArray<readonly [string, number]>;
    remainPoint: number;
    year: number;
    month: number;
};
const bettingApi = trpc.betting as unknown as {
    getList: {
        query: (input: { req: 'bettingNation' }) => Promise<BettingList>;
    };
    getDetail: {
        query: (input: { bettingId: number }) => Promise<BettingDetail>;
    };
    bet: {
        mutate: (input: { bettingId: number; bettingType: number[]; amount: number }) => Promise<{ result: boolean }>;
    };
};
type Candidate = {
    title: string;
    info: string;
};

const list = ref<BettingList | null>(null);
const detail = ref<BettingDetail | null>(null);
const selectedBettingId = ref<number | null>(null);
const selectedCandidates = ref<number[]>([]);
const amount = ref(0);
const loadingList = ref(false);
const loadingDetail = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const noticeMessage = ref('');

const currentYearMonth = computed(() => {
    if (!detail.value) {
        return 0;
    }
    return detail.value.year * 12 + detail.value.month - 1;
});

const listYearMonth = computed(() => {
    if (!list.value) {
        return 0;
    }
    return list.value.year * 12 + list.value.month - 1;
});

const listItems = computed(() =>
    list.value ? Object.values(list.value.bettingList).sort((left, right) => right.id - left.id) : []
);

const info = computed(() => detail.value?.bettingInfo ?? null);

const candidates = computed<Candidate[]>(() => {
    const value = info.value?.candidates;
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return { title: '-', info: '' };
        }
        return {
            title: typeof candidate.title === 'string' ? candidate.title : '-',
            info: typeof candidate.info === 'string' ? candidate.info : '',
        };
    });
});

const winner = computed(() => {
    const value = info.value?.winner;
    if (!Array.isArray(value)) {
        return new Set<number>();
    }
    return new Set(value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)));
});

const detailRows = computed(() =>
    (detail.value?.bettingDetail ?? [])
        .filter(([key]) => readSelection(key).every((value) => value >= 0))
        .sort((left, right) => right[1] - left[1])
);

const myBetMap = computed(() => new Map(detail.value?.myBetting ?? []));

const totalAmount = computed(() => (detail.value?.bettingDetail ?? []).reduce((sum, [, value]) => sum + value, 0));

const pureAmount = computed(() =>
    (detail.value?.bettingDetail ?? []).reduce(
        (sum, [key, value]) => sum + (readSelection(key).some((item) => item < 0) ? 0 : value),
        0
    )
);

const candidateAmounts = computed(() => {
    const result = new Map<number, number>();
    for (const [key, value] of detail.value?.bettingDetail ?? []) {
        const selection = readSelection(key);
        if (selection.some((item) => item < 0)) {
            continue;
        }
        for (const item of selection) {
            result.set(item, (result.get(item) ?? 0) + value);
        }
    }
    return result;
});

const usedAmount = computed(() => Array.from(myBetMap.value.values()).reduce((sum, value) => sum + value, 0));

const selectedKey = computed(() => JSON.stringify([...selectedCandidates.value].sort((a, b) => a - b)));

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : '요청을 처리하지 못했습니다.';
};

const parseYearMonth = (yearMonth: number): [number, number] => [Math.floor(yearMonth / 12), (yearMonth % 12) + 1];

const readSelection = (value: string): number[] => {
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
            : [];
    } catch {
        return [];
    }
};

const selectionLabel = (value: string): string =>
    readSelection(value)
        .map((index) => candidates.value[index]?.title ?? '-')
        .join(', ');

const isListOpen = (item: BettingListItem): boolean => !item.finished && listYearMonth.value <= item.closeYearMonth;

const isDetailOpen = computed(() =>
    Boolean(info.value && !info.value.finished && currentYearMonth.value <= info.value.closeYearMonth)
);

const matchCount = (key: string): number =>
    readSelection(key).reduce((count, value) => count + (winner.value.has(value) ? 1 : 0), 0);

const rowColor = (key: string): string => {
    if (!info.value?.finished) {
        return '';
    }
    const matched = matchCount(key);
    if (info.value.isExclusive) {
        return matched === info.value.selectCnt ? 'green' : 'red';
    }
    return matched === 0 ? 'red' : matched < info.value.selectCnt ? 'yellow' : 'green';
};

const rewardByMatch = computed(() => {
    const selectCount = info.value?.selectCnt ?? 0;
    const rewards = new Array<number>(selectCount + 1).fill(0);
    if (selectCount <= 0) {
        return rewards;
    }
    const amountByMatch = new Map<number, number>();
    for (const [key, betAmount] of detailRows.value) {
        const matched = matchCount(key);
        amountByMatch.set(matched, (amountByMatch.get(matched) ?? 0) + betAmount);
    }
    if (selectCount === 1 || info.value?.isExclusive) {
        rewards[selectCount] = totalAmount.value;
        return rewards;
    }

    let remainingReward = totalAmount.value;
    let accumulatedReward = 0;
    let nextReward = totalAmount.value;
    for (let matched = selectCount; matched > 0; matched -= 1) {
        nextReward /= 2;
        accumulatedReward += nextReward;
        if (!amountByMatch.has(matched)) {
            continue;
        }
        rewards[matched] = accumulatedReward;
        remainingReward -= accumulatedReward;
        accumulatedReward = 0;
    }
    for (let matched = selectCount; matched >= 0; matched -= 1) {
        if (!amountByMatch.has(matched)) {
            continue;
        }
        rewards[matched] += remainingReward;
        break;
    }
    return rewards;
});

const expectedReward = (key: string): number => {
    if (!info.value?.finished) {
        return info.value?.isExclusive || info.value?.selectCnt === 1 ? totalAmount.value : totalAmount.value / 2;
    }
    return rewardByMatch.value[matchCount(key)] ?? 0;
};

const rewardDivisor = (key: string, betAmount: number): number =>
    info.value?.finished
        ? detailRows.value
              .filter(([candidateKey]) => matchCount(candidateKey) === matchCount(key))
              .reduce((sum, [, value]) => sum + value, 0)
        : betAmount;

const expectedMultiplier = (key: string, betAmount: number): string => {
    const divisor = rewardDivisor(key, betAmount);
    return divisor > 0 ? (expectedReward(key) / divisor).toFixed(1) : '0.0';
};

const myExpectedReward = (key: string, betAmount: number): string => {
    const myAmount = myBetMap.value.get(key);
    if (myAmount === undefined) {
        return '';
    }
    const divisor = rewardDivisor(key, betAmount);
    const reward = divisor > 0 ? (myAmount * expectedReward(key)) / divisor : 0;
    return `(${myAmount.toLocaleString('ko-KR')} -> ${reward.toFixed(1)})`;
};

const loadList = async () => {
    if (loadingList.value) {
        return;
    }
    loadingList.value = true;
    errorMessage.value = '';
    try {
        list.value = await bettingApi.getList.query({ req: 'bettingNation' });
    } catch (error) {
        errorMessage.value = getErrorMessage(error);
    } finally {
        loadingList.value = false;
    }
};

const loadDetail = async (bettingId: number, resetSelection = true, preserveNotice = false) => {
    selectedBettingId.value = bettingId;
    loadingDetail.value = true;
    errorMessage.value = '';
    if (!preserveNotice) {
        noticeMessage.value = '';
    }
    try {
        detail.value = await bettingApi.getDetail.query({ bettingId });
        if (resetSelection) {
            selectedCandidates.value = [];
            amount.value = 0;
        }
    } catch (error) {
        errorMessage.value = getErrorMessage(error);
    } finally {
        loadingDetail.value = false;
    }
};

const toggleCandidate = (index: number) => {
    if (!info.value || !isDetailOpen.value) {
        return;
    }
    const current = selectedCandidates.value;
    if (current.includes(index)) {
        selectedCandidates.value = current.filter((value) => value !== index);
        return;
    }
    if (info.value.selectCnt === 1) {
        selectedCandidates.value = [index];
        return;
    }
    if (current.length >= info.value.selectCnt) {
        errorMessage.value = `이미 ${info.value.selectCnt}개를 선택했습니다.`;
        return;
    }
    selectedCandidates.value = [...current, index];
};

const submitBet = async () => {
    if (!info.value || submitting.value) {
        return;
    }
    submitting.value = true;
    errorMessage.value = '';
    noticeMessage.value = '';
    try {
        await bettingApi.bet.mutate({
            bettingId: info.value.id,
            bettingType: [...selectedCandidates.value],
            amount: amount.value,
        });
        noticeMessage.value = '베팅했습니다';
        await loadDetail(info.value.id, true, true);
        await loadList();
    } catch (error) {
        // Legacy form keeps the selected candidates and amount after a failed request.
        errorMessage.value = getErrorMessage(error);
    } finally {
        submitting.value = false;
    }
};

onMounted(() => {
    void loadList();
});
</script>

<template>
    <main id="nation-betting-container" class="nation-betting-page legacy-bg0">
        <header class="legacy-top-bar">
            <RouterLink v-slot="{ navigate }" custom to="/">
                <button class="legacy-nav-button" type="button" @click="navigate">돌아가기</button>
            </RouterLink>
            <div></div>
            <h1>국가 베팅장</h1>
            <div></div>
            <div></div>
        </header>

        <div v-if="errorMessage" class="betting-notice error" role="alert">{{ errorMessage }}</div>
        <div v-if="noticeMessage" class="betting-notice success" role="status">{{ noticeMessage }}</div>

        <section v-if="detail && info" class="betting-detail">
            <div class="section-title legacy-bg2">
                {{ info.name }}
                <span v-if="info.finished">(종료)</span>
                <span v-else-if="currentYearMonth <= info.closeYearMonth">
                    ({{ parseYearMonth(info.closeYearMonth)[0] }}년 {{ parseYearMonth(info.closeYearMonth)[1] }}월까지)
                </span>
                <span v-else>(베팅 마감)</span>
                (총액: {{ totalAmount.toLocaleString('ko-KR') }})
            </div>

            <div class="betting-candidates">
                <div
                    v-for="(candidate, index) in candidates"
                    :key="`${info.id}-${index}`"
                    class="betting-candidate-cell"
                >
                    <button
                        type="button"
                        class="betting-candidate"
                        :class="{
                            picked: selectedCandidates.includes(index) || (info.finished && winner.has(index)),
                        }"
                        :disabled="!isDetailOpen"
                        @click="toggleCandidate(index)"
                    >
                        <span class="candidate-title legacy-bg1">{{ candidate.title }}</span>
                        <span class="candidate-info">
                            <span v-for="line in candidate.info.split('<br>')" :key="line">{{ line }}</span>
                        </span>
                        <span class="candidate-rate">
                            선택율:
                            {{ (((candidateAmounts.get(index) ?? 0) / Math.max(1, pureAmount)) * 100).toFixed(1) }}%
                        </span>
                    </button>
                </div>
            </div>

            <form v-if="isDetailOpen" class="betting-form" @submit.prevent="submitBet">
                <div>
                    잔여 {{ info.reqInheritancePoint ? '포인트' : '금' }}:
                    {{ detail.remainPoint.toLocaleString('ko-KR') }}
                </div>
                <div>사용 포인트: {{ usedAmount.toLocaleString('ko-KR') }}</div>
                <div>대상: {{ selectionLabel(selectedKey) }}</div>
                <input v-model.number="amount" aria-label="베팅 금액" type="number" min="10" max="1000" step="10" />
                <button type="submit" :disabled="submitting">베팅</button>
            </form>

            <div class="payout-table">
                <div class="section-title legacy-bg2">배당 순위</div>
                <div class="payout-row payout-head">
                    <div>대상</div>
                    <div>베팅액</div>
                    <div>내 베팅</div>
                    <div>{{ info.finished ? '배율' : '기대 배율' }}</div>
                </div>
                <div v-for="[key, betAmount] in detailRows" :key="key" class="payout-row">
                    <div :style="{ color: rowColor(key), fontWeight: myBetMap.has(key) ? 'bold' : undefined }">
                        {{ selectionLabel(key) }}
                    </div>
                    <div>{{ betAmount.toLocaleString('ko-KR') }}</div>
                    <div>{{ myExpectedReward(key, betAmount) }}</div>
                    <div>{{ expectedMultiplier(key, betAmount) }}배</div>
                </div>
            </div>
        </section>

        <div v-if="loadingDetail && !detail" class="betting-loading">불러오는 중...</div>
        <section class="betting-list">
            <div class="section-title legacy-bg2">베팅 목록</div>
            <button
                v-for="item in listItems"
                :key="item.id"
                type="button"
                class="betting-item"
                :class="{ active: selectedBettingId === item.id }"
                @click="loadDetail(item.id)"
            >
                [{{ parseYearMonth(item.openYearMonth)[0] }}년 {{ parseYearMonth(item.openYearMonth)[1] }}월]
                {{ item.name }}
                <span v-if="item.finished">(종료)</span>
                <span v-else-if="isListOpen(item)">
                    ({{ parseYearMonth(item.closeYearMonth)[0] }}년 {{ parseYearMonth(item.closeYearMonth)[1] }}월까지)
                </span>
                <span v-else>(베팅 마감)</span>
            </button>
            <div v-if="loadingList && !list" class="betting-loading">로딩 중...</div>
        </section>

        <footer class="betting-footer">
            <RouterLink class="legacy-nav-button" to="/">돌아가기</RouterLink>
        </footer>
    </main>
</template>

<style scoped>
.nation-betting-page {
    position: relative;
    width: 500px;
    margin: 0 auto;
    color: #fff;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic';
    font-size: 14px;
    line-height: 1.5;
    overflow-x: hidden;
}

.nation-betting-page.legacy-bg0 {
    background-color: transparent;
}

.legacy-top-bar {
    width: 100%;
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
}

.legacy-top-bar h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 500;
    line-height: 32px;
    text-align: center;
}

.legacy-nav-button,
.betting-form button {
    height: 32px;
    border: 0;
    background: #00582c;
    color: #fff;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
}

.legacy-nav-button {
    display: grid;
    place-items: center;
    margin-right: 2px;
}

.legacy-nav-button:hover,
.legacy-nav-button:focus,
.betting-form button:hover,
.betting-form button:focus {
    filter: brightness(1.18);
}

.legacy-nav-button:focus-visible,
.betting-form button:focus-visible,
.betting-candidate:focus-visible,
.betting-item:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}

.section-title {
    min-height: 21px;
    text-align: center;
    line-height: 21px;
}

.betting-candidates {
    display: flex;
    flex-wrap: wrap;
    margin-top: -3.5px;
    margin-right: -1.75px;
    margin-left: -1.75px;
}

.betting-candidate-cell {
    flex: 0 0 auto;
    width: 33.33333333%;
    max-width: 100%;
    padding-right: 1.75px;
    padding-left: 1.75px;
    margin-top: 3.5px;
}

.betting-candidate {
    width: 100%;
    height: 100%;
    min-height: 143px;
    min-width: 0;
    padding: 0;
    border: 1px solid gray;
    border-radius: 0.5em;
    overflow: hidden;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.betting-candidate:disabled {
    cursor: default;
    opacity: 1;
}

.betting-candidate.picked {
    border: 1px solid white;
    outline: 1.5px solid white;
}

.candidate-title,
.candidate-info,
.candidate-rate {
    display: block;
}

.candidate-title {
    text-align: center;
}

.picked .candidate-title {
    font-weight: 700;
}

.candidate-info,
.candidate-rate {
    padding: 1ch;
}

.candidate-info span {
    display: block;
}

.betting-form {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    align-items: center;
}

.betting-form > div {
    grid-column: span 3;
    padding: 4px;
}

.betting-form input {
    grid-column: span 4;
    min-width: 0;
    height: 35.5px;
    border: 1px solid #777;
    background: #ddd;
    color: #303030;
}

.betting-form button {
    grid-column: span 2;
    height: 35.5px;
}

.payout-table {
    margin-top: 0;
}

.payout-row {
    display: grid;
    grid-template-columns: 5fr 2fr 3fr 2fr;
}

.payout-row > div {
    min-width: 0;
    padding: 0 4px;
}

.payout-row > div:not(:first-child) {
    text-align: right;
}

.payout-head {
    border-bottom: 1px solid gray;
}

.payout-head > div {
    text-align: center;
}

.betting-list {
    margin-top: 1em;
}

.betting-list > .section-title {
    text-align: left;
}

.betting-item {
    display: block;
    width: auto;
    margin: 0.25em;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.betting-item:hover,
.betting-item:focus,
.betting-item.active {
    text-decoration: underline;
}

.betting-footer {
    min-height: 52px;
    padding-top: 20px;
}

.betting-footer .legacy-nav-button {
    width: 90px;
    height: 35.5px;
}

.betting-notice,
.betting-loading {
    padding: 6px 10px;
}

.betting-notice {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 20;
    width: min(320px, calc(100vw - 16px));
    background: #303030;
}

.betting-notice.error {
    border: 1px solid #9b4848;
    color: #ffd0d0;
}

.betting-notice.success {
    border: 1px solid #477a47;
    color: #d8f5d8;
}

@media (min-width: 1000px) {
    .nation-betting-page {
        width: 1000px;
    }

    .betting-candidate-cell {
        /* Legacy Bootstrap switches .col-4 to .col-lg-2 at 940px. */
        width: 16.66666667%;
    }

    .betting-form {
        grid-template-columns: repeat(12, 1fr);
    }

    .betting-form > div {
        grid-column: span 3;
    }

    .betting-form input {
        grid-column: span 2;
    }

    .betting-form button {
        grid-column: span 1;
    }
}
</style>
