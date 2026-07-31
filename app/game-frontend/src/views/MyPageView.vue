<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { trpc } from '../utils/trpc';
import { formatLog } from '../utils/formatLog';
import { formatSeoulDateTime } from '../utils/legacyDateTime';
import { isDefenceTrainPenaltyWaivedByScenarioEffect } from '@sammo-ts/logic';
import { useSessionStore } from '../stores/session';
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';

const SCREEN_MODE_KEY = 'sam.screenMode';
const CUSTOM_CSS_KEY = 'sam_customCSS';
const PENDING_DIE_ON_PRESTART_KEY = 'sam.pending.dieOnPrestart';
type ScreenMode = 'auto' | '500px' | '1000px';
type LogType = 'generalHistory' | 'battleDetail' | 'battleResult' | 'generalAction';
type ItemSlotKey = 'horse' | 'weapon' | 'book' | 'item';
type MyGeneralResponse = Awaited<ReturnType<typeof trpc.general.me.query>>;
type SelectionPoolStatus = Awaited<ReturnType<typeof trpc.join.getConfig.query>>['selectionPool'];
type DieOnPrestartStatus = Awaited<ReturnType<typeof trpc.general.ensureDieOnPrestartStatus.mutate>>;

type WorldSnapshot = {
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    config: Record<string, unknown>;
    meta: Record<string, unknown>;
} | null;

type SettingForm = {
    tnmt: number;
    defence_train: number;
    use_treatment: number;
    use_auto_nation_turn: number;
};

const data = ref<MyGeneralResponse | null>(null);
const world = ref<WorldSnapshot>(null);
const selectionPoolStatus = ref<SelectionPoolStatus | null>(null);
const dieOnPrestartStatus = ref<DieOnPrestartStatus | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const screenMode = ref<ScreenMode>('auto');
const customCss = ref('');
const cssSaving = ref(false);
const session = useSessionStore();
let cssTimer: number | null = null;
const readPendingDieOnPrestartId = (): string => {
    const stored = window.sessionStorage.getItem(PENDING_DIE_ON_PRESTART_KEY);
    return stored && /^[0-9a-f-]{36}$/iu.test(stored) ? stored : crypto.randomUUID();
};
const immediateActionRequestIds = reactive({
    dieOnPrestart: readPendingDieOnPrestartId(),
    buildNationCandidate: crypto.randomUUID(),
    instantRetreat: crypto.randomUUID(),
});

const resetImmediateActionRequestIds = () => {
    immediateActionRequestIds.buildNationCandidate = crypto.randomUUID();
    immediateActionRequestIds.instantRetreat = crypto.randomUUID();
};

const form = reactive<SettingForm>({
    tnmt: 1,
    defence_train: 80,
    use_treatment: 10,
    use_auto_nation_turn: 1,
});

const logTypes: LogType[] = ['generalAction', 'battleDetail', 'generalHistory', 'battleResult'];
const logLabels: Record<LogType, string> = {
    generalAction: '개인 기록',
    battleDetail: '전투 기록',
    generalHistory: '장수 열전',
    battleResult: '전투 결과',
};
const logColors: Record<LogType, string> = {
    generalAction: 'skyblue',
    battleDetail: 'orange',
    generalHistory: 'skyblue',
    battleResult: 'orange',
};
const logs = reactive<Record<LogType, Array<{ id: number; html: string }>>>({
    generalHistory: [],
    battleDetail: [],
    battleResult: [],
    generalAction: [],
});
const logLoading = reactive<Record<LogType, boolean>>({
    generalHistory: false,
    battleDetail: false,
    battleResult: false,
    generalAction: false,
});
const logHasMore = reactive<Record<LogType, boolean>>({
    generalHistory: true,
    battleDetail: true,
    battleResult: true,
    generalAction: true,
});

const errorText = (value: unknown): string =>
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'unknown_error';

const asRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const numberValue = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const statusLine = computed(() =>
    world.value
        ? `${world.value.currentYear}년 ${world.value.currentMonth}월 · ${Math.max(
              1,
              Math.round(world.value.tickSeconds / 60)
          )}분 턴`
        : '내 정보를 불러오는 중'
);

const canSave = computed(() => (data.value?.settings.myset ?? 1) > 0);
const penalties = computed(() => Object.entries(data.value?.penalties ?? {}));
const noDefencePenaltyWaived = computed(() => {
    const environment = asRecord(world.value?.config.environment);
    return isDefenceTrainPenaltyWaivedByScenarioEffect(
        typeof environment.scenarioEffect === 'string' ? environment.scenarioEffect : null
    );
});
const noDefenceLabel = computed(() => (noDefencePenaltyWaived.value ? '×' : '× [훈련 -3,사기 -6]'));
const items = computed<Array<{ key: ItemSlotKey; name: string; code: string | null }>>(() => [
    { key: 'horse', name: '말', code: data.value?.general.items.horse ?? null },
    { key: 'weapon', name: '무기', code: data.value?.general.items.weapon ?? null },
    { key: 'book', name: '서적', code: data.value?.general.items.book ?? null },
    { key: 'item', name: '도구', code: data.value?.general.items.item ?? null },
]);

const autorunUser = computed(() => asRecord(world.value?.meta.autorun_user));
const showAutoNationTurn = computed(() => Boolean(asRecord(autorunUser.value.options).chief));
const showVacation = computed(() => !autorunUser.value.limit_minutes);
const actionAvailability = computed(() => {
    const general = data.value?.general;
    const meta = world.value?.meta ?? {};
    const config = world.value?.config ?? {};
    const constConfig = asRecord(config.const);
    const availableInstantAction = asRecord(constConfig.availableInstantAction ?? config.availableInstantAction);
    const turnTime = meta.turntime ? new Date(String(meta.turntime)) : null;
    const openTime = meta.opentime ? new Date(String(meta.opentime)) : null;
    const preopen = Boolean(turnTime && openTime && turnTime.getTime() <= openTime.getTime());
    const npcMode = numberValue(config.npcMode ?? config.npcmode, 0);
    return {
        dieOnPrestart: Boolean(dieOnPrestartStatus.value?.show),
        buildNationCandidate: Boolean(preopen && general?.nationId === 0),
        instantRetreat: Boolean(availableInstantAction.instantRetreat),
        selectOtherGeneral: Boolean(npcMode === 2 && general?.npcState === 0),
    };
});
const formatDieOnPrestartAvailableAt = computed(() => {
    const value = dieOnPrestartStatus.value?.availableAt;
    return value ? formatSeoulDateTime(value) : '';
});
const formatSelectionAvailableAt = computed(() => {
    const value = selectionPoolStatus.value?.nextChangeAt;
    if (!value) return '';
    return formatSeoulDateTime(value);
});

const applyCustomCss = (text: string) => {
    let style = document.getElementById('sammo-custom-css') as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = 'sammo-custom-css';
        document.head.appendChild(style);
    }
    style.textContent = text;
};

const loadLog = async (type: LogType, beforeId?: number) => {
    if (logLoading[type]) return;
    logLoading[type] = true;
    try {
        const response = await trpc.general.getMyLog.query({ type, beforeId });
        const next = response.logs.map((entry) => ({ id: entry.id, html: formatLog(entry.text) }));
        logs[type] = beforeId ? [...logs[type], ...next] : next;
        logHasMore[type] = next.length >= 24;
    } catch (cause) {
        error.value = errorText(cause);
    } finally {
        logLoading[type] = false;
    }
};

const loadPage = async (resetImmediateActionIds = true) => {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
        const [general, state, joinConfig, prestartStatus] = await Promise.all([
            trpc.general.me.query(),
            trpc.world.getState.query() as Promise<WorldSnapshot>,
            trpc.join.getConfig.query(),
            trpc.general.ensureDieOnPrestartStatus.mutate(),
        ]);
        data.value = general;
        world.value = state;
        selectionPoolStatus.value = joinConfig.selectionPool;
        dieOnPrestartStatus.value = prestartStatus;
        if (general) {
            Object.assign(form, general.settings);
        }
        await Promise.all(logTypes.map((type) => loadLog(type)));
        if (resetImmediateActionIds) {
            resetImmediateActionRequestIds();
        }
    } catch (cause) {
        error.value = errorText(cause);
    } finally {
        loading.value = false;
    }
};

const saveSettings = async () => {
    if (!canSave.value) return;
    try {
        await trpc.general.setMySetting.mutate({ ...form });
        await loadPage();
    } catch (cause) {
        alert(`실패했습니다: ${errorText(cause)}`);
    }
};

const confirmMutation = async (message: string, mutation: () => Promise<unknown>, reloadAfterFailure = false) => {
    if (!confirm(message)) return;
    try {
        await mutation();
        await loadPage();
    } catch (cause) {
        alert(`실패했습니다: ${errorText(cause)}`);
        if (reloadAfterFailure) {
            const code = asRecord(asRecord(cause).data).code;
            await loadPage(code !== 'TIMEOUT');
        }
    }
};

const dieOnPrestart = async () => {
    if (!confirm('정말로 삭제하시겠습니까?')) return;
    const clientRequestId = immediateActionRequestIds.dieOnPrestart;
    window.sessionStorage.setItem(PENDING_DIE_ON_PRESTART_KEY, clientRequestId);
    try {
        await trpc.general.dieOnPrestart.mutate({ clientRequestId });
        window.sessionStorage.removeItem(PENDING_DIE_ON_PRESTART_KEY);
        session.leaveGame();
        window.location.replace(import.meta.env.VITE_GATEWAY_WEB_URL?.trim() || '/gateway/');
    } catch (cause) {
        const code = asRecord(asRecord(cause).data).code;
        if (code !== 'TIMEOUT') {
            window.sessionStorage.removeItem(PENDING_DIE_ON_PRESTART_KEY);
        }
        alert(`실패했습니다: ${errorText(cause)}`);
        window.location.reload();
    }
};

const dropItem = (item: { key: ItemSlotKey; name: string; code: string | null }) =>
    confirmMutation(`${item.code ?? item.name}을(를) 버리시겠습니까?`, () =>
        trpc.general.dropItem.mutate({ itemType: item.key })
    );

watch(screenMode, (mode) => {
    localStorage.setItem(SCREEN_MODE_KEY, mode);
    document.dispatchEvent(new CustomEvent('tryChangeScreenMode'));
});

watch(customCss, (text) => {
    if (cssTimer !== null) window.clearTimeout(cssTimer);
    cssSaving.value = true;
    cssTimer = window.setTimeout(() => {
        localStorage.setItem(CUSTOM_CSS_KEY, text);
        applyCustomCss(text);
        cssSaving.value = false;
    }, 500);
});

onMounted(() => {
    const storedMode = localStorage.getItem(SCREEN_MODE_KEY);
    screenMode.value = storedMode === '500px' || storedMode === '1000px' ? storedMode : 'auto';
    customCss.value = localStorage.getItem(CUSTOM_CSS_KEY) ?? '';
    applyCustomCss(customCss.value);
    void loadPage();
});
</script>

<template>
    <main id="container" class="legacy-page bg0" :class="`screen-${screenMode}`">
        <div class="title-row">
            <span>내 정 보</span>
            <RouterLink class="legacy-button" to="/past-plays">지난 플레이</RouterLink>
            <RouterLink class="legacy-button" to="/">돌아가기</RouterLink>
            <button class="legacy-button" type="button" @click="() => loadPage()">새로고침</button>
        </div>

        <div v-if="error" class="error-row">{{ error }}</div>
        <div class="status-row">{{ statusLine }}</div>

        <section class="top-grid">
            <div class="general-column">
                <div class="section-title sky">장수 정보</div>
                <div v-if="loading || !data" class="loading">불러오는 중...</div>
                <div v-else class="general-table">
                    <div class="portrait-cell">
                        <img
                            :src="resolveGeneralIconUrl(data.general, { legacyBaseUrl: '/image/game' })"
                            alt=""
                            @error="useDefaultGeneralIcon"
                        />
                        <strong>{{ data.general.name }}</strong>
                    </div>
                    <dl>
                        <div>
                            <dt>통솔</dt>
                            <dd>{{ data.general.stats.leadership }}</dd>
                        </div>
                        <div>
                            <dt>무력</dt>
                            <dd>{{ data.general.stats.strength }}</dd>
                        </div>
                        <div>
                            <dt>지력</dt>
                            <dd>{{ data.general.stats.intelligence }}</dd>
                        </div>
                        <div>
                            <dt>소속</dt>
                            <dd>{{ data.nation?.name ?? '재야' }}</dd>
                        </div>
                        <div>
                            <dt>도시</dt>
                            <dd>{{ data.city?.name ?? '-' }}</dd>
                        </div>
                        <div>
                            <dt>금/쌀</dt>
                            <dd>{{ data.general.gold }} / {{ data.general.rice }}</dd>
                        </div>
                        <div>
                            <dt>병력</dt>
                            <dd>{{ data.general.crew }}</dd>
                        </div>
                        <div>
                            <dt>훈련/사기</dt>
                            <dd>{{ data.general.train }} / {{ data.general.atmos }}</dd>
                        </div>
                        <div>
                            <dt>경험/공헌</dt>
                            <dd>{{ data.general.experience }} / {{ data.general.dedication }}</dd>
                        </div>
                    </dl>
                </div>
            </div>

            <div class="settings-column">
                <div class="setting-line">
                    토너먼트 【
                    <label><input v-model.number="form.tnmt" type="radio" :value="0" />수동참여</label>
                    <label><input v-model.number="form.tnmt" type="radio" :value="1" />자동참여</label>
                    】
                </div>
                <div class="hint">∞ 개막직전 남는자리가 있을경우 랜덤하게 참여합니다.</div>

                <label class="setting-line">
                    환약 사용 【
                    <select v-model.number="form.use_treatment">
                        <option :value="10">경상</option>
                        <option :value="21">중상</option>
                        <option :value="41">심각</option>
                        <option :value="61">위독</option>
                        <option :value="100">사용안함</option>
                    </select>
                    】
                </label>
                <div class="hint">∞ 부상을 입었을 때 환약을 사용하는 기준입니다.</div>

                <label v-if="showAutoNationTurn" class="setting-line">
                    자동 사령턴 허용 【
                    <select v-model.number="form.use_auto_nation_turn">
                        <option :value="1">허용</option>
                        <option :value="0">허용 안함</option>
                    </select>
                    】
                </label>

                <label class="setting-line">
                    수비 【
                    <select
                        id="defence_train"
                        v-model.number="form.defence_train"
                        :class="{ 'penalty-waived': noDefencePenaltyWaived }"
                    >
                        <option :value="90">☆(훈사90)</option>
                        <option :value="80">◎(훈사80)</option>
                        <option :value="60">○(훈사60)</option>
                        <option :value="40">△(훈사40)</option>
                        <option :value="999">{{ noDefenceLabel }}</option>
                    </select>
                    】
                </label>
                <button
                    id="set_my_setting"
                    class="action-button"
                    type="button"
                    :hidden="!canSave"
                    @click="saveSettings"
                >
                    설정저장
                </button>
                <div class="hint">∞ 설정저장은 이달중 {{ data?.settings.myset ?? 0 }}회 남았습니다.</div>

                <div v-if="penalties.length" class="penalties">
                    징계 목록(저장 시 갱신)
                    <div v-for="[key, value] in penalties" :key="key">{{ key }} : {{ value }}</div>
                </div>

                <div v-if="showVacation" class="action-line">
                    휴 가 신 청<br />
                    <button
                        class="action-button"
                        type="button"
                        @click="confirmMutation('휴가 기능을 신청할까요?', () => trpc.general.vacation.mutate())"
                    >
                        휴가 신청
                    </button>
                </div>
                <div v-if="actionAvailability.dieOnPrestart" class="action-line">
                    가오픈 기간 내 장수 삭제 ({{ formatDieOnPrestartAvailableAt }} 부터)<br />
                    <button class="action-button" @click="dieOnPrestart">장수 삭제</button>
                </div>
                <div v-if="actionAvailability.buildNationCandidate" class="action-line">
                    서버 개시 이전 거병(2턴부터 건국 가능)<br />
                    <button
                        class="action-button"
                        @click="
                            confirmMutation(
                                '거병 이후 장수를 삭제할 수 없게됩니다. 거병하시겠습니까?',
                                () =>
                                    trpc.general.buildNationCandidate.mutate({
                                        clientRequestId: immediateActionRequestIds.buildNationCandidate,
                                    }),
                                true
                            )
                        "
                    >
                        사전 거병
                    </button>
                </div>
                <div v-if="actionAvailability.instantRetreat" class="action-line">
                    거리 3칸 이내 아국 도시로 즉시 이동<br />
                    <button
                        class="action-button"
                        @click="
                            confirmMutation(
                                '아군 접경으로 이동할까요?',
                                () =>
                                    trpc.general.instantRetreat.mutate({
                                        clientRequestId: immediateActionRequestIds.instantRetreat,
                                    }),
                                true
                            )
                        "
                    >
                        접경 귀환
                    </button>
                </div>
                <div v-if="actionAvailability.selectOtherGeneral && selectionPoolStatus?.enabled" class="action-line">
                    다른 장수 선택
                    <template v-if="formatSelectionAvailableAt"> ({{ formatSelectionAvailableAt }} 부터) </template>
                    <br />
                    <RouterLink class="action-button select-general-link" to="/select-general">
                        다른 장수 선택
                    </RouterLink>
                    <br /><br />
                </div>

                <div class="screen-mode-row">
                    <span>500px/1000px 모드<br />(모바일 전용, 즉시 설정)</span>
                    <div class="button-group">
                        <label><input v-model="screenMode" type="radio" value="auto" />자동</label>
                        <label><input v-model="screenMode" type="radio" value="500px" />500px</label>
                        <label><input v-model="screenMode" type="radio" value="1000px" />1000px</label>
                    </div>
                </div>

                <div class="item-title">아이템 파기</div>
                <div class="item-group">
                    <button
                        v-for="item in items"
                        :key="item.key"
                        type="button"
                        :disabled="!item.code"
                        @click="dropItem(item)"
                    >
                        {{ item.code ?? '-' }}
                    </button>
                </div>

                <label class="custom-css">
                    개인용 CSS <span>{{ cssSaving ? '(저장 중)' : '' }}</span>
                    <textarea id="custom_css" v-model="customCss" />
                </label>
            </div>
        </section>

        <section class="log-grid">
            <article v-for="type in logTypes" :key="type" class="log-panel">
                <h2 :style="{ color: logColors[type] }">{{ logLabels[type] }}</h2>
                <div v-if="logLoading[type]" class="loading">불러오는 중...</div>
                <div v-else>
                    <div v-for="entry in logs[type]" :key="entry.id" class="log-line" v-html="entry.html" />
                    <div v-if="logs[type].length === 0" class="empty">기록이 없습니다.</div>
                    <button
                        v-if="logHasMore[type]"
                        class="load-old"
                        type="button"
                        @click="loadLog(type, logs[type].at(-1)?.id)"
                    >
                        이전 로그 불러오기
                    </button>
                </div>
            </article>
        </section>
    </main>
</template>

<style scoped>
.legacy-page {
    width: 100%;
    max-width: 1000px;
    min-width: 500px;
    min-height: 100vh;
    margin: 0 auto;
    padding: 0;
    color: #fff;
    background-color: #111;
    background-image: var(--sammo-texture-walnut);
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
}
.legacy-page.screen-500px {
    max-width: 500px;
}
.legacy-page.screen-1000px {
    max-width: 1000px;
}
.title-row {
    height: 54px;
    display: flex;
    align-content: flex-start;
    align-items: flex-start;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 0 4px;
    border: 1px solid #666;
    background: transparent;
    font-size: 14px;
}
.title-row > span {
    flex-basis: 100%;
    height: 18px;
    letter-spacing: 0;
}
.legacy-button,
button,
select,
textarea {
    border: 1px solid #777;
    border-radius: 0;
    color: #fff;
    background: #6b6b6b;
    font: inherit;
}
.legacy-button {
    min-height: 34px;
    padding: 5px 10px;
    border-color: #2d5d7f;
    border-radius: 4px;
    background: #315f86;
    color: #fff;
    font-weight: 700;
    text-decoration: none;
    letter-spacing: 0;
}
button {
    cursor: pointer;
}
button:disabled {
    cursor: default;
    opacity: 0.45;
}
.status-row,
.error-row {
    padding: 4px 8px;
    text-align: center;
}
.error-row {
    color: #ff7777;
    border: 1px solid #a33;
}
.top-grid,
.log-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}
.general-column,
.settings-column,
.log-panel {
    border: 1px solid #666;
    background-image: var(--sammo-texture-walnut);
}
.section-title,
.log-panel h2 {
    min-height: 34px;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #666;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
    font-size: 1.25em;
    font-weight: 500;
}
.sky {
    color: skyblue;
}
.general-table {
    display: grid;
    grid-template-columns: 150px 1fr;
    padding: 0;
    background-color: #172a52;
    background-image: var(--sammo-texture-blue);
}
.portrait-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-right: 1px solid #777;
}
.portrait-cell img {
    width: 64px;
    height: 64px;
    object-fit: cover;
}
dl {
    margin: 0;
}
dl > div {
    display: grid;
    grid-template-columns: 80px 1fr;
    border-bottom: 1px solid #777;
}
dt,
dd {
    margin: 0;
    padding: 2px 5px;
    border-right: 1px solid #777;
}
dt {
    color: #aaa;
}
.settings-column {
    padding: 10px 18px;
}
.setting-line {
    display: block;
    margin-top: 5px;
}
#defence_train {
    width: 134px;
}
#defence_train.penalty-waived {
    width: 86px;
}
.hint {
    margin: 0 0 13px;
    color: orange;
}
.action-button {
    width: 160px;
    height: 30px;
    margin: 4px 0;
    background: #225500;
}
.select-general-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    color: #fff;
    text-decoration: none;
}
.action-line {
    margin: 12px 0;
}
.penalties {
    margin: 12px 0;
    color: #f66;
}
.screen-mode-row {
    display: grid;
    grid-template-columns: 160px 1fr;
    align-items: center;
    margin: 14px 0;
}
.button-group {
    display: flex;
}
.button-group label {
    padding: 5px 8px;
    border: 1px solid #666;
    background: #26384d;
}
.button-group input {
    margin-right: 4px;
}
.item-title {
    margin-top: 12px;
}
.item-group {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 5px 0 14px;
}
.item-group button {
    min-height: 30px;
}
.custom-css {
    display: block;
}
.custom-css textarea {
    display: block;
    width: 420px;
    max-width: 100%;
    height: 150px;
    color: #fff;
    background: #000;
}
.log-panel {
    min-height: 180px;
}
.log-panel h2 {
    color: orange;
}
.log-line,
.empty,
.loading {
    padding: 2px 8px;
}
.load-old {
    width: 100%;
    min-height: 32px;
    margin-top: 8px;
}
@media (max-width: 991px) {
    .legacy-page {
        width: 500px;
    }
    .top-grid,
    .log-grid {
        grid-template-columns: 1fr;
    }
}
</style>
