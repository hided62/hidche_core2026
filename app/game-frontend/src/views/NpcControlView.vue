<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { npcPriorityHelp } from '../utils/npcPriorityHelp';
import { trpc } from '../utils/trpc';

type NpcPolicyResponse = Awaited<ReturnType<typeof trpc.npc.getPolicy.query>>;
type NationPolicy = NpcPolicyResponse['currentNationPolicy'];
type NumericPolicyKey = Exclude<keyof NationPolicy, 'CombatForce' | 'SupportForce' | 'DevelopForce'>;
type PrioritySectionKey = 'nation' | 'general';
type PriorityBucket = 'active' | 'inactive';

interface PolicyField {
    key: NumericPolicyKey;
    label: string;
    step: number;
    description: string;
    hint?: string;
    percent?: boolean;
    min?: number;
    max?: number;
}

interface PriorityListState {
    active: string[];
    inactive: string[];
    available: string[];
}

interface PriorityPanel {
    key: PrioritySectionKey;
    title: string;
    description: string[];
    setter: NpcPolicyResponse['lastSetters']['nation'];
    state: PriorityListState;
}

interface DragState {
    section: PrioritySectionKey;
    bucket: PriorityBucket;
    index: number;
}

const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const data = ref<NpcPolicyResponse | null>(null);
const policyDraft = ref<NationPolicy | null>(null);
const lastSavedPolicy = ref<NationPolicy | null>(null);
const nationPriority = ref<PriorityListState | null>(null);
const generalPriority = ref<PriorityListState | null>(null);
const lastSavedNationPriority = ref<string[]>([]);
const lastSavedGeneralPriority = ref<string[]>([]);
const dragState = ref<DragState | null>(null);

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
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
    return {
        active: [...active],
        inactive: available.filter((item) => !activeSet.has(item)),
        available: [...available],
    };
};

const loadPolicy = async () => {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
        data.value = await trpc.npc.getPolicy.query();
    } catch (caught) {
        error.value = resolveErrorMessage(caught);
    } finally {
        loading.value = false;
    }
};

watch(data, (value) => {
    if (!value) return;
    policyDraft.value = clonePolicy(value.currentNationPolicy);
    lastSavedPolicy.value = clonePolicy(value.currentNationPolicy);
    nationPriority.value = assignPriorityState(value.currentNationPriority, value.availableNationPriorityItems);
    generalPriority.value = assignPriorityState(
        value.currentGeneralActionPriority,
        value.availableGeneralActionPriorityItems
    );
    lastSavedNationPriority.value = [...value.currentNationPriority];
    lastSavedGeneralPriority.value = [...value.currentGeneralActionPriority];
});

onMounted(() => void loadPolicy());

const formatNumber = (value: number): string => new Intl.NumberFormat('ko-KR').format(Math.round(value));

const calcPolicyValue = (key: NumericPolicyKey): number => {
    if (!data.value || !policyDraft.value) return 0;
    const value = policyDraft.value[key];
    return value === 0 ? data.value.zeroPolicy[key] : value;
};

const safeRecruitPercent = computed({
    get: () => (policyDraft.value?.safeRecruitCityPopulationRatio ?? 0) * 100,
    set: (value: number) => {
        if (policyDraft.value) policyDraft.value.safeRecruitCityPopulationRatio = value / 100;
    },
});

const policyFields = computed<PolicyField[]>(() => {
    if (!data.value) return [];
    const statMax = data.value.defaultStatMax;
    const statNpcMax = data.value.defaultStatNpcMax;
    return [
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
        {
            key: 'reqHumanWarUrgentGold',
            label: '유저전투장 긴급포상 금',
            step: 100,
            description: '유저장긴급포상시 이보다 금이 적은 장수에게 포상합니다.',
            hint: `0이면 보병 6회 징병(${formatNumber(statMax * 100)} * 6) 가능한 금을 기준으로 하며, 그 수치는 현재 ${formatNumber(data.value.zeroPolicy.reqHumanWarUrgentGold)}입니다.`,
        },
        {
            key: 'reqHumanWarUrgentRice',
            label: '유저전투장 긴급포상 쌀',
            step: 100,
            description: '유저장긴급포상시 이보다 쌀이 적은 장수에게 포상합니다.',
            hint: `0이면 기본 병종으로 ${formatNumber(statMax * 100)} * 6명 사살 가능한 쌀을 기준으로 하며, 그 수치는 현재 ${formatNumber(data.value.zeroPolicy.reqHumanWarUrgentRice)}입니다.`,
        },
        {
            key: 'reqHumanWarRecommandGold',
            label: '유저전투장 권장 금',
            step: 100,
            description: '유저전투장에게 주는 금입니다. 이보다 적으면 포상합니다.',
            hint: `0이면 유저전투장 긴급포상 금의 2배를 기준으로 하며, 그 수치는 현재 ${formatNumber(calcPolicyValue('reqHumanWarUrgentGold') * 2)}입니다.`,
        },
        {
            key: 'reqHumanWarRecommandRice',
            label: '유저전투장 권장 쌀',
            step: 100,
            description: '유저전투장에게 주는 쌀입니다. 이보다 적으면 포상합니다.',
            hint: `0이면 유저전투장 긴급포상 쌀의 2배를 기준으로 하며, 그 수치는 현재 ${formatNumber(calcPolicyValue('reqHumanWarUrgentRice') * 2)}입니다.`,
        },
        {
            key: 'reqHumanDevelGold',
            label: '유저내정장 권장 금',
            step: 100,
            description: '유저내정장에게 주는 금입니다. 이보다 적으면 포상합니다.',
        },
        {
            key: 'reqHumanDevelRice',
            label: '유저내정장 권장 쌀',
            step: 100,
            description: '유저내정장에게 주는 쌀입니다. 이보다 적으면 포상합니다.',
        },
        {
            key: 'reqNPCWarGold',
            label: 'NPC전투장 권장 금',
            step: 100,
            description: 'NPC전투장에게 주는 금입니다. 이보다 적으면 포상합니다.',
            hint: `0이면 기본 병종 4회(${formatNumber(statNpcMax * 100)} * 4) 징병비를 기준으로 하며, 그 수치는 현재 ${formatNumber(data.value.zeroPolicy.reqNPCWarGold)}입니다.`,
        },
        {
            key: 'reqNPCWarRice',
            label: 'NPC전투장 권장 쌀',
            step: 100,
            description: 'NPC전투장에게 주는 쌀입니다. 이보다 적으면 포상합니다.',
            hint: `0이면 기본 병종으로 ${formatNumber(statNpcMax * 100)} * 4명 사살 가능한 쌀을 기준으로 하며, 그 수치는 현재 ${formatNumber(data.value.zeroPolicy.reqNPCWarRice)}입니다.`,
        },
        {
            key: 'reqNPCDevelGold',
            label: 'NPC내정장 권장 금',
            step: 100,
            description: 'NPC내정장에게 주는 금입니다. 이보다 5배 더 많다면 헌납합니다.',
            hint: `0이면 30턴 내정 가능한 금을 기준으로 하며, 그 수치는 현재 ${formatNumber(data.value.zeroPolicy.reqNPCDevelGold)}입니다.`,
        },
        {
            key: 'reqNPCDevelRice',
            label: 'NPC내정장 권장 쌀',
            step: 100,
            description: 'NPC내정장에게 주는 쌀입니다. 이보다 5배 더 많다면 헌납합니다.',
        },
        {
            key: 'minimumResourceActionAmount',
            label: '포상/몰수/헌납/삼/팜 최소 단위',
            step: 100,
            min: 100,
            description: '연산결과가 이 단위보다 적다면 수행하지 않습니다.',
        },
        {
            key: 'maximumResourceActionAmount',
            label: '포상/몰수/헌납/삼/팜 최대 단위',
            step: 100,
            min: 100,
            description: '연산결과가 이 단위보다 크다면, 이 값에 맞춥니다.',
        },
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
            description: '도시의 인구가 이보다 낮으면 NPC는 도시에서 징병하지 않고 후방 워프합니다.',
            hint: 'NPC의 최대 병력수보다 낮게 설정하면 제자리에서 정착장려를 합니다.',
        },
        {
            key: 'safeRecruitCityPopulationRatio',
            label: '제자리 징병 허용 인구율(%)',
            step: 0.5,
            min: 0,
            max: 100,
            percent: true,
            description: '전쟁 시 후방 발령, 후방 워프의 기준 인구입니다. 이보다 많다면 충분하다고 판단합니다.',
            hint: 'NPC의 최대 병력수보다 낮게 설정하면 제자리에서 정착장려를 합니다.',
        },
        {
            key: 'minNPCWarLeadership',
            label: 'NPC 전투 참여 통솔 기준',
            step: 5,
            description: '이 수치보다 같거나 높으면 NPC전투장으로 분류됩니다.',
        },
        {
            key: 'properWarTrainAtmos',
            label: '훈련/사기진작 목표치',
            step: 5,
            min: 20,
            max: 100,
            description: '훈련/사기진작 기준치입니다. 이보다 같거나 높으면 출병합니다.',
        },
        {
            key: 'cureThreshold',
            label: '요양 기준',
            step: 5,
            min: 10,
            max: 100,
            description: '요양 기준 %입니다. 이보다 많이 부상을 입으면 요양합니다.',
        },
    ];
});

const priorityPanels = computed<PriorityPanel[]>(() => {
    if (!data.value || !nationPriority.value || !generalPriority.value) return [];
    return [
        {
            key: 'nation',
            title: 'NPC 사령턴 우선순위',
            description: ['예턴이 없거나, 지정되어 있더라도 실패하면', '아래 순위에 따라 사령턴을 시도합니다.'],
            setter: data.value.lastSetters.nation,
            state: nationPriority.value,
        },
        {
            key: 'general',
            title: 'NPC 일반턴 우선순위',
            description: [
                '순위가 높은 것부터 시도합니다.',
                '아무것도 실행할 수 없으면 물자조달이나 인재탐색을 합니다.',
            ],
            setter: data.value.lastSetters.general,
            state: generalPriority.value,
        },
    ];
});

const resetPolicy = () => {
    if (!data.value || !window.confirm('초기 설정으로 되돌릴까요?')) return;
    policyDraft.value = clonePolicy(data.value.defaultNationPolicy);
    notice.value = '서버 초깃값을 적용했습니다. 설정 버튼을 누르면 반영됩니다.';
};

const rollbackPolicy = () => {
    if (!lastSavedPolicy.value || !window.confirm('이전 설정으로 되돌릴까요?')) return;
    policyDraft.value = clonePolicy(lastSavedPolicy.value);
    notice.value = '이전 설정으로 되돌렸습니다.';
};

const submitPolicy = async () => {
    if (!policyDraft.value || !window.confirm('저장할까요?')) return;
    error.value = null;
    notice.value = null;
    try {
        await trpc.npc.setNationPolicy.mutate(policyDraft.value);
        lastSavedPolicy.value = clonePolicy(policyDraft.value);
        notice.value = 'NPC 정책이 반영되었습니다.';
    } catch (caught) {
        error.value = `설정하지 못했습니다: ${resolveErrorMessage(caught)}`;
    }
};

const resetPriority = (section: PrioritySectionKey) => {
    if (!data.value || !window.confirm('초기 설정으로 되돌릴까요?')) return;
    if (section === 'nation') {
        nationPriority.value = assignPriorityState(
            data.value.defaultNationPriority,
            data.value.availableNationPriorityItems
        );
    } else {
        generalPriority.value = assignPriorityState(
            data.value.defaultGeneralActionPriority,
            data.value.availableGeneralActionPriorityItems
        );
    }
    notice.value = '서버 초깃값을 적용했습니다. 설정 버튼을 누르면 반영됩니다.';
};

const rollbackPriority = (section: PrioritySectionKey) => {
    if (!data.value || !window.confirm('이전 설정으로 되돌릴까요?')) return;
    if (section === 'nation') {
        nationPriority.value = assignPriorityState(
            lastSavedNationPriority.value,
            data.value.availableNationPriorityItems
        );
    } else {
        generalPriority.value = assignPriorityState(
            lastSavedGeneralPriority.value,
            data.value.availableGeneralActionPriorityItems
        );
    }
    notice.value = '이전 설정으로 되돌렸습니다.';
};

const submitPriority = async (section: PrioritySectionKey) => {
    const state = section === 'nation' ? nationPriority.value : generalPriority.value;
    if (!state || !window.confirm('저장할까요?')) return;
    error.value = null;
    notice.value = null;
    try {
        if (section === 'nation') {
            await trpc.npc.setNationPriority.mutate(state.active);
            lastSavedNationPriority.value = [...state.active];
        } else {
            await trpc.npc.setGeneralPriority.mutate(state.active);
            lastSavedGeneralPriority.value = [...state.active];
        }
        notice.value = 'NPC 정책이 반영되었습니다.';
    } catch (caught) {
        error.value = `설정하지 못했습니다: ${resolveErrorMessage(caught)}`;
    }
};

const startDrag = (event: DragEvent, section: PrioritySectionKey, bucket: PriorityBucket, index: number) => {
    dragState.value = { section, bucket, index };
    event.dataTransfer?.setData('text/plain', `${section}:${bucket}:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
};

const dropPriority = (event: DragEvent, section: PrioritySectionKey, bucket: PriorityBucket, targetIndex?: number) => {
    event.preventDefault();
    const source = dragState.value;
    const state = section === 'nation' ? nationPriority.value : generalPriority.value;
    if (!source || source.section !== section || !state) return;
    const sourceList = state[source.bucket];
    const targetList = state[bucket];
    const [item] = sourceList.splice(source.index, 1);
    if (!item) return;
    let index = targetIndex ?? targetList.length;
    if (sourceList === targetList && source.index < index) index -= 1;
    targetList.splice(Math.max(0, Math.min(index, targetList.length)), 0, item);
    dragState.value = null;
};
</script>

<template>
    <main id="npc-policy-page" class="npc-page">
        <nav class="top-back-bar legacy-bg0">
            <RouterLink class="back-button" to="/">돌아가기</RouterLink>
            <strong>NPC 정책</strong>
        </nav>

        <div v-if="loading && !data" class="page-state legacy-bg0">불러오는 중...</div>
        <div v-else-if="!data" class="page-state error-state legacy-bg0" role="alert">
            {{ error ?? 'NPC 정책을 불러오지 못했습니다.' }}
            <button type="button" @click="loadPolicy">다시 시도</button>
        </div>

        <section v-else-if="policyDraft" id="container" class="policy-container legacy-bg0">
            <div class="section_bar legacy-bg1">국가 정책</div>
            <div class="setter">
                최근 설정: {{ data.lastSetters.policy.setter ?? '-없음-' }} ({{
                    data.lastSetters.policy.date ?? '설정 기록 없음'
                }})
            </div>

            <div v-if="error" class="feedback error-feedback" role="alert">{{ error }}</div>
            <div v-if="notice" class="feedback notice-feedback" role="status">{{ notice }}</div>

            <div class="form_list">
                <div v-for="field in policyFields" :key="field.key" class="policy-field">
                    <div class="field-row">
                        <label :for="`npc-policy-${field.key}`">{{ field.label }}</label>
                        <input
                            v-if="field.percent"
                            :id="`npc-policy-${field.key}`"
                            v-model.number="safeRecruitPercent"
                            type="number"
                            :step="field.step"
                            :min="field.min"
                            :max="field.max"
                        />
                        <input
                            v-else
                            :id="`npc-policy-${field.key}`"
                            v-model.number="policyDraft[field.key]"
                            type="number"
                            :step="field.step"
                            :min="field.min"
                            :max="field.max"
                        />
                    </div>
                    <p>{{ field.description }}</p>
                    <p v-if="field.hint">{{ field.hint }}</p>
                </div>
            </div>

            <div class="work-in-progress">
                전투 부대는 작업중입니다(json양식: {부대번호:[시작도시번호(아국),도착도시번호(적국)],...})
                <br />후방 징병 부대는 작업중입니다(json양식: [부대번호,...]) <br />내정 부대는 작업중입니다(json양식:
                [부대번호,...])
                <input type="hidden" :value="JSON.stringify(policyDraft.CombatForce)" />
                <input type="hidden" :value="JSON.stringify(policyDraft.SupportForce)" />
                <input type="hidden" :value="JSON.stringify(policyDraft.DevelopForce)" />
            </div>

            <div class="control_bar">
                <div class="button-group">
                    <button class="reset_btn" type="button" @click="resetPolicy">초깃값으로</button>
                    <button class="revert_btn" type="button" @click="rollbackPolicy">이전값으로</button>
                </div>
                <button class="submit_btn" type="button" @click="submitPolicy">설정</button>
            </div>

            <div class="priority-sections">
                <section
                    v-for="panel in priorityPanels"
                    :key="panel.key"
                    :class="['priority-panel', panel.key === 'nation' ? 'half_section_left' : 'half_section_right']"
                >
                    <div class="section_bar legacy-bg1">{{ panel.title }}</div>
                    <div class="priority-meta">
                        <small>
                            최근 설정: {{ panel.setter.setter ?? '-없음-' }} ({{
                                panel.setter.date ?? '설정 기록 없음'
                            }})
                        </small>
                    </div>
                    <div class="priority-description">
                        <small>{{ panel.description[0] }}<br />{{ panel.description[1] }}</small>
                    </div>
                    <div class="priority-columns">
                        <div class="priority-column">
                            <div class="sub_bar legacy-bg2">비활성</div>
                            <div
                                class="priority-list"
                                @dragover.prevent
                                @drop="dropPriority($event, panel.key, 'inactive')"
                            >
                                <div class="inactive-header">&lt;비활성화 항목들&gt;</div>
                                <div
                                    v-for="(item, index) in panel.state.inactive"
                                    :key="item"
                                    class="priority-item"
                                    draggable="true"
                                    @dragstart="startDrag($event, panel.key, 'inactive', index)"
                                    @dragover.prevent
                                    @drop.stop="dropPriority($event, panel.key, 'inactive', index)"
                                >
                                    <div class="priority_info">
                                        <span class="drag-handle">≡</span>
                                        <span>{{ item }}</span>
                                        <button
                                            class="help-button"
                                            type="button"
                                            :aria-label="`${item} 설명`"
                                            :data-text="npcPriorityHelp[item] ?? '설명 없음'"
                                        >
                                            ?
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="priority-column">
                            <div class="sub_bar legacy-bg2">활성</div>
                            <div
                                class="priority-list"
                                @dragover.prevent
                                @drop="dropPriority($event, panel.key, 'active')"
                            >
                                <div
                                    v-for="(item, index) in panel.state.active"
                                    :key="`${item}-${index}`"
                                    class="priority-item"
                                    draggable="true"
                                    @dragstart="startDrag($event, panel.key, 'active', index)"
                                    @dragover.prevent
                                    @drop.stop="dropPriority($event, panel.key, 'active', index)"
                                >
                                    <div class="priority_info">
                                        <span class="drag-handle">≡</span>
                                        <span>{{ item }}</span>
                                        <button
                                            class="help-button"
                                            type="button"
                                            :aria-label="`${item} 설명`"
                                            :data-text="npcPriorityHelp[item] ?? '설명 없음'"
                                        >
                                            ?
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="control_bar priority-control">
                        <div class="button-group">
                            <button class="reset_btn" type="button" @click="resetPriority(panel.key)">
                                초깃값으로
                            </button>
                            <button class="revert_btn" type="button" @click="rollbackPriority(panel.key)">
                                이전값으로
                            </button>
                        </div>
                        <button class="submit_btn" type="button" @click="submitPriority(panel.key)">설정</button>
                    </div>
                </section>
            </div>
        </section>
        <div class="sortable-compat-controls" aria-hidden="true">
            <button type="button" tabindex="-1" />
            <input v-for="index in 20" :key="index" type="hidden" />
        </div>
    </main>
</template>

<style scoped>
/*
 * The document contract belongs to this page only. An unscoped html/body rule
 * here leaked a 21px line-height and a 500px min-width onto every other screen.
 */
:global(html:has(#npc-policy-page)),
:global(body:has(#npc-policy-page)),
:global(#app:has(#npc-policy-page)) {
    min-width: 500px;
    margin: 0;
    background: #000;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 21px;
}

.npc-page {
    min-height: 100vh;
    padding-bottom: 32px;
    box-sizing: border-box;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 21px;
}
.sortable-compat-controls {
    display: none;
}

.legacy-bg0 {
    background-image: var(--sammo-texture-walnut);
}

.legacy-bg1 {
    background-image: var(--sammo-texture-green);
}

.legacy-bg2 {
    background-image: var(--sammo-texture-blue);
}

.top-back-bar {
    position: relative;
    height: 32px;
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
    box-sizing: border-box;
}

.top-back-bar strong {
    font-size: 24px;
    line-height: 32px;
    font-weight: 400;
}

.back-button {
    position: absolute;
    inset: 0 auto 0 0;
    width: 88px;
    color: #fff;
    background: #087f45;
    border: 1px solid #0a9960;
    border-radius: 0 0 4px;
    font-weight: 700;
    line-height: 30px;
    text-decoration: none;
}

.back-button:hover,
.back-button:focus-visible {
    background: #0a9960;
    outline: 2px solid #fff;
    outline-offset: -2px;
}

.policy-container,
.page-state {
    width: 100%;
    max-width: 1000px;
    margin: 0 auto;
    border: 1px solid #888;
    box-sizing: border-box;
}

.page-state {
    padding: 16px;
    min-height: 100px;
}

.page-state button {
    margin-left: 12px;
}

.section_bar {
    min-height: 23px;
    border: 0.5px solid #aaa;
    box-sizing: border-box;
    text-align: center;
}

.setter,
.priority-meta {
    min-height: 21px;
    padding: 0 12px;
    color: #8e8e8e;
    font-size: 12.25px;
    line-height: 18.375px;
    text-align: right;
    box-sizing: border-box;
}

.feedback {
    margin: 4px 12px;
    padding: 5px 10px;
    border: 1px solid;
    border-radius: 4px;
}

.error-feedback,
.error-state {
    color: #ffd4d4;
    border-color: #a94442;
    background-color: rgba(120, 20, 20, 0.75);
}

.notice-feedback {
    color: #d9ffd9;
    border-color: #3c763d;
    background-color: rgba(20, 90, 20, 0.7);
}

.form_list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 8px;
}

.policy-field {
    min-width: 0;
    padding: 0 10.5px;
    box-sizing: border-box;
}

.field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 224px;
    align-items: center;
    min-height: 34px;
}

.field-row label {
    min-width: 0;
}

.field-row input {
    width: 224px;
    height: 34px;
    padding: 5.25px 10.5px;
    color: #303030;
    background: #ddd;
    border: 1px solid #000;
    border-radius: 4px;
    box-sizing: border-box;
    font: inherit;
}

.field-row input:focus {
    border-color: #66afe9;
    outline: 2px solid rgba(102, 175, 233, 0.7);
}

.policy-field p {
    min-height: 18.375px;
    margin: 0;
    color: #888;
    font-size: 12.25px;
    line-height: 18.375px;
    text-align: right;
}

.work-in-progress {
    margin: 0 11px 15px;
    padding: 14px;
    color: #fff;
    background: #444;
    border: 1px solid #444;
    border-radius: 4px;
}

.control_bar {
    display: flex;
    justify-content: flex-end;
    padding: 0 10.6667px 10.6667px;
    min-height: 56.8125px;
    box-sizing: border-box;
}

.button-group {
    display: flex;
}

.control_bar button {
    width: 150px;
    height: 35.5px;
    margin-top: 10.6667px;
    padding: 5.25px 10.5px;
    color: #fff;
    border: 1px solid;
    font: inherit;
    cursor: pointer;
}

.reset_btn {
    background: #303030;
    border-color: #2b2b2b !important;
    border-radius: 4px 0 0 4px;
}

.revert_btn {
    background: #444;
    border-color: #3d3d3d !important;
    border-radius: 0 4px 4px 0;
}

.submit_btn {
    margin-left: 14px;
    background: #375a7f;
    border-color: #325172 !important;
    border-radius: 4px;
}

.control_bar button:hover {
    filter: brightness(1.15);
}

.control_bar button:focus-visible,
.help-button:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
}

.priority-sections {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.priority-panel {
    min-width: 0;
}

.half_section_left {
    border-right: 0.5px solid #aaa;
}

.priority-meta {
    float: right;
}

.priority-description {
    clear: both;
    min-height: 42px;
    padding: 0 8px;
    color: #888;
    box-sizing: border-box;
}

.priority-description small {
    font-size: 12.25px;
    line-height: 18.375px;
}

.priority-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.priority-column {
    min-width: 0;
}

.sub_bar {
    height: 22px;
    margin: 0 5px;
    border: 0.5px solid #aaa;
    text-align: center;
    box-sizing: border-box;
}

.priority-list {
    display: flex;
    min-height: 37px;
    margin: 0 10px;
    flex-direction: column;
}

.inactive-header,
.priority-item {
    height: 37px;
    padding: 7px 14px;
    border: 1px solid #444;
    box-sizing: border-box;
}

.inactive-header {
    color: #1d1d1d;
    background: #d6d6d6;
}

.priority-item {
    color: #fff;
    background: #303030;
    cursor: grab;
}

.priority-item:active {
    cursor: grabbing;
    opacity: 0.8;
}

.priority_info {
    display: grid;
    height: 21px;
    grid-template-columns: 24px minmax(0, 1fr) 24px;
    align-items: center;
}

.drag-handle {
    font-size: 18px;
}

.help-button {
    position: relative;
    width: 24px;
    height: 22.375px;
    padding: 0 3.5px;
    color: #fff;
    background: #444;
    border: 1px solid #3d3d3d;
    border-radius: 3px;
    font-size: 12.25px;
    line-height: 18.375px;
    cursor: pointer;
}

.help-button::after {
    position: absolute;
    right: 0;
    bottom: calc(100% + 5px);
    z-index: 10;
    width: 300px;
    padding: 7px;
    color: #fff;
    background: #111;
    border: 1px solid #777;
    border-radius: 4px;
    content: attr(data-text);
    font-size: 12px;
    line-height: 18px;
    text-align: left;
    white-space: pre-line;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.help-button:hover::after,
.help-button:focus-visible::after {
    opacity: 1;
}

.priority-control {
    margin-top: 0;
}

@media (max-width: 991px) {
    .npc-page {
        padding-bottom: 47px;
    }
    .form_list,
    .priority-sections {
        grid-template-columns: 1fr;
    }

    .half_section_left {
        border-right: 0;
    }
}
</style>
