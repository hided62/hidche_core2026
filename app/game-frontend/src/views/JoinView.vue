<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import { useSessionStore } from '../stores/session';

type JoinConfig = Awaited<ReturnType<typeof trpc.join.getConfig.query>>;
type JoinInput = Parameters<typeof trpc.join.createGeneral.mutate>[0];
type PossessCandidate = Awaited<ReturnType<typeof trpc.join.listPossessCandidates.query>>[0];

const router = useRouter();
const session = useSessionStore();

const loading = ref(true);
const error = ref<string | null>(null);
const submitting = ref(false);

const joinConfig = ref<JoinConfig | null>(null);
const activeTab = ref<'create' | 'possess'>('create');

const form = ref<JoinInput>({
    name: '',
    leadership: 0,
    strength: 0,
    intel: 0,
    character: 'Random',
    pic: true,
});

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
    return true;
});

const nationList = computed(() => joinConfig.value?.nations ?? []);
const personalities = computed(() => joinConfig.value?.personalities ?? []);

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
        joinConfig.value = config;
        form.value.name = config.user.displayName || '';
        applyBalancedStats();
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
    try {
        await trpc.join.createGeneral.mutate(form.value);
        await session.refreshGeneralStatus();
        if (session.hasGeneral) {
            await router.push({ name: 'home' });
        }
    } catch (err) {
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
                        <input v-model="form.name" type="text" class="form-input" />
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

            <PanelCard title="유산/빙의 안내" subtitle="유산 포인트와 추가 옵션은 추후 이식 예정입니다.">
                <div class="muted">특기/도시 선택, 턴 시간 지정은 향후 UI와 함께 제공됩니다.</div>
            </PanelCard>
        </section>

        <section v-else class="join-grid">
            <PanelCard title="빙의 가능한 NPC 목록" subtitle="NPC 타입2 장수를 선택해 빙의합니다.">
                <template #actions>
                    <button class="ghost" :disabled="npcLoading" @click="loadNpcCandidates(true)">
                        목록 새로고침
                    </button>
                </template>
                <div v-if="npcError" class="muted">{{ npcError }}</div>
                <div v-if="npcLoading && npcCandidates.length === 0">
                    <SkeletonLines :lines="3" />
                </div>
                <div v-else-if="npcCandidates.length === 0" class="muted">
                    빙의 가능한 NPC가 없습니다.
                </div>
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
                        <button class="npc-action" :disabled="submitting" @click="possessGeneral(npc.id)">
                            빙의
                        </button>
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
