<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';

type InheritStatus = Awaited<ReturnType<typeof trpc.inherit.getStatus.query>>;
type InheritLog = Awaited<ReturnType<typeof trpc.inherit.getLogs.query>>[number];
type JoinConfig = Awaited<ReturnType<typeof trpc.join.getConfig.query>>;

type BuffKey =
    | 'warAvoidRatio'
    | 'warCriticalRatio'
    | 'warMagicTrialProb'
    | 'success'
    | 'fail'
    | 'warAvoidRatioOppose'
    | 'warCriticalRatioOppose'
    | 'warMagicTrialProbOppose';

const buffKeys: BuffKey[] = [
    'warAvoidRatio',
    'warCriticalRatio',
    'warMagicTrialProb',
    'success',
    'fail',
    'warAvoidRatioOppose',
    'warCriticalRatioOppose',
    'warMagicTrialProbOppose',
];

const buffLabels: Record<BuffKey, string> = {
    warAvoidRatio: '회피 확률 증가',
    warCriticalRatio: '필살 확률 증가',
    warMagicTrialProb: '전투계략 시도 확률 증가',
    success: '내정 성공률 증가',
    fail: '내정 실패율 감소',
    warAvoidRatioOppose: '상대 회피 확률 감소',
    warCriticalRatioOppose: '상대 필살 확률 감소',
    warMagicTrialProbOppose: '상대 전투계략 시도 확률 감소',
};

const pointLabels: Record<string, string> = {
    previous: '보유',
    lived_month: '생존 턴',
    max_domestic_critical: '내정 최고치',
    active_action: '활동',
    combat: '전투',
    sabotage: '계략',
    dex: '숙련',
    unifier: '통일 보상',
    tournament: '토너먼트',
    betting: '베팅',
    max_belong: '최대 충성',
};

const pointOrder = [
    'previous',
    'lived_month',
    'max_domestic_critical',
    'active_action',
    'combat',
    'sabotage',
    'dex',
    'unifier',
    'tournament',
    'betting',
    'max_belong',
] as const;

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
    success: 1,
    fail: 1,
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
    resetBonusSum.value > 0 ? status.value?.inheritConst.inheritBornStatPoint ?? 0 : 0
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

const specialNameMap = computed(() => {
    const map = new Map<string, string>();
    for (const entry of status.value?.availableSpecialWar ?? []) {
        map.set(entry.key, entry.name);
    }
    return map;
});

const currentSpecialName = computed(() => {
    if (!status.value) {
        return '-';
    }
    return specialNameMap.value.get(status.value.currentSpecialWar) ?? status.value.currentSpecialWar ?? '-';
});

const buffCost = (key: BuffKey, target: number): number => {
    const points = status.value?.inheritConst.inheritBuffPoints ?? [0, 0, 0, 0, 0, 0];
    const current = status.value?.buffLevels[key] ?? 0;
    return Math.max(0, (points[target] ?? 0) - (points[current] ?? 0));
};

const buffTargetOptions = (key: BuffKey): number[] => {
    const current = status.value?.buffLevels[key] ?? 0;
    const start = Math.min(5, Math.max(1, current + 1));
    const result: number[] = [];
    for (let level = start; level <= 5; level += 1) {
        result.push(level);
    }
    return result.length > 0 ? result : [5];
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

const applyResetBalanced = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    const base = Math.floor(rules.total / 3);
    resetStatForm.leadership = rules.total - base * 2;
    resetStatForm.strength = base;
    resetStatForm.intel = base;
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
        actionError.value = '유니크 아이템 ID를 입력해주세요.';
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

watch(statRules, (rules) => {
    if (rules) {
        applyResetBalanced();
    }
});

onMounted(() => {
    void loadStatus();
    void loadJoinConfig();
    void loadLogs(true);
});
</script>

<template>
    <main class="inherit-page">
        <header class="inherit-header">
            <div>
                <h1 class="inherit-title">유산 포인트</h1>
                <p class="inherit-subtitle">숨김 강화와 유산 상점 기능을 관리합니다.</p>
            </div>
            <div class="inherit-actions">
                <button class="ghost" @click="loadStatus">새로고침</button>
                <button class="ghost" @click="loadLogs(true)">로그 갱신</button>
            </div>
        </header>

        <div v-if="error" class="inherit-error">{{ error }}</div>
        <div v-if="actionError" class="inherit-error">{{ actionError }}</div>
        <div v-if="actionMessage" class="inherit-message">{{ actionMessage }}</div>

        <div v-if="loading">
            <SkeletonLines :lines="4" />
        </div>

        <section v-else class="inherit-grid">
            <PanelCard title="포인트 요약" subtitle="유산 포인트 구성 현황">
                <div v-if="!status" class="muted">포인트 정보를 불러오지 못했습니다.</div>
                <div v-else class="summary-panel">
                    <div class="summary-head">
                        <div class="summary-total">총 {{ status.totalPoint }} 포인트</div>
                        <div class="summary-state" :class="{ united: status.isUnited }">
                            {{ status.isUnited ? '통일 완료' : '진행 중' }}
                        </div>
                    </div>
                    <div class="summary-list">
                        <div v-for="entry in pointEntries" :key="entry.key" class="summary-row">
                            <span>{{ entry.label }}</span>
                            <span>{{ entry.value }}</span>
                        </div>
                    </div>
                    <div class="summary-footer">
                        <div>현재 전투 특기: {{ currentSpecialName }}</div>
                        <div>특기 초기화 단계: {{ status.resetLevels.resetSpecialWar }}회</div>
                        <div>턴 시간 초기화 단계: {{ status.resetLevels.resetTurnTime }}회</div>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="숨김 강화" subtitle="숨김 강화 효과를 구입합니다.">
                <div v-if="!status" class="muted">숨김 강화 정보를 불러오지 못했습니다.</div>
                <div v-else class="buff-list">
                    <div v-for="key in buffKeys" :key="key" class="buff-row">
                        <div class="buff-info">
                            <div class="buff-name">{{ buffLabels[key] }}</div>
                            <div class="buff-level">현재 {{ status.buffLevels[key] ?? 0 }} 단계</div>
                        </div>
                        <div class="buff-action">
                            <select v-model.number="buffTargets[key]" class="form-input">
                                <option
                                    v-for="level in buffTargetOptions(key)"
                                    :key="level"
                                    :value="level"
                                >
                                    {{ level }} 단계
                                </option>
                            </select>
                            <div class="buff-cost">비용 {{ buffCost(key, buffTargets[key]) }}</div>
                            <button
                                :disabled="isUnited || actionBusy || (status.buffLevels[key] ?? 0) >= 5"
                                @click="buyHiddenBuff(key)"
                            >
                                구입
                            </button>
                        </div>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="전투 특기 제어" subtitle="다음 특기 지정 및 초기화">
                <div v-if="!status" class="muted">전투 특기 정보를 불러오지 못했습니다.</div>
                <div v-else class="action-stack">
                    <div class="action-row">
                        <label class="form-field">
                            <span>다음 전투 특기</span>
                            <select v-model="nextSpecialKey" class="form-input">
                                <option v-for="special in status.availableSpecialWar" :key="special.key" :value="special.key">
                                    {{ special.name }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ status.inheritConst.inheritSpecificSpecialPoint }} 포인트</small>
                        </label>
                        <button :disabled="isUnited || actionBusy" @click="reserveSpecialWar">예약</button>
                    </div>
                    <div class="action-row">
                        <div>
                            <div class="muted">현재 전투 특기: {{ currentSpecialName }}</div>
                            <div class="muted">
                                초기화 비용 {{ status.resetCosts.resetSpecialWar }} 포인트
                                ({{ status.resetLevels.resetSpecialWar }}회)
                            </div>
                        </div>
                        <button :disabled="isUnited || actionBusy" @click="resetSpecialWar">초기화</button>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="턴 시간 초기화" subtitle="턴 시간대를 재설정합니다.">
                <div v-if="!status" class="muted">턴 시간 정보를 불러오지 못했습니다.</div>
                <div v-else class="action-stack">
                    <div class="action-row">
                        <div class="muted">
                            비용 {{ status.resetCosts.resetTurnTime }} 포인트 ({{ status.resetLevels.resetTurnTime }}회)
                        </div>
                        <button :disabled="isUnited || actionBusy" @click="resetTurnTime">턴 시간 변경</button>
                    </div>
                    <div v-if="turnTimeLabel" class="muted">다음 적용 시각: {{ turnTimeLabel }}</div>
                </div>
            </PanelCard>

            <PanelCard title="능력치 초기화" subtitle="능력치를 다시 배분합니다.">
                <div v-if="!status" class="muted">능력치 정보를 불러오지 못했습니다.</div>
                <div v-else class="stat-panel">
                    <div class="stat-grid">
                        <label class="form-field">
                            <span>통솔</span>
                            <input v-model.number="resetStatForm.leadership" type="number" class="form-input" />
                        </label>
                        <label class="form-field">
                            <span>무력</span>
                            <input v-model.number="resetStatForm.strength" type="number" class="form-input" />
                        </label>
                        <label class="form-field">
                            <span>지력</span>
                            <input v-model.number="resetStatForm.intel" type="number" class="form-input" />
                        </label>
                    </div>

                    <div class="stat-grid">
                        <label class="form-field">
                            <span>보너스 통솔</span>
                            <input v-model.number="resetStatForm.bonus[0]" type="number" min="0" max="5" class="form-input" />
                        </label>
                        <label class="form-field">
                            <span>보너스 무력</span>
                            <input v-model.number="resetStatForm.bonus[1]" type="number" min="0" max="5" class="form-input" />
                        </label>
                        <label class="form-field">
                            <span>보너스 지력</span>
                            <input v-model.number="resetStatForm.bonus[2]" type="number" min="0" max="5" class="form-input" />
                        </label>
                    </div>

                    <div class="stat-summary">
                        <div>총합 {{ resetStatTotal }} / {{ statRules?.total ?? '-' }}</div>
                        <div>보너스 합 {{ resetBonusSum }} · 비용 {{ resetStatCost }}</div>
                        <div v-if="resetStatErrors.length" class="stat-errors">
                            <div v-for="item in resetStatErrors" :key="item">{{ item }}</div>
                        </div>
                    </div>

                    <div class="action-row">
                        <button :disabled="isUnited || actionBusy" class="ghost" @click="applyResetBalanced">균형형</button>
                        <button :disabled="isUnited || actionBusy" @click="resetStats">능력치 초기화</button>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="유니크 상점" subtitle="유니크 아이템 관련 기능">
                <div v-if="!status" class="muted">유니크 정보를 불러오지 못했습니다.</div>
                <div v-else class="action-stack">
                    <div class="action-row">
                        <div class="muted">랜덤 유니크 구매 ({{ status.inheritConst.inheritItemRandomPoint }} 포인트)</div>
                        <button :disabled="isUnited || actionBusy" @click="buyRandomUnique">구입</button>
                    </div>
                    <div class="action-row">
                        <label class="form-field">
                            <span>유니크 아이템 ID</span>
                            <input v-model="uniqueForm.itemId" type="text" class="form-input" />
                        </label>
                        <label class="form-field">
                            <span>입찰 포인트</span>
                            <input v-model.number="uniqueForm.amount" type="number" class="form-input" />
                            <small class="muted">최소 {{ status.inheritConst.inheritItemUniqueMinPoint }} 포인트</small>
                        </label>
                        <button :disabled="isUnited || actionBusy" @click="openUniqueAuction">신청</button>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="소유자 확인" subtitle="상대 장수의 소유자를 확인합니다.">
                <div v-if="!status" class="muted">대상 장수 목록을 불러오지 못했습니다.</div>
                <div v-else class="action-stack">
                    <label class="form-field">
                        <span>대상 장수</span>
                        <select v-model="ownerTargetId" class="form-input">
                            <option v-for="general in status.availableTargetGenerals" :key="general.id" :value="String(general.id)">
                                {{ general.name }}
                            </option>
                        </select>
                        <small class="muted">비용 {{ status.inheritConst.inheritCheckOwnerPoint }} 포인트</small>
                    </label>
                    <button :disabled="isUnited || actionBusy" @click="checkOwner">확인</button>
                    <div v-if="ownerResult" class="muted">
                        {{ ownerResult.targetName }}의 소유자: {{ ownerResult.ownerName }}
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="유산 기록" subtitle="최근 유산 로그">
                <template #actions>
                    <button class="ghost" :disabled="logLoading" @click="loadLogs(true)">갱신</button>
                </template>
                <div v-if="logLoading && logs.length === 0">
                    <SkeletonLines :lines="3" />
                </div>
                <div v-else-if="logs.length === 0" class="muted">기록이 없습니다.</div>
                <div v-else class="log-list">
                    <div v-for="entry in logs" :key="entry.id" class="log-entry">
                        <span class="log-date">{{ entry.year }}년 {{ entry.month }}월</span>
                        <span>{{ entry.text }}</span>
                    </div>
                </div>
                <div class="log-footer">
                    <button class="ghost" :disabled="logLoading || logEnd" @click="loadLogs()">더 보기</button>
                </div>
            </PanelCard>
        </section>
    </main>
</template>

<style scoped>
.inherit-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.inherit-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
    padding-bottom: 12px;
}

.inherit-title {
    font-size: 1.6rem;
    font-weight: 600;
}

.inherit-subtitle {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.inherit-actions {
    display: flex;
    gap: 8px;
}

.inherit-error {
    border: 1px solid rgba(240, 90, 90, 0.6);
    padding: 8px 10px;
    color: rgba(240, 150, 150, 0.9);
}

.inherit-message {
    border: 1px solid rgba(120, 190, 120, 0.5);
    padding: 8px 10px;
    color: rgba(180, 230, 180, 0.9);
}

.inherit-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.summary-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.summary-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.summary-total {
    font-size: 1rem;
    font-weight: 600;
}

.summary-state {
    font-size: 0.75rem;
    padding: 4px 8px;
    border: 1px solid rgba(201, 164, 90, 0.4);
}

.summary-state.united {
    border-color: rgba(240, 120, 120, 0.6);
    color: rgba(240, 150, 150, 0.9);
}

.summary-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.summary-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.8);
}

.summary-footer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.buff-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.buff-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid rgba(201, 164, 90, 0.2);
    padding: 8px;
}

.buff-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.buff-name {
    font-weight: 600;
    font-size: 0.85rem;
}

.buff-level {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.7);
}

.buff-action {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.buff-cost {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.action-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.action-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
}

.stat-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.stat-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.stat-summary {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.stat-errors {
    color: rgba(240, 150, 150, 0.9);
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.75rem;
}

.form-input {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(10, 10, 10, 0.8);
    padding: 6px 8px;
    color: inherit;
}

button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
    background: rgba(16, 16, 16, 0.6);
    color: inherit;
}

button.ghost {
    background: transparent;
}

.log-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.log-entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.8rem;
}

.log-date {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
}

.log-footer {
    margin-top: 8px;
}

.muted {
    color: rgba(232, 221, 196, 0.6);
    font-size: 0.75rem;
}
</style>
