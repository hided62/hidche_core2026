<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import AdminConsoleLayout from '../layouts/AdminConsoleLayout.vue';
import { trpc } from '../utils/trpc';

type OperationPageMode = 'version' | 'scenario' | 'gateway';

const props = defineProps<{
    mode: OperationPageMode;
    profileName?: string;
}>();

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
        frontendRunning: boolean;
        apiRunning: boolean;
        daemonRunning: boolean;
        auctionRunning: boolean;
        battleSimRunning: boolean;
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
    type: 'RESET' | 'DEPLOY' | 'START' | 'STOP';
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

type GatewayReleaseState = {
    activeCommitSha?: string;
    activeWorkspace?: string;
    previousCommitSha?: string;
    previousWorkspace?: string;
    lastSuccessfulAt?: string;
    lastError?: string;
};

type GatewayReleaseOperation = {
    id: string;
    type: 'DEPLOY' | 'ROLLBACK';
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    sourceMode?: 'BRANCH' | 'COMMIT';
    sourceRef?: string;
    resolvedCommitSha?: string;
    requestedBy: string;
    reason?: string;
    error?: string;
    createdAt: string;
    completedAt?: string;
};

type GatewayReleaseLog = {
    cursor: string;
    operationId: string;
    level: 'INFO' | 'OUTPUT' | 'ERROR';
    phase: string;
    message: string;
    createdAt: string;
};

const profiles = ref<Profile[]>([]);
const scenarios = ref<Scenario[]>([]);
const operations = ref<Operation[]>([]);
const gatewayReleaseState = ref<GatewayReleaseState | null>(null);
const gatewayReleaseOperations = ref<GatewayReleaseOperation[]>([]);
const selectedGatewayOperationId = ref('');
const gatewayReleaseLogs = ref<GatewayReleaseLog[]>([]);
const gatewayReleaseLogCursor = ref<string>();
const gatewayReleaseLogStatus = ref('');
const gatewayReleaseLogConnection = ref<'idle' | 'connected' | 'reconnecting'>('idle');
const gatewayReleaseLogViewport = ref<HTMLElement>();
const gatewayReleaseAvailable = ref(false);
const selectedProfileName = ref(props.profileName ?? '');
const capabilities = ref<Array<{ permission: string; scopes?: string[] }>>([]);
const loading = ref(false);
const catalogLoading = ref(false);
const submitting = ref(false);
const message = ref('');
const errorMessage = ref('');
let pollTimer: ReturnType<typeof setInterval> | undefined;
let stateRequestInFlight = false;
let releaseLogLoopGeneration = 0;
let componentMounted = false;

const form = reactive({
    sourceMode: (props.mode === 'scenario' ? 'CURRENT' : 'BRANCH') as 'CURRENT' | 'BRANCH' | 'COMMIT',
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
const gatewayForm = reactive({
    sourceMode: 'BRANCH' as 'BRANCH' | 'COMMIT',
    sourceRef: 'main',
    reason: '',
});

const selectedGatewayOperation = computed(
    () => gatewayReleaseOperations.value.find((operation) => operation.id === selectedGatewayOperationId.value) ?? null
);

const selectedProfile = computed(
    () => profiles.value.find((profile) => profile.profileName === selectedProfileName.value) ?? null
);

const hasCapability = (permission: string): boolean =>
    capabilities.value.some((entry) => {
        if (entry.permission !== permission && entry.permission !== 'admin.profiles.manage') return false;
        if (!props.profileName) return true;
        return !entry.scopes?.length || entry.scopes.includes('*') || entry.scopes.includes(props.profileName);
    });

const pageTitle = computed(() => {
    if (props.mode === 'gateway') return 'Gateway 릴리스';
    if (props.mode === 'scenario') return `${props.profileName ?? ''} 시나리오 초기화`;
    return `${props.profileName ?? ''} 버전 업데이트`;
});

const pageDescription = computed(() => {
    if (props.mode === 'gateway') return 'Gateway control plane 배포와 rollback을 별도 권한으로 관리합니다.';
    if (props.mode === 'scenario') {
        return '현재 배포 버전으로 시나리오만 초기화하거나, 배포 권한이 있을 때 새 버전과 함께 초기화합니다.';
    }
    return '현재 게임 DB를 유지한 채 코드와 forward migration을 배포합니다.';
});

const activeOperation = computed(
    () =>
        operations.value.find(
            (operation) =>
                operation.profileName === selectedProfileName.value &&
                (operation.status === 'QUEUED' || operation.status === 'RUNNING')
        ) ?? null
);

const sourceHelp = computed(() =>
    form.sourceMode === 'CURRENT'
        ? `현재 서버 커밋 ${shortSha(selectedProfile.value?.buildCommitSha)}의 시나리오 리소스를 사용합니다.`
        : form.sourceMode === 'BRANCH'
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
const formatLogTime = (value: string): string =>
    new Date(value).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
        capabilities.value = (await adminClient.capabilities.list.query()) as typeof capabilities.value;
        if (props.mode === 'gateway') {
            const state = await adminClient.releases.gatewayState.query();
            const releaseOperations = await adminClient.releases.list.query({ limit: 30 });
            gatewayReleaseState.value = state as GatewayReleaseState;
            gatewayReleaseOperations.value = releaseOperations as GatewayReleaseOperation[];
            const active = gatewayReleaseOperations.value.find((operation) =>
                ['QUEUED', 'RUNNING'].includes(operation.status)
            );
            if (active && selectedGatewayOperationId.value !== active.id) {
                selectedGatewayOperationId.value = active.id;
            } else if (
                !selectedGatewayOperationId.value ||
                !gatewayReleaseOperations.value.some((operation) => operation.id === selectedGatewayOperationId.value)
            ) {
                selectedGatewayOperationId.value = gatewayReleaseOperations.value[0]?.id ?? '';
            }
            gatewayReleaseAvailable.value = true;
        } else {
            const profileResult = await adminClient.profiles.list.query();
            const operationResult = await adminClient.operations.list.query({
                profileName: props.profileName,
                limit: 100,
            });
            profiles.value = profileResult as Profile[];
            operations.value = operationResult as Operation[];
            selectedProfileName.value = props.profileName ?? profiles.value[0]?.profileName ?? '';
        }
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '운영 상태를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
        stateRequestInFlight = false;
    }
};

const scrollReleaseLogToEnd = async () => {
    await nextTick();
    const viewport = gatewayReleaseLogViewport.value;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
};

const pollGatewayReleaseLogs = async (operationId: string, generation: number) => {
    while (componentMounted && generation === releaseLogLoopGeneration && selectedGatewayOperationId.value === operationId) {
        try {
            const result = await adminClient.releases.logs.query({
                id: operationId,
                afterCursor: gatewayReleaseLogCursor.value,
                limit: 200,
                timeoutMs: 20_000,
            });
            if (generation !== releaseLogLoopGeneration || selectedGatewayOperationId.value !== operationId) return;
            gatewayReleaseLogConnection.value = 'connected';
            const entries = result.entries as GatewayReleaseLog[];
            if (entries.length) {
                const known = new Set(gatewayReleaseLogs.value.map((entry) => entry.cursor));
                gatewayReleaseLogs.value.push(...entries.filter((entry) => !known.has(entry.cursor)));
                gatewayReleaseLogs.value = gatewayReleaseLogs.value.slice(-1_000);
                gatewayReleaseLogCursor.value = result.nextCursor;
                await scrollReleaseLogToEnd();
            }
            const operation = result.operation as GatewayReleaseOperation;
            gatewayReleaseLogStatus.value = operation.status;
            const index = gatewayReleaseOperations.value.findIndex((entry) => entry.id === operation.id);
            if (index >= 0) gatewayReleaseOperations.value[index] = operation;
            if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.status)) return;
        } catch {
            if (generation !== releaseLogLoopGeneration || !componentMounted) return;
            gatewayReleaseLogConnection.value = 'reconnecting';
            await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        }
    }
};

const selectGatewayReleaseOperation = (operationId: string) => {
    if (selectedGatewayOperationId.value === operationId) {
        releaseLogLoopGeneration += 1;
        gatewayReleaseLogs.value = [];
        gatewayReleaseLogCursor.value = undefined;
        gatewayReleaseLogStatus.value = '';
        gatewayReleaseLogConnection.value = 'idle';
        void pollGatewayReleaseLogs(operationId, releaseLogLoopGeneration);
        return;
    }
    selectedGatewayOperationId.value = operationId;
};

const requestDeploy = async () => {
    clearStatus();
    if (!selectedProfile.value || activeOperation.value || !form.sourceRef.trim() || form.sourceMode === 'CURRENT') {
        return;
    }
    if (
        !window.confirm(
            `${selectedProfile.value.profileName}의 인게임 DB를 유지하고 ${form.sourceRef.trim()} 버전으로 배포하시겠습니까?`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        await adminClient.operations.requestDeploy.mutate({
            profileName: selectedProfile.value.profileName,
            sourceMode: form.sourceMode,
            sourceRef: form.sourceRef.trim(),
            reason: form.reason.trim() || undefined,
        });
        message.value = 'DB 보존 배포 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'DB 보존 배포 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const requestGatewayDeploy = async () => {
    clearStatus();
    if (!gatewayForm.sourceRef.trim()) return;
    if (!window.confirm(`Gateway 전체를 ${gatewayForm.sourceRef.trim()} 버전으로 전환하시겠습니까?`)) return;
    submitting.value = true;
    try {
        const operation = await adminClient.releases.requestGatewayDeploy.mutate({
            sourceMode: gatewayForm.sourceMode,
            sourceRef: gatewayForm.sourceRef.trim(),
            reason: gatewayForm.reason.trim() || undefined,
        });
        selectedGatewayOperationId.value = operation.id;
        message.value = 'Gateway 배포 작업을 등록했습니다. 외부 release-controller가 처리합니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Gateway 배포 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const requestGatewayRollback = async () => {
    clearStatus();
    if (!gatewayReleaseState.value?.previousCommitSha) return;
    if (
        !window.confirm(
            `Gateway를 이전 버전 ${shortSha(gatewayReleaseState.value.previousCommitSha)}로 되돌리시겠습니까?`
        )
    )
        return;
    submitting.value = true;
    try {
        const operation = await adminClient.releases.requestGatewayRollback.mutate({
            reason: gatewayForm.reason.trim() || undefined,
        });
        selectedGatewayOperationId.value = operation.id;
        message.value = 'Gateway rollback 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Gateway rollback 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const loadScenarios = async () => {
    clearStatus();
    if (form.sourceMode !== 'CURRENT' && !form.sourceRef.trim()) {
        errorMessage.value = '브랜치 또는 커밋을 입력해주세요.';
        return;
    }
    catalogLoading.value = true;
    try {
        const result = await adminClient.profiles.listScenarios.query({
            profileName: selectedProfileName.value,
            gitRef: form.sourceMode === 'CURRENT' ? undefined : form.sourceRef.trim(),
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
    if ((form.sourceMode !== 'CURRENT' && !form.sourceRef.trim()) || !form.scenarioId) {
        errorMessage.value = '초기화 소스와 시나리오를 먼저 선택해주세요.';
        return;
    }
    const sourceLabel =
        form.sourceMode === 'CURRENT' ? '현재 배포 버전' : form.sourceMode === 'BRANCH' ? '브랜치' : '커밋';
    if (
        !window.confirm(
            `${selectedProfile.value.profileName}의 게임 DB를 초기화합니다.\n${sourceLabel}${form.sourceMode === 'CURRENT' ? '' : `: ${form.sourceRef}`}\n시나리오: ${form.scenarioId}`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        await adminClient.operations.requestReset.mutate({
            profileName: selectedProfile.value.profileName,
            sourceMode: form.sourceMode,
            sourceRef: form.sourceMode === 'CURRENT' ? undefined : form.sourceRef.trim(),
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
        message.value = form.scheduledAt ? '예약 초기화 작업을 등록했습니다.' : '초기화 작업을 등록했습니다.';
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

watch(selectedGatewayOperationId, (operationId) => {
    releaseLogLoopGeneration += 1;
    gatewayReleaseLogs.value = [];
    gatewayReleaseLogCursor.value = undefined;
    gatewayReleaseLogStatus.value = '';
    gatewayReleaseLogConnection.value = operationId ? 'connected' : 'idle';
    if (operationId && componentMounted) void pollGatewayReleaseLogs(operationId, releaseLogLoopGeneration);
});

onMounted(async () => {
    componentMounted = true;
    await loadState();
    if (props.mode === 'scenario') await loadScenarios();
    pollTimer = setInterval(() => void loadState(true), 3000);
});

onBeforeUnmount(() => {
    componentMounted = false;
    releaseLogLoopGeneration += 1;
    if (pollTimer) {
        clearInterval(pollTimer);
    }
});
</script>

<template>
    <AdminConsoleLayout :title="pageTitle" :description="pageDescription" eyebrow="Release operations">
        <template #actions>
            <button
                class="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-50"
                :disabled="loading"
                data-testid="refresh-operations"
                @click="loadState()"
            >
                상태 새로고침
            </button>
        </template>

        <div class="space-y-6" data-testid="server-operations-page">
            <div v-if="errorMessage" class="rounded border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
                {{ errorMessage }}
            </div>
            <div
                v-if="message"
                class="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200"
            >
                {{ message }}
            </div>

            <nav v-if="mode !== 'gateway' && profileName" class="flex flex-wrap gap-2" aria-label="서버 관리 탭">
                <RouterLink
                    :to="`/admin/servers/${encodeURIComponent(profileName)}`"
                    class="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                    상태 · 설정
                </RouterLink>
                <RouterLink
                    v-if="hasCapability('admin.profiles.deploy')"
                    :to="`/admin/servers/${encodeURIComponent(profileName)}/version`"
                    class="rounded border border-blue-700 px-3 py-2 text-xs text-blue-200 hover:bg-blue-950"
                >
                    버전 업데이트
                </RouterLink>
                <RouterLink
                    v-if="hasCapability('admin.scenarios.reset')"
                    :to="`/admin/servers/${encodeURIComponent(profileName)}/scenario`"
                    class="rounded border border-purple-700 px-3 py-2 text-xs text-purple-200 hover:bg-purple-950"
                >
                    시나리오 초기화
                </RouterLink>
            </nav>

            <section v-if="mode !== 'gateway'" class="grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
                <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-4">
                    <div>
                        <label class="text-xs text-zinc-400" for="profile-select">운영 프로필</label>
                        <select
                            id="profile-select"
                            v-model="selectedProfileName"
                            class="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                            data-testid="profile-select"
                            :disabled="Boolean(profileName)"
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
                            <div class="text-xs text-zinc-500">Game frontend</div>
                            <div
                                :class="selectedProfile.runtime.frontendRunning ? 'text-emerald-400' : 'text-zinc-500'"
                            >
                                {{ selectedProfile.runtime.frontendRunning ? 'RUNNING' : 'STOPPED' }}
                            </div>
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
                            <div class="text-xs text-zinc-500">Battle sim worker</div>
                            <div
                                :class="selectedProfile.runtime.battleSimRunning ? 'text-emerald-400' : 'text-zinc-500'"
                            >
                                {{ selectedProfile.runtime.battleSimRunning ? 'RUNNING' : 'STOPPED' }}
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
                </div>

                <form
                    class="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-5"
                    @submit.prevent="mode === 'scenario' ? requestReset() : requestDeploy()"
                >
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold">
                            {{ mode === 'scenario' ? '시나리오 초기화' : 'DB 보존 버전 업데이트' }}
                        </h3>
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
                            <label v-if="mode === 'scenario'" class="flex items-center gap-2">
                                <input
                                    v-model="form.sourceMode"
                                    type="radio"
                                    value="CURRENT"
                                    data-testid="source-current"
                                />
                                현재 배포 버전
                            </label>
                            <label
                                v-if="mode === 'version' || hasCapability('admin.profiles.deploy')"
                                class="flex items-center gap-2"
                            >
                                <input
                                    v-model="form.sourceMode"
                                    type="radio"
                                    value="BRANCH"
                                    data-testid="source-branch"
                                />
                                {{ mode === 'scenario' ? '새 브랜치와 함께' : '브랜치' }}
                            </label>
                            <label
                                v-if="mode === 'version' || hasCapability('admin.profiles.deploy')"
                                class="flex items-center gap-2"
                            >
                                <input
                                    v-model="form.sourceMode"
                                    type="radio"
                                    value="COMMIT"
                                    data-testid="source-commit"
                                />
                                {{ mode === 'scenario' ? '새 커밋과 함께' : '커밋' }}
                            </label>
                        </div>
                        <p class="text-xs text-amber-200/80" data-testid="source-help">{{ sourceHelp }}</p>
                    </fieldset>

                    <div v-if="form.sourceMode !== 'CURRENT'" class="grid gap-3 md:grid-cols-[1fr_auto]">
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
                            v-if="mode === 'scenario'"
                            type="button"
                            class="rounded border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
                            :disabled="catalogLoading"
                            data-testid="load-scenarios"
                            @click="loadScenarios"
                        >
                            시나리오 확인
                        </button>
                    </div>

                    <div v-if="mode === 'scenario'" class="grid gap-4 md:grid-cols-2">
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

                    <details v-if="mode === 'scenario'" class="rounded border border-zinc-800 bg-zinc-950/50 p-4">
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

                    <div v-if="mode === 'scenario'" class="grid gap-4 md:grid-cols-3">
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
                    <div>
                        <button
                            v-if="mode === 'version'"
                            type="submit"
                            class="rounded bg-sky-700 px-4 py-3 font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
                            :disabled="submitting || Boolean(activeOperation) || !form.sourceRef.trim()"
                            data-testid="request-deploy"
                            @click="requestDeploy"
                        >
                            DB 유지 배포
                        </button>
                        <button
                            v-else
                            type="submit"
                            class="w-full rounded bg-amber-500 px-4 py-3 font-bold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                            :disabled="submitting || Boolean(activeOperation) || !form.scenarioId"
                            data-testid="request-reset"
                        >
                            {{ form.scheduledAt ? '시나리오 초기화 예약' : '시나리오 초기화' }}
                        </button>
                    </div>
                </form>
            </section>

            <section
                v-if="mode === 'gateway' && gatewayReleaseAvailable"
                class="rounded-lg border border-violet-800/70 bg-zinc-900 p-5 space-y-4"
                data-testid="gateway-release-panel"
            >
                <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 class="text-lg font-semibold">Gateway 릴리스</h3>
                        <p class="text-xs text-zinc-400">
                            외부 release-controller가 Gateway API·frontend·orchestrator를 전환합니다.
                        </p>
                    </div>
                    <div class="text-xs text-zinc-400">
                        현재
                        <span class="font-mono text-zinc-200">{{
                            shortSha(gatewayReleaseState?.activeCommitSha)
                        }}</span>
                        · 이전
                        <span class="font-mono text-zinc-200">{{
                            shortSha(gatewayReleaseState?.previousCommitSha)
                        }}</span>
                    </div>
                </div>
                <div class="grid gap-3 md:grid-cols-[auto_1fr_1fr]">
                    <select
                        v-model="gatewayForm.sourceMode"
                        class="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    >
                        <option value="BRANCH">브랜치</option>
                        <option value="COMMIT">커밋</option>
                    </select>
                    <input
                        v-model="gatewayForm.sourceRef"
                        class="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm"
                        placeholder="main 또는 full commit SHA"
                        data-testid="gateway-source-ref"
                    />
                    <input
                        v-model="gatewayForm.reason"
                        class="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                        placeholder="배포 사유"
                    />
                </div>
                <div class="grid gap-3 md:grid-cols-2">
                    <button
                        class="rounded bg-violet-700 px-4 py-2 font-semibold hover:bg-violet-600 disabled:opacity-40"
                        :disabled="
                            submitting ||
                            gatewayReleaseOperations.some((item) => ['QUEUED', 'RUNNING'].includes(item.status))
                        "
                        data-testid="request-gateway-deploy"
                        @click="requestGatewayDeploy"
                    >
                        Gateway 배포
                    </button>
                    <button
                        class="rounded border border-violet-700 px-4 py-2 font-semibold hover:bg-violet-950 disabled:opacity-40"
                        :disabled="
                            submitting ||
                            !gatewayReleaseState?.previousCommitSha ||
                            gatewayReleaseOperations.some((item) => ['QUEUED', 'RUNNING'].includes(item.status))
                        "
                        data-testid="request-gateway-rollback"
                        @click="requestGatewayRollback"
                    >
                        이전 Gateway로 rollback
                    </button>
                </div>
                <div v-if="gatewayReleaseState?.lastError" class="text-sm text-red-300">
                    {{ gatewayReleaseState.lastError }}
                </div>
                <section
                    v-if="selectedGatewayOperationId"
                    class="overflow-hidden rounded border border-zinc-700 bg-zinc-950"
                    data-testid="gateway-release-log-panel"
                    aria-live="polite"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
                        <div>
                            <h4 class="text-sm font-semibold text-zinc-100">실시간 릴리스 로그</h4>
                            <p class="mt-1 font-mono text-[11px] text-zinc-500">
                                {{ selectedGatewayOperationId }}
                            </p>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                            <span
                                class="h-2 w-2 rounded-full"
                                :class="
                                    gatewayReleaseLogConnection === 'reconnecting'
                                        ? 'animate-pulse bg-amber-400'
                                        : ['QUEUED', 'RUNNING'].includes(
                                                gatewayReleaseLogStatus || selectedGatewayOperation?.status || ''
                                            )
                                          ? 'animate-pulse bg-emerald-400'
                                          : 'bg-zinc-500'
                                "
                            ></span>
                            <span data-testid="gateway-release-log-status">
                                {{ gatewayReleaseLogStatus || selectedGatewayOperation?.status || '연결 중' }}
                                <template v-if="gatewayReleaseLogConnection === 'reconnecting'"> · 재연결 중</template>
                            </span>
                        </div>
                    </div>
                    <div
                        ref="gatewayReleaseLogViewport"
                        class="h-72 overflow-y-auto px-4 py-3 font-mono text-xs leading-5"
                        data-testid="gateway-release-log"
                    >
                        <div v-if="!gatewayReleaseLogs.length" class="text-zinc-500">
                            controller 로그를 기다리고 있습니다…
                        </div>
                        <div
                            v-for="entry in gatewayReleaseLogs"
                            :key="entry.cursor"
                            :class="entry.level === 'ERROR' ? 'text-red-300' : entry.level === 'OUTPUT' ? 'text-zinc-300' : 'text-cyan-300'"
                        >
                            <span class="text-zinc-600">{{ formatLogTime(entry.createdAt) }}</span>
                            <span class="ml-2 text-violet-300">[{{ entry.phase }}]</span>
                            <span class="ml-2 whitespace-pre-wrap break-all">{{ entry.message }}</span>
                        </div>
                    </div>
                </section>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[760px] text-left text-xs" data-testid="gateway-release-table">
                        <thead class="border-b border-zinc-700 text-zinc-500">
                            <tr>
                                <th class="p-2">시각</th>
                                <th class="p-2">작업</th>
                                <th class="p-2">상태</th>
                                <th class="p-2">소스</th>
                                <th class="p-2">해석 커밋</th>
                                <th class="p-2">오류</th>
                                <th class="p-2">로그</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="operation in gatewayReleaseOperations"
                                :key="operation.id"
                                class="border-b border-zinc-800"
                            >
                                <td class="p-2">{{ formatTime(operation.createdAt) }}</td>
                                <td class="p-2">{{ operation.type }}</td>
                                <td class="p-2">{{ operation.status }}</td>
                                <td class="p-2 font-mono">{{ operation.sourceRef }}</td>
                                <td class="p-2 font-mono">{{ shortSha(operation.resolvedCommitSha) }}</td>
                                <td class="max-w-xs p-2 text-red-300">{{ operation.error }}</td>
                                <td class="p-2">
                                    <button
                                        type="button"
                                        class="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                                        :class="operation.id === selectedGatewayOperationId ? 'border-violet-500 text-violet-200' : ''"
                                        @click="selectGatewayReleaseOperation(operation.id)"
                                    >
                                        보기
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section v-if="mode !== 'gateway'" class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="text-lg font-semibold">작업 이력</h3>
                    <span class="text-xs text-zinc-500">3초마다 상태 갱신</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[920px] text-left text-sm" data-testid="operations-table">
                        <thead class="border-b border-zinc-700 text-xs text-zinc-500">
                            <tr>
                                <th class="p-2">요청/예약</th>
                                <th class="p-2">작업 ID</th>
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
                                <td class="max-w-48 break-all p-2 font-mono text-xs">{{ operation.id }}</td>
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
                                    <div
                                        v-if="operation.error"
                                        class="mt-1"
                                        :class="operation.status === 'FAILED' ? 'text-red-400' : 'text-amber-300'"
                                    >
                                        {{ operation.error }}
                                    </div>
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
                                <td colspan="10" class="p-6 text-center text-zinc-500">작업 이력이 없습니다.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    </AdminConsoleLayout>
</template>
