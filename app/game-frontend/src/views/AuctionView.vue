<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { formatLog } from '../utils/formatLog';
import { trpc } from '../utils/trpc';

type AuctionOverview = Awaited<ReturnType<typeof trpc.auction.getOverview.query>>;
type ResourceAuction = AuctionOverview['resourceAuctions'][number];
type UniqueAuction = AuctionOverview['uniqueAuctions'][number];
type UniqueDetail = Awaited<ReturnType<typeof trpc.auction.getUniqueDetail.query>>;

const activeTab = ref<'resource' | 'unique'>('resource');
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
const formatDate = (value: string): string =>
    new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(value));

const resourceTitle = (auction: ResourceAuction): string =>
    auction.type === 'BUY_RICE' ? '쌀 구매' : '쌀 판매';
const hostResource = (auction: ResourceAuction): string => (auction.type === 'BUY_RICE' ? '쌀' : '금');
const bidResource = (auction: ResourceAuction): string => (auction.type === 'BUY_RICE' ? '금' : '쌀');

const resourceAuctions = computed(() => overview.value?.resourceAuctions ?? []);
const uniqueAuctions = computed(() => overview.value?.uniqueAuctions ?? []);

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
            selectedUnique.value =
                overview.value.uniqueAuctions.find((auction) => auction.id === selectedUnique.value?.id) ?? null;
        }
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const selectResource = (auction: ResourceAuction): void => {
    selectedResource.value = auction;
    bidAmount.value = auction.highestBid?.amount ?? auction.detail.startBidAmount ?? 0;
};

const selectUnique = async (auction: UniqueAuction): Promise<void> => {
    selectedUnique.value = auction;
    error.value = null;
    try {
        uniqueDetail.value = await trpc.auction.getUniqueDetail.query({ auctionId: auction.id });
        const highest = uniqueDetail.value.bids[0]?.amount ?? auction.detail.startBidAmount ?? 0;
        bidAmount.value = Math.max(Math.ceil(highest * 1.01), highest + 10);
    } catch (err) {
        error.value = resolveErrorMessage(err);
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
        message.value = `${auction.id}번 경매에 입찰했습니다.`;
    });

const bidUniqueAuction = (): Promise<void> =>
    runAction(async () => {
        const auction = selectedUnique.value;
        if (!auction) {
            return;
        }
        if (!window.confirm(`${auction.detail.title ?? auction.targetCode ?? '유니크'}에 ${bidAmount.value} 포인트를 입찰하시겠습니까?`)) {
            return;
        }
        await trpc.auction.bidUnique.mutate({
            auctionId: auction.id,
            amount: bidAmount.value,
            tryExtendCloseDate: true,
        });
        message.value = `${auction.id}번 유니크 경매에 입찰했습니다.`;
        await selectUnique(auction);
    });

onMounted(() => {
    void loadOverview();
});
</script>

<template>
    <main class="auction-page">
        <header class="page-header">
            <div>
                <h1>거래장</h1>
                <p>금·쌀 거래와 유니크 아이템 경매를 확인합니다.</p>
            </div>
            <button class="ghost" :disabled="loading" @click="loadOverview">새로고침</button>
        </header>

        <nav class="tabs" aria-label="경매 종류">
            <button :class="{ active: activeTab === 'resource' }" @click="activeTab = 'resource'">금·쌀 경매</button>
            <button :class="{ active: activeTab === 'unique' }" @click="activeTab = 'unique'">유니크 경매</button>
        </nav>

        <p v-if="error" class="notice error">{{ error }}</p>
        <p v-if="message" class="notice success">{{ message }}</p>
        <SkeletonLines v-if="loading && !overview" :lines="8" />

        <template v-else-if="activeTab === 'resource'">
            <PanelCard title="진행 중인 금·쌀 경매" subtitle="행을 선택하면 아래에서 입찰할 수 있습니다.">
                <div class="auction-table resource-table">
                    <div class="table-head">
                        <span>번호</span><span>종류</span><span>판매자</span><span>수량</span><span>입찰자</span>
                        <span>현재가</span><span>마감가</span><span>종료</span>
                    </div>
                    <button
                        v-for="auction in resourceAuctions"
                        :key="auction.id"
                        class="table-row"
                        :class="{ selected: selectedResource?.id === auction.id }"
                        @click="selectResource(auction)"
                    >
                        <span>{{ auction.id }}</span>
                        <span>{{ resourceTitle(auction) }}</span>
                        <span>{{ auction.hostName }}</span>
                        <span>{{ hostResource(auction) }} {{ formatNumber(auction.detail.amount) }}</span>
                        <span>{{ auction.highestBid?.bidderName ?? '-' }}</span>
                        <span>{{ bidResource(auction) }} {{ formatNumber(auction.highestBid?.amount ?? auction.detail.startBidAmount) }}</span>
                        <span>{{ bidResource(auction) }} {{ formatNumber(auction.detail.finishBidAmount) }}</span>
                        <span>{{ formatDate(auction.closeAt) }}</span>
                    </button>
                    <p v-if="resourceAuctions.length === 0" class="empty">진행 중인 경매가 없습니다.</p>
                </div>

                <form v-if="selectedResource" class="bid-form" @submit.prevent="bidResourceAuction">
                    <strong>{{ selectedResource.id }}번 {{ resourceTitle(selectedResource) }}</strong>
                    <label>
                        <span>입찰가 ({{ bidResource(selectedResource) }})</span>
                        <input v-model.number="bidAmount" type="number" min="1" step="10" required />
                    </label>
                    <button :disabled="actionBusy || selectedResource.isCallerHost">입찰</button>
                </form>
            </PanelCard>

            <PanelCard title="경매 등록" subtitle="레거시와 동일하게 한 장수는 자원 경매를 한 건만 진행할 수 있습니다.">
                <form class="open-form" @submit.prevent="openResourceAuction">
                    <label>
                        <span>매물</span>
                        <select v-model="openForm.type">
                            <option value="BUY_RICE">쌀</option>
                            <option value="SELL_RICE">금</option>
                        </select>
                    </label>
                    <label><span>수량</span><input v-model.number="openForm.amount" type="number" min="100" max="10000" step="10" /></label>
                    <label><span>기간(턴)</span><input v-model.number="openForm.closeTurnCnt" type="number" min="1" max="24" /></label>
                    <label><span>시작가</span><input v-model.number="openForm.startBidAmount" type="number" min="1" step="10" /></label>
                    <label><span>마감가</span><input v-model.number="openForm.finishBidAmount" type="number" min="1" step="10" /></label>
                    <button :disabled="actionBusy">등록</button>
                </form>
            </PanelCard>

            <PanelCard title="이전 경매" subtitle="최근 경매 기록 20건">
                <ol class="log-list">
                    <!-- eslint-disable vue/no-v-html -->
                    <li v-for="log in overview?.recentLogs ?? []" :key="log.id" v-html="formatLog(log.text)" />
                    <!-- eslint-enable vue/no-v-html -->
                    <li v-if="(overview?.recentLogs.length ?? 0) === 0" class="empty">경매 기록이 없습니다.</li>
                </ol>
            </PanelCard>
        </template>

        <template v-else>
            <PanelCard title="유니크 경매" :subtitle="`내 가명: ${overview?.callerAlias ?? '-'}`">
                <div class="auction-table unique-table">
                    <div class="table-head">
                        <span>번호</span><span>경매명</span><span>주최자</span><span>종료</span><span>1순위</span><span>포인트</span>
                    </div>
                    <button
                        v-for="auction in uniqueAuctions"
                        :key="auction.id"
                        class="table-row"
                        :class="{ selected: selectedUnique?.id === auction.id }"
                        @click="selectUnique(auction)"
                    >
                        <span>{{ auction.id }}</span>
                        <span>{{ auction.detail.title ?? auction.targetCode }}</span>
                        <span :class="{ me: auction.isCallerHost }">{{ auction.hostName }}</span>
                        <span>{{ formatDate(auction.closeAt) }}</span>
                        <span :class="{ me: auction.highestBid?.isCaller }">{{ auction.highestBid?.bidderName ?? '-' }}</span>
                        <span>{{ formatNumber(auction.highestBid?.amount ?? auction.detail.startBidAmount) }}</span>
                    </button>
                    <p v-if="uniqueAuctions.length === 0" class="empty">유니크 경매가 없습니다.</p>
                </div>
            </PanelCard>

            <PanelCard v-if="uniqueDetail" title="유니크 경매 상세">
                <dl class="detail-grid">
                    <dt>경매명</dt><dd>{{ uniqueDetail.auction.detail.title ?? uniqueDetail.auction.targetCode }}</dd>
                    <dt>주최자(익명)</dt><dd :class="{ me: uniqueDetail.auction.isCallerHost }">{{ uniqueDetail.auction.hostName }}</dd>
                    <dt>종료일시</dt><dd>{{ formatDate(uniqueDetail.auction.closeAt) }}</dd>
                    <dt>잔여 포인트</dt><dd>{{ formatNumber(uniqueDetail.remainPoint) }}</dd>
                </dl>
                <div class="bid-history">
                    <div v-for="bid in uniqueDetail.bids" :key="bid.id" class="bid-entry">
                        <span :class="{ me: bid.isCaller }">{{ bid.bidderName }}</span>
                        <strong>{{ formatNumber(bid.amount) }}</strong>
                        <time>{{ formatDate(bid.eventAt) }}</time>
                    </div>
                </div>
                <form v-if="uniqueDetail.auction.status === 'OPEN'" class="bid-form" @submit.prevent="bidUniqueAuction">
                    <label><span>유산 포인트</span><input v-model.number="bidAmount" type="number" min="1" required /></label>
                    <button :disabled="actionBusy">입찰</button>
                </form>
            </PanelCard>
        </template>
    </main>
</template>

<style scoped>
.auction-page {
    min-height: 100%;
    padding: 18px;
    color: #e8ddc4;
    background: radial-gradient(circle at top, rgba(93, 57, 26, 0.25), transparent 42%), #080807;
}
.page-header, .tabs, .bid-form, .open-form, .detail-grid, .bid-entry {
    display: flex;
    align-items: center;
}
.page-header { justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.page-header h1 { margin: 0; font-size: 1.45rem; }
.page-header p { margin: 4px 0 0; color: rgba(232, 221, 196, 0.7); }
.tabs { gap: 6px; margin-bottom: 12px; }
button, input, select {
    border: 1px solid rgba(201, 164, 90, 0.55);
    background: rgba(20, 17, 12, 0.95);
    color: #e8ddc4;
    padding: 8px 10px;
}
button { cursor: pointer; }
button:hover, button:focus-visible, button.active { background: rgba(201, 164, 90, 0.22); }
button:disabled { cursor: not-allowed; opacity: 0.45; }
.ghost { background: transparent; }
.notice { padding: 9px 12px; border: 1px solid; }
.notice.error { color: #ffb3a9; border-color: rgba(255, 90, 70, 0.45); }
.notice.success { color: #b9e6af; border-color: rgba(94, 177, 75, 0.45); }
.auction-page :deep(.panel-card) { margin-bottom: 12px; }
.auction-table { overflow-x: auto; }
.table-head, .table-row { display: grid; min-width: 820px; align-items: center; text-align: center; }
.resource-table .table-head, .resource-table .table-row { grid-template-columns: 52px 84px 1fr 1fr 1fr 1fr 1fr 150px; }
.unique-table .table-head, .unique-table .table-row { grid-template-columns: 52px 2fr 1fr 150px 1fr 110px; }
.table-head { border-bottom: 1px solid rgba(232, 221, 196, 0.4); padding: 7px; color: rgba(232, 221, 196, 0.7); }
.table-row { width: 100%; border: 0; border-bottom: 1px solid rgba(232, 221, 196, 0.12); background: transparent; }
.table-row.selected { background: rgba(201, 164, 90, 0.18); }
.table-row > span { padding: 8px 5px; }
.bid-form { justify-content: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.bid-form label, .open-form label { display: grid; gap: 5px; }
.open-form { align-items: end; gap: 10px; flex-wrap: wrap; }
.open-form label { min-width: 110px; flex: 1; }
.empty { padding: 14px; text-align: center; color: rgba(232, 221, 196, 0.6); }
.log-list { margin: 0; padding-left: 24px; }
.log-list li { padding: 4px 0; }
.detail-grid { display: grid; grid-template-columns: 130px 1fr 130px 1fr; gap: 1px; background: rgba(232, 221, 196, 0.18); }
.detail-grid dt, .detail-grid dd { margin: 0; padding: 9px; background: #11100d; }
.detail-grid dt { color: rgba(232, 221, 196, 0.65); }
.bid-history { margin-top: 12px; }
.bid-entry { justify-content: space-between; gap: 12px; padding: 7px 10px; border-bottom: 1px solid rgba(232, 221, 196, 0.14); }
.bid-entry time { color: rgba(232, 221, 196, 0.65); }
.me { color: aquamarine; font-weight: 700; }
@media (max-width: 720px) {
    .auction-page { padding: 10px; }
    .page-header { align-items: flex-start; }
    .detail-grid { grid-template-columns: 110px 1fr; }
}
</style>
