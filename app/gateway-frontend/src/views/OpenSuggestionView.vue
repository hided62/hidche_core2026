<script setup lang="ts">
import type { AppRouter } from '@sammo-ts/gateway-api';
import type { inferRouterOutputs } from '@trpc/server';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import DefaultLayout from '../layouts/DefaultLayout.vue';
import {
    PROFILE_TURN_TERM_MINUTES,
    RESET_AUTORUN_LABELS,
    RESET_OPTION_COPY,
    SYSTEM_PROFILE_RESET_DEFAULTS,
    type ResetAutorunOption,
} from '../utils/resetDefaults';
import { directTrpc, trpc } from '../utils/trpc';

type GatewayOutput = inferRouterOutputs<AppRouter>;
type LobbyProfile = GatewayOutput['lobby']['profiles'][number];
type Scenario = GatewayOutput['lobby']['scenarios'][number];

const router = useRouter();
const profiles = ref<LobbyProfile[]>([]);
const scenarios = ref<Scenario[]>([]);
const catalogLoading = ref(false);
const catalogError = ref('');
const copiedMessage = ref('');
const outputElement = ref<HTMLTextAreaElement | null>(null);
let catalogRequestId = 0;

const form = reactive({
    profileName: '',
    preopenAt: '',
    openAt: '',
    scenarioId: null as number | null,
    turnTermMinutes: 1,
    fiction: 1 as 0 | 1,
    npcMode: 0 as 0 | 1 | 2,
    sync: SYSTEM_PROFILE_RESET_DEFAULTS.sync,
    extend: SYSTEM_PROFILE_RESET_DEFAULTS.extend,
    blockGeneralCreate: SYSTEM_PROFILE_RESET_DEFAULTS.blockGeneralCreate,
    showImgLevel: SYSTEM_PROFILE_RESET_DEFAULTS.showImgLevel,
    tournamentTrig: SYSTEM_PROFILE_RESET_DEFAULTS.tournamentTrig,
    joinMode: SYSTEM_PROFILE_RESET_DEFAULTS.joinMode,
    autorunEnabled: true,
    autorunLimitMinutes: 1440,
    autorunOptions: RESET_AUTORUN_LABELS.map(({ value }) => value) as ResetAutorunOption[],
});

const selectedProfile = computed(() => profiles.value.find((profile) => profile.profileName === form.profileName));
const selectedScenario = computed(() => scenarios.value.find((scenario) => scenario.id === form.scenarioId));
const dateOrderValid = computed(
    () => !form.preopenAt || !form.openAt || new Date(form.preopenAt).getTime() <= new Date(form.openAt).getTime()
);
const canCopy = computed(
    () =>
        Boolean(selectedProfile.value && selectedScenario.value && form.preopenAt && form.openAt) &&
        dateOrderValid.value &&
        (!form.autorunEnabled || form.autorunOptions.length > 0)
);

const formatProposalDate = (value: string): string => {
    if (!value) return '-';
    const normalized = value.replace('T', ' ');
    return normalized.length === 16 ? `${normalized}:00` : normalized;
};

const npcModeText = (value: number): string => ['불가', '가능', '선택 생성 가능'][value] ?? '불가';
const fictionText = (value: number): string => (value === 1 ? '가상' : '사실');
const autorunText = computed(() => {
    if (!form.autorunEnabled) return '';
    const enabled = new Set(form.autorunOptions);
    const labels: string[] = [];
    if (enabled.has('develop')) labels.push('내정');
    if (enabled.has('warp')) labels.push('순간이동');
    if (enabled.has('recruit_high')) labels.push('모병');
    else if (enabled.has('recruit')) labels.push('징병');
    if (enabled.has('train')) labels.push('훈련/사기진작');
    if (enabled.has('battle')) labels.push('출병');
    if (enabled.has('chief')) labels.push('사령턴');
    const limit =
        form.autorunLimitMinutes >= 43_200
            ? '항상 유효'
            : form.autorunLimitMinutes % 60 === 0
              ? `${form.autorunLimitMinutes / 60}시간 유효`
              : `${form.autorunLimitMinutes}분 유효`;
    labels.push(limit);
    return `자율행동[${labels.join(', ')}]`;
});

const additionalSettingsText = computed(() => {
    const settings: string[] = [];
    if (!form.sync) settings.push('시간동기화 없음');
    if (!form.extend) settings.push('확장 NPC 미포함');
    if (form.blockGeneralCreate === 1) settings.push('장수 생성 불가');
    if (form.blockGeneralCreate === 2) settings.push('장수명 무작위');
    if (form.joinMode === 'onlyRandom') settings.push('랜덤 임관');
    if (form.showImgLevel !== SYSTEM_PROFILE_RESET_DEFAULTS.showImgLevel) {
        settings.push(['이미지 표시 안함', '전콘 표시', '전콘/병종 표시'][form.showImgLevel] ?? '이미지 표시');
    }
    if (!form.tournamentTrig) settings.push('토너먼트 수동 시작');
    if (autorunText.value) settings.push(autorunText.value);
    return settings.length > 0 ? settings.join(', ') : '없음';
});

const suggestionText = computed(() => {
    const profile = selectedProfile.value;
    const scenario = selectedScenario.value;
    const serverName = profile ? `${profile.korName}섭` : '서버';
    const scenarioTitle = scenario?.title ?? '시나리오';
    const statTotal = scenario?.defaultStatTotal ?? '-';
    return `${serverName}<오픈건의>
- 가오픈 일시 : ${formatProposalDate(form.preopenAt)} -
- 오픈 일시 : ${formatProposalDate(form.openAt)} -
${scenarioTitle} ${form.turnTermMinutes}분 턴 서버
(상성 설정:${fictionText(form.fiction)}), (빙의 여부:${npcModeText(form.npcMode)}), (최대 스탯:${statTotal}), (기타 설정:${additionalSettingsText.value})`;
});

const loadScenarios = async (): Promise<void> => {
    const profileName = form.profileName;
    const requestId = ++catalogRequestId;
    scenarios.value = [];
    form.scenarioId = null;
    catalogError.value = '';
    if (!profileName) return;
    catalogLoading.value = true;
    try {
        const result = await directTrpc.lobby.scenarios.query({ profileName });
        if (requestId !== catalogRequestId) return;
        scenarios.value = result;
        form.scenarioId = result[0]?.id ?? null;
    } catch (error) {
        if (requestId !== catalogRequestId) return;
        catalogError.value = error instanceof Error ? error.message : '시나리오 목록을 불러오지 못했습니다.';
    } finally {
        if (requestId === catalogRequestId) catalogLoading.value = false;
    }
};

watch(
    () => form.profileName,
    () => void loadScenarios()
);
watch(selectedScenario, (scenario) => {
    if (scenario?.fiction === 0 || scenario?.fiction === 1) form.fiction = scenario.fiction;
});

const copySuggestion = async (): Promise<void> => {
    if (!canCopy.value) return;
    copiedMessage.value = '';
    try {
        await navigator.clipboard.writeText(suggestionText.value);
    } catch {
        outputElement.value?.focus();
        outputElement.value?.select();
        document.execCommand('copy');
    }
    copiedMessage.value = '오픈 건의 양식을 복사했습니다.';
};

onMounted(async () => {
    const me = await trpc.me.query().catch(() => null);
    if (!me) {
        await router.replace('/');
        return;
    }
    profiles.value = await trpc.lobby.profiles.query();
    form.profileName = profiles.value[0]?.profileName ?? '';
});
</script>

<template>
    <DefaultLayout>
        <main class="suggestion-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">GATEWAY COMMUNITY TOOL</p>
                    <h1>오픈 건의 양식</h1>
                    <p>현재 서버 빌드의 시나리오와 빌드 옵션을 살펴보고, 운영자에게 전달할 문구를 만듭니다.</p>
                </div>
                <RouterLink class="back-link" to="/lobby">서버 목록으로</RouterLink>
            </header>

            <p class="read-only-notice" role="note">
                이 화면은 조회와 문구 작성만 합니다. 서버 설정, 시나리오, 오픈 시각은 변경되지 않습니다.
            </p>

            <section class="panel" aria-labelledby="proposal-basic-heading">
                <h2 id="proposal-basic-heading">기본 정보</h2>
                <div class="field-grid">
                    <label>
                        <span>대상 서버</span>
                        <select v-model="form.profileName" data-testid="proposal-profile">
                            <option v-for="profile in profiles" :key="profile.profileName" :value="profile.profileName">
                                {{ profile.korName }}섭
                            </option>
                        </select>
                    </label>
                    <label>
                        <span>시나리오</span>
                        <select
                            v-model.number="form.scenarioId"
                            data-testid="proposal-scenario"
                            :disabled="catalogLoading || scenarios.length === 0"
                        >
                            <option v-for="scenario in scenarios" :key="scenario.id" :value="scenario.id">
                                {{ scenario.title }}
                            </option>
                        </select>
                    </label>
                    <label>
                        <span>가오픈 일시</span>
                        <input v-model="form.preopenAt" type="datetime-local" step="1" data-testid="proposal-preopen" />
                    </label>
                    <label>
                        <span>오픈 일시</span>
                        <input v-model="form.openAt" type="datetime-local" step="1" data-testid="proposal-open" />
                    </label>
                </div>
                <p v-if="catalogLoading" class="field-status" role="status">활성 빌드의 시나리오를 확인하고 있습니다.</p>
                <p v-else-if="catalogError" class="field-error" role="alert">
                    {{ catalogError }}
                    <button type="button" @click="loadScenarios">다시 확인</button>
                </p>
                <p v-if="!dateOrderValid" class="field-error" role="alert">가오픈 일시는 오픈 일시보다 늦을 수 없습니다.</p>

                <dl v-if="selectedScenario" class="scenario-summary" data-testid="scenario-summary">
                    <div><dt>시작 연도</dt><dd>{{ selectedScenario.year ?? '-' }}년</dd></div>
                    <div><dt>최대 스탯</dt><dd>{{ selectedScenario.defaultStatTotal }}</dd></div>
                    <div><dt>기본 NPC</dt><dd>{{ selectedScenario.npcCount }}명</dd></div>
                    <div><dt>확장 NPC</dt><dd>{{ selectedScenario.npcExCount }}명</dd></div>
                    <div><dt>중립 NPC</dt><dd>{{ selectedScenario.npcNeutralCount }}명</dd></div>
                    <div><dt>국가</dt><dd>{{ selectedScenario.nations.length }}개</dd></div>
                </dl>
            </section>

            <section class="panel" aria-labelledby="proposal-options-heading">
                <h2 id="proposal-options-heading">빌드 옵션</h2>
                <p class="section-help">선택은 아래 미리보기에만 반영됩니다. 각 설명은 실제 초기화 옵션의 의미입니다.</p>
                <div class="field-grid option-grid">
                    <label>
                        <span>{{ RESET_OPTION_COPY.turnTerm.label }}</span>
                        <select v-model.number="form.turnTermMinutes">
                            <option v-for="minutes in PROFILE_TURN_TERM_MINUTES" :key="minutes" :value="minutes">
                                {{ minutes }}분
                            </option>
                        </select>
                        <small>{{ RESET_OPTION_COPY.turnTerm.help }}</small>
                    </label>
                    <label>
                        <span>{{ RESET_OPTION_COPY.fiction.label }}</span>
                        <select v-model.number="form.fiction">
                            <option :value="1">가상</option>
                            <option :value="0">연의(사실)</option>
                        </select>
                        <small>{{ RESET_OPTION_COPY.fiction.help }}</small>
                    </label>
                    <label>
                        <span>{{ RESET_OPTION_COPY.npcMode.label }}</span>
                        <select v-model.number="form.npcMode">
                            <option :value="0">불가</option>
                            <option :value="1">가능</option>
                            <option :value="2">선택 생성 가능</option>
                        </select>
                        <small>{{ RESET_OPTION_COPY.npcMode.help }}</small>
                    </label>
                    <label>
                        <span>{{ RESET_OPTION_COPY.blockGeneralCreate.label }}</span>
                        <select v-model.number="form.blockGeneralCreate">
                            <option :value="0">가능</option>
                            <option :value="2">장수명 무작위</option>
                            <option :value="1">불가</option>
                        </select>
                        <small>{{ RESET_OPTION_COPY.blockGeneralCreate.help }}</small>
                    </label>
                    <label>
                        <span>{{ RESET_OPTION_COPY.joinMode.label }}</span>
                        <select v-model="form.joinMode">
                            <option value="full">일반</option>
                            <option value="onlyRandom">랜덤 임관</option>
                        </select>
                        <small>{{ RESET_OPTION_COPY.joinMode.help }}</small>
                    </label>
                    <label>
                        <span>{{ RESET_OPTION_COPY.showImgLevel.label }}</span>
                        <select v-model.number="form.showImgLevel">
                            <option :value="0">안함</option>
                            <option :value="1">전콘</option>
                            <option :value="2">전콘, 병종</option>
                            <option :value="3">전콘, 병종, NPC</option>
                        </select>
                        <small>{{ RESET_OPTION_COPY.showImgLevel.help }}</small>
                    </label>
                </div>

                <div class="toggle-grid">
                    <label><input v-model="form.sync" type="checkbox" /> 시간 동기화</label>
                    <label><input v-model="form.extend" type="checkbox" /> 확장 NPC 포함</label>
                    <label><input v-model="form.tournamentTrig" type="checkbox" /> 토너먼트 자동 시작</label>
                    <label><input v-model="form.autorunEnabled" type="checkbox" /> 자율행동 사용</label>
                </div>

                <fieldset v-if="form.autorunEnabled" class="autorun-options">
                    <legend>자율행동</legend>
                    <div class="checkbox-list">
                        <label v-for="option in RESET_AUTORUN_LABELS" :key="option.value">
                            <input v-model="form.autorunOptions" type="checkbox" :value="option.value" />
                            {{ option.label }}
                        </label>
                    </div>
                    <label class="autorun-limit">
                        <span>{{ RESET_OPTION_COPY.autorunLimit.label }}</span>
                        <select v-model.number="form.autorunLimitMinutes">
                            <option :value="60">1시간</option>
                            <option :value="720">12시간</option>
                            <option :value="1440">24시간</option>
                            <option :value="2880">48시간</option>
                            <option :value="4320">72시간</option>
                            <option :value="43200">항상</option>
                        </select>
                    </label>
                    <p v-if="form.autorunOptions.length === 0" class="field-error" role="alert">
                        자율행동을 사용하려면 행동을 하나 이상 선택해야 합니다.
                    </p>
                </fieldset>
            </section>

            <section class="panel output-panel" aria-labelledby="proposal-output-heading">
                <div class="output-heading">
                    <div>
                        <h2 id="proposal-output-heading">복사할 양식</h2>
                        <p>기본값과 같은 고급 옵션은 생략하고, 달라진 옵션과 자율행동만 기타 설정에 표시합니다.</p>
                    </div>
                    <button type="button" :disabled="!canCopy" data-testid="copy-proposal" @click="copySuggestion">
                        양식 복사
                    </button>
                </div>
                <textarea
                    ref="outputElement"
                    class="suggestion-output"
                    :value="suggestionText"
                    readonly
                    rows="6"
                    data-testid="proposal-output"
                ></textarea>
                <p class="copy-status" role="status">{{ copiedMessage }}</p>
            </section>

            <details class="panel catalog-panel">
                <summary>시나리오 목록 {{ scenarios.length }}개 보기</summary>
                <div class="catalog-table-frame">
                    <table>
                        <thead><tr><th>ID</th><th>시나리오</th><th>시작</th><th>최대 스탯</th><th>NPC</th><th>국가</th></tr></thead>
                        <tbody>
                            <tr v-for="scenario in scenarios" :key="scenario.id">
                                <td>{{ scenario.id }}</td>
                                <td>{{ scenario.title }}</td>
                                <td>{{ scenario.year ?? '-' }}</td>
                                <td>{{ scenario.defaultStatTotal }}</td>
                                <td>{{ scenario.npcCount + scenario.npcExCount + scenario.npcNeutralCount }}</td>
                                <td>{{ scenario.nations.length }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
        </main>
    </DefaultLayout>
</template>

<style scoped>
.suggestion-page {
    box-sizing: border-box;
    width: min(100% - 32px, 960px);
    margin: 0 auto;
    padding: 108px 0 40px;
    color: #e4e4e7;
}

.page-header,
.output-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
}

.page-header h1,
.panel h2 {
    margin: 0;
    color: #fff;
}

.page-header h1 { font-size: 28px; line-height: 1.25; }
.page-header p:not(.eyebrow), .section-help, .output-heading p { margin: 8px 0 0; color: #a1a1aa; }
.eyebrow { margin: 0 0 6px; color: #fb923c; font-size: 12px; font-weight: 700; letter-spacing: .12em; }
.back-link { flex: 0 0 auto; color: #fdba74; text-underline-offset: 3px; }

.read-only-notice {
    margin: 22px 0;
    border: 1px solid #3f3f46;
    border-left: 4px solid #f97316;
    border-radius: 4px;
    background: #18181b;
    padding: 12px 14px;
    color: #fed7aa;
}

.panel {
    margin-top: 18px;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    background: #18181b;
    padding: 20px;
}

.panel h2 { font-size: 20px; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
.field-grid label, .autorun-limit { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.field-grid label > span, .autorun-limit > span { color: #fafafa; font-size: 14px; font-weight: 700; }
.field-grid small { color: #a1a1aa; font-size: 12px; line-height: 1.45; }

select, input[type='datetime-local'], textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #52525b;
    border-radius: 4px;
    background: #09090b;
    padding: 10px 11px;
    color: #fafafa;
    font: inherit;
}

select:focus-visible, input:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible, .back-link:focus-visible {
    outline: 2px solid #fb923c;
    outline-offset: 2px;
}

.field-status { color: #a1a1aa; }
.field-error { color: #fca5a5; }
.field-error button { border: 0; background: transparent; color: #fdba74; text-decoration: underline; cursor: pointer; }

.scenario-summary { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); margin: 18px 0 0; border: 1px solid #3f3f46; }
.scenario-summary div { min-width: 0; border-right: 1px solid #3f3f46; padding: 10px; text-align: center; }
.scenario-summary div:last-child { border-right: 0; }
.scenario-summary dt { color: #a1a1aa; font-size: 12px; }
.scenario-summary dd { margin: 4px 0 0; color: #fff; font-weight: 700; }

.toggle-grid, .checkbox-list { display: flex; flex-wrap: wrap; gap: 10px 18px; }
.toggle-grid { margin-top: 20px; border-top: 1px solid #3f3f46; padding-top: 16px; }
.toggle-grid label, .checkbox-list label { display: inline-flex; align-items: center; gap: 7px; }
.autorun-options { margin-top: 18px; border: 1px solid #3f3f46; border-radius: 4px; padding: 16px; }
.autorun-options legend { padding: 0 8px; color: #fff; font-weight: 700; }
.autorun-limit { width: min(100%, 260px); margin-top: 16px; }

.output-heading { align-items: center; }
.output-heading h2 { margin: 0; }
.output-heading button {
    flex: 0 0 auto;
    border: 1px solid #f97316;
    border-radius: 4px;
    background: #c2410c;
    padding: 10px 16px;
    color: #fff;
    cursor: pointer;
    font-weight: 700;
}
.output-heading button:disabled { border-color: #3f3f46; background: #27272a; color: #71717a; cursor: default; }
.suggestion-output { margin-top: 16px; resize: vertical; line-height: 1.6; white-space: pre-wrap; }
.copy-status { min-height: 20px; margin: 8px 0 0; color: #86efac; }

.catalog-panel summary { cursor: pointer; color: #fdba74; font-weight: 700; }
.catalog-table-frame { margin-top: 14px; overflow-x: auto; }
.catalog-table-frame table { width: 100%; min-width: 680px; border-collapse: collapse; }
.catalog-table-frame th, .catalog-table-frame td { border-bottom: 1px solid #3f3f46; padding: 9px; text-align: left; }
.catalog-table-frame th { color: #a1a1aa; font-size: 12px; }

@media (max-width: 700px) {
    .suggestion-page { width: min(100% - 24px, 960px); padding-top: 96px; }
    .page-header { flex-direction: column; gap: 10px; }
    .field-grid, .scenario-summary { grid-template-columns: minmax(0, 1fr); }
    .scenario-summary div { display: flex; justify-content: space-between; border-right: 0; border-bottom: 1px solid #3f3f46; text-align: left; }
    .scenario-summary div:last-child { border-bottom: 0; }
    .scenario-summary dd { margin: 0; }
    .panel { padding: 16px; }
    .output-heading { align-items: stretch; flex-direction: column; }
    .output-heading button { width: 100%; }
}
</style>
