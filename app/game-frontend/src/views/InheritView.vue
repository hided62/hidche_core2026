<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { trpc } from '../utils/trpc';

type InheritStatus = Awaited<ReturnType<typeof trpc.inherit.getStatus.query>>;
type InheritLog = Awaited<ReturnType<typeof trpc.inherit.getLogs.query>>[number];
type JoinConfig = Awaited<ReturnType<typeof trpc.join.getConfig.query>>;

type BuffKey =
    | 'warAvoidRatio'
    | 'warCriticalRatio'
    | 'warMagicTrialProb'
    | 'domesticSuccessProb'
    | 'domesticFailProb'
    | 'warAvoidRatioOppose'
    | 'warCriticalRatioOppose'
    | 'warMagicTrialProbOppose';

const buffKeys: BuffKey[] = [
    'warAvoidRatio',
    'warCriticalRatio',
    'warMagicTrialProb',
    'domesticSuccessProb',
    'domesticFailProb',
    'warAvoidRatioOppose',
    'warCriticalRatioOppose',
    'warMagicTrialProbOppose',
];

const buffLabels: Record<BuffKey, string> = {
    warAvoidRatio: '회피 확률 증가',
    warCriticalRatio: '필살 확률 증가',
    warMagicTrialProb: '전투계략 시도 확률 증가',
    domesticSuccessProb: '내정 성공 확률 증가',
    domesticFailProb: '내정 실패 확률 감소',
    warAvoidRatioOppose: '상대 회피 확률 감소',
    warCriticalRatioOppose: '상대 필살 확률 감소',
    warMagicTrialProbOppose: '상대 전투계략 시도 확률 감소',
};

const pointLabels: Record<string, string> = {
    previous: '보유',
    lived_month: '생존',
    max_domestic_critical: '최대 연속 내정 성공',
    active_action: '능동 행동 수',
    combat: '전투 횟수',
    sabotage: '계략 성공 횟수',
    dex: '숙련도',
    unifier: '천통 기여',
    tournament: '토너먼트',
    betting: '베팅 당첨',
    max_belong: '최대 임관년 수',
};

const pointOrder = [
    'previous',
    'lived_month',
    'max_belong',
    'max_domestic_critical',
    'active_action',
    'combat',
    'sabotage',
    'unifier',
    'dex',
    'tournament',
    'betting',
] as const;

const pointHelp: Record<string, string> = {
    previous: '이전에 물려받은 포인트입니다.',
    lived_month: '살아남은 기간입니다. (1개월 단위)',
    max_belong: '가장 오래 임관했던 국가의 연도입니다.',
    max_domestic_critical: '성공한 내정 중 최대 연속값입니다.',
    active_action: '장수 동향에 본인의 이름이 직접 나타난 수입니다.일부 사령턴은 제외됩니다.',
    combat: '전투 횟수입니다.',
    sabotage: '계략 성공 횟수입니다.',
    unifier: '천통에 기여한 포인트입니다. 각 국의 군주, 천통 수뇌, 천통 군주가 받습니다.',
    dex: '총 숙련도합입니다. 최대 숙련 이후에는 상승량이 1/3로 감소합니다.',
    tournament: '토너먼트 입상 포인트입니다.',
    betting: '성공적인 베팅을 했습니다. 수익율과 베팅 성공 횟수를 따릅니다.',
};

const buffHelp: Record<BuffKey, string> = {
    warAvoidRatio: '전투 시 회피 확률이 1%p ~ 5%p 증가합니다.',
    warCriticalRatio: '전투 시 필살 확률이 1%p ~ 5%p 증가합니다.',
    warMagicTrialProb: '전투 시 계략을 시도할 확률이 1%p ~ 5%p 증가합니다. 무장도 계략을 시도합니다.',
    domesticSuccessProb: '민심, 인구, 농업, 상업, 치안, 수비, 성벽, 기술 내정의 성공 확률이 증가합니다.',
    domesticFailProb: '민심, 인구, 농업, 상업, 치안, 수비, 성벽, 기술 내정의 실패 확률이 감소합니다.',
    warAvoidRatioOppose: '전투 시 상대의 회피 확률이 1%p ~ 5%p 감소합니다.',
    warCriticalRatioOppose: '전투 시 상대의 필살 확률이 1%p ~ 5%p 감소합니다.',
    warMagicTrialProbOppose: '전투 시 상대의 계략 시도 확률이 1%p ~ 5%p 감소합니다.',
};

const loading = ref(true);
const error = ref<string | null>(null);
const status = ref<InheritStatus | null>(null);

const logs = ref<InheritLog[]>([]);
const logLoading = ref(false);
const logEnd = ref(false);

const actionError = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const actionBusy = ref(false);

const joinConfig = ref<JoinConfig | null>(null);

const buffTargets = reactive<Record<BuffKey, number>>({
    warAvoidRatio: 1,
    warCriticalRatio: 1,
    warMagicTrialProb: 1,
    domesticSuccessProb: 1,
    domesticFailProb: 1,
    warAvoidRatioOppose: 1,
    warCriticalRatioOppose: 1,
    warMagicTrialProbOppose: 1,
});

const nextSpecialKey = ref('');
const ownerTargetId = ref('');
const ownerResult = ref<{ targetName: string; ownerName: string } | null>(null);
const turnTimeResult = ref<string | null>(null);

const uniqueForm = reactive({
    itemId: '',
    amount: 0,
});

const resetStatForm = reactive({
    leadership: 0,
    strength: 0,
    intel: 0,
    bonus: [0, 0, 0] as [number, number, number],
});

const statRules = computed(() => joinConfig.value?.rules.stat ?? null);

const resetStatTotal = computed(() => resetStatForm.leadership + resetStatForm.strength + resetStatForm.intel);
const resetBonusSum = computed(() => resetStatForm.bonus.reduce((acc, value) => acc + value, 0));
const resetStatCost = computed(() =>
    resetBonusSum.value > 0 ? (status.value?.inheritConst.inheritBornStatPoint ?? 0) : 0
);

const resetStatErrors = computed(() => {
    const errors: string[] = [];
    const rules = statRules.value;
    if (rules) {
        if (resetStatTotal.value !== rules.total) {
            errors.push(`능력치 총합이 ${rules.total}이 아닙니다.`);
        }
        if (
            resetStatForm.leadership < rules.min ||
            resetStatForm.strength < rules.min ||
            resetStatForm.intel < rules.min ||
            resetStatForm.leadership > rules.max ||
            resetStatForm.strength > rules.max ||
            resetStatForm.intel > rules.max
        ) {
            errors.push(`능력치는 ${rules.min} ~ ${rules.max} 범위여야 합니다.`);
        }
    }
    if (resetBonusSum.value !== 0 && (resetBonusSum.value < 3 || resetBonusSum.value > 5)) {
        errors.push('보너스 능력치 합이 잘못되었습니다.');
    }
    return errors;
});

const turnTimeLabel = computed(() => {
    if (!turnTimeResult.value) {
        return null;
    }
    const parsed = new Date(turnTimeResult.value);
    if (Number.isNaN(parsed.getTime())) {
        return turnTimeResult.value;
    }
    return parsed.toLocaleString();
});

const isUnited = computed(() => status.value?.isUnited ?? false);

const pointEntries = computed(() => {
    if (!status.value) {
        return [] as Array<{ key: string; label: string; value: number }>;
    }
    return pointOrder.map((key) => ({
        key,
        label: pointLabels[key] ?? key,
        value: status.value?.items[key] ?? 0,
    }));
});

const previousPoint = computed(() => status.value?.items.previous ?? 0);
const newPoint = computed(() => (status.value?.totalPoint ?? 0) - previousPoint.value);

const specialNameMap = computed(() => {
    const map = new Map<string, string>();
    for (const entry of status.value?.availableSpecialWar ?? []) {
        map.set(entry.key, entry.name);
    }
    return map;
});
const selectedSpecialWarInfo = computed(
    () => status.value?.availableSpecialWar.find((entry) => entry.key === nextSpecialKey.value)?.info ?? ''
);

const buffCost = (key: BuffKey, target: number): number => {
    const points = status.value?.inheritConst.inheritBuffPoints ?? [0, 0, 0, 0, 0, 0];
    const current = status.value?.buffLevels[key] ?? 0;
    return Math.max(0, (points[target] ?? 0) - (points[current] ?? 0));
};

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const syncSelections = () => {
    if (!status.value) {
        return;
    }
    for (const key of buffKeys) {
        const current = status.value.buffLevels[key] ?? 0;
        buffTargets[key] = Math.min(5, Math.max(1, current + 1));
    }
    if (!nextSpecialKey.value) {
        nextSpecialKey.value = status.value.availableSpecialWar[0]?.key ?? '';
    }
    if (!ownerTargetId.value) {
        ownerTargetId.value = String(status.value.availableTargetGenerals[0]?.id ?? '');
    }
    if (!uniqueForm.amount) {
        uniqueForm.amount = status.value.inheritConst.inheritItemUniqueMinPoint;
    }
    if (!uniqueForm.itemId) {
        uniqueForm.itemId = status.value.availableUnique[0]?.key ?? '';
    }
    if (resetStatForm.leadership === 0 && resetStatForm.strength === 0 && resetStatForm.intel === 0) {
        resetStatForm.leadership = status.value.currentStat.leadership;
        resetStatForm.strength = status.value.currentStat.strength;
        resetStatForm.intel = status.value.currentStat.intel;
    }
};

const loadStatus = async () => {
    loading.value = true;
    error.value = null;
    actionError.value = null;
    try {
        status.value = await trpc.inherit.getStatus.query();
        syncSelections();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const loadJoinConfig = async () => {
    try {
        joinConfig.value = await trpc.join.getConfig.query();
    } catch {
        joinConfig.value = null;
    }
};

const loadLogs = async (reset = false) => {
    if (logLoading.value) {
        return;
    }
    logLoading.value = true;
    try {
        const lastId = reset ? undefined : logs.value[logs.value.length - 1]?.id;
        const result = await trpc.inherit.getLogs.query({ lastId });
        logs.value = reset ? result : [...logs.value, ...result];
        logEnd.value = result.length < 30;
    } catch (err) {
        actionError.value = resolveErrorMessage(err);
    } finally {
        logLoading.value = false;
    }
};

const runAction = async (action: () => Promise<void>, message?: string) => {
    if (actionBusy.value) {
        return;
    }
    actionBusy.value = true;
    actionError.value = null;
    actionMessage.value = null;
    try {
        await action();
        if (message) {
            actionMessage.value = message;
        }
        await loadStatus();
        await loadLogs(true);
    } catch (err) {
        actionError.value = resolveErrorMessage(err);
    } finally {
        actionBusy.value = false;
    }
};

const buyHiddenBuff = async (key: BuffKey) => {
    if (!status.value) {
        return;
    }
    const target = buffTargets[key];
    const cost = buffCost(key, target);
    if (!window.confirm(`${buffLabels[key]} ${target}단계를 ${cost} 포인트로 구입하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.inherit.buyHiddenBuff.mutate({ type: key, level: target });
    });
};

const reserveSpecialWar = async () => {
    if (!nextSpecialKey.value) {
        actionError.value = '다음 전투 특기를 선택해주세요.';
        return;
    }
    const name = specialNameMap.value.get(nextSpecialKey.value) ?? nextSpecialKey.value;
    const cost = status.value?.inheritConst.inheritSpecificSpecialPoint ?? 0;
    if (!window.confirm(`${name} 특기를 ${cost} 포인트로 예약하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.inherit.setNextSpecialWar.mutate({ specialKey: nextSpecialKey.value });
    });
};

const resetSpecialWar = async () => {
    const cost = status.value?.resetCosts.resetSpecialWar ?? 0;
    if (!window.confirm(`전투 특기를 ${cost} 포인트로 초기화하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.inherit.resetSpecialWar.mutate();
    });
};

const resetTurnTime = async () => {
    const cost = status.value?.resetCosts.resetTurnTime ?? 0;
    if (!window.confirm(`턴 시간을 ${cost} 포인트로 초기화하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        const result = await trpc.inherit.resetTurnTime.mutate();
        turnTimeResult.value = result.nextTurnTime;
    });
};

const resetStats = async () => {
    if (resetStatErrors.value.length > 0) {
        actionError.value = resetStatErrors.value[0] ?? '입력값을 확인해주세요.';
        return;
    }
    if (!window.confirm('능력치를 초기화하시겠습니까?')) {
        return;
    }
    await runAction(async () => {
        await trpc.inherit.resetStat.mutate({
            leadership: resetStatForm.leadership,
            strength: resetStatForm.strength,
            intel: resetStatForm.intel,
            inheritBonusStat: resetStatForm.bonus,
        });
    });
};

const buyRandomUnique = async () => {
    const cost = status.value?.inheritConst.inheritItemRandomPoint ?? 0;
    if (!window.confirm(`랜덤 유니크를 ${cost} 포인트로 구매하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.inherit.buyRandomUnique.mutate();
    });
};

const openUniqueAuction = async () => {
    if (!uniqueForm.itemId.trim()) {
        actionError.value = '유니크를 선택해주세요.';
        return;
    }
    const amount = Math.max(0, Math.floor(uniqueForm.amount));
    if (amount <= 0) {
        actionError.value = '입찰 포인트를 입력해주세요.';
        return;
    }
    if (!window.confirm(`유니크 경매를 ${amount} 포인트로 신청하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.inherit.openUniqueAuction.mutate({
            itemId: uniqueForm.itemId.trim(),
            amount,
        });
    });
};

const checkOwner = async () => {
    const targetId = Number(ownerTargetId.value);
    if (!targetId) {
        actionError.value = '확인할 장수를 선택해주세요.';
        return;
    }
    const cost = status.value?.inheritConst.inheritCheckOwnerPoint ?? 0;
    if (!window.confirm(`장수 소유자 확인에 ${cost} 포인트를 사용하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        const result = await trpc.inherit.checkOwner.mutate({ targetGeneralId: targetId });
        ownerResult.value = { targetName: result.targetName, ownerName: result.ownerName };
    });
};

onMounted(() => {
    void loadStatus();
    void loadJoinConfig();
    void loadLogs(true);
});
</script>

<template>
    <header class="top-back-bar legacy-bg0">
        <RouterLink class="top-button legacy-button legacy-button--navigation" to="/">돌아가기</RouterLink>
        <strong>유산 관리</strong>
        <button
            class="top-button legacy-button legacy-button--navigation"
            type="button"
            :disabled="loading"
            @click="loadStatus"
        >
            갱신
        </button>
    </header>

    <main id="container" class="inherit-page legacy-bg0">
        <input type="hidden" name="inheritanceAction" value="inherit" />
        <div v-if="error || actionError" class="notice error" role="alert">{{ error ?? actionError }}</div>
        <div v-if="actionMessage" class="notice success">{{ actionMessage }}</div>
        <div v-if="loading" class="loading-state">불러오는 중...</div>

        <template v-else-if="status">
            <section id="inheritance_list" class="point-grid">
                <article id="inherit_sum" class="inherit-item">
                    <label for="inherit_sum_value">총 포인트</label>
                    <input id="inherit_sum_value" :value="Math.floor(status.totalPoint).toLocaleString()" readonly />
                    <small>다음 플레이에서 사용할 수 있는 총 포인트입니다.</small>
                </article>
                <article id="inherit_previous" class="inherit-item">
                    <label for="inherit_previous_value">기존 포인트</label>
                    <input id="inherit_previous_value" :value="Math.floor(previousPoint).toLocaleString()" readonly />
                    <small>이전에 물려받은 포인트입니다.</small>
                </article>
                <article id="inherit_new" class="inherit-item">
                    <label for="inherit_new_value">신규 포인트</label>
                    <input id="inherit_new_value" :value="Math.floor(newPoint).toLocaleString()" readonly />
                    <small>이번 플레이에서 얻은 총 포인트입니다.</small>
                </article>
                <div class="divider"></div>
                <article
                    v-for="entry in pointEntries.filter((item) => item.key !== 'previous')"
                    :id="`inherit_${entry.key}`"
                    :key="entry.key"
                    class="inherit-item"
                >
                    <label :for="`inherit_${entry.key}_value`">{{ entry.label }}</label>
                    <input
                        :id="`inherit_${entry.key}_value`"
                        :value="Math.floor(entry.value).toLocaleString()"
                        readonly
                    />
                    <small>{{ pointHelp[entry.key] }}</small>
                </article>
            </section>

            <section id="inheritance_store">
                <h2 class="section-title legacy-bg1">유산 포인트 상점</h2>

                <div class="action-grid leading-actions">
                    <article class="shop-item">
                        <div class="control-row">
                            <label for="next-special">다음 전투 특기 선택</label>
                            <select id="next-special" v-model="nextSpecialKey">
                                <option v-for="entry in status.availableSpecialWar" :key="entry.key" :value="entry.key">
                                    {{ entry.name }}
                                </option>
                            </select>
                        </div>
                        <small
                            ><span v-if="selectedSpecialWarInfo" class="special-description">{{
                                selectedSpecialWarInfo
                            }}</span
                            ><br v-if="selectedSpecialWarInfo" />{{ specialNameMap.get(nextSpecialKey) }} 특기를 다음에
                            얻도록 지정합니다.<br /><b
                                >필요 포인트: {{ status.inheritConst.inheritSpecificSpecialPoint }}</b
                            ></small
                        >
                        <button
                            class="legacy-button legacy-button--primary buy-button"
                            :disabled="isUnited || actionBusy"
                            @click="reserveSpecialWar"
                        >
                            구입
                        </button>
                    </article>

                    <article class="shop-item">
                        <div class="control-row">
                            <label for="specific-unique">유니크 경매</label>
                            <select id="specific-unique" v-model="uniqueForm.itemId">
                                <option disabled value="">유니크 선택</option>
                                <option v-for="item in status.availableUnique" :key="item.key" :value="item.key">
                                    {{ item.name }}
                                </option>
                            </select>
                        </div>
                        <div class="control-row">
                            <label for="specific-unique-amount">입찰 포인트</label>
                            <input
                                id="specific-unique-amount"
                                v-model.number="uniqueForm.amount"
                                type="number"
                                :min="status.inheritConst.inheritItemUniqueMinPoint"
                                :max="previousPoint"
                            />
                        </div>
                        <small
                            >얻고자 하는 유니크 아이템으로 경매를 시작합니다. 24턴 동안 진행됩니다.<br />{{
                                status.availableUnique.find((item) => item.key === uniqueForm.itemId)?.info
                            }}</small
                        >
                        <button
                            class="legacy-button legacy-button--primary buy-button"
                            :disabled="isUnited || actionBusy"
                            @click="openUniqueAuction"
                        >
                            경매 시작
                        </button>
                    </article>
                </div>

                <div class="divider"></div>

                <div class="action-grid">
                    <article class="shop-item simple-item">
                        <div class="control-row">
                            <span>랜덤 턴 초기화</span
                            ><button
                                class="legacy-button legacy-button--primary"
                                :disabled="isUnited || actionBusy"
                                @click="resetTurnTime"
                            >
                                구입
                            </button>
                        </div>
                        <small
                            >다다음턴부터 시간이 랜덤하게 바뀝니다. (필요 포인트가 피보나치식으로 증가합니다)<br /><b
                                >필요 포인트: {{ status.resetCosts.resetTurnTime }}</b
                            ><template v-if="turnTimeLabel"><br />적용 시간: {{ turnTimeLabel }}</template></small
                        >
                    </article>
                    <article class="shop-item simple-item">
                        <div class="control-row">
                            <span>랜덤 유니크 획득</span
                            ><button
                                class="legacy-button legacy-button--primary"
                                :disabled="isUnited || actionBusy"
                                @click="buyRandomUnique"
                            >
                                구입
                            </button>
                        </div>
                        <small
                            >다음 턴에 랜덤 유니크를 얻습니다.<br /><b
                                >필요 포인트: {{ status.inheritConst.inheritItemRandomPoint }}</b
                            ></small
                        >
                    </article>
                    <article class="shop-item simple-item">
                        <div class="control-row">
                            <span>즉시 전투 특기 초기화</span
                            ><button
                                class="legacy-button legacy-button--primary"
                                :disabled="isUnited || actionBusy"
                                @click="resetSpecialWar"
                            >
                                구입
                            </button>
                        </div>
                        <small
                            >즉시 전투 특기를 초기화합니다. (필요 포인트가 피보나치식으로 증가합니다)<br /><b
                                >필요 포인트: {{ status.resetCosts.resetSpecialWar }}</b
                            ></small
                        >
                    </article>
                </div>

                <div class="divider"></div>

                <div class="buff-grid">
                    <article v-for="key in buffKeys" :key="key" class="shop-item buff-item">
                        <div class="control-row">
                            <label :for="`buff-${key}`">{{ buffLabels[key] }}</label>
                            <input
                                :id="`buff-${key}`"
                                v-model.number="buffTargets[key]"
                                type="number"
                                :min="status.buffLevels[key] ?? 0"
                                max="5"
                            />
                        </div>
                        <small
                            >{{ buffHelp[key] }}<br /><b>필요 포인트: {{ buffCost(key, buffTargets[key]) }}</b></small
                        >
                        <div class="dual-buttons">
                            <button
                                class="legacy-button legacy-button--secondary"
                                :disabled="actionBusy"
                                @click="buffTargets[key] = status.buffLevels[key] ?? 0"
                            >
                                리셋
                            </button>
                            <button
                                class="legacy-button legacy-button--primary"
                                :disabled="isUnited || actionBusy"
                                @click="buyHiddenBuff(key)"
                            >
                                구입
                            </button>
                        </div>
                    </article>
                </div>

                <div class="divider"></div>

                <div class="action-grid bottom-actions">
                    <article class="shop-item">
                        <div class="control-row">
                            <label for="owner-target">장수 소유자 확인</label>
                            <select id="owner-target" v-model="ownerTargetId">
                                <option disabled value="">장수 선택</option>
                                <option
                                    v-for="general in status.availableTargetGenerals"
                                    :key="general.id"
                                    :value="String(general.id)"
                                >
                                    {{ general.name }}
                                </option>
                            </select>
                        </div>
                        <small
                            >장수의 소유자를 찾습니다. 대상에게도 알림이 전송됩니다.<br /><b
                                >필요 포인트: {{ status.inheritConst.inheritCheckOwnerPoint }}</b
                            ></small
                        >
                        <button
                            class="legacy-button legacy-button--primary buy-button"
                            :disabled="isUnited || actionBusy"
                            @click="checkOwner"
                        >
                            소유자 찾기
                        </button>
                        <p v-if="ownerResult" class="owner-result">
                            {{ ownerResult.targetName }}의 소유자: {{ ownerResult.ownerName }}
                        </p>
                    </article>

                    <article class="shop-item stat-reset">
                        <div class="stat-layout">
                            <span>능력치 초기화</span>
                            <div>
                                <strong>기본 능력치</strong>
                                <label
                                    >통
                                    <input
                                        v-model.number="resetStatForm.leadership"
                                        type="number"
                                        :min="statRules?.min"
                                        :max="statRules?.max"
                                /></label>
                                <label
                                    >무
                                    <input
                                        v-model.number="resetStatForm.strength"
                                        type="number"
                                        :min="statRules?.min"
                                        :max="statRules?.max"
                                /></label>
                                <label
                                    >지
                                    <input
                                        v-model.number="resetStatForm.intel"
                                        type="number"
                                        :min="statRules?.min"
                                        :max="statRules?.max"
                                /></label>
                                <strong>추가 능력치</strong>
                                <label
                                    >통 <input v-model.number="resetStatForm.bonus[0]" type="number" min="0" max="5"
                                /></label>
                                <label
                                    >무 <input v-model.number="resetStatForm.bonus[1]" type="number" min="0" max="5"
                                /></label>
                                <label
                                    >지 <input v-model.number="resetStatForm.bonus[2]" type="number" min="0" max="5"
                                /></label>
                            </div>
                        </div>
                        <small
                            >시즌 당 1회에 한 해 능력치를 초기화합니다.<br /><b>필요 포인트: {{ resetStatCost }}</b
                            ><br /><span v-if="resetStatErrors.length">{{ resetStatErrors[0] }}</span></small
                        >
                        <button
                            class="legacy-button legacy-button--primary buy-button"
                            :disabled="isUnited || actionBusy || resetStatErrors.length > 0"
                            @click="resetStats"
                        >
                            능력치 초기화
                        </button>
                    </article>
                </div>
            </section>

            <section class="inherit-logs">
                <h2 class="section-title legacy-bg1">유산 포인트 변경 내역</h2>
                <div v-if="logLoading && logs.length === 0" class="log-empty">불러오는 중...</div>
                <div v-else-if="logs.length === 0" class="log-empty">기록이 없습니다.</div>
                <div v-for="entry in logs" v-else :key="entry.id" class="log-row">
                    <small>[{{ new Date(entry.createdAt).toLocaleString('ko-KR') }}]</small>
                    <span>{{ entry.text }}</span>
                </div>
                <button
                    class="legacy-button legacy-button--secondary more-button"
                    :disabled="logLoading || logEnd"
                    @click="loadLogs()"
                >
                    더 가져오기
                </button>
            </section>
        </template>
    </main>
</template>

<style scoped>
.top-back-bar {
    width: min(100%, 1000px);
    height: 32px;
    margin: 0 auto;
    border: 1px solid #888;
    display: grid;
    grid-template-columns: 88px 1fr 88px;
    align-items: center;
    text-align: center;
    padding: 0;
    box-sizing: border-box;
}

.top-button {
    height: 32px;
    min-height: 32px;
    padding: 2px 8px;
    text-decoration: none;
}

.inherit-page {
    width: min(100%, 1000px);
    margin: 0 auto;
    border: 1px solid #888;
    overflow: hidden;
    box-sizing: border-box;
    position: relative;
    padding: 0 7px;
    color: #fff;
    height: 1597px;
    font:
        14px/21px Pretendard,
        'Apple SD Gothic Neo',
        'Noto Sans KR',
        'Malgun Gothic',
        sans-serif;
}

.inherit-page.legacy-bg0 {
    background-color: transparent;
}

.notice,
.loading-state,
.log-empty {
    padding: 10px;
    text-align: center;
}

.notice.error {
    color: #ffb0b0;
}

.notice.success {
    color: #b6efb6;
}

.point-grid,
.action-grid,
.buff-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.inherit-item,
.shop-item {
    padding: 6px 8px;
    box-sizing: border-box;
    min-width: 0;
}

.inherit-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(100px, 1fr);
    align-items: start;
    gap: 3px;
}

.inherit-item label {
    text-align: right;
    padding: 7px 8px 0 0;
}

.inherit-item input,
.shop-item input,
.shop-item select {
    width: 100%;
    min-width: 0;
    border: 1px solid #6c757d;
    border-radius: 4px;
    background: #212529;
    color: #fff;
    padding: 4px 6px;
    box-sizing: border-box;
}

.inherit-item small,
.shop-item small {
    grid-column: 1 / -1;
    min-height: 0;
    text-align: right;
    color: #aeb2b6;
}

.inherit-item small {
    min-height: 0;
}

.divider {
    grid-column: 1 / -1;
    border-top: 1px solid rgba(255, 255, 255, 0.22);
    margin: 4px 2px;
}

.section-title {
    font-size: 14px;
    font-weight: 400;
    text-align: center;
    margin: 0 -8px;
    padding: 2px;
}

.leading-actions .shop-item:first-child {
    grid-column: 2;
}

.control-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 6px;
    min-height: 31px;
}

.control-row > label,
.control-row > span {
    text-align: right;
}

.shop-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.shop-item .buy-button {
    width: 146.5px;
    margin-left: auto;
}

.leading-actions .shop-item:first-child .buy-button {
    margin-top: 35px;
    margin-right: 9.5px;
}

.simple-item small {
    min-height: 0;
}

.buff-item small {
    min-height: 0;
}

.dual-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
}

.bottom-actions .shop-item:first-child {
    grid-column: 1;
}

.stat-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    text-align: right;
}

.stat-layout > div {
    display: grid;
    gap: 3px;
}

.stat-layout label {
    display: grid;
    grid-template-columns: 22px 1fr;
    align-items: center;
}

.stat-layout strong {
    text-align: left;
    font-size: 12px;
}

.owner-result {
    margin: 0;
    color: #fff;
    text-align: right;
}

.inherit-logs {
    margin: 8px 0 0;
}

.log-row {
    display: grid;
    grid-template-columns: minmax(150px, 20ch) 1fr;
    gap: 8px;
    padding: 3px 8px;
}

.log-row small {
    color: #aeb2b6;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.more-button {
    width: 100%;
    margin-top: 6px;
}

input:focus-visible,
select:focus-visible,
a:not(.legacy-button):focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}

@media (max-width: 767px) {
    .point-grid,
    .action-grid,
    .buff-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .leading-actions .shop-item:first-child {
        grid-column: 1;
    }
}

@media (max-width: 575px) {
    .top-back-bar,
    .inherit-page {
        width: 500px;
        max-width: 100%;
    }

    .inherit-page {
        height: 3047.5px;
    }

    .shop-item .buy-button {
        width: 50%;
    }

    .leading-actions .shop-item:first-child .buy-button {
        margin-top: 0;
        margin-right: 0;
    }

    .point-grid,
    .action-grid,
    .buff-grid {
        grid-template-columns: 1fr;
    }

    .divider {
        grid-column: 1;
    }

    .inherit-item,
    .shop-item {
        padding-left: 8px;
        padding-right: 8px;
    }

    .log-row {
        grid-template-columns: 1fr;
    }

    .log-row small {
        text-align: left;
    }
}
</style>
