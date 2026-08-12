<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { useGameFeedback } from '../composables/useGameFeedback';
import { trpc } from '../utils/trpc';

const CUSTOM_CSS_KEY = 'sammo-custom-css';
const SCREEN_MODE_KEY = 'sammo-screen-mode';
const { success: showSuccessToast, error: showErrorToast } = useGameFeedback();

type MyGeneralResponse = Awaited<ReturnType<typeof trpc.general.me.query>>;

type WorldStateSnapshot = {
    config: Record<string, unknown>;
    meta: Record<string, unknown>;
} | null;

type ScreenMode = 'auto' | '500px' | '1000px';

type SettingForm = {
    tnmt: number;
    defence_train: number;
    use_treatment: number;
    use_auto_nation_turn: number;
};

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<MyGeneralResponse | null>(null);
const worldState = ref<WorldStateSnapshot>(null);

const form = reactive<SettingForm>({
    tnmt: 1,
    defence_train: 80,
    use_treatment: 10,
    use_auto_nation_turn: 1,
});

const screenMode = ref<ScreenMode>('auto');
const customCss = ref('');
const cssSaving = ref(false);
let cssTimer: number | null = null;

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const resolveNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const canSave = computed(() => {
    const remaining = data.value?.settings?.myset ?? null;
    if (remaining === null) {
        return true;
    }
    return remaining > 0;
});

const remainingLabel = computed(() => {
    const remaining = data.value?.settings?.myset ?? null;
    if (remaining === null) {
        return '설정 저장 제한 없음';
    }
    return `설정저장은 이달중 ${remaining}회 남았습니다.`;
});

const showAutoNationTurn = computed(() => {
    const meta = (worldState.value?.meta ?? {}) as Record<string, unknown>;
    const autorunUser = (meta.autorun_user ?? {}) as Record<string, unknown>;
    const options = (autorunUser.options ?? {}) as Record<string, unknown>;
    return Boolean(options.chief);
});

const penalties = computed(() => {
    const list = data.value?.penalties ?? {};
    return Object.entries(list);
});

const applyCustomCss = (text: string) => {
    if (typeof window === 'undefined') {
        return;
    }
    const id = 'sammo-custom-css';
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.head.appendChild(style);
    }
    style.textContent = text;
};

const saveCustomCss = () => {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(CUSTOM_CSS_KEY, customCss.value);
    applyCustomCss(customCss.value);
};

const loadScreenMode = () => {
    if (typeof window === 'undefined') {
        return;
    }
    const value = window.localStorage.getItem(SCREEN_MODE_KEY);
    if (value === '500px' || value === '1000px') {
        screenMode.value = value;
    } else {
        screenMode.value = 'auto';
    }
};

const saveScreenMode = () => {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(SCREEN_MODE_KEY, screenMode.value);
};

const loadSettings = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        const general = await trpc.general.me.query();
        const world = await trpc.world.getState.query() as
            | {
                config?: Record<string, unknown>;
                meta?: Record<string, unknown>;
            }
            | null;
        data.value = general;
        worldState.value = world
            ? {
                config: world.config ?? {},
                meta: world.meta ?? {},
            }
            : null;

        if (general?.settings) {
            form.tnmt = general.settings.tnmt;
            form.defence_train = general.settings.defence_train;
            form.use_treatment = general.settings.use_treatment;
            form.use_auto_nation_turn = general.settings.use_auto_nation_turn;
        }
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const saveSettings = async () => {
    if (!canSave.value) {
        showErrorToast('설정 저장 가능 횟수가 없습니다.');
        return;
    }

    try {
        await trpc.general.setMySetting.mutate({
            tnmt: resolveNumber(form.tnmt, 1),
            defence_train: resolveNumber(form.defence_train, 80),
            use_treatment: resolveNumber(form.use_treatment, 10),
            use_auto_nation_turn: resolveNumber(form.use_auto_nation_turn, 1),
        });
        await loadSettings();
        showSuccessToast('설정을 저장했습니다.');
    } catch (err) {
        showErrorToast(`설정 저장에 실패했습니다: ${resolveErrorMessage(err)}`);
    }
};

watch(
    () => screenMode.value,
    () => {
        saveScreenMode();
    }
);

watch(
    () => customCss.value,
    () => {
        if (cssTimer) {
            window.clearTimeout(cssTimer);
        }
        cssSaving.value = true;
        cssTimer = window.setTimeout(() => {
            saveCustomCss();
            cssSaving.value = false;
        }, 400);
    }
);

onMounted(() => {
    if (typeof window !== 'undefined') {
        customCss.value = window.localStorage.getItem(CUSTOM_CSS_KEY) ?? '';
        applyCustomCss(customCss.value);
    }
    loadScreenMode();
    void loadSettings();
});
</script>

<template>
    <main class="settings-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">게임 설정</h1>
                <p class="page-subtitle">내 정보 설정을 관리합니다.</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/my-page">내 정보</RouterLink>
                <button class="ghost" @click="loadSettings">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <section class="layout-grid">
            <div class="stack">
                <PanelCard title="게임 옵션" subtitle="설정 저장 시 즉시 반영됩니다.">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="form-grid">
                        <label class="form-field">
                            <span>토너먼트 참가</span>
                            <select v-model.number="form.tnmt">
                                <option :value="0">수동 참여</option>
                                <option :value="1">자동 참여</option>
                            </select>
                        </label>
                        <label class="form-field">
                            <span>환약 사용 기준</span>
                            <select v-model.number="form.use_treatment">
                                <option :value="10">경상</option>
                                <option :value="21">중상</option>
                                <option :value="41">심각</option>
                                <option :value="61">위독</option>
                                <option :value="100">사용 안함</option>
                            </select>
                        </label>
                        <label v-if="showAutoNationTurn" class="form-field">
                            <span>자동 사령턴 허용</span>
                            <select v-model.number="form.use_auto_nation_turn">
                                <option :value="1">허용</option>
                                <option :value="0">허용 안함</option>
                            </select>
                        </label>
                        <label class="form-field">
                            <span>수비 설정</span>
                            <select v-model.number="form.defence_train">
                                <option :value="90">훈련 90</option>
                                <option :value="80">훈련 80</option>
                                <option :value="60">훈련 60</option>
                                <option :value="40">훈련 40</option>
                                <option :value="999">절대 수비</option>
                            </select>
                        </label>
                        <div class="hint">{{ remainingLabel }}</div>
                        <button class="primary" type="button" :disabled="!canSave" @click="saveSettings">
                            설정 저장
                        </button>
                    </div>
                </PanelCard>

                <PanelCard title="징계 목록" subtitle="설정 저장 시 갱신됩니다.">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else class="penalty-list">
                        <div v-if="penalties.length === 0" class="empty">징계가 없습니다.</div>
                        <div v-for="[key, value] in penalties" :key="key" class="penalty-item">
                            {{ key }}: {{ value }}
                        </div>
                    </div>
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="화면 모드" subtitle="모바일 전용 설정입니다.">
                    <div class="screen-mode">
                        <label>
                            <input v-model="screenMode" type="radio" value="auto" />
                            자동
                        </label>
                        <label>
                            <input v-model="screenMode" type="radio" value="500px" />
                            500px
                        </label>
                        <label>
                            <input v-model="screenMode" type="radio" value="1000px" />
                            1000px
                        </label>
                    </div>
                </PanelCard>

                <PanelCard title="개인용 CSS" subtitle="변경 사항은 자동 저장됩니다.">
                    <textarea v-model="customCss" class="css-input" rows="8" />
                    <div class="hint">{{ cssSaving ? '저장 중...' : '자동 저장 완료' }}</div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.settings-page {
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.form-grid {
    display: grid;
    gap: 12px;
}

.form-field {
    display: grid;
    gap: 6px;
    font-size: 0.9rem;
}

.form-field select {
    padding: 6px 8px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(12, 12, 12, 0.7);
    color: inherit;
}

.primary {
    border: 1px solid rgba(201, 164, 90, 0.6);
    background: rgba(201, 164, 90, 0.2);
    color: inherit;
    padding: 8px 12px;
    font-size: 0.85rem;
    cursor: pointer;
}

.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.screen-mode {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 0.85rem;
}

.css-input {
    width: 100%;
    background: rgba(12, 12, 12, 0.7);
    color: inherit;
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 8px;
}

.penalty-list {
    display: grid;
    gap: 6px;
    font-size: 0.85rem;
}

.penalty-item {
    color: #f08a5d;
}

.hint {
    color: rgba(232, 221, 196, 0.7);
    font-size: 0.8rem;
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.5);
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    font-size: 0.8rem;
    cursor: pointer;
}

.error {
    color: #f08a5d;
    font-size: 0.9rem;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}

@media (max-width: 1024px) {
    .layout-grid {
        grid-template-columns: 1fr;
    }
}
</style>
