<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import DefaultLayout from '../layouts/DefaultLayout.vue';
import { trpc } from '../utils/trpc';

const adminClient = trpc.admin;

type Profile = {
    profileName: string;
    profile: string;
    scenario: string;
    status: string;
    buildStatus: string;
    buildCommitSha?: string;
    buildWorkspace?: string;
    buildError?: string;
    lastError?: string;
    runtime: {
        apiRunning: boolean;
        daemonRunning: boolean;
        auctionRunning: boolean;
        tournamentRunning: boolean;
    };
};

type Scenario = {
    id: number;
    title: string;
    year: number | null;
    npcCount: number;
};

type Operation = {
    id: string;
    profileName: string;
    type: 'RESET' | 'START' | 'STOP';
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    sourceMode?: 'BRANCH' | 'COMMIT';
    sourceRef?: string;
    resolvedCommitSha?: string;
    reason?: string;
    requestedBy: string;
    scheduledAt?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    createdAt: string;
};

const profiles = ref<Profile[]>([]);
const scenarios = ref<Scenario[]>([]);
const operations = ref<Operation[]>([]);
const selectedProfileName = ref('');
const loading = ref(false);
const catalogLoading = ref(false);
const submitting = ref(false);
const message = ref('');
const errorMessage = ref('');
let pollTimer: ReturnType<typeof setInterval> | undefined;
let stateRequestInFlight = false;

const form = reactive({
    sourceMode: 'BRANCH' as 'BRANCH' | 'COMMIT',
    sourceRef: 'main',
    scenarioId: 0,
    turnTermMinutes: 60,
    sync: true,
    fiction: 1,
    extend: true,
    blockGeneralCreate: 0,
    npcMode: 0,
    showImgLevel: 3,
    tournamentTrig: true,
    joinMode: 'full' as 'full' | 'onlyRandom',
    autorunEnabled: false,
    autorunUserMinutes: 1440,
    autorunDevelop: true,
    autorunWarp: true,
    autorunRecruit: true,
    autorunTrain: true,
    autorunBattle: true,
    openAt: '',
    preopenAt: '',
    scheduledAt: '',
    reason: '',
});

const selectedProfile = computed(
    () => profiles.value.find((profile) => profile.profileName === selectedProfileName.value) ?? null
);

const activeOperation = computed(
    () =>
        operations.value.find(
            (operation) =>
                operation.profileName === selectedProfileName.value &&
                (operation.status === 'QUEUED' || operation.status === 'RUNNING')
        ) ?? null
);

const sourceHelp = computed(() =>
    form.sourceMode === 'BRANCH'
        ? '작업이 실제로 시작될 때 원격 브랜치를 다시 fetch하여 최신 커밋을 사용합니다.'
        : '요청 시 커밋을 전체 SHA로 고정하므로 이후 브랜치가 이동해도 결과가 바뀌지 않습니다.'
);

const toIso = (value: string): string | undefined => {
    if (!value) {
        return undefined;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const formatTime = (value?: string): string => (value ? new Date(value).toLocaleString('ko-KR') : '-');
const shortSha = (value?: string): string => (value ? value.slice(0, 12) : '-');

const clearStatus = () => {
    message.value = '';
    errorMessage.value = '';
};

const loadState = async (quiet = false) => {
    if (stateRequestInFlight) {
        return;
    }
    stateRequestInFlight = true;
    if (!quiet) {
        loading.value = true;
    }
    try {
        const profileResult = await adminClient.profiles.list.query();
        const operationResult = await adminClient.operations.list.query({ limit: 100 });
        profiles.value = profileResult as Profile[];
        operations.value = operationResult as Operation[];
        if (!selectedProfileName.value && profiles.value.length > 0) {
            selectedProfileName.value = profiles.value[0].profileName;
        }
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '운영 상태를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
        stateRequestInFlight = false;
    }
};

const loadScenarios = async () => {
    clearStatus();
    if (!form.sourceRef.trim()) {
        errorMessage.value = '브랜치 또는 커밋을 입력해주세요.';
        return;
    }
    catalogLoading.value = true;
    try {
        const result = await adminClient.profiles.listScenarios.query({
            gitRef: form.sourceRef.trim(),
            sourceMode: form.sourceMode,
        });
        scenarios.value = result as Scenario[];
        if (!scenarios.value.some((scenario) => scenario.id === form.scenarioId)) {
            const profileScenario = Number(selectedProfile.value?.scenario);
            form.scenarioId =
                scenarios.value.find((scenario) => scenario.id === profileScenario)?.id ?? scenarios.value[0]?.id ?? 0;
        }
        message.value = `${scenarios.value.length}개 시나리오를 확인했습니다.`;
    } catch (error) {
        scenarios.value = [];
        errorMessage.value = error instanceof Error ? error.message : '소스에서 시나리오를 읽지 못했습니다.';
    } finally {
        catalogLoading.value = false;
    }
};

const requestRuntime = async (action: 'START' | 'STOP') => {
    clearStatus();
    if (!selectedProfile.value || activeOperation.value) {
        return;
    }
    const label = action === 'START' ? '시작' : '정지';
    if (!window.confirm(`${selectedProfile.value.profileName} 서버를 ${label}하시겠습니까?`)) {
        return;
    }
    submitting.value = true;
    try {
        await adminClient.operations.requestRuntime.mutate({
            profileName: selectedProfile.value.profileName,
            action,
            reason: form.reason.trim() || undefined,
        });
        message.value = `${label} 작업을 요청했습니다.`;
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : `${label} 요청에 실패했습니다.`;
    } finally {
        submitting.value = false;
    }
};

const selectedAutorunOptions = (): Array<'develop' | 'warp' | 'recruit' | 'train' | 'battle'> => {
    const options: Array<'develop' | 'warp' | 'recruit' | 'train' | 'battle'> = [];
    if (form.autorunDevelop) options.push('develop');
    if (form.autorunWarp) options.push('warp');
    if (form.autorunRecruit) options.push('recruit');
    if (form.autorunTrain) options.push('train');
    if (form.autorunBattle) options.push('battle');
    return options;
};

const requestReset = async () => {
    clearStatus();
    if (!selectedProfile.value || activeOperation.value) {
        return;
    }
    if (!form.sourceRef.trim() || !form.scenarioId) {
        errorMessage.value = '소스와 시나리오를 먼저 선택해주세요.';
        return;
    }
    const sourceLabel = form.sourceMode === 'BRANCH' ? '브랜치' : '커밋';
    if (
        !window.confirm(
            `${selectedProfile.value.profileName}의 게임 DB를 초기화합니다.\n${sourceLabel}: ${form.sourceRef}\n시나리오: ${form.scenarioId}`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        await adminClient.operations.requestReset.mutate({
            profileName: selectedProfile.value.profileName,
            sourceMode: form.sourceMode,
            sourceRef: form.sourceRef.trim(),
            scheduledAt: toIso(form.scheduledAt),
            reason: form.reason.trim() || undefined,
            install: {
                scenarioId: form.scenarioId,
                turnTermMinutes: form.turnTermMinutes,
                sync: form.sync,
                fiction: form.fiction,
                extend: form.extend,
                blockGeneralCreate: form.blockGeneralCreate,
                npcMode: form.npcMode,
                showImgLevel: form.showImgLevel,
                tournamentTrig: form.tournamentTrig,
                joinMode: form.joinMode,
                autorunUser: form.autorunEnabled
                    ? {
                          limitMinutes: form.autorunUserMinutes,
                          options: selectedAutorunOptions(),
                      }
                    : null,
                openAt: toIso(form.openAt),
                preopenAt: toIso(form.preopenAt),
            },
        });
        message.value = form.scheduledAt ? '예약 초기화 작업을 등록했습니다.' : '초기화 작업을 시작했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '초기화 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const cancelOperation = async (operation: Operation) => {
    clearStatus();
    if (!window.confirm('대기 중인 작업을 취소하시겠습니까?')) {
        return;
    }
    try {
        await adminClient.operations.cancel.mutate({ id: operation.id });
        message.value = '작업을 취소했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '작업 취소에 실패했습니다.';
    }
};

const retryOperation = async (operation: Operation) => {
    clearStatus();
    if (!window.confirm('같은 입력으로 작업을 다시 실행하시겠습니까?')) {
        return;
    }
    try {
        await adminClient.operations.retry.mutate({ id: operation.id });
        message.value = '재시도 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '작업 재시도에 실패했습니다.';
    }
};

watch(selectedProfileName, () => {
    const scenarioId = Number(selectedProfile.value?.scenario);
    if (Number.isFinite(scenarioId)) {
        form.scenarioId = scenarioId;
    }
});

onMounted(async () => {
    await loadState();
    await loadScenarios();
    pollTimer = setInterval(() => void loadState(true), 3000);
});

onBeforeUnmount(() => {
    if (pollTimer) {
        clearInterval(pollTimer);
    }
});
</script>

<template>
    <DefaultLayout>
        <div class="max-w-7xl mx-auto px-4 py-8 space-y-6" data-testid="server-operations-page">
            <header class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <p class="text-xs uppercase tracking-[0.25em] text-amber-400">Operations console</p>
                    <h2 class="text-2xl font-bold text-white">서버 배포 · 시나리오 초기화</h2>
                    <p class="mt-2 text-sm text-zinc-400">
                        실행 소스, 초기화 옵션, 프로세스 상태와 작업 이력을 한 화면에서 관리합니다.
                    </p>
                </div>
                <button
                    class="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-50"
                    :disabled="loading"
                    data-testid="refresh-operations"
                    @click="loadState()"
                >
                    상태 새로고침
                </button>
            </header>

            <div v-if="errorMessage" class="rounded border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
                {{ errorMessage }}
            </div>
            <div
                v-if="message"
                class="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200"
            >
                {{ message }}
            </div>

            <section class="grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
                <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-4">
                    <div>
                        <label class="text-xs text-zinc-400" for="profile-select">운영 프로필</label>
                        <select
                            id="profile-select"
                            v-model="selectedProfileName"
                            class="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                            data-testid="profile-select"
                        >
                            <option v-for="profile in profiles" :key="profile.profileName" :value="profile.profileName">
                                {{ profile.profileName }}
                            </option>
                        </select>
                    </div>

                    <div
                        v-if="selectedProfile"
                        class="grid grid-cols-2 gap-3 text-sm"
                        data-testid="selected-profile-status"
                    >
                        <div class="rounded bg-zinc-950 p-3">
                            <div class="text-xs text-zinc-500">목표 상태</div>
                            <div class="mt-1 font-semibold">{{ selectedProfile.status }}</div>
                        </div>
                        <div class="rounded bg-zinc-950 p-3">
                            <div class="text-xs text-zinc-500">빌드</div>
                            <div class="mt-1 font-semibold">{{ selectedProfile.buildStatus }}</div>
                        </div>
                        <div class="rounded bg-zinc-950 p-3">
                            <div class="text-xs text-zinc-500">Game API</div>
                            <div :class="selectedProfile.runtime.apiRunning ? 'text-emerald-400' : 'text-zinc-500'">
                                {{ selectedProfile.runtime.apiRunning ? 'RUNNING' : 'STOPPED' }}
                            </div>
                        </div>
                        <div class="rounded bg-zinc-950 p-3">
                            <div class="text-xs text-zinc-500">Turn daemon</div>
                            <div :class="selectedProfile.runtime.daemonRunning ? 'text-emerald-400' : 'text-zinc-500'">
                                {{ selectedProfile.runtime.daemonRunning ? 'RUNNING' : 'STOPPED' }}
                            </div>
                        </div>
                        <div class="rounded bg-zinc-950 p-3">
                            <div class="text-xs text-zinc-500">Auction worker</div>
                            <div :class="selectedProfile.runtime.auctionRunning ? 'text-emerald-400' : 'text-zinc-500'">
                                {{ selectedProfile.runtime.auctionRunning ? 'RUNNING' : 'STOPPED' }}
                            </div>
                        </div>
                        <div class="rounded bg-zinc-950 p-3">
                            <div class="text-xs text-zinc-500">Tournament worker</div>
                            <div
                                :class="
                                    selectedProfile.runtime.tournamentRunning ? 'text-emerald-400' : 'text-zinc-500'
                                "
                            >
                                {{ selectedProfile.runtime.tournamentRunning ? 'RUNNING' : 'STOPPED' }}
                            </div>
                        </div>
                    </div>

                    <div v-if="selectedProfile" class="space-y-1 text-xs text-zinc-500">
                        <div>
                            현재 커밋:
                            <span class="font-mono text-zinc-300">{{ shortSha(selectedProfile.buildCommitSha) }}</span>
                        </div>
                        <div class="break-all">worktree: {{ selectedProfile.buildWorkspace ?? '기본 workspace' }}</div>
                        <div v-if="selectedProfile.buildError" class="text-red-400">
                            {{ selectedProfile.buildError }}
                        </div>
                        <div v-if="selectedProfile.lastError" class="text-red-400">{{ selectedProfile.lastError }}</div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <button
                            class="rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
                            :disabled="submitting || Boolean(activeOperation)"
                            data-testid="start-server"
                            @click="requestRuntime('START')"
                        >
                            서버 시작
                        </button>
                        <button
                            class="rounded bg-red-800 px-3 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                            :disabled="submitting || Boolean(activeOperation)"
                            data-testid="stop-server"
                            @click="requestRuntime('STOP')"
                        >
                            서버 정지
                        </button>
                    </div>
                </div>

                <form
                    class="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-5"
                    @submit.prevent="requestReset"
                >
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold">시나리오 초기화</h3>
                        <span
                            v-if="activeOperation"
                            class="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-300"
                        >
                            {{ activeOperation.type }} · {{ activeOperation.status }}
                        </span>
                    </div>

                    <fieldset class="space-y-2">
                        <legend class="text-xs text-zinc-400">소스 종류</legend>
                        <div class="flex gap-5">
                            <label class="flex items-center gap-2">
                                <input
                                    v-model="form.sourceMode"
                                    type="radio"
                                    value="BRANCH"
                                    data-testid="source-branch"
                                />
                                브랜치
                            </label>
                            <label class="flex items-center gap-2">
                                <input
                                    v-model="form.sourceMode"
                                    type="radio"
                                    value="COMMIT"
                                    data-testid="source-commit"
                                />
                                커밋
                            </label>
                        </div>
                        <p class="text-xs text-amber-200/80" data-testid="source-help">{{ sourceHelp }}</p>
                    </fieldset>

                    <div class="grid gap-3 md:grid-cols-[1fr_auto]">
                        <input
                            v-model="form.sourceRef"
                            class="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white"
                            :placeholder="
                                form.sourceMode === 'BRANCH'
                                    ? '예: main 또는 release/season-12'
                                    : '예: 40자리 commit SHA'
                            "
                            data-testid="source-ref"
                        />
                        <button
                            type="button"
                            class="rounded border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
                            :disabled="catalogLoading"
                            data-testid="load-scenarios"
                            @click="loadScenarios"
                        >
                            시나리오 확인
                        </button>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="text-xs text-zinc-400">
                            시나리오
                            <select
                                v-model.number="form.scenarioId"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                                data-testid="scenario-select"
                            >
                                <option v-for="scenario in scenarios" :key="scenario.id" :value="scenario.id">
                                    {{ scenario.id }} · {{ scenario.title }} (NPC {{ scenario.npcCount }})
                                </option>
                            </select>
                        </label>
                        <label class="text-xs text-zinc-400">
                            턴 간격
                            <select
                                v-model.number="form.turnTermMinutes"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                            >
                                <option
                                    v-for="minutes in [1, 2, 5, 10, 20, 30, 60, 120]"
                                    :key="minutes"
                                    :value="minutes"
                                >
                                    {{ minutes }}분
                                </option>
                            </select>
                        </label>
                    </div>

                    <details class="rounded border border-zinc-800 bg-zinc-950/50 p-4">
                        <summary class="cursor-pointer text-sm font-semibold">고급 시나리오 옵션</summary>
                        <div class="mt-4 grid gap-4 md:grid-cols-2 text-sm">
                            <label
                                >동기화
                                <select v-model="form.sync" class="ml-2 rounded bg-zinc-900 px-2 py-1">
                                    <option :value="true">사용</option>
                                    <option :value="false">미사용</option>
                                </select>
                            </label>
                            <label
                                >가상 장수
                                <select v-model.number="form.fiction" class="ml-2 rounded bg-zinc-900 px-2 py-1">
                                    <option :value="1">허용</option>
                                    <option :value="0">금지</option>
                                </select>
                            </label>
                            <label
                                >연장
                                <select v-model="form.extend" class="ml-2 rounded bg-zinc-900 px-2 py-1">
                                    <option :value="true">사용</option>
                                    <option :value="false">미사용</option>
                                </select>
                            </label>
                            <label
                                >가입 방식
                                <select v-model="form.joinMode" class="ml-2 rounded bg-zinc-900 px-2 py-1">
                                    <option value="full">전체</option>
                                    <option value="onlyRandom">랜덤만</option>
                                </select>
                            </label>
                            <label
                                >장수 생성 제한
                                <select
                                    v-model.number="form.blockGeneralCreate"
                                    class="ml-2 rounded bg-zinc-900 px-2 py-1"
                                >
                                    <option :value="0">없음</option>
                                    <option :value="1">제한</option>
                                    <option :value="2">차단</option>
                                </select>
                            </label>
                            <label
                                >NPC 모드
                                <select v-model.number="form.npcMode" class="ml-2 rounded bg-zinc-900 px-2 py-1">
                                    <option :value="0">기본</option>
                                    <option :value="1">확장</option>
                                    <option :value="2">전체</option>
                                </select>
                            </label>
                            <label
                                >이미지 표시
                                <select v-model.number="form.showImgLevel" class="ml-2 rounded bg-zinc-900 px-2 py-1">
                                    <option v-for="level in [0, 1, 2, 3]" :key="level" :value="level">
                                        {{ level }}
                                    </option>
                                </select>
                            </label>
                            <label class="flex items-center gap-2">
                                <input v-model="form.tournamentTrig" type="checkbox" /> 토너먼트 사용
                            </label>
                            <label class="flex items-center gap-2">
                                <input v-model="form.autorunEnabled" type="checkbox" /> 유저 자동턴
                            </label>
                            <input
                                v-if="form.autorunEnabled"
                                v-model.number="form.autorunUserMinutes"
                                type="number"
                                min="1"
                                max="43200"
                                class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
                                aria-label="자동턴 제한 분"
                            />
                            <div v-if="form.autorunEnabled" class="md:col-span-2 flex flex-wrap gap-3 text-xs">
                                <label><input v-model="form.autorunDevelop" type="checkbox" /> 내정</label>
                                <label><input v-model="form.autorunWarp" type="checkbox" /> 이동</label>
                                <label><input v-model="form.autorunRecruit" type="checkbox" /> 징병</label>
                                <label><input v-model="form.autorunTrain" type="checkbox" /> 훈련</label>
                                <label><input v-model="form.autorunBattle" type="checkbox" /> 전투</label>
                            </div>
                        </div>
                    </details>

                    <div class="grid gap-4 md:grid-cols-3">
                        <label class="text-xs text-zinc-400"
                            >작업 예약
                            <input
                                v-model="form.scheduledAt"
                                type="datetime-local"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                            />
                        </label>
                        <label class="text-xs text-zinc-400"
                            >가오픈
                            <input
                                v-model="form.preopenAt"
                                type="datetime-local"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                            />
                        </label>
                        <label class="text-xs text-zinc-400"
                            >정식 오픈
                            <input
                                v-model="form.openAt"
                                type="datetime-local"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                            />
                        </label>
                    </div>

                    <input
                        v-model="form.reason"
                        class="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                        placeholder="작업 사유 또는 운영 메모"
                    />
                    <button
                        type="submit"
                        class="w-full rounded bg-amber-500 px-4 py-3 font-bold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="submitting || Boolean(activeOperation) || !form.scenarioId"
                        data-testid="request-reset"
                    >
                        {{ form.scheduledAt ? '초기화 예약' : '초기화 시작' }}
                    </button>
                </form>
            </section>

            <section class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="text-lg font-semibold">작업 이력</h3>
                    <span class="text-xs text-zinc-500">3초마다 상태 갱신</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[920px] text-left text-sm" data-testid="operations-table">
                        <thead class="border-b border-zinc-700 text-xs text-zinc-500">
                            <tr>
                                <th class="p-2">요청/예약</th>
                                <th class="p-2">프로필</th>
                                <th class="p-2">작업</th>
                                <th class="p-2">상태</th>
                                <th class="p-2">소스</th>
                                <th class="p-2">해석 커밋</th>
                                <th class="p-2">요청자/사유</th>
                                <th class="p-2">완료/오류</th>
                                <th class="p-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="operation in operations"
                                :key="operation.id"
                                class="border-b border-zinc-800 align-top"
                            >
                                <td class="p-2 text-xs">
                                    {{ formatTime(operation.createdAt) }}
                                    <div v-if="operation.scheduledAt" class="mt-1 text-amber-300">
                                        예약 {{ formatTime(operation.scheduledAt) }}
                                    </div>
                                </td>
                                <td class="p-2">{{ operation.profileName }}</td>
                                <td class="p-2">{{ operation.type }}</td>
                                <td class="p-2 font-semibold">{{ operation.status }}</td>
                                <td class="p-2 font-mono text-xs">
                                    {{ operation.sourceMode ?? '-' }}<br />{{ operation.sourceRef ?? '' }}
                                </td>
                                <td class="p-2 font-mono text-xs">{{ shortSha(operation.resolvedCommitSha) }}</td>
                                <td class="max-w-xs p-2 text-xs">
                                    <div class="font-mono">{{ operation.requestedBy }}</div>
                                    <div v-if="operation.reason" class="mt-1 text-zinc-400">{{ operation.reason }}</div>
                                </td>
                                <td class="max-w-xs p-2 text-xs">
                                    {{ formatTime(operation.completedAt) }}
                                    <div v-if="operation.error" class="mt-1 text-red-400">{{ operation.error }}</div>
                                </td>
                                <td class="p-2">
                                    <button
                                        v-if="operation.status === 'QUEUED'"
                                        class="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
                                        @click="cancelOperation(operation)"
                                    >
                                        취소
                                    </button>
                                    <button
                                        v-else-if="operation.status === 'FAILED' || operation.status === 'CANCELLED'"
                                        class="rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950"
                                        @click="retryOperation(operation)"
                                    >
                                        재시도
                                    </button>
                                </td>
                            </tr>
                            <tr v-if="operations.length === 0">
                                <td colspan="9" class="p-6 text-center text-zinc-500">작업 이력이 없습니다.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    </DefaultLayout>
</template>
