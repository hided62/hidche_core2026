<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import { resolveDiplomacyInfo } from '../utils/diplomacy';

type StratFinanResponse = Awaited<ReturnType<typeof trpc.nation.getStratFinan.query>>;
type NationEntry = StratFinanResponse['nationsList'][number];

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<StratFinanResponse | null>(null);

const nationMsg = ref('');
const scoutMsg = ref('');
const nationMsgDraft = ref('');
const scoutMsgDraft = ref('');
const editingNationMsg = ref(false);
const editingScoutMsg = ref(false);

const policy = reactive({
    rate: 0,
    bill: 0,
    secretLimit: 0,
    blockScout: false,
    blockWar: false,
});

const oldPolicy = reactive({
    rate: 0,
    bill: 0,
    secretLimit: 0,
});

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const loadStratFinan = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        const response = await trpc.nation.getStratFinan.query();
        data.value = response;
        nationMsg.value = response.nationMsg ?? '';
        scoutMsg.value = response.scoutMsg ?? '';
        nationMsgDraft.value = nationMsg.value;
        scoutMsgDraft.value = scoutMsg.value;
        Object.assign(policy, response.policy);
        Object.assign(oldPolicy, response.policy);
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const canEdit = computed(() => data.value?.editable ?? false);
const nationsList = computed(() => data.value?.nationsList ?? []);
const warSettingCnt = computed(() => data.value?.warSettingCnt ?? { remain: 0, inc: 0, max: 0 });

const statusLine = computed(() => {
    if (!data.value) {
        return '내무부 정보를 불러오는 중';
    }
    return `${data.value.year}년 ${data.value.month}월`;
});

const formatNumber = (value: number): string => new Intl.NumberFormat('ko-KR').format(value);

const incomeGoldCity = computed(() => {
    if (!data.value) {
        return 0;
    }
    return (data.value.income.gold.city * policy.rate) / 100;
});

const incomeGold = computed(() => {
    if (!data.value) {
        return 0;
    }
    return incomeGoldCity.value + data.value.income.gold.war;
});

const incomeRiceCity = computed(() => {
    if (!data.value) {
        return 0;
    }
    return (data.value.income.rice.city * policy.rate) / 100;
});

const incomeRiceWall = computed(() => {
    if (!data.value) {
        return 0;
    }
    return (data.value.income.rice.wall * policy.rate) / 100;
});

const incomeRice = computed(() => incomeRiceCity.value + incomeRiceWall.value);

const outcomeByBill = computed(() => {
    if (!data.value) {
        return 0;
    }
    return (data.value.outcome * policy.bill) / 100;
});

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

const parseYearMonth = (value: number): [number, number] => {
    return [Math.floor(value / 12), (value % 12) + 1];
};

const resolveDiplomacyEnd = (term: number | null): string => {
    if (!data.value || !term) {
        return '-';
    }
    const [endYear, endMonth] = parseYearMonth(joinYearMonth(data.value.year, data.value.month) + term);
    return `${endYear}년 ${endMonth}월`;
};

const enableEditNationMsg = () => {
    if (!canEdit.value) {
        return;
    }
    editingNationMsg.value = true;
    nationMsgDraft.value = nationMsg.value;
};

const rollbackNationMsg = () => {
    editingNationMsg.value = false;
    nationMsgDraft.value = nationMsg.value;
};

const saveNationMsg = async () => {
    if (!canEdit.value) {
        return;
    }
    try {
        await trpc.nation.setNotice.mutate({ msg: nationMsgDraft.value });
        nationMsg.value = nationMsgDraft.value;
        editingNationMsg.value = false;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const enableEditScoutMsg = () => {
    if (!canEdit.value) {
        return;
    }
    editingScoutMsg.value = true;
    scoutMsgDraft.value = scoutMsg.value;
};

const rollbackScoutMsg = () => {
    editingScoutMsg.value = false;
    scoutMsgDraft.value = scoutMsg.value;
};

const saveScoutMsg = async () => {
    if (!canEdit.value) {
        return;
    }
    try {
        await trpc.nation.setScoutMsg.mutate({ msg: scoutMsgDraft.value });
        scoutMsg.value = scoutMsgDraft.value;
        editingScoutMsg.value = false;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const setRate = async () => {
    if (!canEdit.value) {
        return;
    }
    try {
        await trpc.nation.setRate.mutate({ amount: policy.rate });
        oldPolicy.rate = policy.rate;
    } catch (err) {
        error.value = resolveErrorMessage(err);
        policy.rate = oldPolicy.rate;
    }
};

const rollbackRate = () => {
    policy.rate = oldPolicy.rate;
};

const setBill = async () => {
    if (!canEdit.value) {
        return;
    }
    try {
        await trpc.nation.setBill.mutate({ amount: policy.bill });
        oldPolicy.bill = policy.bill;
    } catch (err) {
        error.value = resolveErrorMessage(err);
        policy.bill = oldPolicy.bill;
    }
};

const rollbackBill = () => {
    policy.bill = oldPolicy.bill;
};

const setSecretLimit = async () => {
    if (!canEdit.value) {
        return;
    }
    try {
        await trpc.nation.setSecretLimit.mutate({ amount: policy.secretLimit });
        oldPolicy.secretLimit = policy.secretLimit;
    } catch (err) {
        error.value = resolveErrorMessage(err);
        policy.secretLimit = oldPolicy.secretLimit;
    }
};

const rollbackSecretLimit = () => {
    policy.secretLimit = oldPolicy.secretLimit;
};

const setBlockWar = async () => {
    if (!canEdit.value || !data.value) {
        return;
    }
    const nextValue = policy.blockWar;
    try {
        const result = await trpc.nation.setBlockWar.mutate({ value: nextValue });
        data.value.warSettingCnt.remain = result.availableCnt;
    } catch (err) {
        error.value = resolveErrorMessage(err);
        policy.blockWar = !nextValue;
    }
};

const setBlockScout = async () => {
    if (!canEdit.value) {
        return;
    }
    const nextValue = policy.blockScout;
    try {
        await trpc.nation.setBlockScout.mutate({ value: nextValue });
    } catch (err) {
        error.value = resolveErrorMessage(err);
        policy.blockScout = !nextValue;
    }
};

const formatDiplomacyTerm = (term: number | null): string => {
    if (!term) {
        return '-';
    }
    return `${term}개월`;
};

const diplomacyInfo = (nation: NationEntry) => resolveDiplomacyInfo(nation.diplomacy.state);

onMounted(() => {
    void loadStratFinan();
});
</script>

<template>
    <main class="finance-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">내무부</h1>
                <p class="page-subtitle">{{ statusLine }}</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <RouterLink class="ghost" to="/nation/cities">세력 도시</RouterLink>
                <RouterLink class="ghost" to="/nation/generals">세력 장수</RouterLink>
                <button class="ghost" @click="loadStratFinan">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <section class="layout-grid">
            <div class="stack">
                <PanelCard title="외교 관계" subtitle="현 세력 외교 상황">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="table-scroll">
                        <table class="finance-table">
                            <thead>
                                <tr>
                                    <th>국가명</th>
                                    <th>국력</th>
                                    <th>장수</th>
                                    <th>속령</th>
                                    <th>상태</th>
                                    <th>기간</th>
                                    <th>종료 시점</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="nation in nationsList" :key="nation.id">
                                    <td>
                                        <span class="nation-swatch" :style="{ backgroundColor: nation.color }" />
                                        {{ nation.name }}
                                    </td>
                                    <td>{{ formatNumber(nation.power) }}</td>
                                    <td>{{ formatNumber(nation.generalCount) }}</td>
                                    <td>{{ formatNumber(nation.cityCount) }}</td>
                                    <template v-if="nation.id === data?.nationId">
                                        <td>-</td>
                                        <td>-</td>
                                        <td>-</td>
                                    </template>
                                    <template v-else>
                                        <td :style="{ color: diplomacyInfo(nation).color ?? undefined }">
                                            {{ diplomacyInfo(nation).name }}
                                        </td>
                                        <td>{{ formatDiplomacyTerm(nation.diplomacy.term) }}</td>
                                        <td>{{ resolveDiplomacyEnd(nation.diplomacy.term) }}</td>
                                    </template>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </PanelCard>

                <PanelCard title="국가 방침">
                    <template #actions>
                        <button v-if="canEdit && !editingNationMsg" class="ghost" @click="enableEditNationMsg">
                            국가방침 수정
                        </button>
                        <button v-if="canEdit && editingNationMsg" class="ghost" @click="saveNationMsg">저장</button>
                        <button v-if="canEdit && editingNationMsg" class="ghost" @click="rollbackNationMsg">취소</button>
                    </template>
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="message-block">
                        <div v-if="!editingNationMsg" class="message-preview" v-html="nationMsg || '내용 없음'" />
                        <textarea
                            v-else
                            v-model="nationMsgDraft"
                            class="text-area"
                            rows="6"
                            maxlength="16384"
                        />
                    </div>
                </PanelCard>

                <PanelCard title="임관 권유">
                    <template #actions>
                        <button v-if="canEdit && !editingScoutMsg" class="ghost" @click="enableEditScoutMsg">
                            임관 권유문 수정
                        </button>
                        <button v-if="canEdit && editingScoutMsg" class="ghost" @click="saveScoutMsg">저장</button>
                        <button v-if="canEdit && editingScoutMsg" class="ghost" @click="rollbackScoutMsg">취소</button>
                    </template>
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else class="message-block">
                        <div class="hint">870px x 200px를 넘어서는 내용은 표시되지 않습니다.</div>
                        <div v-if="!editingScoutMsg" class="message-preview" v-html="scoutMsg || '내용 없음'" />
                        <textarea
                            v-else
                            v-model="scoutMsgDraft"
                            class="text-area"
                            rows="4"
                            maxlength="1000"
                        />
                    </div>
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="예산 요약" subtitle="세입/세출 추산">
                    <SkeletonLines v-if="loading" :lines="5" />
                    <div v-else class="budget-grid">
                        <div class="budget-card">
                            <div class="budget-title">자금 예산</div>
                            <div class="budget-row">
                                <span>현 재</span>
                                <span>{{ formatNumber(Math.floor(data?.gold ?? 0)) }}</span>
                            </div>
                            <div class="budget-row">
                                <span>단기수입</span>
                                <span>{{ formatNumber(Math.floor(data?.income.gold.war ?? 0)) }}</span>
                            </div>
                            <div class="budget-row">
                                <span>세 금</span>
                                <span>{{ formatNumber(Math.floor(incomeGoldCity)) }}</span>
                            </div>
                            <div class="budget-row">
                                <span>수입/지출</span>
                                <span>
                                    +{{ formatNumber(Math.floor(incomeGold)) }} /
                                    {{ formatNumber(Math.floor(-outcomeByBill)) }}
                                </span>
                            </div>
                            <div class="budget-row total">
                                <span>국고 예산</span>
                                <span>
                                    {{ formatNumber(Math.floor((data?.gold ?? 0) + incomeGold - outcomeByBill)) }}
                                    ({{ incomeGold >= outcomeByBill ? '+' : '' }}{{
                                        formatNumber(Math.floor(incomeGold - outcomeByBill))
                                    }})
                                </span>
                            </div>
                        </div>

                        <div class="budget-card">
                            <div class="budget-title">군량 예산</div>
                            <div class="budget-row">
                                <span>현 재</span>
                                <span>{{ formatNumber(Math.floor(data?.rice ?? 0)) }}</span>
                            </div>
                            <div class="budget-row">
                                <span>둔전수입</span>
                                <span>{{ formatNumber(Math.floor(incomeRiceWall)) }}</span>
                            </div>
                            <div class="budget-row">
                                <span>세 금</span>
                                <span>{{ formatNumber(Math.floor(incomeRiceCity)) }}</span>
                            </div>
                            <div class="budget-row">
                                <span>수입/지출</span>
                                <span>
                                    +{{ formatNumber(Math.floor(incomeRice)) }} /
                                    {{ formatNumber(Math.floor(-outcomeByBill)) }}
                                </span>
                            </div>
                            <div class="budget-row total">
                                <span>국고 예산</span>
                                <span>
                                    {{ formatNumber(Math.floor((data?.rice ?? 0) + incomeRice - outcomeByBill)) }}
                                    ({{ incomeRice >= outcomeByBill ? '+' : '' }}{{
                                        formatNumber(Math.floor(incomeRice - outcomeByBill))
                                    }})
                                </span>
                            </div>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="정책 설정" subtitle="세율/지급률/기밀 권한">
                    <div class="policy-grid">
                        <div class="policy-row">
                            <div class="policy-label">세율 (5 ~ 30%)</div>
                            <div class="policy-control">
                                <input
                                    v-model.number="policy.rate"
                                    class="number-input"
                                    type="number"
                                    min="5"
                                    max="30"
                                    :disabled="!canEdit"
                                />
                                <button class="ghost" :disabled="!canEdit" @click="setRate">변경</button>
                                <button class="ghost" :disabled="!canEdit" @click="rollbackRate">취소</button>
                            </div>
                        </div>
                        <div class="policy-row">
                            <div class="policy-label">지급률 (20 ~ 200%)</div>
                            <div class="policy-control">
                                <input
                                    v-model.number="policy.bill"
                                    class="number-input"
                                    type="number"
                                    min="20"
                                    max="200"
                                    :disabled="!canEdit"
                                />
                                <button class="ghost" :disabled="!canEdit" @click="setBill">변경</button>
                                <button class="ghost" :disabled="!canEdit" @click="rollbackBill">취소</button>
                            </div>
                        </div>
                        <div class="policy-row">
                            <div class="policy-label">기밀 권한 (1 ~ 99년)</div>
                            <div class="policy-control">
                                <input
                                    v-model.number="policy.secretLimit"
                                    class="number-input"
                                    type="number"
                                    min="1"
                                    max="99"
                                    :disabled="!canEdit"
                                />
                                <button class="ghost" :disabled="!canEdit" @click="setSecretLimit">변경</button>
                                <button class="ghost" :disabled="!canEdit" @click="rollbackSecretLimit">취소</button>
                            </div>
                        </div>
                        <div class="policy-row">
                            <div class="policy-label">전쟁 금지 설정</div>
                            <div class="policy-summary">
                                {{ warSettingCnt.remain }} 회 (월 +{{ warSettingCnt.inc }}회, 최대{{ warSettingCnt.max }}회)
                            </div>
                        </div>
                        <div class="policy-toggles">
                            <label class="toggle">
                                <input
                                    v-model="policy.blockWar"
                                    type="checkbox"
                                    :disabled="!canEdit"
                                    @change="setBlockWar"
                                />
                                <span>전쟁 금지</span>
                            </label>
                            <label class="toggle">
                                <input
                                    v-model="policy.blockScout"
                                    type="checkbox"
                                    :disabled="!canEdit"
                                    @change="setBlockScout"
                                />
                                <span>임관 금지</span>
                            </label>
                        </div>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.finance-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.page-title {
    font-size: 1.6rem;
    font-weight: 700;
}

.page-subtitle {
    color: rgba(232, 221, 196, 0.7);
    margin-top: 6px;
}

.header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.layout-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 18px;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.table-scroll {
    overflow-x: auto;
}

.finance-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
}

.finance-table th,
.finance-table td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.2);
    text-align: center;
}

.finance-table th {
    text-align: center;
    font-weight: 600;
}

.nation-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 6px;
}

.message-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.message-preview {
    min-height: 80px;
    padding: 10px;
    border: 1px solid rgba(201, 164, 90, 0.2);
    background: rgba(12, 12, 12, 0.5);
}

.text-area {
    width: 100%;
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(12, 12, 12, 0.7);
    color: inherit;
    padding: 8px;
    font-size: 0.9rem;
}

.hint {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.budget-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
}

.budget-card {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 10px;
    background: rgba(12, 12, 12, 0.6);
}

.budget-title {
    font-weight: 600;
    margin-bottom: 8px;
}

.budget-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 0.85rem;
}

.budget-row.total {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed rgba(201, 164, 90, 0.3);
    font-weight: 600;
}

.policy-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.policy-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.policy-label {
    font-size: 0.85rem;
}

.policy-control {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}

.policy-summary {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.8);
}

.policy-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 6px;
}

.toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
}

.number-input {
    width: 80px;
    padding: 4px 6px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(12, 12, 12, 0.7);
    color: inherit;
    text-align: right;
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.5);
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    font-size: 0.8rem;
    cursor: pointer;
}

.ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.error {
    color: #f08a5d;
    font-size: 0.9rem;
}
@media (max-width: 768px) {
    .page-header {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
