<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import { npcPriorityHelp } from '../utils/npcPriorityHelp';

type NpcPolicyResponse = Awaited<ReturnType<typeof trpc.npc.getPolicy.query>>;
type NationPolicy = NpcPolicyResponse['currentNationPolicy'];
type PolicyKey = keyof NationPolicy;
type PolicyField = {
    key: PolicyKey;
    label: string;
    step: number;
    description: string;
    hint?: string;
    percent?: boolean;
};

type PolicySection = {
    title: string;
    fields: PolicyField[];
};

const NUMERIC_POLICY_KEYS = [
    'reqNationGold',
    'reqNationRice',
    'reqHumanWarUrgentGold',
    'reqHumanWarUrgentRice',
    'reqHumanWarRecommandGold',
    'reqHumanWarRecommandRice',
    'reqHumanDevelGold',
    'reqHumanDevelRice',
    'reqNPCWarGold',
    'reqNPCWarRice',
    'reqNPCDevelGold',
    'reqNPCDevelRice',
    'minimumResourceActionAmount',
    'maximumResourceActionAmount',
    'minNPCWarLeadership',
    'minWarCrew',
    'minNPCRecruitCityPopulation',
    'safeRecruitCityPopulationRatio',
    'properWarTrainAtmos',
    'cureThreshold',
] as const;

type NumericPolicyKey = (typeof NUMERIC_POLICY_KEYS)[number];

type PrioritySectionKey = 'nation' | 'general';

type PriorityListState = {
    active: string[];
    inactive: string[];
    available: string[];
};

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<NpcPolicyResponse | null>(null);
const policyDraft = ref<NationPolicy | null>(null);
const lastSavedPolicy = ref<NationPolicy | null>(null);

const nationPriority = ref<PriorityListState | null>(null);
const generalPriority = ref<PriorityListState | null>(null);
const lastSavedNationPriority = ref<string[]>([]);
const lastSavedGeneralPriority = ref<string[]>([]);

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const clonePolicy = (source: NationPolicy): NationPolicy => ({
    ...source,
    CombatForce: { ...source.CombatForce },
    SupportForce: [...source.SupportForce],
    DevelopForce: [...source.DevelopForce],
});

const assignPriorityState = (active: string[], available: string[]): PriorityListState => {
    const activeSet = new Set(active);
    const inactive = available.filter((item) => !activeSet.has(item));
    return {
        active: [...active],
        inactive,
        available: [...available],
    };
};

const loadPolicy = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        data.value = await trpc.npc.getPolicy.query();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

onMounted(() => {
    void loadPolicy();
});

watch(
    () => data.value,
    (value) => {
        if (!value) {
            return;
        }
        policyDraft.value = clonePolicy(value.currentNationPolicy);
        lastSavedPolicy.value = clonePolicy(value.currentNationPolicy);
        nationPriority.value = assignPriorityState(value.currentNationPriority, value.availableNationPriorityItems);
        generalPriority.value = assignPriorityState(
            value.currentGeneralActionPriority,
            value.availableGeneralActionPriorityItems
        );
        lastSavedNationPriority.value = [...value.currentNationPriority];
        lastSavedGeneralPriority.value = [...value.currentGeneralActionPriority];
    }
);

const formatNumber = (value: number): string => new Intl.NumberFormat('ko-KR').format(Math.round(value));

const calcPolicyValue = (key: NumericPolicyKey): number => {
    if (!data.value || !policyDraft.value) {
        return 0;
    }
    const value = policyDraft.value[key];
    if (value === 0) {
        return data.value.zeroPolicy[key];
    }
    return value;
};

const safeRecruitPercent = computed({
    get: () => (policyDraft.value?.safeRecruitCityPopulationRatio ?? 0) * 100,
    set: (value: number) => {
        if (!policyDraft.value) {
            return;
        }
        policyDraft.value.safeRecruitCityPopulationRatio = value / 100;
    },
});

const policySections = computed<PolicySection[]>(() => {
    if (!data.value) {
        return [];
    }
    const statMax = data.value.defaultStatMax;
    const statNpcMax = data.value.defaultStatNpcMax;

    return [
        {
            title: '국가 재정',
            fields: [
                {
                    key: 'reqNationGold',
                    label: '국가 권장 금',
                    step: 100,
                    description: '이보다 많으면 포상, 적으면 몰수/헌납합니다.(긴급포상 제외)',
                },
                {
                    key: 'reqNationRice',
                    label: '국가 권장 쌀',
                    step: 100,
                    description: '이보다 많으면 포상, 적으면 몰수/헌납합니다.(긴급포상 제외)',
                },
            ],
        },
        {
            title: '유저 전투장',
            fields: [
                {
                    key: 'reqHumanWarUrgentGold',
                    label: '긴급포상 금',
                    step: 100,
                    description:
                        '유저장긴급포상시 이보다 금이 적은 장수에게 포상합니다.',
                    hint: `0이면 보병 6회 징병(${formatNumber(statMax * 100 * 6)}) 가능한 금을 기준으로 하며, 현재 ${formatNumber(
                        data.value.zeroPolicy.reqHumanWarUrgentGold
                    )}입니다.`,
                },
                {
                    key: 'reqHumanWarUrgentRice',
                    label: '긴급포상 쌀',
                    step: 100,
                    description:
                        '유저장긴급포상시 이보다 쌀이 적은 장수에게 포상합니다.',
                    hint: `0이면 기본 병종으로 ${formatNumber(statMax * 100 * 6)}명 사살 가능한 쌀을 기준으로 하며, 현재 ${formatNumber(
                        data.value.zeroPolicy.reqHumanWarUrgentRice
                    )}입니다.`,
                },
                {
                    key: 'reqHumanWarRecommandGold',
                    label: '권장 금',
                    step: 100,
                    description: '유저전투장에게 주는 금입니다. 이보다 적으면 포상합니다.',
                    hint: `0이면 긴급포상 금의 2배를 기준으로 하며, 현재 ${formatNumber(
                        calcPolicyValue('reqHumanWarUrgentGold') * 2
                    )}입니다.`,
                },
                {
                    key: 'reqHumanWarRecommandRice',
                    label: '권장 쌀',
                    step: 100,
                    description: '유저전투장에게 주는 쌀입니다. 이보다 적으면 포상합니다.',
                    hint: `0이면 긴급포상 쌀의 2배를 기준으로 하며, 현재 ${formatNumber(
                        calcPolicyValue('reqHumanWarUrgentRice') * 2
                    )}입니다.`,
                },
            ],
        },
        {
            title: '유저 내정장',
            fields: [
                {
                    key: 'reqHumanDevelGold',
                    label: '권장 금',
                    step: 100,
                    description: '유저내정장에게 주는 금입니다. 이보다 적으면 포상합니다.',
                },
                {
                    key: 'reqHumanDevelRice',
                    label: '권장 쌀',
                    step: 100,
                    description: '유저내정장에게 주는 쌀입니다. 이보다 적으면 포상합니다.',
                },
            ],
        },
        {
            title: 'NPC 전투장',
            fields: [
                {
                    key: 'reqNPCWarGold',
                    label: '권장 금',
                    step: 100,
                    description: 'NPC전투장에게 주는 금입니다. 이보다 적으면 포상합니다.',
                    hint: `0이면 기본 병종 4회(${formatNumber(statNpcMax * 100 * 4)}) 징병비를 기준으로 하며, 현재 ${formatNumber(
                        data.value.zeroPolicy.reqNPCWarGold
                    )}입니다.`,
                },
                {
                    key: 'reqNPCWarRice',
                    label: '권장 쌀',
                    step: 100,
                    description: 'NPC전투장에게 주는 쌀입니다. 이보다 적으면 포상합니다.',
                    hint: `0이면 기본 병종으로 ${formatNumber(statNpcMax * 100 * 4)}명 사살 가능한 쌀을 기준으로 하며, 현재 ${formatNumber(
                        data.value.zeroPolicy.reqNPCWarRice
                    )}입니다.`,
                },
            ],
        },
        {
            title: 'NPC 내정장',
            fields: [
                {
                    key: 'reqNPCDevelGold',
                    label: '권장 금',
                    step: 100,
                    description: 'NPC내정장에게 주는 금입니다. 이보다 5배 더 많다면 헌납합니다.',
                    hint: `0이면 30턴 내정 가능한 금을 기준으로 하며, 현재 ${formatNumber(
                        data.value.zeroPolicy.reqNPCDevelGold
                    )}입니다.`,
                },
                {
                    key: 'reqNPCDevelRice',
                    label: '권장 쌀',
                    step: 100,
                    description: 'NPC내정장에게 주는 쌀입니다. 이보다 5배 더 많다면 헌납합니다.',
                },
            ],
        },
        {
            title: '자원 정책',
            fields: [
                {
                    key: 'minimumResourceActionAmount',
                    label: '포상/몰수/헌납 최소 단위',
                    step: 100,
                    description: '연산결과가 이 단위보다 적다면 수행하지 않습니다.',
                },
                {
                    key: 'maximumResourceActionAmount',
                    label: '포상/몰수/헌납 최대 단위',
                    step: 100,
                    description: '연산결과가 이 단위보다 크다면 이 값에 맞춥니다.',
                },
            ],
        },
        {
            title: '전투/징병 기준',
            fields: [
                {
                    key: 'minWarCrew',
                    label: '최소 전투 가능 병력 수',
                    step: 50,
                    description: '이보다 적을 때에는 징병을 시도합니다.',
                },
                {
                    key: 'minNPCRecruitCityPopulation',
                    label: 'NPC 최소 징병 가능 인구 수',
                    step: 100,
                    description:
                        '도시의 인구가 이보다 낮으면 NPC는 도시에서 징병하지 않고 후방 워프합니다.',
                },
                {
                    key: 'safeRecruitCityPopulationRatio',
                    label: '제자리 징병 허용 인구율(%)',
                    step: 0.5,
                    description:
                        '전쟁 시 후방 발령, 후방 워프의 기준 인구입니다. 이보다 많다면 충분하다고 판단합니다.',
                    percent: true,
                },
                {
                    key: 'minNPCWarLeadership',
                    label: 'NPC 전투 참여 통솔 기준',
                    step: 5,
                    description: '이 수치보다 같거나 높으면 NPC전투장으로 분류됩니다.',
                },
            ],
        },
        {
            title: '상태 기준',
            fields: [
                {
                    key: 'properWarTrainAtmos',
                    label: '훈련/사기진작 목표치',
                    step: 5,
                    description: '훈련/사기진작 기준치입니다. 이보다 같거나 높으면 출병합니다.',
                },
                {
                    key: 'cureThreshold',
                    label: '요양 기준(%)',
                    step: 5,
                    description: '요양 기준입니다. 이보다 많이 부상을 입으면 요양합니다.',
                },
            ],
        },
    ];
});

const canEdit = computed(() => (data.value?.permissionLevel ?? 0) >= 3);

const resetPolicy = () => {
    if (!data.value) {
        return;
    }
    if (!window.confirm('초기 설정으로 되돌릴까요?')) {
        return;
    }
    policyDraft.value = clonePolicy(data.value.defaultNationPolicy);
};

const rollbackPolicy = () => {
    if (!lastSavedPolicy.value) {
        return;
    }
    if (!window.confirm('이전 설정으로 되돌릴까요?')) {
        return;
    }
    policyDraft.value = clonePolicy(lastSavedPolicy.value);
};

const submitPolicy = async () => {
    if (!policyDraft.value) {
        return;
    }
    if (!window.confirm('저장할까요?')) {
        return;
    }
    try {
        await trpc.npc.setNationPolicy.mutate(policyDraft.value);
        await loadPolicy();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const moveItem = (list: string[], from: number, to: number) => {
    if (to < 0 || to >= list.length) {
        return;
    }
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
};

const insertByOrder = (list: string[], item: string, orderMap: Map<string, number>) => {
    const targetOrder = orderMap.get(item) ?? Number.MAX_SAFE_INTEGER;
    const index = list.findIndex((entry) => (orderMap.get(entry) ?? Number.MAX_SAFE_INTEGER) > targetOrder);
    if (index === -1) {
        list.push(item);
    } else {
        list.splice(index, 0, item);
    }
};

const togglePriority = (section: PrioritySectionKey, item: string, enable: boolean) => {
    const target = section === 'nation' ? nationPriority.value : generalPriority.value;
    if (!target) {
        return;
    }
    if (enable) {
        const index = target.inactive.indexOf(item);
        if (index >= 0) {
            target.inactive.splice(index, 1);
            const orderMap = new Map(target.available.map((entry, idx) => [entry, idx]));
            insertByOrder(target.active, item, orderMap);
        }
        return;
    }

    const index = target.active.indexOf(item);
    if (index >= 0) {
        target.active.splice(index, 1);
        const orderMap = new Map(target.available.map((entry, idx) => [entry, idx]));
        insertByOrder(target.inactive, item, orderMap);
    }
};

const reorderPriority = (section: PrioritySectionKey, index: number, direction: number) => {
    const target = section === 'nation' ? nationPriority.value : generalPriority.value;
    if (!target) {
        return;
    }
    moveItem(target.active, index, index + direction);
};

const resetPriority = (section: PrioritySectionKey) => {
    if (!data.value) {
        return;
    }
    if (!window.confirm('초기 설정으로 되돌릴까요?')) {
        return;
    }
    if (section === 'nation') {
        nationPriority.value = assignPriorityState(data.value.defaultNationPriority, data.value.availableNationPriorityItems);
    } else {
        generalPriority.value = assignPriorityState(
            data.value.defaultGeneralActionPriority,
            data.value.availableGeneralActionPriorityItems
        );
    }
};

const rollbackPriority = (section: PrioritySectionKey) => {
    if (!window.confirm('이전 설정으로 되돌릴까요?')) {
        return;
    }
    if (section === 'nation' && data.value) {
        nationPriority.value = assignPriorityState(lastSavedNationPriority.value, data.value.availableNationPriorityItems);
    }
    if (section === 'general' && data.value) {
        generalPriority.value = assignPriorityState(
            lastSavedGeneralPriority.value,
            data.value.availableGeneralActionPriorityItems
        );
    }
};

const submitPriority = async (section: PrioritySectionKey) => {
    if (!data.value) {
        return;
    }
    if (!window.confirm('저장할까요?')) {
        return;
    }
    try {
        if (section === 'nation' && nationPriority.value) {
            await trpc.npc.setNationPriority.mutate(nationPriority.value.active);
        }
        if (section === 'general' && generalPriority.value) {
            await trpc.npc.setGeneralPriority.mutate(generalPriority.value.active);
        }
        await loadPolicy();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};
</script>

<template>
    <main class="npc-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">NPC 정책</h1>
                <p class="page-subtitle">사령/일반 AI 우선순위 및 자원 기준</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <button class="ghost" @click="loadPolicy">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <section v-if="loading && !data">
            <PanelCard title="NPC 정책 로딩">
                <SkeletonLines :lines="6" />
            </PanelCard>
        </section>

        <section v-else-if="data && policyDraft" class="npc-layout">
            <PanelCard title="국가 정책" subtitle="NPC 자원 기준과 전투 판단 기준">
                <div class="setter">
                    최근 설정: {{ data.lastSetters.policy.setter ?? '-없음-' }} ({{
                        data.lastSetters.policy.date ?? '설정 기록 없음'
                    }})
                </div>
                <div v-if="!canEdit" class="readonly-note">권한이 부족하여 읽기 전용으로 표시됩니다.</div>
                <div v-for="section in policySections" :key="section.title" class="policy-section">
                    <h3 class="section-title">{{ section.title }}</h3>
                    <div class="policy-grid">
                        <div
                            v-for="field in section.fields"
                            :key="field.key"
                            class="policy-field"
                        >
                            <label class="field-label">{{ field.label }}</label>
                            <input
                                v-if="field.percent"
                                v-model.number="safeRecruitPercent"
                                type="number"
                                class="field-input"
                                :step="field.step"
                                min="0"
                                max="100"
                                :disabled="!canEdit"
                            />
                            <input
                                v-else
                                v-model.number="policyDraft[field.key as PolicyKey]"
                                type="number"
                                class="field-input"
                                :step="field.step"
                                min="0"
                                :disabled="!canEdit"
                            />
                            <p class="field-desc">{{ field.description }}</p>
                            <p v-if="field.hint" class="field-hint">{{ field.hint }}</p>
                        </div>
                    </div>
                </div>
                <div class="control-bar">
                    <div class="btn-group">
                        <button class="ghost" :disabled="!canEdit" @click="resetPolicy">초깃값으로</button>
                        <button class="ghost" :disabled="!canEdit" @click="rollbackPolicy">이전값으로</button>
                    </div>
                    <button class="primary" :disabled="!canEdit" @click="submitPolicy">설정</button>
                </div>
            </PanelCard>

            <div class="priority-grid">
                <PanelCard title="NPC 사령턴 우선순위" subtitle="예턴 실패 시 우선순위대로 실행">
                    <div class="setter">
                        최근 설정: {{ data.lastSetters.nation.setter ?? '-없음-' }} ({{
                            data.lastSetters.nation.date ?? '설정 기록 없음'
                        }})
                    </div>
                    <div v-if="!canEdit" class="readonly-note">권한이 부족하여 읽기 전용으로 표시됩니다.</div>
                    <div class="priority-columns">
                        <div class="priority-column">
                            <div class="column-title">비활성</div>
                            <div class="priority-list">
                                <div
                                    v-for="item in nationPriority?.inactive ?? []"
                                    :key="item"
                                    class="priority-item"
                                >
                                    <span class="priority-name">{{ item }}</span>
                                    <span
                                        class="priority-help"
                                        :data-text="npcPriorityHelp[item] ?? '설명 없음'"
                                    >
                                        ?
                                    </span>
                                    <button class="ghost" :disabled="!canEdit" @click="togglePriority('nation', item, true)">
                                        활성
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="priority-column">
                            <div class="column-title">활성</div>
                            <div class="priority-list">
                                <div
                                    v-for="(item, idx) in nationPriority?.active ?? []"
                                    :key="item"
                                    class="priority-item"
                                >
                                    <div class="priority-main">
                                        <span class="priority-name">{{ item }}</span>
                                        <span
                                            class="priority-help"
                                            :data-text="npcPriorityHelp[item] ?? '설명 없음'"
                                        >
                                            ?
                                        </span>
                                    </div>
                                    <div class="priority-actions">
                                        <button class="ghost" :disabled="!canEdit" @click="reorderPriority('nation', idx, -1)">위</button>
                                        <button class="ghost" :disabled="!canEdit" @click="reorderPriority('nation', idx, 1)">아래</button>
                                        <button class="ghost" :disabled="!canEdit" @click="togglePriority('nation', item, false)">
                                            비활성
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="control-bar">
                        <div class="btn-group">
                            <button class="ghost" :disabled="!canEdit" @click="resetPriority('nation')">초깃값으로</button>
                            <button class="ghost" :disabled="!canEdit" @click="rollbackPriority('nation')">이전값으로</button>
                        </div>
                        <button class="primary" :disabled="!canEdit" @click="submitPriority('nation')">설정</button>
                    </div>
                </PanelCard>

                <PanelCard title="NPC 일반턴 우선순위" subtitle="순위가 높은 것부터 시도">
                    <div class="setter">
                        최근 설정: {{ data.lastSetters.general.setter ?? '-없음-' }} ({{
                            data.lastSetters.general.date ?? '설정 기록 없음'
                        }})
                    </div>
                    <div v-if="!canEdit" class="readonly-note">권한이 부족하여 읽기 전용으로 표시됩니다.</div>
                    <div class="priority-columns">
                        <div class="priority-column">
                            <div class="column-title">비활성</div>
                            <div class="priority-list">
                                <div
                                    v-for="item in generalPriority?.inactive ?? []"
                                    :key="item"
                                    class="priority-item"
                                >
                                    <span class="priority-name">{{ item }}</span>
                                    <span
                                        class="priority-help"
                                        :data-text="npcPriorityHelp[item] ?? '설명 없음'"
                                    >
                                        ?
                                    </span>
                                    <button class="ghost" :disabled="!canEdit" @click="togglePriority('general', item, true)">
                                        활성
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="priority-column">
                            <div class="column-title">활성</div>
                            <div class="priority-list">
                                <div
                                    v-for="(item, idx) in generalPriority?.active ?? []"
                                    :key="item"
                                    class="priority-item"
                                >
                                    <div class="priority-main">
                                        <span class="priority-name">{{ item }}</span>
                                        <span
                                            class="priority-help"
                                            :data-text="npcPriorityHelp[item] ?? '설명 없음'"
                                        >
                                            ?
                                        </span>
                                    </div>
                                    <div class="priority-actions">
                                        <button class="ghost" :disabled="!canEdit" @click="reorderPriority('general', idx, -1)">위</button>
                                        <button class="ghost" :disabled="!canEdit" @click="reorderPriority('general', idx, 1)">아래</button>
                                        <button class="ghost" :disabled="!canEdit" @click="togglePriority('general', item, false)">
                                            비활성
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="control-bar">
                        <div class="btn-group">
                            <button class="ghost" :disabled="!canEdit" @click="resetPriority('general')">초깃값으로</button>
                            <button class="ghost" :disabled="!canEdit" @click="rollbackPriority('general')">이전값으로</button>
                        </div>
                        <button class="primary" :disabled="!canEdit" @click="submitPriority('general')">설정</button>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.npc-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.page-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
    padding-bottom: 12px;
}

.page-title {
    font-size: 1.6rem;
    font-weight: 600;
}

.page-subtitle {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
    cursor: pointer;
    background: rgba(16, 16, 16, 0.6);
    color: inherit;
}

.primary {
    border: 1px solid rgba(201, 164, 90, 0.6);
    padding: 6px 12px;
    font-size: 0.8rem;
    cursor: pointer;
    background: rgba(201, 164, 90, 0.2);
    color: inherit;
}

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.npc-layout {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.setter {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
    margin-bottom: 8px;
}

.readonly-note {
    font-size: 0.75rem;
    color: rgba(245, 208, 138, 0.8);
    margin-bottom: 8px;
}

.policy-section {
    margin-top: 12px;
}

.section-title {
    font-size: 0.95rem;
    margin-bottom: 8px;
    color: rgba(232, 221, 196, 0.9);
}

.policy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
}

.policy-field {
    border: 1px solid rgba(201, 164, 90, 0.2);
    background: rgba(16, 16, 16, 0.5);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.field-label {
    font-size: 0.8rem;
    font-weight: 600;
}

.field-input {
    background: rgba(12, 12, 12, 0.8);
    border: 1px solid rgba(201, 164, 90, 0.3);
    color: inherit;
    padding: 6px 8px;
    font-size: 0.8rem;
    font-family: inherit;
}

.field-desc {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
}

.field-hint {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.45);
    white-space: pre-line;
}

.control-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}

.btn-group {
    display: flex;
    gap: 8px;
}

.priority-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
}

.priority-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
}

.priority-column {
    border: 1px solid rgba(201, 164, 90, 0.2);
    padding: 8px;
    background: rgba(12, 12, 12, 0.5);
}

.column-title {
    font-size: 0.8rem;
    margin-bottom: 6px;
    color: rgba(232, 221, 196, 0.7);
}

.priority-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.priority-item {
    border: 1px solid rgba(201, 164, 90, 0.2);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(16, 16, 16, 0.6);
}

.priority-main {
    display: flex;
    align-items: center;
    gap: 6px;
}

.priority-name {
    font-size: 0.78rem;
}

.priority-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.priority-help {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-size: 0.7rem;
    border-radius: 999px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    cursor: default;
}

.priority-help::after {
    content: attr(data-text);
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(16, 16, 16, 0.9);
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 8px;
    font-size: 0.7rem;
    width: 220px;
    white-space: pre-line;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 10;
}

.priority-help:hover::after {
    opacity: 1;
}

@media (max-width: 1024px) {
    .npc-page {
        padding: 16px;
    }
}
</style>
