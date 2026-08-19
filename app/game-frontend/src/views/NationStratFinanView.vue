<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { trpc } from '../utils/trpc';
import { resolveDiplomacyInfo } from '../utils/diplomacy';
import { legacyNationTextColor } from '../utils/legacyNationColor';
import LegacyHtmlEditor from '../components/ui/LegacyHtmlEditor.vue';

type StratFinanResponse = Awaited<ReturnType<typeof trpc.nation.getStratFinan.query>>;
type NationEntry = StratFinanResponse['nationsList'][number];

const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<string | null>(null);
const data = ref<StratFinanResponse | null>(null);
const nationMsg = ref('');
const scoutMsg = ref('');
const nationMsgDraft = ref('');
const scoutMsgDraft = ref('');
const editingNationMsg = ref(false);
const editingScoutMsg = ref(false);
const policy = reactive({ rate: 0, bill: 0, secretLimit: 0, blockScout: false, blockWar: false });
const oldPolicy = reactive({ rate: 0, bill: 0, secretLimit: 0 });

const resolveErrorMessage = (value: unknown): string =>
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'unknown_error';

const loadStratFinan = async () => {
    if (loading.value) return;
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
const formatNumber = (value: number): string => new Intl.NumberFormat('ko-KR').format(value);
const incomeGoldCity = computed(() => ((data.value?.income.gold.city ?? 0) * policy.rate) / 100);
const incomeGold = computed(() => incomeGoldCity.value + (data.value?.income.gold.war ?? 0));
const incomeRiceCity = computed(() => ((data.value?.income.rice.city ?? 0) * policy.rate) / 100);
const incomeRiceWall = computed(() => ((data.value?.income.rice.wall ?? 0) * policy.rate) / 100);
const incomeRice = computed(() => incomeRiceCity.value + incomeRiceWall.value);
const outcomeByBill = computed(() => ((data.value?.outcome ?? 0) * policy.bill) / 100);
const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;
const parseYearMonth = (value: number): [number, number] => [Math.floor(value / 12), (value % 12) + 1];
const resolveDiplomacyEnd = (term: number | null): string => {
    if (!data.value || !term) return '-';
    const [year, month] = parseYearMonth(joinYearMonth(data.value.year, data.value.month) + term);
    return `${year}년 ${month}월`;
};
const formatDiplomacyTerm = (term: number | null): string => (term ? `${term}개월` : '-');
const diplomacyInfo = (nation: NationEntry) => resolveDiplomacyInfo(nation.diplomacy.state);

const mutation = async <T,>(
    action: () => Promise<T>,
    message: string,
    rollback?: () => void
): Promise<T | undefined> => {
    error.value = null;
    status.value = null;
    try {
        const result = await action();
        status.value = message;
        return result;
    } catch (err) {
        rollback?.();
        error.value = resolveErrorMessage(err);
        return undefined;
    }
};

const enableEditNationMsg = () => {
    if (!canEdit.value) return;
    nationMsgDraft.value = nationMsg.value;
    editingNationMsg.value = true;
};
const rollbackNationMsg = () => {
    nationMsgDraft.value = nationMsg.value;
    editingNationMsg.value = false;
};
const saveNationMsg = async () => {
    const result = await mutation(
        () => trpc.nation.setNotice.mutate({ msg: nationMsgDraft.value }),
        '국가 방침을 변경했습니다.'
    );
    if (result) {
        nationMsg.value = result.msg;
        nationMsgDraft.value = result.msg;
        editingNationMsg.value = false;
    }
};
const enableEditScoutMsg = () => {
    if (!canEdit.value) return;
    scoutMsgDraft.value = scoutMsg.value;
    editingScoutMsg.value = true;
};
const rollbackScoutMsg = () => {
    scoutMsgDraft.value = scoutMsg.value;
    editingScoutMsg.value = false;
};
const saveScoutMsg = async () => {
    const result = await mutation(
        () => trpc.nation.setScoutMsg.mutate({ msg: scoutMsgDraft.value }),
        '임관 권유문을 변경했습니다.'
    );
    if (result) {
        scoutMsg.value = result.msg;
        scoutMsgDraft.value = result.msg;
        editingScoutMsg.value = false;
    }
};
const setRate = () =>
    mutation(
        () => trpc.nation.setRate.mutate({ amount: policy.rate }),
        '세율을 변경했습니다.',
        () => (policy.rate = oldPolicy.rate)
    ).then(() => {
        if (!error.value) oldPolicy.rate = policy.rate;
    });
const setBill = () =>
    mutation(
        () => trpc.nation.setBill.mutate({ amount: policy.bill }),
        '지급률을 변경했습니다.',
        () => (policy.bill = oldPolicy.bill)
    ).then(() => {
        if (!error.value) oldPolicy.bill = policy.bill;
    });
const setSecretLimit = () =>
    mutation(
        () => trpc.nation.setSecretLimit.mutate({ amount: policy.secretLimit }),
        '기밀 권한을 변경했습니다.',
        () => (policy.secretLimit = oldPolicy.secretLimit)
    ).then(() => {
        if (!error.value) oldPolicy.secretLimit = policy.secretLimit;
    });
const setBlockWar = async () => {
    const next = policy.blockWar;
    await mutation(
        async () => {
            const result = await trpc.nation.setBlockWar.mutate({ value: next });
            if (data.value) data.value.warSettingCnt.remain = result.availableCnt;
        },
        '전쟁 금지 설정을 변경했습니다.',
        () => (policy.blockWar = !next)
    );
};
const setBlockScout = async () => {
    const next = policy.blockScout;
    await mutation(
        () => trpc.nation.setBlockScout.mutate({ value: next }),
        '임관 금지 설정을 변경했습니다.',
        () => (policy.blockScout = !next)
    );
};

onMounted(() => void loadStratFinan());
</script>

<template>
    <main id="finance-container" class="page-finance">
        <nav class="top-back-bar">
            <RouterLink class="legacy-button" to="/">돌아가기</RouterLink>
            <span />
            <strong>내무부</strong>
            <span />
        </nav>

        <div v-if="error" class="feedback error" role="alert">{{ error }}</div>
        <div v-if="status" class="feedback status" role="status">{{ status }}</div>
        <div v-if="loading" class="loading">불러오는 중...</div>

        <template v-if="data && !loading">
            <div class="diplomacy-title">외교관계</div>
            <div class="diplomacy-table">
                <div class="diplomacy-row diplomacy-header">
                    <div>국가명</div>
                    <div>국력</div>
                    <div>장수</div>
                    <div>속령</div>
                    <div>상태</div>
                    <div>기간</div>
                    <div>종료 시점</div>
                </div>
                <div v-for="nation in nationsList" :key="nation.id" class="diplomacy-row">
                    <div :style="{ backgroundColor: nation.color, color: legacyNationTextColor(nation.color) }">
                        {{ nation.name }}
                    </div>
                    <div>{{ formatNumber(nation.power) }}</div>
                    <div>{{ formatNumber(nation.generalCount) }}</div>
                    <div>{{ formatNumber(nation.cityCount) }}</div>
                    <template v-if="nation.id === data.nationId">
                        <div>-</div>
                        <div>-</div>
                        <div>-</div>
                    </template>
                    <template v-else>
                        <div :style="{ color: diplomacyInfo(nation).color ?? undefined }">
                            {{ diplomacyInfo(nation).name }}
                        </div>
                        <div>{{ formatDiplomacyTerm(nation.diplomacy.term) }}</div>
                        <div>{{ resolveDiplomacyEnd(nation.diplomacy.term) }}</div>
                    </template>
                </div>
            </div>

            <div class="notice-title">국가 방침 &amp; 임관 권유 메시지</div>
            <section id="notice-form" class="message-form" :class="{ 'message-form--editing': editingNationMsg }">
                <header class="green-header">
                    <span>국가 방침</span>
                    <span>
                        <button
                            v-if="canEdit && !editingNationMsg"
                            class="message-button"
                            type="button"
                            @click="enableEditNationMsg"
                        >
                            국가방침 수정
                        </button>
                        <button
                            v-if="canEdit && editingNationMsg"
                            class="policy-submit"
                            type="button"
                            @click="saveNationMsg"
                        >
                            저장
                        </button>
                        <button
                            v-if="canEdit && editingNationMsg"
                            class="policy-cancel"
                            type="button"
                            @click="rollbackNationMsg"
                        >
                            취소
                        </button>
                    </span>
                </header>
                <div v-if="!editingNationMsg" class="message-preview" v-html="nationMsg || '내용 없음'" />
                <LegacyHtmlEditor
                    v-else
                    v-model="nationMsgDraft"
                    :max-length="16384"
                    aria-label="국가 방침"
                />
            </section>
            <section
                id="scout-message-form"
                class="message-form"
                :class="{ 'message-form--editing': editingScoutMsg }"
            >
                <header class="green-header">
                    <span>임관 권유</span>
                    <span>
                        <button
                            v-if="canEdit && !editingScoutMsg"
                            class="message-button"
                            type="button"
                            @click="enableEditScoutMsg"
                        >
                            임관 권유문 수정
                        </button>
                        <button
                            v-if="canEdit && editingScoutMsg"
                            class="policy-submit"
                            type="button"
                            @click="saveScoutMsg"
                        >
                            저장
                        </button>
                        <button
                            v-if="canEdit && editingScoutMsg"
                            class="policy-cancel"
                            type="button"
                            @click="rollbackScoutMsg"
                        >
                            취소
                        </button>
                    </span>
                </header>
                <div class="scout-limit">870px x 200px를 넘어서는 내용은 표시되지 않습니다.</div>
                <div v-if="!editingScoutMsg" class="message-preview scout-preview" v-html="scoutMsg || '내용 없음'" />
                <LegacyHtmlEditor
                    v-else
                    v-model="scoutMsgDraft"
                    :max-length="1000"
                    aria-label="임관 권유"
                />
            </section>

            <div class="finance-title">예산&amp;정책</div>
            <section class="finance-grid">
                <div class="budget-column">
                    <div class="blue-heading">자금 예산</div>
                    <div class="budget-row">
                        <span>현 재</span><span>{{ formatNumber(data.gold) }}</span>
                    </div>
                    <div class="budget-row">
                        <span>단기수입</span><span>{{ formatNumber(data.income.gold.war) }}</span>
                    </div>
                    <div class="budget-row">
                        <span>세 금</span><span>{{ formatNumber(Math.floor(incomeGoldCity)) }}</span>
                    </div>
                    <div class="budget-row">
                        <span>수입/지출</span
                        ><span
                            >+{{ formatNumber(Math.floor(incomeGold)) }} /
                            {{ formatNumber(Math.floor(-outcomeByBill)) }}</span
                        >
                    </div>
                    <div class="budget-row">
                        <span>국고 예산</span
                        ><span
                            >{{ formatNumber(Math.floor(data.gold + incomeGold - outcomeByBill)) }} ({{
                                incomeGold >= outcomeByBill ? '+' : ''
                            }}{{ formatNumber(Math.floor(incomeGold - outcomeByBill)) }})</span
                        >
                    </div>
                </div>
                <div class="budget-column">
                    <div class="blue-heading">군량 예산</div>
                    <div class="budget-row">
                        <span>현 재</span><span>{{ formatNumber(data.rice) }}</span>
                    </div>
                    <div class="budget-row">
                        <span>둔전수입</span><span>{{ formatNumber(Math.floor(incomeRiceWall)) }}</span>
                    </div>
                    <div class="budget-row">
                        <span>세 금</span><span>{{ formatNumber(Math.floor(incomeRiceCity)) }}</span>
                    </div>
                    <div class="budget-row">
                        <span>수입/지출</span
                        ><span
                            >+{{ formatNumber(Math.floor(incomeRice)) }} /
                            {{ formatNumber(Math.floor(-outcomeByBill)) }}</span
                        >
                    </div>
                    <div class="budget-row">
                        <span>국고 예산</span
                        ><span
                            >{{ formatNumber(Math.floor(data.rice + incomeRice - outcomeByBill)) }} ({{
                                incomeRice >= outcomeByBill ? '+' : ''
                            }}{{ formatNumber(Math.floor(incomeRice - outcomeByBill)) }})</span
                        >
                    </div>
                </div>
                <div class="policy-cell">
                    <div class="green-label">세율 <span>(5 ~ 30%)</span></div>
                    <div class="policy-control">
                        <input v-model.number="policy.rate" aria-label="세율" type="number" min="5" max="30" /><span
                            >%</span
                        >
                        <button v-if="canEdit" class="policy-submit" type="button" @click="setRate">변경</button>
                        <button
                            v-if="canEdit"
                            class="policy-cancel"
                            type="button"
                            @click="policy.rate = oldPolicy.rate"
                        >
                            취소
                        </button>
                    </div>
                </div>
                <div class="policy-cell">
                    <div class="green-label">지급률 <span>(20 ~ 200%)</span></div>
                    <div class="policy-control">
                        <input v-model.number="policy.bill" aria-label="지급률" type="number" min="20" max="200" /><span
                            >%</span
                        >
                        <button v-if="canEdit" class="policy-submit" type="button" @click="setBill">변경</button>
                        <button
                            v-if="canEdit"
                            class="policy-cancel"
                            type="button"
                            @click="policy.bill = oldPolicy.bill"
                        >
                            취소
                        </button>
                    </div>
                </div>
                <div class="policy-cell">
                    <div class="green-label">기밀 권한 <span>(1 ~ 99년)</span></div>
                    <div class="policy-control">
                        <input
                            v-model.number="policy.secretLimit"
                            aria-label="기밀 권한"
                            type="number"
                            min="1"
                            max="99"
                        /><span>년</span>
                        <button v-if="canEdit" class="policy-submit" type="button" @click="setSecretLimit">변경</button>
                        <button
                            v-if="canEdit"
                            class="policy-cancel"
                            type="button"
                            @click="policy.secretLimit = oldPolicy.secretLimit"
                        >
                            취소
                        </button>
                    </div>
                </div>
                <div class="policy-cell">
                    <div class="green-label">전쟁 금지 설정</div>
                    <div class="war-count">
                        {{ warSettingCnt.remain }} 회(월 +{{ warSettingCnt.inc }}회, 최대{{ warSettingCnt.max }}회)
                    </div>
                </div>
                <div class="policy-toggles">
                    <label
                        ><span>전쟁 금지</span
                        ><input v-model="policy.blockWar" type="checkbox" :disabled="!canEdit" @change="setBlockWar"
                    /></label>
                    <label
                        ><span>임관 금지</span
                        ><input
                            v-model="policy.blockScout"
                            type="checkbox"
                            :disabled="!canEdit"
                            @change="setBlockScout"
                    /></label>
                </div>
            </section>
            <div>추가 설정</div>
            <div class="tiptap-compat-controls" aria-hidden="true">
                <button v-for="index in 8" :key="`compat-button-${index}`" type="button" tabindex="-1" />
                <input v-for="index in 4" :key="`compat-input-${index}`" type="hidden" />
            </div>
            <footer class="bottom-bar">
                <RouterLink class="legacy-button" to="/">돌아가기</RouterLink>
            </footer>
        </template>
    </main>
</template>

<style scoped>
.page-finance {
    width: 1000px;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    background: var(--sammo-texture-walnut);
    font: 14px/1.3 var(--sammo-font-sans);
}
.tiptap-compat-controls {
    display: none;
}
.top-back-bar,
.bottom-bar {
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
    align-items: center;
    width: 100%;
    height: 32px;
}
.top-back-bar strong,
.bottom-bar strong {
    grid-column: 3;
    text-align: center;
}
.top-back-bar button {
    grid-column: 5;
}
.legacy-button,
button {
    box-sizing: border-box;
    border: 1px solid #00502a;
    border-radius: 4px;
    padding: 5.25px 10.5px;
    color: #fff;
    background: #00582c;
    font: inherit;
    line-height: 21px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
}
.message-button,
.policy-cancel {
    border-color: #6c757d;
    background: #6c757d;
}
.policy-submit {
    border-color: #325172;
    background: #375a7f;
}
button:hover,
.legacy-button:hover {
    filter: brightness(1.2);
}
button:focus-visible,
.legacy-button:focus-visible,
input:focus-visible,
textarea:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
}
.diplomacy-title,
.notice-title,
.finance-title {
    height: 25.47px;
    text-align: center;
    font-size: 19.6px;
    line-height: 25.47px;
}
.diplomacy-title {
    background: #375a7f;
}
.notice-title {
    color: #000;
    background: #fff;
}
.finance-title {
    background: #00bc8c;
}
.diplomacy-row {
    display: grid;
    grid-template-columns: minmax(130px, 3fr) 1.5fr 1fr 1fr 2fr 1fr 2fr;
    min-height: 18.19px;
    text-align: center;
}
.diplomacy-row > div {
    border-bottom: 1px solid gray;
    overflow: hidden;
    white-space: nowrap;
}
.diplomacy-header {
    background: var(--sammo-texture-green);
}
.green-header {
    display: flex;
    min-height: 18.19px;
    align-items: center;
    justify-content: space-between;
    background: var(--sammo-texture-green);
}
.message-preview,
textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 42px;
    border: 1px solid gray;
    padding: 6px;
    color: #fff;
    background: transparent;
    font: inherit;
}
.scout-limit {
    border-bottom: 0.5px solid gray;
}
.scout-preview,
.scout-editor {
    width: 870px;
    max-height: 200px;
    margin-left: auto;
    overflow: hidden;
}
.finance-grid {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    height: 205.88px;
    margin-bottom: 13.25px;
    overflow: hidden;
}
.budget-column,
.policy-cell {
    box-sizing: border-box;
    width: 50%;
}
.blue-heading {
    height: 18.19px;
    text-align: center;
    background: var(--sammo-texture-blue);
}
.budget-row,
.policy-cell {
    display: grid;
    grid-template-columns: 33.333% 66.667%;
    min-height: 18.19px;
    text-align: center;
}
.budget-row span:first-child,
.green-label {
    background: var(--sammo-texture-green);
}
.budget-row > span,
.green-label,
.policy-control,
.war-count {
    box-sizing: border-box;
    border: 1px solid rgba(128, 128, 128, 0.65);
}
.green-label,
.war-count {
    display: flex;
    align-items: center;
    justify-content: center;
}
.policy-control {
    display: flex;
    min-height: 30px;
    align-items: center;
    justify-content: center;
}
.policy-control input {
    box-sizing: border-box;
    width: 58.66px;
    height: 30px;
    border: 1px solid #000;
    padding: 3.5px 0;
    color: #303030;
    background: #ddd;
    font: inherit;
    text-align: right;
}
.policy-control button {
    padding: 3px 7px;
}
.policy-toggles {
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 45px;
}
.policy-toggles label {
    display: flex;
    align-items: center;
    gap: 8px;
}
.policy-toggles input {
    position: relative;
    width: 32px;
    height: 16px;
    appearance: none;
    border: 0;
    border-radius: 16px;
    background: #adb5bd;
    cursor: pointer;
}
.policy-toggles input::before {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    content: '';
    transition: transform 0.15s ease-in-out;
}
.policy-toggles input:checked {
    background: #00bc8c;
}
.policy-toggles input:checked::before {
    transform: translateX(16px);
}
.policy-toggles input:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}
.feedback,
.loading {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid gray;
    padding: 6px 8px;
}
.error {
    color: #ff8080;
}
.status {
    color: #80ff80;
}
.bottom-bar {
    margin-top: 8px;
}
@media (max-width: 939.98px) {
    .page-finance {
        width: 500px;
        margin: 0;
        overflow-x: hidden;
    }
    .top-back-bar,
    .bottom-bar {
        grid-template-columns: 90px 90px 140px 90px 90px;
    }
    .message-preview:not(.scout-preview),
    #notice-form textarea {
        width: 1000px;
        transform: scale(0.5);
        transform-origin: left top;
        margin-bottom: -22.75px;
    }
    .scout-preview,
    .scout-editor {
        width: 870px;
        transform: scale(calc(500 / 870));
        transform-origin: left top;
        margin-bottom: -19px;
    }
    .policy-control {
        min-height: 36px;
    }
    .policy-toggles {
        min-height: 38px;
    }
    #notice-form {
        height: 39.19px;
        overflow: hidden;
    }
    #scout-message-form {
        height: 61.5px;
        overflow: hidden;
    }
    #notice-form.message-form--editing,
    #scout-message-form.message-form--editing {
        height: auto;
        overflow: visible;
    }
    .finance-grid {
        height: 218.63px;
        margin-bottom: 15.25px;
    }
}
</style>
