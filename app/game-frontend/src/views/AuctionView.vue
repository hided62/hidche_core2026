<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { formatLog } from '../utils/formatLog';
import { trpc } from '../utils/trpc';

type AuctionOverview = Awaited<ReturnType<typeof trpc.auction.getOverview.query>>;
type ResourceAuction = AuctionOverview['resourceAuctions'][number];
type UniqueAuction = AuctionOverview['uniqueAuctions'][number];
type UniqueDetail = Awaited<ReturnType<typeof trpc.auction.getUniqueDetail.query>>;

const route = useRoute();
const activeTab = ref<'resource' | 'unique'>(route.query.type === 'unique' ? 'unique' : 'resource');
const loading = ref(false);
const actionBusy = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const overview = ref<AuctionOverview | null>(null);
const selectedResource = ref<ResourceAuction | null>(null);
const selectedUnique = ref<UniqueAuction | null>(null);
const uniqueDetail = ref<UniqueDetail | null>(null);
const bidAmount = ref(0);

const openForm = reactive({
    type: 'BUY_RICE' as 'BUY_RICE' | 'SELL_RICE',
    amount: 1000,
    closeTurnCnt: 24,
    startBidAmount: 500,
    finishBidAmount: 2000,
});

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    return typeof value === 'string' ? value : 'unknown_error';
};

const formatNumber = (value: number | null | undefined): string => (value ?? 0).toLocaleString();
const cutDateTime = (value: string | null | undefined, showSecond = false): string => {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value.slice(5, showSecond ? 19 : 16);
    }
    const parts = new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(showSecond ? { second: '2-digit' } : {}),
        hour12: false,
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}${showSecond ? `:${part('second')}` : ''}`;
};

const buyRice = computed(() =>
    (overview.value?.resourceAuctions ?? []).filter((auction) => auction.type === 'BUY_RICE')
);
const sellRice = computed(() =>
    (overview.value?.resourceAuctions ?? []).filter((auction) => auction.type === 'SELL_RICE')
);
const ongoingUnique = computed(() =>
    (overview.value?.uniqueAuctions ?? []).filter((auction) => auction.status === 'OPEN')
);
const finishedUnique = computed(() =>
    (overview.value?.uniqueAuctions ?? []).filter((auction) => auction.status !== 'OPEN')
);

const selectResource = (auction: ResourceAuction): void => {
    selectedResource.value = auction;
    bidAmount.value = auction.highestBid?.amount ?? auction.detail.startBidAmount ?? 0;
};

const selectUnique = async (auction: UniqueAuction): Promise<void> => {
    selectedUnique.value = auction;
    uniqueDetail.value = null;
    error.value = null;
    try {
        uniqueDetail.value = await trpc.auction.getUniqueDetail.query({ auctionId: auction.id });
        const highest = uniqueDetail.value.bids[0]?.amount ?? auction.detail.startBidAmount ?? 0;
        bidAmount.value = Math.max(Math.ceil(highest * 1.01), highest + 10);
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const loadOverview = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
        overview.value = await trpc.auction.getOverview.query();
        if (selectedResource.value) {
            selectedResource.value =
                overview.value.resourceAuctions.find((auction) => auction.id === selectedResource.value?.id) ?? null;
        }
        if (selectedUnique.value) {
            const updated =
                overview.value.uniqueAuctions.find((auction) => auction.id === selectedUnique.value?.id) ?? null;
            selectedUnique.value = updated;
            if (updated) {
                await selectUnique(updated);
            }
        } else if (activeTab.value === 'unique' && ongoingUnique.value[0]) {
            await selectUnique(ongoingUnique.value[0]);
        }
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (actionBusy.value) {
        return;
    }
    actionBusy.value = true;
    error.value = null;
    message.value = null;
    try {
        await action();
        await loadOverview();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        actionBusy.value = false;
    }
};

const openResourceAuction = (): Promise<void> =>
    runAction(async () => {
        const input = {
            amount: openForm.amount,
            closeTurnCnt: openForm.closeTurnCnt,
            startBidAmount: openForm.startBidAmount,
            finishBidAmount: openForm.finishBidAmount,
        };
        const result =
            openForm.type === 'BUY_RICE'
                ? await trpc.auction.openBuyRice.mutate(input)
                : await trpc.auction.openSellRice.mutate(input);
        message.value = `${result.auctionId}번 경매로 등록되었습니다.`;
    });

const bidResourceAuction = (): Promise<void> =>
    runAction(async () => {
        const auction = selectedResource.value;
        if (!auction) {
            return;
        }
        if (auction.isCallerHost) {
            throw new Error('자신이 연 경매에 입찰할 수 없습니다.');
        }
        if (auction.type === 'BUY_RICE') {
            await trpc.auction.bidBuyRice.mutate({ auctionId: auction.id, amount: bidAmount.value });
        } else {
            await trpc.auction.bidSellRice.mutate({ auctionId: auction.id, amount: bidAmount.value });
        }
        message.value = '입찰했습니다.';
    });

const bidUniqueAuction = (): Promise<void> =>
    runAction(async () => {
        const auction = selectedUnique.value;
        if (!auction) {
            return;
        }
        if (
            !window.confirm(
                `${auction.detail.title ?? auction.targetCode ?? '유니크'}에 ${bidAmount.value}유산포인트를 입찰하시겠습니까?`
            )
        ) {
            return;
        }
        await trpc.auction.bidUnique.mutate({
            auctionId: auction.id,
            amount: bidAmount.value,
            tryExtendCloseDate: false,
        });
        message.value = '입찰이 완료되었습니다.';
    });

const closeWindow = (): void => window.close();

watch(activeTab, (tab) => {
    error.value = null;
    message.value = null;
    if (tab === 'unique' && !selectedUnique.value && ongoingUnique.value[0]) {
        void selectUnique(ongoingUnique.value[0]);
    }
});

onMounted(() => {
    void loadOverview();
});
</script>

<template>
    <main id="container" class="legacy-auction-page bg0">
        <header class="top-back-bar bg0">
            <button class="legacy-button close-button" type="button" @click="closeWindow">창 닫기</button>
            <button class="legacy-button reload-button" type="button" :disabled="loading" @click="loadOverview">
                갱신
            </button>
            <h1>{{ activeTab === 'resource' ? '경매장' : '유니크 경매장' }}</h1>
            <button
                class="legacy-button tab-button"
                :aria-pressed="activeTab === 'resource'"
                @click="activeTab = 'resource'"
            >
                금/쌀
            </button>
            <button
                class="legacy-button tab-button"
                :aria-pressed="activeTab === 'unique'"
                @click="activeTab = 'unique'"
            >
                유니크
            </button>
        </header>

        <p v-if="error" class="auction-notice error" role="alert">{{ error }}</p>
        <p v-if="message" class="auction-notice success" role="status">{{ message }}</p>
        <div v-if="loading && !overview" class="loading-state">불러오는 중...</div>

        <section v-else-if="activeTab === 'resource'" class="resource-auction bg0">
            <h2 class="section-title bg2">거래장</h2>

            <section class="resource-section" aria-labelledby="buy-rice-heading">
                <h3 id="buy-rice-heading" class="resource-kind buy-rice">쌀 구매</h3>
                <div class="resource-row resource-header">
                    <span class="idx">번호</span><span class="host">판매자</span><span class="amount">수량</span>
                    <span class="highest-bidder">입찰자</span><span class="highest-bid">입찰가</span>
                    <span class="bid-ratio">단가</span><span class="finish-bid">마감가</span>
                    <span class="close-date">거래 종료</span>
                </div>
                <button
                    v-for="auction in buyRice"
                    :key="auction.id"
                    class="resource-row clickable-row"
                    :class="{ selected: selectedResource?.id === auction.id }"
                    @click="selectResource(auction)"
                >
                    <span class="idx tnum">{{ auction.id }}</span>
                    <span class="host">{{ auction.hostName }}</span>
                    <span class="amount tnum">쌀 {{ formatNumber(auction.detail.amount) }}</span>
                    <span class="highest-bidder">{{ auction.highestBid?.bidderName ?? '-' }}</span>
                    <span class="highest-bid tnum" :class="{ 'no-bid': !auction.highestBid }">
                        금 {{ formatNumber(auction.highestBid?.amount ?? auction.detail.startBidAmount) }}
                    </span>
                    <span class="bid-ratio tnum">
                        {{
                            auction.highestBid && auction.detail.amount
                                ? (auction.highestBid.amount / auction.detail.amount).toFixed(2)
                                : '-'
                        }}
                    </span>
                    <span class="finish-bid tnum">금 {{ formatNumber(auction.detail.finishBidAmount) }}</span>
                    <span class="close-date tnum">{{ cutDateTime(auction.closeAt) }}</span>
                </button>
                <p v-if="buyRice.length === 0" class="empty-row">진행 중인 쌀 구매 경매가 없습니다.</p>
            </section>

            <section class="resource-section" aria-labelledby="sell-rice-heading">
                <h3 id="sell-rice-heading" class="resource-kind sell-rice">쌀 판매</h3>
                <div class="resource-row resource-header">
                    <span class="idx">번호</span><span class="host">판매자</span><span class="amount">수량</span>
                    <span class="highest-bidder">입찰자</span><span class="highest-bid">입찰가</span>
                    <span class="bid-ratio">단가</span><span class="finish-bid">마감가</span>
                    <span class="close-date">거래 종료</span>
                </div>
                <button
                    v-for="auction in sellRice"
                    :key="auction.id"
                    class="resource-row clickable-row"
                    :class="{ selected: selectedResource?.id === auction.id }"
                    @click="selectResource(auction)"
                >
                    <span class="idx tnum">{{ auction.id }}</span>
                    <span class="host">{{ auction.hostName }}</span>
                    <span class="amount tnum">금 {{ formatNumber(auction.detail.amount) }}</span>
                    <span class="highest-bidder">{{ auction.highestBid?.bidderName ?? '-' }}</span>
                    <span class="highest-bid tnum" :class="{ 'no-bid': !auction.highestBid }">
                        쌀 {{ formatNumber(auction.highestBid?.amount ?? auction.detail.startBidAmount) }}
                    </span>
                    <span class="bid-ratio tnum">
                        {{
                            auction.highestBid && auction.detail.amount
                                ? (auction.highestBid.amount / auction.detail.amount).toFixed(2)
                                : '-'
                        }}
                    </span>
                    <span class="finish-bid tnum">쌀 {{ formatNumber(auction.detail.finishBidAmount) }}</span>
                    <span class="close-date tnum">{{ cutDateTime(auction.closeAt) }}</span>
                </button>
                <p v-if="sellRice.length === 0" class="empty-row">진행 중인 쌀 판매 경매가 없습니다.</p>
            </section>

            <form v-if="selectedResource" class="resource-bid-form" @submit.prevent="bidResourceAuction">
                <span class="bid-description">
                    {{ selectedResource.id }}번 {{ selectedResource.type === 'BUY_RICE' ? '쌀' : '금' }}
                    {{ formatNumber(selectedResource.detail.amount) }} 경매에
                    {{ selectedResource.type === 'BUY_RICE' ? '금' : '쌀' }}
                </span>
                <input
                    v-model.number="bidAmount"
                    :aria-label="`${selectedResource.id}번 경매 입찰가`"
                    type="number"
                    :min="selectedResource.detail.startBidAmount ?? 1"
                    :max="selectedResource.detail.finishBidAmount ?? undefined"
                    step="10"
                    required
                />
                <button class="legacy-button" :disabled="actionBusy || selectedResource.isCallerHost">입찰</button>
            </form>

            <h3 class="subsection-title">경매 등록</h3>
            <form class="open-form" @submit.prevent="openResourceAuction">
                <fieldset>
                    <legend>매물</legend>
                    <div class="item-toggle">
                        <button
                            class="legacy-button"
                            type="button"
                            :aria-pressed="openForm.type === 'BUY_RICE'"
                            @click="openForm.type = 'BUY_RICE'"
                        >
                            쌀
                        </button>
                        <button
                            class="legacy-button"
                            type="button"
                            :aria-pressed="openForm.type === 'SELL_RICE'"
                            @click="openForm.type = 'SELL_RICE'"
                        >
                            금
                        </button>
                    </div>
                </fieldset>
                <label>
                    <span>수량 ({{ openForm.type === 'BUY_RICE' ? '쌀' : '금' }})</span>
                    <input v-model.number="openForm.amount" type="number" min="100" max="10000" step="10" />
                </label>
                <label
                    ><span>기간(턴)</span><input v-model.number="openForm.closeTurnCnt" type="number" min="3" max="24"
                /></label>
                <label>
                    <span>시작가 ({{ openForm.type === 'BUY_RICE' ? '금' : '쌀' }})</span>
                    <input v-model.number="openForm.startBidAmount" type="number" min="100" max="10000" step="10" />
                </label>
                <label>
                    <span>마감가 ({{ openForm.type === 'BUY_RICE' ? '금' : '쌀' }})</span>
                    <input v-model.number="openForm.finishBidAmount" type="number" min="100" max="10000" step="10" />
                </label>
                <button class="legacy-button register-button" :disabled="actionBusy">등록</button>
            </form>

            <h3 class="subsection-title">이전 경매(최근 20건)</h3>
            <div class="recent-logs">
                <!-- eslint-disable vue/no-v-html -->
                <div v-for="log in overview?.recentLogs ?? []" :key="log.id" v-html="formatLog(log.text)" />
                <!-- eslint-enable vue/no-v-html -->
                <div v-if="(overview?.recentLogs.length ?? 0) === 0" class="sr-only">경매 기록이 없습니다.</div>
            </div>
        </section>

        <section v-else class="unique-auction bg0">
            <div class="caller-alias">
                내 가명: <strong>{{ overview?.callerAlias ?? '-' }}</strong>
            </div>

            <section v-if="uniqueDetail" class="unique-detail">
                <h2 class="section-title bg2">경매 {{ uniqueDetail.auction.id }}번 상세</h2>
                <dl class="detail-grid">
                    <dt class="bg1">경매명</dt>
                    <dd>{{ uniqueDetail.auction.detail.title ?? uniqueDetail.auction.targetCode }}</dd>
                    <dt class="bg1">주최자(익명)</dt>
                    <dd :class="{ 'is-me': uniqueDetail.auction.isCallerHost }">{{ uniqueDetail.auction.hostName }}</dd>
                    <dt class="bg1">종료일시</dt>
                    <dd class="tnum">{{ cutDateTime(uniqueDetail.auction.closeAt, true) }}</dd>
                    <dt class="bg1">최대지연</dt>
                    <dd class="tnum">
                        {{ cutDateTime(uniqueDetail.auction.detail.availableLatestBidCloseDate, true) }}
                    </dd>
                </dl>
                <h3 class="subsection-title bg1">입찰자 목록</h3>
                <div class="bid-row bid-header"><span>입찰자</span><span>입찰포인트</span><span>시각</span></div>
                <div v-for="bid in uniqueDetail.bids" :key="bid.id" class="bid-row">
                    <span :class="{ 'is-me': bid.isCaller }">{{ bid.bidderName }}</span>
                    <span class="tnum">{{ formatNumber(bid.amount) }}</span>
                    <time class="tnum">{{ cutDateTime(bid.eventAt) }}</time>
                </div>
                <template v-if="uniqueDetail.auction.status === 'OPEN'">
                    <h3 class="subsection-title bg1">입찰하기</h3>
                    <form class="unique-bid-form" @submit.prevent="bidUniqueAuction">
                        <label for="unique-bid">
                            유산포인트 (잔여: {{ formatNumber(uniqueDetail.remainPoint) }}포인트)
                        </label>
                        <input id="unique-bid" v-model.number="bidAmount" type="number" min="1" required />
                        <button class="legacy-button" :disabled="actionBusy">입찰</button>
                    </form>
                </template>
            </section>

            <section class="unique-list-section">
                <h2 class="subsection-title bg1">진행중인 경매 목록</h2>
                <div class="unique-row unique-header">
                    <span>번호</span><span>경매명</span><span>주최자</span><span>종료일시</span> <span>연장</span
                    ><span>1순위</span><span>포인트</span>
                </div>
                <button
                    v-for="auction in ongoingUnique"
                    :key="auction.id"
                    class="unique-row clickable-row"
                    :class="{ selected: selectedUnique?.id === auction.id }"
                    @click="selectUnique(auction)"
                >
                    <span>{{ auction.id }}</span
                    ><span>{{ auction.detail.title ?? auction.targetCode }}</span>
                    <span :class="{ 'is-me': auction.isCallerHost }">{{ auction.hostName }}</span>
                    <span class="tnum">{{ cutDateTime(auction.closeAt) }}</span>
                    <span>{{ (auction.detail.remainCloseDateExtensionCnt ?? 0) > 0 ? '남음' : '소진' }}</span>
                    <span :class="{ 'is-me': auction.highestBid?.isCaller }">{{
                        auction.highestBid?.bidderName ?? '-'
                    }}</span>
                    <span class="tnum">{{
                        formatNumber(auction.highestBid?.amount ?? auction.detail.startBidAmount)
                    }}</span>
                </button>
                <p v-if="ongoingUnique.length === 0" class="empty-row">진행중인 유니크 경매가 없습니다.</p>
            </section>

            <section class="unique-list-section">
                <h2 class="subsection-title bg1">종료된 경매 목록</h2>
                <div class="unique-row unique-header">
                    <span>번호</span><span>경매명</span><span>주최자</span><span>종료일시</span> <span>연장</span
                    ><span>1순위</span><span>포인트</span>
                </div>
                <button
                    v-for="auction in finishedUnique"
                    :key="auction.id"
                    class="unique-row clickable-row"
                    :class="{ selected: selectedUnique?.id === auction.id }"
                    @click="selectUnique(auction)"
                >
                    <span>{{ auction.id }}</span
                    ><span>{{ auction.detail.title ?? auction.targetCode }}</span>
                    <span :class="{ 'is-me': auction.isCallerHost }">{{ auction.hostName }}</span>
                    <span class="tnum">{{ cutDateTime(auction.closeAt) }}</span>
                    <span>{{ (auction.detail.remainCloseDateExtensionCnt ?? 0) > 0 ? '남음' : '소진' }}</span>
                    <span :class="{ 'is-me': auction.highestBid?.isCaller }">{{
                        auction.highestBid?.bidderName ?? '-'
                    }}</span>
                    <span class="tnum">{{
                        formatNumber(auction.highestBid?.amount ?? auction.detail.startBidAmount)
                    }}</span>
                </button>
                <p v-if="finishedUnique.length === 0" class="empty-row">종료된 유니크 경매가 없습니다.</p>
            </section>
        </section>

        <footer class="bottom-bar bg0">
            <button class="legacy-button close-button" type="button" @click="closeWindow">창 닫기</button>
        </footer>
    </main>
</template>

<style scoped>
.legacy-auction-page {
    width: 100%;
    max-width: 1000px;
    box-sizing: border-box;
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 21px;
}
.legacy-auction-page.bg0 {
    background-color: transparent;
}
.bg0 {
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
}
.bg1 {
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}
.bg2 {
    background-color: #172a52;
    background-image: var(--sammo-texture-blue);
}
.top-back-bar {
    width: 100%;
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
}
.top-back-bar h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 500;
    line-height: 32px;
    text-align: center;
}
.legacy-button {
    box-sizing: border-box;
    border: solid #3d3d3d;
    border-width: 0 1px 4px;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    color: #fff;
    background: #444;
    font: inherit;
    font-weight: 700;
    line-height: 21px;
    cursor: pointer;
}
.legacy-button:hover,
.legacy-button:focus {
    border-color: #353535;
    background: #393939;
}
.legacy-button:focus-visible {
    outline: 2px solid #8ab4f8;
    outline-offset: -2px;
}
.legacy-button:active,
.legacy-button[aria-pressed='true'] {
    border-color: #303030;
    background: #333;
}
.legacy-button:disabled {
    cursor: default;
    opacity: 0.65;
}
.close-button,
.reload-button {
    margin-right: 2px;
    border-color: #004f28;
    background: #00582c;
}
.close-button:hover,
.close-button:focus,
.reload-button:hover,
.reload-button:focus {
    border-color: #004523;
    background: #004a25;
}
.top-back-bar .close-button,
.top-back-bar .reload-button {
    height: 32px;
}
.tab-button {
    border-color: #3d3d3d;
    background: #444;
}
.tab-button[aria-pressed='true'] {
    border-color: #3d3d3d;
    background: #444;
}
.tab-button:hover,
.tab-button:focus {
    border-color: #3d3d3d;
    background: #444;
}
.section-title,
.subsection-title,
.resource-kind {
    margin: 0;
    min-height: 18px;
    font: inherit;
    font-weight: 400;
}
.unique-detail .section-title {
    background-color: transparent;
}
.resource-kind.buy-rice {
    color: #000;
    background: orange;
}
.resource-kind.sell-rice {
    color: #000;
    background: skyblue;
}
.resource-row {
    width: 100%;
    min-height: 22px;
    display: grid;
    grid-template-columns: 1fr 2fr 2fr 2fr 2fr 1fr 3fr 2fr;
    align-items: center;
    box-sizing: border-box;
    border: 0;
    border-bottom: 1px solid gray;
    padding: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: center;
}
.clickable-row {
    cursor: pointer;
}
.clickable-row:hover,
.clickable-row:focus-visible,
.clickable-row.selected {
    background-color: rgb(255 255 255 / 30%);
    outline: 0;
}
.no-bid {
    color: #ccc;
}
.tnum {
    font-variant-numeric: tabular-nums;
}
.empty-row {
    min-height: 24px;
    margin: 0;
    padding: 4px 8px;
    text-align: center;
}
.resource-bid-form {
    min-height: 42px;
    display: grid;
    grid-template-columns: 2fr 2fr 1fr;
    align-items: center;
    gap: 4px;
    padding-right: 33.3333%;
    padding-left: 25%;
}
.bid-description {
    text-align: right;
}
input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid #000;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    color: #303030;
    background: #ddd;
    font: inherit;
}
input:focus-visible {
    outline: 2px solid #8ab4f8;
    outline-offset: -2px;
}
.open-form {
    min-height: 58px;
    display: grid;
    grid-template-columns: 1fr 2fr 1fr 2fr 2fr 1fr;
    align-items: end;
    gap: 4px;
    box-sizing: border-box;
    padding-right: 8.3333%;
    padding-left: 16.6667%;
}
.open-form fieldset,
.open-form label {
    min-width: 0;
    margin: 0;
    border: 0;
    padding: 0;
}
.open-form legend {
    padding: 0;
}
.open-form label {
    display: grid;
    gap: 2px;
}
.item-toggle {
    display: flex;
}
.item-toggle .legacy-button {
    flex: 1;
}
.register-button {
    height: 100%;
    align-self: stretch;
}
.recent-logs {
    min-height: 24px;
}
.caller-alias {
    min-height: 20px;
}
.caller-alias strong,
.is-me {
    color: aqua;
    font-weight: 700;
}
.detail-grid {
    display: grid;
    grid-template-columns: 1fr 2fr 1fr 2fr 1fr 2fr 1fr 2fr;
    margin: 0;
    text-align: center;
}
.detail-grid dt,
.detail-grid dd {
    min-width: 0;
    min-height: 18px;
    display: grid;
    align-content: center;
    margin: 0;
}
.bid-row {
    min-height: 22px;
    display: grid;
    grid-template-columns: 3fr 2fr 3fr;
    align-items: center;
    padding: 0 20%;
    text-align: center;
}
.bid-header {
    border-bottom: 1px solid #fff;
}
.bid-row > :nth-child(2) {
    padding-right: 20px;
    text-align: right;
}
.unique-bid-form {
    min-height: 40px;
    display: grid;
    grid-template-columns: 3fr 2fr 1fr;
    align-items: center;
    padding: 0 25%;
}
.unique-bid-form label {
    text-align: center;
}
.unique-row {
    width: 100%;
    min-height: 22px;
    display: grid;
    grid-template-columns: 1fr 4fr 1fr 2fr 1fr 1fr 2fr;
    align-items: center;
    box-sizing: border-box;
    border: 0;
    padding: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: center;
}
.unique-header {
    border-bottom: 1px solid #fff;
}
.unique-row > :last-child {
    padding-right: 8px;
    text-align: right;
}
.auction-notice {
    min-height: 28px;
    box-sizing: border-box;
    margin: 0;
    padding: 5px 8px;
}
.auction-notice.error {
    background: #842029;
}
.auction-notice.success {
    background: #0f5132;
}
.loading-state {
    min-height: 120px;
    display: grid;
    place-items: center;
}
.bottom-bar {
    padding-top: 20px;
}
@media (max-width: 991px) {
    .legacy-auction-page {
        max-width: none;
    }
}
@media (max-width: 500px) {
    .resource-row {
        min-height: 43px;
        grid-template-columns: 1fr 3fr 3fr 1fr 2fr 2fr;
        grid-template-rows: 1fr 1fr;
    }
    .resource-row .idx {
        grid-column: 1;
        grid-row: 1 / 3;
    }
    .resource-row .host {
        grid-column: 2;
        grid-row: 1;
    }
    .resource-row .amount {
        grid-column: 2;
        grid-row: 2;
    }
    .resource-row .highest-bidder {
        grid-column: 3;
        grid-row: 1;
    }
    .resource-row .highest-bid {
        grid-column: 3;
        grid-row: 2;
    }
    .resource-row .bid-ratio {
        grid-column: 4;
        grid-row: 1 / 3;
    }
    .resource-row .finish-bid {
        grid-column: 5;
        grid-row: 1 / 3;
    }
    .resource-row .close-date {
        grid-column: 6;
        grid-row: 1 / 3;
    }
    .resource-bid-form {
        grid-template-columns: 4fr 3fr 2fr;
        padding-right: 16.6667%;
        padding-left: 8.3333%;
    }
    .open-form {
        grid-template-columns: 2fr 2.3333fr 2fr 2.3333fr 2.3333fr 1fr;
        padding: 0;
    }
    .detail-grid {
        grid-template-columns: 2fr 4fr 2fr 4fr;
    }
    .bid-row {
        padding: 0;
        grid-template-columns: 4fr 4fr 4fr;
    }
    .unique-bid-form {
        padding: 0;
        grid-template-columns: 5fr 4fr 3fr;
    }
}
</style>
