<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import { useSessionStore } from '../stores/session';
import { cityLevelMap, regionMap } from '../utils/nationFormat';

type JoinConfig = Awaited<ReturnType<typeof trpc.join.getConfig.query>>;
type JoinInput = Parameters<typeof trpc.join.createGeneral.mutate>[0];
type PossessCandidate = Awaited<ReturnType<typeof trpc.join.listPossessCandidates.query>>[0];
type JoinForm = Omit<JoinInput, 'inheritBonusStat' | 'clientRequestId'> & {
    inheritBonusStat: [number, number, number];
};
type PendingJoinAction = {
    ownerUserId: string;
    input: JoinForm;
    clientRequestId: string;
};

const router = useRouter();
const session = useSessionStore();

const loading = ref(true);
const error = ref<string | null>(null);
const submitting = ref(false);

const joinConfig = ref<JoinConfig | null>(null);
const activeTab = ref<'create' | 'possess'>('create');
const pendingJoinStorageKey = 'sammo-join-create-pending-action';

const form = ref<JoinForm>({
    name: '',
    leadership: 0,
    strength: 0,
    intel: 0,
    character: 'Random',
    pic: true,
    inheritBonusStat: [0, 0, 0],
});

const readPendingJoin = (): PendingJoinAction | null => {
    try {
        const raw = window.sessionStorage.getItem(pendingJoinStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<PendingJoinAction>;
        if (
            !value.input ||
            typeof value.input !== 'object' ||
            typeof value.ownerUserId !== 'string' ||
            typeof value.clientRequestId !== 'string'
        ) {
            return null;
        }
        return value as PendingJoinAction;
    } catch {
        return null;
    }
};

const cloneJoinInput = (): JoinForm => JSON.parse(JSON.stringify(form.value)) as JoinForm;

const getPendingJoin = (): PendingJoinAction => {
    const input = cloneJoinInput();
    const current = readPendingJoin();
    const ownerUserId = joinConfig.value?.user.id ?? '';
    if (current && current.ownerUserId === ownerUserId && JSON.stringify(current.input) === JSON.stringify(input)) {
        return current;
    }
    const pending: PendingJoinAction = {
        ownerUserId,
        input,
        clientRequestId: crypto.randomUUID(),
    };
    window.sessionStorage.setItem(pendingJoinStorageKey, JSON.stringify(pending));
    return pending;
};

const clearPendingJoin = (pending: PendingJoinAction): void => {
    if (readPendingJoin()?.clientRequestId === pending.clientRequestId) {
        window.sessionStorage.removeItem(pendingJoinStorageKey);
    }
};

const isIndeterminateTimeout = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || !('data' in value)) return false;
    const data = value.data;
    return Boolean(data && typeof data === 'object' && 'code' in data && data.code === 'TIMEOUT');
};

const npcCandidates = ref<PossessCandidate[]>([]);
const npcLoading = ref(false);
const npcError = ref<string | null>(null);
const npcOffset = ref(0);
const npcLimit = 20;

const statRules = computed(() => joinConfig.value?.rules.stat ?? null);
const statTotal = computed(() => form.value.leadership + form.value.strength + form.value.intel);
const statErrors = computed(() => {
    const rules = statRules.value;
    if (!rules) {
        return [] as string[];
    }
    const errors: string[] = [];
    const values = [form.value.leadership, form.value.strength, form.value.intel];
    if (values.some((value) => value < rules.min || value > rules.max)) {
        errors.push(`능력치는 ${rules.min} ~ ${rules.max} 범위여야 합니다.`);
    }
    if (statTotal.value > rules.total) {
        errors.push(`능력치 합이 ${rules.total}을 넘을 수 없습니다.`);
    }
    return errors;
});

const canSubmit = computed(() => {
    if (!statRules.value) {
        return false;
    }
    if (!form.value.name.trim()) {
        return false;
    }
    if (statErrors.value.length > 0) {
        return false;
    }
    if (inheritErrors.value.length > 0) {
        return false;
    }
    return true;
});

const nationList = computed(() => joinConfig.value?.nations ?? []);
const personalities = computed(() => joinConfig.value?.personalities ?? []);
const inheritConfig = computed(() => joinConfig.value?.inherit ?? null);

const inheritTotalPoint = computed(() => inheritConfig.value?.totalPoint ?? 0);
const inheritCosts = computed(
    () =>
        inheritConfig.value?.costs ?? {
            inheritBornSpecialPoint: 0,
            inheritBornTurntimePoint: 0,
            inheritBornCityPoint: 0,
            inheritBornStatPoint: 0,
        }
);
const inheritRequiredPoint = computed(() => {
    let total = 0;
    if (form.value.inheritSpecial) {
        total += inheritCosts.value.inheritBornSpecialPoint;
    }
    if (form.value.inheritCity !== undefined) {
        total += inheritCosts.value.inheritBornCityPoint;
    }
    if (form.value.inheritTurntimeZone !== undefined) {
        total += inheritCosts.value.inheritBornTurntimePoint;
    }
    const bonus = form.value.inheritBonusStat ?? [0, 0, 0];
    const bonusSum = bonus.reduce((acc, value) => acc + value, 0);
    if (bonusSum > 0) {
        total += inheritCosts.value.inheritBornStatPoint;
    }
    return total;
});

const inheritBonusSum = computed(() => {
    const bonus = form.value.inheritBonusStat ?? [0, 0, 0];
    return bonus.reduce((acc, value) => acc + value, 0);
});

const inheritErrors = computed(() => {
    const errors: string[] = [];
    const bonus = form.value.inheritBonusStat ?? [0, 0, 0];
    const bonusSum = bonus.reduce((acc, value) => acc + value, 0);
    if (bonusSum !== 0 && (bonusSum < 3 || bonusSum > 5)) {
        errors.push('보너스 능력치는 합 3~5 사이여야 합니다.');
    }
    if (inheritRequiredPoint.value > inheritTotalPoint.value) {
        errors.push('보유한 유산 포인트가 부족합니다.');
    }
    return errors;
});

const inheritSpecialChoice = computed<string>({
    get: () => form.value.inheritSpecial ?? '',
    set: (value) => {
        form.value.inheritSpecial = value ? value : undefined;
    },
});

const inheritCityChoice = computed<string>({
    get: () => (form.value.inheritCity !== undefined ? String(form.value.inheritCity) : ''),
    set: (value) => {
        form.value.inheritCity = value ? Number(value) : undefined;
    },
});

const inheritTurntimeChoice = computed<string>({
    get: () => (form.value.inheritTurntimeZone !== undefined ? String(form.value.inheritTurntimeZone) : ''),
    set: (value) => {
        form.value.inheritTurntimeZone = value ? Number(value) : undefined;
    },
});

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const applyBalancedStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    const base = Math.floor(rules.total / 3);
    form.value.leadership = rules.total - base * 2;
    form.value.strength = base;
    form.value.intel = base;
};

const applyRandomStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    for (let i = 0; i < 40; i += 1) {
        const leadership = randomInt(rules.min, rules.max);
        const strength = randomInt(rules.min, rules.max);
        const intel = rules.total - leadership - strength;
        if (intel >= rules.min && intel <= rules.max) {
            form.value.leadership = leadership;
            form.value.strength = strength;
            form.value.intel = intel;
            return;
        }
    }
    applyBalancedStats();
};

const applyFocusedStats = (focus: 'leadership' | 'strength' | 'intel') => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    const focusValue = Math.min(rules.max, rules.min + Math.floor(rules.total * 0.45));
    const remain = rules.total - focusValue;
    const side = Math.floor(remain / 2);
    form.value.leadership = focus === 'leadership' ? focusValue : side;
    form.value.strength = focus === 'strength' ? focusValue : side;
    form.value.intel = focus === 'intel' ? focusValue : remain - side;
};

const loadConfig = async () => {
    loading.value = true;
    error.value = null;
    try {
        const config = await trpc.join.getConfig.query();
        if (config.selectionPool.enabled) {
            await router.replace({ name: 'select-general' });
            return;
        }
        joinConfig.value = config;
        const pending = readPendingJoin();
        if (pending?.ownerUserId === config.user.id) {
            form.value = pending.input;
        } else {
            form.value.name = config.rules.allowCustomName ? config.user.displayName || '' : '무작위';
            applyBalancedStats();
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'join_config_failed';
    } finally {
        loading.value = false;
    }
};

const loadNpcCandidates = async (reset = false) => {
    npcLoading.value = true;
    npcError.value = null;
    try {
        if (reset) {
            npcOffset.value = 0;
        }
        const list = await trpc.join.listPossessCandidates.query({
            limit: npcLimit,
            offset: npcOffset.value,
        });
        npcCandidates.value = reset ? list : [...npcCandidates.value, ...list];
        npcOffset.value += list.length;
    } catch (err) {
        npcError.value = err instanceof Error ? err.message : 'npc_list_failed';
    } finally {
        npcLoading.value = false;
    }
};

const submitJoin = async () => {
    if (!canSubmit.value || submitting.value) {
        return;
    }
    submitting.value = true;
    error.value = null;
    const pending = getPendingJoin();
    try {
        await trpc.join.createGeneral.mutate({
            ...pending.input,
            clientRequestId: pending.clientRequestId,
        });
        clearPendingJoin(pending);
        await session.refreshGeneralStatus();
        if (session.hasGeneral) {
            await router.push({ name: 'home' });
        }
    } catch (err) {
        if (!isIndeterminateTimeout(err)) {
            clearPendingJoin(pending);
        }
        error.value = err instanceof Error ? err.message : 'join_failed';
    } finally {
        submitting.value = false;
    }
};

const possessGeneral = async (generalId: number) => {
    if (submitting.value) {
        return;
    }
    submitting.value = true;
    error.value = null;
    try {
        await trpc.join.possessGeneral.mutate({ generalId });
        await session.refreshGeneralStatus();
        if (session.hasGeneral) {
            await router.push({ name: 'home' });
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'possess_failed';
    } finally {
        submitting.value = false;
    }
};

watch(activeTab, (value) => {
    if (value === 'possess' && npcCandidates.value.length === 0) {
        void loadNpcCandidates(true);
    }
});

onMounted(() => {
    void loadConfig();
});
</script>

<template>
    <main class="join-page">
        <header class="join-header">
            <div>
                <h1 class="join-title">장수 생성/빙의</h1>
                <p class="join-subtitle">로그인 완료, 아직 장수가 없는 상태입니다.</p>
            </div>
            <div class="join-tabs">
                <RouterLink class="simulator-link" to="/past-plays">내 지난 플레이</RouterLink>
                <RouterLink class="simulator-link" to="/battle-simulator">전투 시뮬레이터</RouterLink>
                <button :class="{ active: activeTab === 'create' }" @click="activeTab = 'create'">장수 생성</button>
                <button :class="{ active: activeTab === 'possess' }" @click="activeTab = 'possess'">NPC 빙의</button>
            </div>
        </header>

        <div v-if="error" class="join-error">{{ error }}</div>

        <div v-if="loading">
            <SkeletonLines :lines="4" />
        </div>

        <section v-else-if="activeTab === 'create'" class="join-grid">
            <PanelCard title="국가 임관 권유">
                <div v-if="nationList.length === 0" class="muted">국가 정보가 아직 준비되지 않았습니다.</div>
                <div v-else class="nation-list">
                    <div v-for="nation in nationList" :key="nation.id" class="nation-card">
                        <div class="nation-name" :style="{ backgroundColor: nation.color }">{{ nation.name }}</div>
                        <div class="nation-message">
                            {{ nation.scoutMessage ?? '권유문 없음' }}
                        </div>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="장수 기본 정보" subtitle="능력치와 성격을 지정합니다.">
                <div class="form-grid">
                    <label class="form-field">
                        <span>장수명</span>
                        <input
                            v-if="joinConfig?.rules.allowCustomName"
                            v-model="form.name"
                            type="text"
                            class="form-input"
                        />
                        <span v-else>무작위</span>
                    </label>
                    <label class="form-field">
                        <span>성격</span>
                        <select v-model="form.character" class="form-input">
                            <option v-for="option in personalities" :key="option.key" :value="option.key">
                                {{ option.name }}
                            </option>
                        </select>
                        <small class="muted">{{ personalities.find((p) => p.key === form.character)?.info }}</small>
                    </label>
                </div>

                <div class="stat-grid">
                    <label class="form-field">
                        <span>통솔</span>
                        <input v-model.number="form.leadership" type="number" class="form-input" />
                    </label>
                    <label class="form-field">
                        <span>무력</span>
                        <input v-model.number="form.strength" type="number" class="form-input" />
                    </label>
                    <label class="form-field">
                        <span>지력</span>
                        <input v-model.number="form.intel" type="number" class="form-input" />
                    </label>
                </div>

                <div class="stat-actions">
                    <button @click="applyRandomStats">랜덤형</button>
                    <button @click="applyFocusedStats('leadership')">통솔형</button>
                    <button @click="applyFocusedStats('strength')">무력형</button>
                    <button @click="applyFocusedStats('intel')">지력형</button>
                    <button @click="applyBalancedStats">균형형</button>
                </div>

                <div class="stat-summary">
                    <div>능력치 합계: {{ statTotal }} / {{ statRules?.total ?? '-' }}</div>
                    <div v-if="statErrors.length" class="stat-errors">
                        <div v-for="item in statErrors" :key="item">{{ item }}</div>
                    </div>
                </div>

                <div class="form-actions">
                    <button :disabled="!canSubmit || submitting" @click="submitJoin">장수 생성</button>
                    <button class="ghost" @click="applyBalancedStats">다시 입력</button>
                </div>
            </PanelCard>

            <PanelCard title="유산 포인트 옵션" subtitle="보유 포인트를 사용해 시작 옵션을 지정합니다.">
                <div v-if="!inheritConfig" class="muted">유산 포인트 정보를 불러오지 못했습니다.</div>
                <div v-else class="inherit-panel">
                    <div class="inherit-summary">
                        <div>보유 포인트: {{ inheritTotalPoint }}</div>
                        <div>필요 포인트: {{ inheritRequiredPoint }}</div>
                    </div>

                    <div class="inherit-options">
                        <label class="form-field">
                            <span>전투 특기 선택</span>
                            <select v-model="inheritSpecialChoice" class="form-input">
                                <option value="">선택 안함</option>
                                <option
                                    v-for="special in inheritConfig.availableSpecialWar"
                                    :key="special.key"
                                    :value="special.key"
                                >
                                    {{ special.name }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ inheritCosts.inheritBornSpecialPoint }} 포인트</small>
                        </label>

                        <label class="form-field">
                            <span>시작 도시 지정</span>
                            <select v-model="inheritCityChoice" class="form-input">
                                <option value="">랜덤 배치</option>
                                <option
                                    v-for="city in inheritConfig.availableCities"
                                    :key="city.id"
                                    :value="String(city.id)"
                                >
                                    {{ city.name }} · {{ cityLevelMap[city.level] ?? city.level }} ·
                                    {{ regionMap[city.region] ?? city.region }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ inheritCosts.inheritBornCityPoint }} 포인트</small>
                        </label>

                        <label class="form-field">
                            <span>턴 시간대 지정</span>
                            <select v-model="inheritTurntimeChoice" class="form-input">
                                <option value="">랜덤 배치</option>
                                <option
                                    v-for="(zone, index) in inheritConfig.turnTimeZones"
                                    :key="zone"
                                    :value="String(index)"
                                >
                                    {{ zone }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ inheritCosts.inheritBornTurntimePoint }} 포인트</small>
                        </label>
                    </div>

                    <div class="inherit-bonus">
                        <div class="bonus-title">보너스 능력치</div>
                        <div class="bonus-grid">
                            <label class="form-field">
                                <span>통솔</span>
                                <input
                                    v-model.number="form.inheritBonusStat[0]"
                                    type="number"
                                    min="0"
                                    max="5"
                                    class="form-input"
                                />
                            </label>
                            <label class="form-field">
                                <span>무력</span>
                                <input
                                    v-model.number="form.inheritBonusStat[1]"
                                    type="number"
                                    min="0"
                                    max="5"
                                    class="form-input"
                                />
                            </label>
                            <label class="form-field">
                                <span>지력</span>
                                <input
                                    v-model.number="form.inheritBonusStat[2]"
                                    type="number"
                                    min="0"
                                    max="5"
                                    class="form-input"
                                />
                            </label>
                        </div>
                        <small class="muted">
                            보너스 합 {{ inheritBonusSum }} (0 또는 3~5) · 비용
                            {{ inheritCosts.inheritBornStatPoint }} 포인트
                        </small>
                    </div>

                    <div v-if="inheritErrors.length" class="inherit-errors">
                        <div v-for="item in inheritErrors" :key="item">{{ item }}</div>
                    </div>
                </div>
            </PanelCard>
        </section>

        <section v-else class="join-grid">
            <PanelCard title="빙의 가능한 NPC 목록" subtitle="NPC 타입2 장수를 선택해 빙의합니다.">
                <template #actions>
                    <button class="ghost" :disabled="npcLoading" @click="loadNpcCandidates(true)">목록 새로고침</button>
                </template>
                <div v-if="npcError" class="muted">{{ npcError }}</div>
                <div v-if="npcLoading && npcCandidates.length === 0">
                    <SkeletonLines :lines="3" />
                </div>
                <div v-else-if="npcCandidates.length === 0" class="muted">빙의 가능한 NPC가 없습니다.</div>
                <div v-else class="npc-list">
                    <div v-for="npc in npcCandidates" :key="npc.id" class="npc-card">
                        <div class="npc-header">
                            <div class="npc-name">{{ npc.name }}</div>
                            <div class="npc-nation" :style="{ color: npc.nation.color }">
                                {{ npc.nation.name }}
                            </div>
                        </div>
                        <div class="npc-meta">
                            <div>통솔 {{ npc.stats.leadership }}</div>
                            <div>무력 {{ npc.stats.strength }}</div>
                            <div>지력 {{ npc.stats.intelligence }}</div>
                            <div>나이 {{ npc.age }}</div>
                            <div>도시 {{ npc.city?.name ?? '-' }}</div>
                        </div>
                        <button class="npc-action" :disabled="submitting" @click="possessGeneral(npc.id)">빙의</button>
                    </div>
                </div>
                <div class="npc-footer">
                    <button class="ghost" :disabled="npcLoading" @click="loadNpcCandidates()">더 보기</button>
                </div>
            </PanelCard>
        </section>
    </main>
</template>

<style scoped>
.join-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.join-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
    padding-bottom: 12px;
}

.join-title {
    font-size: 1.6rem;
    font-weight: 600;
}

.join-subtitle {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.join-tabs {
    display: flex;
    gap: 8px;
}

.join-tabs button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 10px;
    font-size: 0.8rem;
}

.simulator-link {
    border: 1px solid rgba(112, 170, 141, 0.55);
    padding: 6px 10px;
    color: #bfe2cd;
    font-size: 0.8rem;
    text-decoration: none;
}

.join-tabs button.active {
    background: rgba(201, 164, 90, 0.2);
}

.join-error {
    border: 1px solid rgba(240, 90, 90, 0.6);
    padding: 8px 10px;
    color: rgba(240, 150, 150, 0.9);
}

.join-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.nation-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.nation-card {
    border: 1px solid rgba(201, 164, 90, 0.25);
    padding: 8px;
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px;
}

.nation-name {
    font-weight: 600;
    padding: 4px 6px;
    color: #101010;
    text-align: center;
}

.nation-message {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
}

.stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-top: 12px;
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

.stat-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
}

.stat-actions button {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 4px 8px;
    font-size: 0.75rem;
}

.stat-summary {
    margin-top: 10px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.stat-errors {
    margin-top: 4px;
    color: rgba(240, 150, 150, 0.9);
}

.form-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
}

.form-actions button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
}

.inherit-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.inherit-summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.85);
}

.inherit-options {
    display: grid;
    gap: 12px;
}

.inherit-bonus {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.bonus-title {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.8);
}

.bonus-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.inherit-errors {
    color: rgba(240, 150, 150, 0.9);
    font-size: 0.75rem;
}

.form-actions .ghost,
.join-tabs .ghost,
.npc-footer .ghost {
    background: transparent;
}

.npc-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
}

.npc-card {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.npc-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
}

.npc-name {
    font-weight: 600;
}

.npc-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 4px;
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.7);
}

.npc-action {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 4px 8px;
    font-size: 0.75rem;
}

.npc-footer {
    margin-top: 8px;
}

.muted {
    color: rgba(232, 221, 196, 0.6);
    font-size: 0.75rem;
}

.ghost {
    background: transparent;
}
</style>
