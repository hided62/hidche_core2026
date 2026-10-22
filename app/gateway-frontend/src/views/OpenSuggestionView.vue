<script setup lang="ts">
import { formatServerDateTime, serverDateTimeInputToIso } from '@sammo-ts/common/time/ServerDateTime';
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
const requestState = ref<GatewayOutput['openRequests']['list'] | null>(null);
const requestMessage = ref('');
const requestError = ref('');
const requestBusy = ref(false);
const requestLoading = ref(false);
const canAccept = ref(false);
const canManagePolicy = ref(false);
const policyForm = reactive({
    enabled: true,
    lifetimeDays: 7,
    buildLeadMinutes: 10,
    endorsementThreshold: null as number | null,
});
const policyReason = ref('');
let requestListId = 0;

const loadRequests = async (): Promise<void> => {
    const profileName = form.profileName;
    const requestId = ++requestListId;
    requestState.value = null;
    canAccept.value = false;
    canManagePolicy.value = false;
    if (!profileName) return;
    requestLoading.value = true;
    try {
        const result = await directTrpc.openRequests.list.query({ profileName });
        const permissions = await directTrpc.admin.openRequests.permissions.query({ profileName }).catch(() => null);
        if (requestId !== requestListId) return;
        requestState.value = result;
        Object.assign(policyForm, result.policy);
        canAccept.value = permissions?.canAccept ?? false;
        canManagePolicy.value = permissions?.canManagePolicy ?? false;
    } catch (error) {
        if (requestId === requestListId)
            requestError.value = error instanceof Error ? error.message : '요청 목록을 불러오지 못했습니다.';
    } finally {
        if (requestId === requestListId) requestLoading.value = false;
    }
};

const performRequest = async (work: () => Promise<unknown>, message: string): Promise<void> => {
    if (requestBusy.value) return;
    requestBusy.value = true;
    requestError.value = '';
    requestMessage.value = '';
    try {
        await work();
        requestMessage.value = message;
        await loadRequests();
    } catch (error) {
        requestError.value = error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
    } finally {
        requestBusy.value = false;
    }
};

const submitRequest = (): Promise<void> =>
    performRequest(async () => {
        const preopenAt = serverDateTimeInputToIso(form.preopenAt);
        const openAt = serverDateTimeInputToIso(form.openAt);
        if (!preopenAt || !openAt || form.scenarioId === null)
            throw new Error('가오픈·오픈 시각과 시나리오를 확인해 주세요.');
        return directTrpc.openRequests.create.mutate({
            profileName: form.profileName,
            install: {
                scenarioId: form.scenarioId,
                preopenAt,
                openAt,
                turnTermMinutes: form.turnTermMinutes,
                fiction: form.fiction,
                npcMode: form.npcMode,
                sync: form.sync,
                extend: form.extend,
                blockGeneralCreate: form.blockGeneralCreate,
                showImgLevel: form.showImgLevel,
                tournamentTrig: form.tournamentTrig,
                joinMode: form.joinMode,
                autorunUser: form.autorunEnabled
                    ? { limitMinutes: form.autorunLimitMinutes, options: [...form.autorunOptions] }
                    : null,
            },
        });
    }, '오픈 요청을 등록했습니다.');

const actOnRequest = (id: string, action: 'ENDORSE' | 'WITHDRAW' | 'ACCEPT' | 'REJECT'): Promise<void> =>
    performRequest(
        () =>
            action === 'ACCEPT' || action === 'REJECT'
                ? directTrpc.admin.openRequests.decide.mutate({ id, action })
                : directTrpc.openRequests.act.mutate({ id, action }),
        action === 'ACCEPT'
            ? '오픈 예약으로 전환했습니다.'
            : action === 'ENDORSE'
              ? '동의했습니다. 동의 수가 충족되면 자동 예약됩니다.'
              : '요청을 처리했습니다.'
    );
const savePolicy = (): Promise<void> =>
    performRequest(
        () =>
            directTrpc.admin.openRequests.updatePolicy.mutate({
                profileName: form.profileName,
                policy: { ...policyForm },
                reason: policyReason.value,
            }),
        '서버 오픈 요청 정책을 저장했습니다.'
    );
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
const dateOrderValid = computed(() => !form.preopenAt || !form.openAt || form.preopenAt < form.openAt);
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

const operationStatusText = (status: string): string =>
    ({
        QUEUED: '준비 예약',
        RUNNING: '준비 중',
        SUCCEEDED: '준비 완료',
        FAILED: '준비 실패 · 오프너 확인 필요',
        CANCELLED: '예약 취소',
    })[status] ?? status;
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
    () => {
        requestError.value = '';
        requestMessage.value = '';
        void loadScenarios();
        void loadRequests();
    }
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
                    <h1>오픈 요청</h1>
                    <p>통일되었거나 닫힌 서버의 다음 오픈을 요청하고, 다른 사용자의 요청에 동의할 수 있습니다.</p>
                </div>
                <RouterLink class="back-link" to="/lobby">서버 목록으로</RouterLink>
            </header>

            <p class="read-only-notice" role="note">
                등록한 오픈 요청은 목록에서 확인할 수 있습니다. 복사는 문구만 복사하며, 오픈 요청 등록 버튼을 눌러야 요청이
                저장됩니다.
            </p>

            <section class="panel request-list" aria-labelledby="requests-heading">
                <div class="output-heading">
                    <h2 id="requests-heading">오픈 요청 목록</h2>
                    <button type="button" :disabled="requestLoading || requestBusy" @click="loadRequests">
                        새로고침
                    </button>
                </div>
                <p v-if="requestMessage" role="status">{{ requestMessage }}</p>
                <p v-if="requestError" class="field-error" role="alert">{{ requestError }}</p>
                <template v-if="requestState">
                    <p class="section-help">
                        요청은 {{ requestState.policy.lifetimeDays }}일 동안, 늦어도 빌드 시작 전까지 모집합니다. 가오픈
                        {{ requestState.policy.buildLeadMinutes }}분 전 서버 패치 정책에 따라 준비합니다.
                        <span v-if="requestState.policy.endorsementThreshold !== null"
                            >요청자 외 정식 사용자 {{ requestState.policy.endorsementThreshold }}명의 동의로 자동
                            예약됩니다.</span
                        >
                        <span v-else>이 서버는 오프너가 수락하면 예약됩니다.</span>
                    </p>
                    <p v-if="!requestState.canRequest" class="section-help">
                        현재 오픈 요청을 등록할 수 없습니다. 서버 상태와 정식 참여 자격을 확인해 주세요.
                    </p>
                    <p v-if="requestState.requests.length === 0">대기 중인 오픈 요청이 없습니다.</p>
                    <article
                        v-for="request in requestState.requests"
                        :key="request.id"
                        class="request-card"
                        :data-request-id="request.id"
                    >
                        <h3>{{ request.requesterName }} · {{ request.announcement.scenarioTitle }}</h3>
                        <p>
                            {{ request.status === 'RESERVED' ? '오픈 예약' : '수락 대기'
                            }}<span v-if="request.operationStatus">
                                · {{ operationStatusText(request.operationStatus) }}</span
                            >
                        </p>
                        <p>
                            가오픈 {{ formatServerDateTime(request.install.preopenAt) }} / 오픈
                            {{ formatServerDateTime(request.install.openAt) }} (서버 시간 UTC+9)
                        </p>
                        <p>
                            {{ request.install.turnTermMinutes }}분 턴 · 상성
                            {{ request.install.fiction === 1 ? '가상' : '사실' }} · 빙의
                            {{ npcModeText(request.install.npcMode) }} · 최대 스탯
                            {{ request.announcement.defaultStatTotal }}
                        </p>
                        <details>
                            <summary>요청 설정 전체</summary>
                            <dl class="request-settings">
                                <dt>시간 동기화</dt>
                                <dd>{{ request.install.sync ? '사용' : '사용 안 함' }}</dd>
                                <dt>확장 NPC</dt>
                                <dd>{{ request.install.extend ? '포함' : '미포함' }}</dd>
                                <dt>장수 생성</dt>
                                <dd>{{ ['가능', '불가', '장수명 무작위'][request.install.blockGeneralCreate] }}</dd>
                                <dt>임관</dt>
                                <dd>{{ request.install.joinMode === 'full' ? '자유 임관' : '랜덤 임관' }}</dd>
                                <dt>이미지 표시</dt>
                                <dd>{{ ['표시 안 함', '전콘', '전콘·병종', '전체'][request.install.showImgLevel] }}</dd>
                                <dt>토너먼트</dt>
                                <dd>{{ request.install.tournamentTrig ? '자동 시작' : '수동 시작' }}</dd>
                                <dt>자율행동</dt>
                                <dd>
                                    {{
                                        request.install.autorunUser
                                            ? `${request.install.autorunUser.limitMinutes}분`
                                            : '사용 안 함'
                                    }}
                                    <template v-if="request.install.autorunUser">
                                        ·
                                        {{
                                            RESET_AUTORUN_LABELS.filter((entry) =>
                                                request.install.autorunUser?.options.includes(entry.value)
                                            )
                                                .map((entry) => entry.label)
                                                .join(', ')
                                        }}</template
                                    >
                                </dd>
                            </dl>
                        </details>
                        <p v-if="request.status === 'PENDING'">
                            모집 종료 {{ formatServerDateTime(request.expiresAt) }}
                        </p>
                        <p v-if="requestState.policy.endorsementThreshold !== null">
                            동의 {{ request.endorsementCount }}명 /
                            {{ requestState.policy.endorsementThreshold }}명<span v-if="request.endorsed">
                                · 동의 완료</span
                            >
                        </p>
                        <div class="request-actions" v-if="request.status === 'PENDING'">
                            <button
                                v-if="request.canEndorse"
                                type="button"
                                :disabled="requestBusy || request.endorsed"
                                @click="actOnRequest(request.id, 'ENDORSE')"
                            >
                                {{ request.endorsed ? '동의 완료' : '동의' }}
                            </button>
                            <button
                                v-if="request.isMine"
                                type="button"
                                :disabled="requestBusy"
                                @click="actOnRequest(request.id, 'WITHDRAW')"
                            >
                                요청 철회
                            </button>
                            <button
                                v-if="canAccept"
                                type="button"
                                :disabled="requestBusy"
                                @click="actOnRequest(request.id, 'ACCEPT')"
                            >
                                수락하여 오픈 예약
                            </button>
                            <button
                                v-if="canAccept"
                                type="button"
                                :disabled="requestBusy"
                                @click="actOnRequest(request.id, 'REJECT')"
                            >
                                요청 거절
                            </button>
                        </div>
                    </article>
                    <details v-if="canManagePolicy" class="request-policy">
                        <summary>서버 오픈 요청 정책</summary>
                        <div class="field-grid">
                            <label><span>요청 접수</span><input v-model="policyForm.enabled" type="checkbox" /></label>
                            <label
                                ><span>모집 기간(일)</span
                                ><input v-model.number="policyForm.lifetimeDays" type="number" min="1" max="365"
                            /></label>
                            <label
                                ><span>가오픈 전 준비 시간(분)</span
                                ><input v-model.number="policyForm.buildLeadMinutes" type="number" min="1" max="10080"
                            /></label>
                            <label
                                ><span>동의로 자동 예약</span
                                ><input
                                    :checked="policyForm.endorsementThreshold !== null"
                                    type="checkbox"
                                    @change="
                                        policyForm.endorsementThreshold =
                                            policyForm.endorsementThreshold === null ? 5 : null
                                    "
                            /></label>
                            <label v-if="policyForm.endorsementThreshold !== null"
                                ><span>필요 동의 수(요청자 제외)</span
                                ><input
                                    v-model.number="policyForm.endorsementThreshold"
                                    type="number"
                                    min="1"
                                    max="10000"
                            /></label>
                            <label><span>변경 사유</span><input v-model="policyReason" maxlength="200" /></label>
                        </div>
                        <button
                            type="button"
                            :disabled="requestBusy || policyReason.trim().length < 3"
                            @click="savePolicy"
                        >
                            정책 저장
                        </button>
                    </details>
                </template>
            </section>

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
                        <span>가오픈 일시 (서버 시간 UTC+9)</span>
                        <input v-model="form.preopenAt" type="datetime-local" step="1" data-testid="proposal-preopen" />
                    </label>
                    <label>
                        <span>오픈 일시 (서버 시간 UTC+9)</span>
                        <input v-model="form.openAt" type="datetime-local" step="1" data-testid="proposal-open" />
                    </label>
                </div>
                <p v-if="catalogLoading" class="field-status" role="status">
                    활성 빌드의 시나리오를 확인하고 있습니다.
                </p>
                <p v-else-if="catalogError" class="field-error" role="alert">
                    {{ catalogError }}
                    <button type="button" @click="loadScenarios">다시 확인</button>
                </p>
                <p v-if="!dateOrderValid" class="field-error" role="alert">
                    가오픈 일시는 오픈 일시보다 늦을 수 없습니다.
                </p>

                <dl v-if="selectedScenario" class="scenario-summary" data-testid="scenario-summary">
                    <div>
                        <dt>시작 연도</dt>
                        <dd>{{ selectedScenario.year ?? '-' }}년</dd>
                    </div>
                    <div>
                        <dt>최대 스탯</dt>
                        <dd>{{ selectedScenario.defaultStatTotal }}</dd>
                    </div>
                    <div>
                        <dt>기본 NPC</dt>
                        <dd>{{ selectedScenario.npcCount }}명</dd>
                    </div>
                    <div>
                        <dt>확장 NPC</dt>
                        <dd>{{ selectedScenario.npcExCount }}명</dd>
                    </div>
                    <div>
                        <dt>중립 NPC</dt>
                        <dd>{{ selectedScenario.npcNeutralCount }}명</dd>
                    </div>
                    <div>
                        <dt>국가</dt>
                        <dd>{{ selectedScenario.nations.length }}개</dd>
                    </div>
                </dl>
            </section>

            <section class="panel" aria-labelledby="proposal-options-heading">
                <h2 id="proposal-options-heading">빌드 옵션</h2>
                <p class="section-help">
                    선택한 설정은 오픈 요청에 저장됩니다. 각 설명은 실제 초기화 옵션의 의미입니다.
                </p>
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

            <section class="panel">
                <p>
                    요청자는 빌드 시각이나 배포 버전을 지정하지 않습니다. 서버 정책에 따라 가오픈 전에 준비하며, 수락된
                    뒤에는 요청을 철회할 수 없습니다.
                </p>
                <button
                    type="button"
                    data-testid="submit-open-request"
                    :disabled="!canCopy || !requestState?.canRequest || requestBusy || requestLoading"
                    @click="submitRequest"
                >
                    오픈 요청 등록
                </button>
            </section>

            <details class="panel catalog-panel">
                <summary>시나리오 목록 {{ scenarios.length }}개 보기</summary>
                <div class="catalog-table-frame">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>시나리오</th>
                                <th>시작</th>
                                <th>최대 스탯</th>
                                <th>NPC</th>
                                <th>국가</th>
                            </tr>
                        </thead>
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
.request-card {
    margin: 16px 0;
    padding: 16px;
    border: 1px solid #52525b;
    border-radius: 6px;
    overflow-wrap: anywhere;
}
.request-card h3 {
    margin: 0 0 8px;
}
.request-settings {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
}
.request-card pre {
    overflow: auto;
    max-width: 100%;
    white-space: pre-wrap;
}
.request-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.request-policy {
    margin-top: 16px;
}
button {
    min-height: 36px;
    padding: 6px 12px;
    border: 1px solid #71717a;
    border-radius: 4px;
}
button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
button:focus-visible {
    outline: 2px solid #a5b4fc;
    outline-offset: 2px;
}

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

.page-header h1 {
    font-size: 28px;
    line-height: 1.25;
}
.page-header p:not(.eyebrow),
.section-help,
.output-heading p {
    margin: 8px 0 0;
    color: #a1a1aa;
}
.eyebrow {
    margin: 0 0 6px;
    color: #fb923c;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
}
.back-link {
    flex: 0 0 auto;
    color: #fdba74;
    text-underline-offset: 3px;
}

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

.panel h2 {
    font-size: 20px;
}
.field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 18px;
}
.field-grid label,
.autorun-limit {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
}
.field-grid label > span,
.autorun-limit > span {
    color: #fafafa;
    font-size: 14px;
    font-weight: 700;
}
.field-grid small {
    color: #a1a1aa;
    font-size: 12px;
    line-height: 1.45;
}

select,
input[type='datetime-local'],
textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #52525b;
    border-radius: 4px;
    background: #09090b;
    padding: 10px 11px;
    color: #fafafa;
    font: inherit;
}

select:focus-visible,
input:focus-visible,
textarea:focus-visible,
button:focus-visible,
summary:focus-visible,
.back-link:focus-visible {
    outline: 2px solid #fb923c;
    outline-offset: 2px;
}

.field-status {
    color: #a1a1aa;
}
.field-error {
    color: #fca5a5;
}
.field-error button {
    border: 0;
    background: transparent;
    color: #fdba74;
    text-decoration: underline;
    cursor: pointer;
}

.scenario-summary {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    margin: 18px 0 0;
    border: 1px solid #3f3f46;
}
.scenario-summary div {
    min-width: 0;
    border-right: 1px solid #3f3f46;
    padding: 10px;
    text-align: center;
}
.scenario-summary div:last-child {
    border-right: 0;
}
.scenario-summary dt {
    color: #a1a1aa;
    font-size: 12px;
}
.scenario-summary dd {
    margin: 4px 0 0;
    color: #fff;
    font-weight: 700;
}

.toggle-grid,
.checkbox-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
}
.toggle-grid {
    margin-top: 20px;
    border-top: 1px solid #3f3f46;
    padding-top: 16px;
}
.toggle-grid label,
.checkbox-list label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
}
.autorun-options {
    margin-top: 18px;
    border: 1px solid #3f3f46;
    border-radius: 4px;
    padding: 16px;
}
.autorun-options legend {
    padding: 0 8px;
    color: #fff;
    font-weight: 700;
}
.autorun-limit {
    width: min(100%, 260px);
    margin-top: 16px;
}

.output-heading {
    align-items: center;
}
.output-heading h2 {
    margin: 0;
}
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
.output-heading button:disabled {
    border-color: #3f3f46;
    background: #27272a;
    color: #71717a;
    cursor: default;
}
.suggestion-output {
    margin-top: 16px;
    resize: vertical;
    line-height: 1.6;
    white-space: pre-wrap;
}
.copy-status {
    min-height: 20px;
    margin: 8px 0 0;
    color: #86efac;
}

.catalog-panel summary {
    cursor: pointer;
    color: #fdba74;
    font-weight: 700;
}
.catalog-table-frame {
    margin-top: 14px;
    overflow-x: auto;
}
.catalog-table-frame table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
}
.catalog-table-frame th,
.catalog-table-frame td {
    border-bottom: 1px solid #3f3f46;
    padding: 9px;
    text-align: left;
}
.catalog-table-frame th {
    color: #a1a1aa;
    font-size: 12px;
}

@media (max-width: 700px) {
    .suggestion-page {
        width: min(100% - 24px, 960px);
        padding-top: 96px;
    }
    .page-header {
        flex-direction: column;
        gap: 10px;
    }
    .field-grid,
    .scenario-summary {
        grid-template-columns: minmax(0, 1fr);
    }
    .scenario-summary div {
        display: flex;
        justify-content: space-between;
        border-right: 0;
        border-bottom: 1px solid #3f3f46;
        text-align: left;
    }
    .scenario-summary div:last-child {
        border-bottom: 0;
    }
    .scenario-summary dd {
        margin: 0;
    }
    .panel {
        padding: 16px;
    }
    .output-heading {
        align-items: stretch;
        flex-direction: column;
    }
    .output-heading button {
        width: 100%;
    }
}
</style>
