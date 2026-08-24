<script setup lang="ts">
import { formatServerDateTime, serverDateTimeInputToIso } from '@sammo-ts/common/time/ServerDateTime';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import CompactHelp from '../components/CompactHelp.vue';
import ServerProfileTabs from '../components/ServerProfileTabs.vue';
import { useToast } from '../composables/useToast';
import { loadAdminProfileNavigation, type AdminProfileNavigationItem } from '../composables/useAdminProfileNavigation';
import AdminConsoleLayout from '../layouts/AdminConsoleLayout.vue';
import {
    normalizeProfileResetDefaults,
    PROFILE_TURN_TERM_MINUTES,
    RESET_AUTORUN_LABELS,
    RESET_OPTION_COPY,
    SYSTEM_PROFILE_RESET_DEFAULTS,
    type ProfileResetDefaults,
    type ResetAutorunOption,
} from '../utils/resetDefaults';
import { directTrpc, trpc } from '../utils/trpc';

type OperationPageMode = 'version' | 'scenario' | 'cancel' | 'gateway';

const props = defineProps<{
    mode: OperationPageMode;
    profileName?: string;
}>();

const adminClient = trpc.admin;
const scenarioClient = directTrpc.admin;

type Scenario = {
    id: number;
    title: string;
    year: number | null;
    npcCount: number;
    isCurrent: boolean;
};

type Operation = {
    id: string;
    profileName: string;
    type: 'RESET' | 'DEPLOY' | 'CANCEL_GAME' | 'START' | 'STOP';
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
const scenarios = ref<Scenario[]>([]);
const operations = ref<Operation[]>([]);
const selectedProfileOperationId = ref('');
const expandedProfileOperationId = ref('');
const profileOperationLogs = ref<GatewayReleaseLog[]>([]);
const profileOperationLogCursor = ref<string>();
const profileOperationLogStatus = ref('');
const profileOperationLogConnection = ref<'idle' | 'connected' | 'reconnecting'>('idle');
const profileOperationLogViewport = ref<HTMLElement>();
const gatewayReleaseState = ref<GatewayReleaseState | null>(null);
const gatewayReleaseOperations = ref<GatewayReleaseOperation[]>([]);
const selectedGatewayOperationId = ref('');
const expandedGatewayErrorOperationId = ref('');
const gatewayReleaseLogs = ref<GatewayReleaseLog[]>([]);
const gatewayReleaseLogCursor = ref<string>();
const gatewayReleaseLogStatus = ref('');
const gatewayReleaseLogConnection = ref<'idle' | 'connected' | 'reconnecting'>('idle');
const gatewayReleaseLogViewport = ref<HTMLElement>();
const gatewayReleaseAvailable = ref(false);
const selectedProfileName = computed(() => props.profileName ?? '');
const profileIdentities = ref<AdminProfileNavigationItem[]>([]);
const profileDisplayName = (profileName: string): string => {
    const profile = profileIdentities.value.find((candidate) => candidate.profileName === profileName);
    if (!profile) return '삭제되었거나 접근할 수 없는 서버';
    if (profile.displayName?.trim()) return profile.displayName.trim();
    const configuredName = profile.meta?.korName;
    const baseName =
        typeof configuredName === 'string' && configuredName.trim() ? configuredName.trim() : profile.profile;
    return profile.instanceKey === 'default' ? baseName : `${baseName} [${profile.instanceKey}]`;
};
const selectedProfileIdentityReady = computed(() =>
    profileIdentities.value.some((profile) => profile.profileName === selectedProfileName.value)
);
const selectedProfileDisplayName = computed(() => {
    if (!selectedProfileName.value) return '대상 서버';
    return selectedProfileIdentityReady.value ? profileDisplayName(selectedProfileName.value) : '대상 서버';
});
const cancellationConfirmation = computed(() => `${selectedProfileDisplayName.value} 게임 취소`);
const displayOperationText = (value?: string): string => {
    if (!value || !selectedProfileName.value) return value ?? '';
    return value.replaceAll(selectedProfileName.value, selectedProfileDisplayName.value);
};
const capabilities = ref<Array<{ permission: string; scopes?: string[] }>>([]);
const loading = ref(false);
const catalogLoading = ref(false);
const catalogAttempted = ref(false);
const submitting = ref(false);
const message = ref('');
const errorMessage = ref('');
const { success: showSuccessToast, error: showErrorToast } = useToast();

watch(message, (value) => value && showSuccessToast(value), { flush: 'sync' });
watch(errorMessage, (value) => value && showErrorToast(value), { flush: 'sync' });
const resetDefaultsSource = ref<'SYSTEM' | 'PROFILE'>('SYSTEM');
let pollTimer: ReturnType<typeof setInterval> | undefined;
let stateRequestInFlight = false;
let releaseLogLoopGeneration = 0;
let profileLogLoopGeneration = 0;
let componentMounted = false;
let gatewayReleaseTransitionActive = false;
const LOG_SCROLL_FOLLOW_THRESHOLD_PX = 40;

const isLogViewportNearEnd = (viewport?: HTMLElement): boolean => {
    if (!viewport) return true;
    return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= LOG_SCROLL_FOLLOW_THRESHOLD_PX;
};

const form = reactive({
    sourceMode: (props.mode === 'scenario' ? 'CURRENT' : 'BRANCH') as 'CURRENT' | 'BRANCH' | 'COMMIT',
    sourceRef: 'main',
    scenarioId: null as number | null,
    turnTermMinutes: SYSTEM_PROFILE_RESET_DEFAULTS.turnTermMinutes,
    sync: SYSTEM_PROFILE_RESET_DEFAULTS.sync,
    fiction: SYSTEM_PROFILE_RESET_DEFAULTS.fiction,
    extend: SYSTEM_PROFILE_RESET_DEFAULTS.extend,
    blockGeneralCreate: SYSTEM_PROFILE_RESET_DEFAULTS.blockGeneralCreate,
    npcMode: SYSTEM_PROFILE_RESET_DEFAULTS.npcMode,
    showImgLevel: SYSTEM_PROFILE_RESET_DEFAULTS.showImgLevel,
    tournamentTrig: SYSTEM_PROFILE_RESET_DEFAULTS.tournamentTrig,
    joinMode: SYSTEM_PROFILE_RESET_DEFAULTS.joinMode,
    autorunEnabled: false,
    autorunUserMinutes: 1440,
    autorunDevelop: true,
    autorunWarp: true,
    autorunRecruit: true,
    autorunRecruitHigh: true,
    autorunTrain: true,
    autorunBattle: true,
    autorunChief: true,
    openAt: '',
    preopenAt: '',
    scheduledAt: '',
    publishSchedule: false,
    reason: '',
});
const RESET_AUTORUN_FORM_KEYS = {
    develop: 'autorunDevelop',
    warp: 'autorunWarp',
    recruit: 'autorunRecruit',
    recruit_high: 'autorunRecruitHigh',
    train: 'autorunTrain',
    battle: 'autorunBattle',
    chief: 'autorunChief',
} as const satisfies Record<ResetAutorunOption, keyof typeof form>;
const RESET_SCHEDULE_COPY = {
    scheduledAt: {
        label: '초기화 시작',
        help: 'Gateway가 빌드, DB 초기화와 시나리오 생성을 시작합니다. 비우면 즉시 시작하며, 완료되어도 가오픈 전에는 접속을 차단합니다.',
    },
    preopenAt: {
        label: '가오픈 시작',
        help: '게임 접속과 장수 생성, 예약턴 입력을 허용하지만 턴은 진행하지 않습니다. 가오픈을 비우고 정식 오픈만 지정하면 초기화 완료 후 바로 가오픈합니다.',
    },
    openAt: {
        label: '정식 오픈',
        help: '턴 진행을 시작합니다. 비우면 초기화가 완료되는 즉시 정식 오픈합니다.',
    },
} as const;
const gatewayForm = reactive({
    sourceMode: 'BRANCH' as 'BRANCH' | 'COMMIT',
    sourceRef: 'main',
    reason: '',
});
const cancellationForm = reactive({
    historyMode: 'RETAIN_ABANDONED' as 'RETAIN_ABANDONED' | 'DELETE',
    generalMode: 'RETAIN' as 'RETAIN' | 'DELETE',
    earnedPointRetentionPercent: 0,
    reason: '',
    confirmation: '',
});

const selectedGatewayOperation = computed(
    () => gatewayReleaseOperations.value.find((operation) => operation.id === selectedGatewayOperationId.value) ?? null
);
const selectedProfileOperation = computed(
    () => operations.value.find((operation) => operation.id === selectedProfileOperationId.value) ?? null
);
const profileOperationLogEmptyMessage = computed(() => {
    const operation = selectedProfileOperation.value;
    const status = profileOperationLogStatus.value || operation?.status;
    if (!operation || !status || ['QUEUED', 'RUNNING'].includes(status)) {
        return '오케스트레이터 로그를 기다리고 있습니다…';
    }
    if (operation.error) {
        return `이 작업에는 진행 로그가 기록되지 않았습니다. 작업 오류: ${displayOperationText(operation.error)}`;
    }
    return '이 작업에는 진행 로그가 기록되지 않았습니다. 로그 기능 적용 전 작업일 수 있습니다.';
});
const gatewayReleaseLogEmptyMessage = computed(() => {
    const operation = selectedGatewayOperation.value;
    const status = gatewayReleaseLogStatus.value || operation?.status;
    if (!operation || !status || ['QUEUED', 'RUNNING'].includes(status)) {
        return 'controller 로그를 기다리고 있습니다…';
    }
    if (operation.error) {
        return '이 작업에는 controller 로그가 기록되지 않았습니다. 작업 이력의 오류 상세를 확인하세요.';
    }
    return '이 작업에는 controller 로그가 기록되지 않았습니다. 로그 지원 controller 적용 전 작업일 수 있습니다.';
});
const hasCapability = (permission: string): boolean =>
    capabilities.value.some((entry) => {
        if (entry.permission !== permission) return false;
        if (!props.profileName) return true;
        return !entry.scopes?.length || entry.scopes.includes('*') || entry.scopes.includes(props.profileName);
    });

const pageTitle = computed(() => {
    if (props.mode === 'gateway') return 'Gateway 릴리스';
    if (props.mode === 'cancel') return `${selectedProfileDisplayName.value} 게임 취소`;
    if (props.mode === 'scenario') return `${selectedProfileDisplayName.value} 시나리오 초기화`;
    return `${selectedProfileDisplayName.value} 버전 업데이트`;
});

const pageDescription = computed(() => {
    if (props.mode === 'gateway') return 'Gateway control plane 배포와 rollback을 별도 권한으로 관리합니다.';
    if (props.mode === 'cancel') {
        return '진행 중 게임을 닫고 정식 기수에서 제외하며 장수 기록과 유산 포인트 보전 범위를 선택합니다.';
    }
    if (props.mode === 'scenario') {
        return '서버에 지정된 브랜치의 최신 버전 또는 고정 커밋으로 시나리오를 초기화합니다.';
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
        ? '서버가 브랜치를 추적하면 작업 시작 시 최신 커밋을 사용하고, 커밋 고정 상태면 그 버전을 유지합니다.'
        : form.sourceMode === 'BRANCH'
          ? '작업이 실제로 시작될 때 원격 브랜치를 다시 fetch하여 최신 커밋을 사용합니다.'
          : '요청 시 커밋을 전체 SHA로 고정하므로 이후 브랜치가 이동해도 결과가 바뀌지 않습니다.'
);

const toIso = (value: string): string | undefined => {
    return serverDateTimeInputToIso(value);
};

const formatTime = (value?: string): string => formatServerDateTime(value, { fallback: '-' });
const formatLogTime = (value: string): string => formatServerDateTime(value, { format: 'timeSeconds' });
const shortSha = (value?: string): string => (value ? value.slice(0, 12) : '-');

const operationTypeLabel = (type: Operation['type']): string => {
    const labels: Record<Operation['type'], string> = {
        DEPLOY: '버전 업데이트',
        RESET: '시나리오 초기화',
        CANCEL_GAME: '게임 취소',
        START: '서버 시작',
        STOP: '서버 중지',
    };
    return labels[type];
};

const operationStatusLabel = (status: Operation['status']): string => {
    const labels: Record<Operation['status'], string> = {
        QUEUED: '대기 중',
        RUNNING: '진행 중',
        SUCCEEDED: '완료',
        FAILED: '실패',
        CANCELLED: '중단됨',
    };
    return labels[status];
};

const operationStatusClass = (status: Operation['status']): string => {
    if (status === 'RUNNING') return 'border-emerald-700 bg-emerald-950/70 text-emerald-200';
    if (status === 'QUEUED') return 'border-amber-700 bg-amber-950/70 text-amber-200';
    if (status === 'SUCCEEDED') return 'border-cyan-800 bg-cyan-950/60 text-cyan-200';
    if (status === 'FAILED') return 'border-red-800 bg-red-950/70 text-red-200';
    return 'border-zinc-700 bg-zinc-800 text-zinc-300';
};

const toggleProfileOperationDetails = (operationId: string) => {
    expandedProfileOperationId.value = expandedProfileOperationId.value === operationId ? '' : operationId;
};

const clearStatus = () => {
    message.value = '';
    errorMessage.value = '';
};

const applyResetDefaults = (defaults: ProfileResetDefaults) => {
    form.turnTermMinutes = defaults.turnTermMinutes;
    form.sync = defaults.sync;
    form.fiction = defaults.fiction;
    form.extend = defaults.extend;
    form.blockGeneralCreate = defaults.blockGeneralCreate;
    form.npcMode = defaults.npcMode;
    form.showImgLevel = defaults.showImgLevel;
    form.tournamentTrig = defaults.tournamentTrig;
    form.joinMode = defaults.joinMode;
    form.autorunEnabled = defaults.autorunUser !== null;
    form.autorunUserMinutes = defaults.autorunUser?.limitMinutes ?? 1440;
    const autorunOptions = new Set(defaults.autorunUser?.options ?? []);
    form.autorunDevelop = autorunOptions.has('develop');
    form.autorunWarp = autorunOptions.has('warp');
    form.autorunRecruit = autorunOptions.has('recruit');
    form.autorunRecruitHigh = autorunOptions.has('recruit_high');
    form.autorunTrain = autorunOptions.has('train');
    form.autorunBattle = autorunOptions.has('battle');
    form.autorunChief = autorunOptions.has('chief');
};

const loadResetDefaults = async () => {
    if (props.mode !== 'scenario' || !selectedProfileName.value) return;
    try {
        const result = await adminClient.profiles.getResetDefaults.query({
            profileName: selectedProfileName.value,
        });
        applyResetDefaults(normalizeProfileResetDefaults(result.defaults));
        resetDefaultsSource.value = result.source;
    } catch {
        applyResetDefaults(SYSTEM_PROFILE_RESET_DEFAULTS);
        resetDefaultsSource.value = 'SYSTEM';
    }
};

const loadProfileIdentities = async () => {
    if (props.mode === 'gateway') return;
    try {
        profileIdentities.value = await loadAdminProfileNavigation();
    } catch {
        profileIdentities.value = [];
    }
};

const loadCapabilities = async () => {
    try {
        capabilities.value = (await adminClient.capabilities.list.query()) as typeof capabilities.value;
    } catch (error) {
        capabilities.value = [];
        errorMessage.value = error instanceof Error ? error.message : '관리 권한을 불러오지 못했습니다.';
    }
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
        if (props.mode === 'gateway') {
            const [state, releaseOperations] = await Promise.all([
                adminClient.releases.gatewayState.query(),
                adminClient.releases.list.query({ limit: 30 }),
            ]);
            gatewayReleaseState.value = state as GatewayReleaseState;
            gatewayReleaseOperations.value = releaseOperations as GatewayReleaseOperation[];
            const active = gatewayReleaseOperations.value.find((operation) =>
                ['QUEUED', 'RUNNING'].includes(operation.status)
            );
            gatewayReleaseTransitionActive = Boolean(active);
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
            const operationResult = await adminClient.operations.list.query({
                profileName: props.profileName,
                limit: 100,
            });
            operations.value = operationResult as Operation[];
            const active = operations.value.find((operation) => ['QUEUED', 'RUNNING'].includes(operation.status));
            if (active && selectedProfileOperationId.value !== active.id) {
                selectedProfileOperationId.value = active.id;
            } else if (
                !selectedProfileOperationId.value ||
                !operations.value.some((operation) => operation.id === selectedProfileOperationId.value)
            ) {
                selectedProfileOperationId.value = operations.value[0]?.id ?? '';
            }
        }
    } catch (error) {
        // Gateway release가 process를 교체하는 동안에는 background poll의 HTTP 연결이
        // 일시적으로 끊길 수 있다. 이 경우는 기존 상태를 유지하고 다음 poll에서 복구한다.
        if (!quiet || props.mode !== 'gateway' || !gatewayReleaseTransitionActive) {
            errorMessage.value = error instanceof Error ? error.message : '운영 상태를 불러오지 못했습니다.';
        }
    } finally {
        loading.value = false;
        stateRequestInFlight = false;
    }
};

const scrollProfileOperationLogToEnd = async (shouldFollow: boolean) => {
    await nextTick();
    const viewport = profileOperationLogViewport.value;
    if (viewport && shouldFollow) viewport.scrollTop = viewport.scrollHeight;
};

const pollProfileOperationLogs = async (operationId: string, generation: number) => {
    while (
        componentMounted &&
        generation === profileLogLoopGeneration &&
        selectedProfileOperationId.value === operationId
    ) {
        try {
            const result = await adminClient.operations.logs.query({
                id: operationId,
                afterCursor: profileOperationLogCursor.value,
                limit: 200,
                timeoutMs: 20_000,
            });
            if (generation !== profileLogLoopGeneration || selectedProfileOperationId.value !== operationId) return;
            profileOperationLogConnection.value = 'connected';
            const entries = result.entries as GatewayReleaseLog[];
            if (entries.length) {
                const shouldFollow = isLogViewportNearEnd(profileOperationLogViewport.value);
                const known = new Set(profileOperationLogs.value.map((entry) => entry.cursor));
                profileOperationLogs.value.push(...entries.filter((entry) => !known.has(entry.cursor)));
                profileOperationLogs.value = profileOperationLogs.value.slice(-1_000);
                profileOperationLogCursor.value = result.nextCursor;
                await scrollProfileOperationLogToEnd(shouldFollow);
            }
            const operation = result.operation as Operation;
            profileOperationLogStatus.value = operation.status;
            const index = operations.value.findIndex((entry) => entry.id === operation.id);
            if (index >= 0) operations.value[index] = operation;
            if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.status)) return;
        } catch {
            if (generation !== profileLogLoopGeneration || !componentMounted) return;
            profileOperationLogConnection.value = 'reconnecting';
            await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        }
    }
};

const selectProfileOperation = (operationId: string) => {
    if (selectedProfileOperationId.value === operationId) {
        profileLogLoopGeneration += 1;
        profileOperationLogs.value = [];
        profileOperationLogCursor.value = undefined;
        profileOperationLogStatus.value = '';
        profileOperationLogConnection.value = 'idle';
        void pollProfileOperationLogs(operationId, profileLogLoopGeneration);
        return;
    }
    selectedProfileOperationId.value = operationId;
};

const scrollReleaseLogToEnd = async (shouldFollow: boolean) => {
    await nextTick();
    const viewport = gatewayReleaseLogViewport.value;
    if (viewport && shouldFollow) viewport.scrollTop = viewport.scrollHeight;
};

const pollGatewayReleaseLogs = async (operationId: string, generation: number) => {
    while (
        componentMounted &&
        generation === releaseLogLoopGeneration &&
        selectedGatewayOperationId.value === operationId
    ) {
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
                const shouldFollow = isLogViewportNearEnd(gatewayReleaseLogViewport.value);
                const known = new Set(gatewayReleaseLogs.value.map((entry) => entry.cursor));
                gatewayReleaseLogs.value.push(...entries.filter((entry) => !known.has(entry.cursor)));
                gatewayReleaseLogs.value = gatewayReleaseLogs.value.slice(-1_000);
                gatewayReleaseLogCursor.value = result.nextCursor;
                await scrollReleaseLogToEnd(shouldFollow);
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

const toggleGatewayReleaseError = (operationId: string) => {
    expandedGatewayErrorOperationId.value = expandedGatewayErrorOperationId.value === operationId ? '' : operationId;
};

const requestDeploy = async () => {
    clearStatus();
    if (
        !selectedProfileName.value ||
        !selectedProfileIdentityReady.value ||
        activeOperation.value ||
        !form.sourceRef.trim() ||
        form.sourceMode === 'CURRENT'
    ) {
        return;
    }
    if (
        !window.confirm(
            `${selectedProfileDisplayName.value}의 인게임 DB를 유지하고 ${form.sourceRef.trim()} 버전으로 배포하시겠습니까?`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        const operation = await adminClient.operations.requestDeploy.mutate({
            profileName: selectedProfileName.value,
            sourceMode: form.sourceMode,
            sourceRef: form.sourceRef.trim(),
            reason: form.reason.trim() || undefined,
        });
        selectedProfileOperationId.value = operation.id;
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
        gatewayReleaseTransitionActive = true;
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
        gatewayReleaseTransitionActive = true;
        selectedGatewayOperationId.value = operation.id;
        message.value = 'Gateway rollback 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Gateway rollback 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const cancelGatewayRelease = async (operation: GatewayReleaseOperation) => {
    clearStatus();
    const prompt =
        operation.status === 'RUNNING'
            ? '실행 중인 Gateway 빌드를 중단하시겠습니까? process 전환 또는 migration이 시작된 뒤에는 중단할 수 없습니다.'
            : '대기 중인 Gateway 릴리스를 취소하시겠습니까?';
    if (!window.confirm(prompt)) return;
    try {
        await adminClient.releases.cancel.mutate({ id: operation.id });
        selectedGatewayOperationId.value = operation.id;
        message.value =
            operation.status === 'RUNNING' ? 'Gateway 빌드를 중단했습니다.' : 'Gateway 릴리스를 취소했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Gateway 릴리스 중단에 실패했습니다.';
    }
};

const retryGatewayRelease = async (operation: GatewayReleaseOperation) => {
    clearStatus();
    if (!window.confirm('같은 고정 커밋으로 Gateway 릴리스를 다시 실행하시겠습니까?')) return;
    try {
        const retried = await adminClient.releases.retry.mutate({ id: operation.id });
        selectedGatewayOperationId.value = retried.id;
        message.value = 'Gateway 릴리스 재시도 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Gateway 릴리스 재시도에 실패했습니다.';
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
        const result = await scenarioClient.profiles.listScenarios.query({
            profileName: selectedProfileName.value,
            gitRef: form.sourceMode === 'CURRENT' ? undefined : form.sourceRef.trim(),
            sourceMode: form.sourceMode,
        });
        scenarios.value = result as Scenario[];
        if (!scenarios.value.some((scenario) => scenario.id === form.scenarioId)) {
            form.scenarioId =
                scenarios.value.find((scenario) => scenario.isCurrent)?.id ?? scenarios.value[0]?.id ?? null;
        }
        message.value = `${scenarios.value.length}개 시나리오를 확인했습니다.`;
    } catch (error) {
        scenarios.value = [];
        errorMessage.value = error instanceof Error ? error.message : '소스에서 시나리오를 읽지 못했습니다.';
    } finally {
        catalogAttempted.value = true;
        catalogLoading.value = false;
    }
};

const selectedAutorunOptions = (): ResetAutorunOption[] => {
    const options: ResetAutorunOption[] = [];
    if (form.autorunDevelop) options.push('develop');
    if (form.autorunWarp) options.push('warp');
    if (form.autorunRecruit) options.push('recruit');
    if (form.autorunRecruitHigh) options.push('recruit_high');
    if (form.autorunTrain) options.push('train');
    if (form.autorunBattle) options.push('battle');
    if (form.autorunChief) options.push('chief');
    return options;
};

const requestReset = async () => {
    clearStatus();
    if (!selectedProfileName.value || !selectedProfileIdentityReady.value || activeOperation.value) {
        return;
    }
    if ((form.sourceMode !== 'CURRENT' && !form.sourceRef.trim()) || form.scenarioId === null) {
        errorMessage.value = '초기화 소스와 시나리오를 먼저 선택해주세요.';
        return;
    }
    if (form.publishSchedule && (!form.scheduledAt || !form.preopenAt || !form.openAt)) {
        errorMessage.value = '로비 일정 공개에는 초기화 시작, 가오픈 시작과 정식 오픈을 모두 입력해주세요.';
        return;
    }
    const scenarioId = form.scenarioId;
    const sourceLabel =
        form.sourceMode === 'CURRENT' ? '서버 지정 버전' : form.sourceMode === 'BRANCH' ? '브랜치' : '커밋';
    if (
        !window.confirm(
            `${selectedProfileDisplayName.value}의 게임 DB를 초기화합니다.\n${sourceLabel}${form.sourceMode === 'CURRENT' ? '' : `: ${form.sourceRef}`}\n시나리오: ${scenarioId}${form.publishSchedule ? '\n예약 등록 즉시 로비에 오픈 일정을 공개합니다.' : ''}`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        const operation = await adminClient.operations.requestReset.mutate({
            profileName: selectedProfileName.value,
            sourceMode: form.sourceMode,
            sourceRef: form.sourceMode === 'CURRENT' ? undefined : form.sourceRef.trim(),
            scheduledAt: toIso(form.scheduledAt),
            publishSchedule: form.publishSchedule,
            reason: form.reason.trim() || undefined,
            install: {
                scenarioId,
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
        selectedProfileOperationId.value = operation.id;
        message.value = form.scheduledAt ? '예약 초기화 작업을 등록했습니다.' : '초기화 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '초기화 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const requestGameCancellation = async () => {
    clearStatus();
    const profileName = selectedProfileName.value;
    if (!profileName || !selectedProfileIdentityReady.value || activeOperation.value) return;
    if (cancellationForm.reason.trim().length < 5) {
        errorMessage.value = '취소 사유를 5자 이상 입력해주세요.';
        return;
    }
    if (cancellationForm.confirmation.trim() !== cancellationConfirmation.value) {
        errorMessage.value = `확인란에 ${cancellationConfirmation.value}를 정확히 입력해주세요.`;
        return;
    }
    const historyText =
        cancellationForm.historyMode === 'RETAIN_ABANDONED' ? '취소 게임으로 보존' : '기수 행 물리 삭제';
    const generalText = cancellationForm.generalMode === 'RETAIN' ? '장수 기록 보존' : '장수 기록 삭제';
    if (
        !window.confirm(
            `${selectedProfileDisplayName.value}의 진행 중 게임을 취소합니다.\n${historyText}\n${generalText}\n유산 획득분 ${cancellationForm.earnedPointRetentionPercent}% 보전\n취소 후 시나리오 초기화 전에는 재개할 수 없습니다.`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        const operation = await adminClient.operations.requestGameCancellation.mutate({
            profileName,
            historyMode: cancellationForm.historyMode,
            generalMode: cancellationForm.generalMode,
            earnedPointRetentionPercent: cancellationForm.earnedPointRetentionPercent,
            reason: cancellationForm.reason.trim(),
        });
        selectedProfileOperationId.value = operation.id;
        cancellationForm.confirmation = '';
        message.value = '게임 취소 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '게임 취소 요청에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const cancelOperation = async (operation: Operation) => {
    clearStatus();
    const prompt =
        operation.status === 'RUNNING'
            ? '실행 중인 프로필 빌드를 중단하시겠습니까? 기존 runtime과 게임 DB는 유지됩니다.'
            : '대기 중인 작업을 취소하시겠습니까?';
    if (!window.confirm(prompt)) {
        return;
    }
    try {
        await adminClient.operations.cancel.mutate({ id: operation.id });
        selectedProfileOperationId.value = operation.id;
        message.value = operation.status === 'RUNNING' ? '프로필 빌드를 중단했습니다.' : '작업을 취소했습니다.';
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
        const retried = await adminClient.operations.retry.mutate({ id: operation.id });
        selectedProfileOperationId.value = retried.id;
        message.value = '재시도 작업을 등록했습니다.';
        await loadState(true);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '작업 재시도에 실패했습니다.';
    }
};

watch(selectedProfileOperationId, (operationId) => {
    profileLogLoopGeneration += 1;
    profileOperationLogs.value = [];
    profileOperationLogCursor.value = undefined;
    profileOperationLogStatus.value = '';
    profileOperationLogConnection.value = operationId ? 'connected' : 'idle';
    if (operationId && componentMounted) void pollProfileOperationLogs(operationId, profileLogLoopGeneration);
});

watch(selectedGatewayOperationId, (operationId) => {
    releaseLogLoopGeneration += 1;
    gatewayReleaseLogs.value = [];
    gatewayReleaseLogCursor.value = undefined;
    gatewayReleaseLogStatus.value = '';
    gatewayReleaseLogConnection.value = operationId ? 'connected' : 'idle';
    if (operationId && componentMounted) void pollGatewayReleaseLogs(operationId, releaseLogLoopGeneration);
});

watch(
    () => form.sourceMode,
    (sourceMode) => {
        scenarios.value = [];
        form.scenarioId = null;
        catalogAttempted.value = false;
        if (sourceMode === 'CURRENT' && componentMounted) {
            void loadScenarios();
        }
    }
);

onMounted(async () => {
    componentMounted = true;
    await Promise.all([
        loadCapabilities(),
        loadProfileIdentities(),
        loadState(),
        loadResetDefaults(),
        props.mode === 'scenario' ? loadScenarios() : Promise.resolve(),
    ]);
    pollTimer = setInterval(() => void loadState(true), 3000);
});

onBeforeUnmount(() => {
    componentMounted = false;
    profileLogLoopGeneration += 1;
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
            <ServerProfileTabs
                v-if="mode !== 'gateway' && profileName"
                :profile-name="profileName"
                :profile-label="selectedProfileDisplayName"
                :active-tab="mode === 'scenario' ? 'scenario' : mode === 'cancel' ? 'cancel' : 'version'"
                :can-deploy="hasCapability('admin.profiles.deploy')"
                :can-reset="hasCapability('admin.scenarios.reset')"
                :can-cancel="hasCapability('admin.games.cancel')"
            />

            <div v-if="errorMessage" class="rounded border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
                {{ errorMessage }}
            </div>
            <div
                v-if="message"
                class="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200"
            >
                {{ message }}
            </div>

            <section v-if="mode === 'cancel'">
                <form
                    class="space-y-5 rounded-lg border border-red-900/80 bg-zinc-900 p-5"
                    data-testid="game-cancellation-form"
                    @submit.prevent="requestGameCancellation"
                >
                    <div class="rounded border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-100">
                        이 작업은 게임을 즉시 닫고 profile을 <strong>CANCELLED</strong> 상태로 만듭니다. 버전
                        rollback이나 단순 서버 정지가 아니며, 다시 열려면 새 시나리오 초기화가 필요합니다.
                    </div>
                    <fieldset class="grid gap-4 md:grid-cols-2">
                        <label class="text-sm text-zinc-300">
                            기수 데이터
                            <select
                                v-model="cancellationForm.historyMode"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
                                data-testid="cancellation-history-mode"
                            >
                                <option value="RETAIN_ABANDONED">취소 게임으로 DB에 보존</option>
                                <option value="DELETE">기수 행 물리 삭제</option>
                            </select>
                        </label>
                        <label class="text-sm text-zinc-300">
                            플레이 장수 기록
                            <select
                                v-model="cancellationForm.generalMode"
                                class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
                                data-testid="cancellation-general-mode"
                            >
                                <option value="RETAIN">내 지난 플레이에 취소 게임 기록 보존</option>
                                <option value="DELETE">장수 과거 기록 삭제</option>
                            </select>
                        </label>
                    </fieldset>
                    <label class="block text-sm text-zinc-300">
                        당기 획득 유산 포인트 보전율
                        <div class="mt-1 flex items-center gap-3">
                            <input
                                v-model.number="cancellationForm.earnedPointRetentionPercent"
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                class="w-full"
                                data-testid="cancellation-retention-range"
                            />
                            <input
                                v-model.number="cancellationForm.earnedPointRetentionPercent"
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                class="w-24 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-right"
                                data-testid="cancellation-retention-percent"
                            />
                            <span>%</span>
                        </div>
                        <span class="mt-1 block text-xs text-zinc-500">
                            개장 시 보유 원금은 사용 여부와 관계없이 전액 복구되고, 이 비율은 이번 게임에서 획득한
                            몫에만 적용됩니다.
                        </span>
                    </label>
                    <label class="block text-sm text-zinc-300">
                        취소 사유
                        <textarea
                            v-model="cancellationForm.reason"
                            rows="3"
                            maxlength="500"
                            class="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
                            placeholder="잘못된 기수/시나리오 설정 등 감사 기록에 남길 사유"
                            data-testid="cancellation-reason"
                        ></textarea>
                    </label>
                    <label class="block text-sm text-zinc-300">
                        확인을 위해 <strong>{{ cancellationConfirmation }}</strong> 입력
                        <input
                            v-model="cancellationForm.confirmation"
                            class="mt-1 w-full rounded border border-red-800 bg-zinc-950 px-3 py-2 font-mono"
                            :placeholder="cancellationConfirmation"
                            data-testid="cancellation-confirmation"
                        />
                    </label>
                    <button
                        type="submit"
                        class="w-full rounded bg-red-700 px-4 py-3 font-bold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="
                            submitting ||
                            !selectedProfileIdentityReady ||
                            Boolean(activeOperation) ||
                            cancellationForm.reason.trim().length < 5 ||
                            cancellationForm.confirmation.trim() !== cancellationConfirmation
                        "
                        data-testid="request-game-cancellation"
                    >
                        진행 게임 취소
                    </button>
                </form>
            </section>

            <section v-if="mode !== 'gateway' && mode !== 'cancel'">
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
                                서버 지정 버전
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

                    <div
                        v-if="form.sourceMode !== 'CURRENT' || mode === 'scenario'"
                        class="grid gap-3 md:grid-cols-[1fr_auto]"
                    >
                        <input
                            v-if="form.sourceMode !== 'CURRENT'"
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
                            {{ catalogLoading ? '확인 중…' : catalogAttempted ? '시나리오 재확인' : '시나리오 확인' }}
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
                                <option v-if="catalogLoading" :value="null" disabled>
                                    시나리오를 불러오는 중입니다…
                                </option>
                                <option v-else-if="scenarios.length === 0" :value="null" disabled>
                                    선택할 수 있는 시나리오가 없습니다.
                                </option>
                                <option v-for="scenario in scenarios" :key="scenario.id" :value="scenario.id">
                                    {{ scenario.id }} · {{ scenario.title }} (NPC {{ scenario.npcCount }})
                                    {{ scenario.isCurrent ? '· 현재 시나리오' : '' }}
                                </option>
                            </select>
                        </label>
                        <div class="space-y-1 text-xs text-zinc-400">
                            <div class="flex items-center gap-1.5">
                                <label for="reset-turn-term">{{ RESET_OPTION_COPY.turnTerm.label }}</label>
                                <CompactHelp
                                    :label="RESET_OPTION_COPY.turnTerm.label"
                                    :text="RESET_OPTION_COPY.turnTerm.help"
                                    test-id="reset-help-turn-term"
                                />
                            </div>
                            <select
                                id="reset-turn-term"
                                v-model.number="form.turnTermMinutes"
                                class="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                                data-testid="reset-turn-term"
                            >
                                <option v-for="minutes in PROFILE_TURN_TERM_MINUTES" :key="minutes" :value="minutes">
                                    {{ minutes }}분
                                </option>
                            </select>
                        </div>
                    </div>

                    <details v-if="mode === 'scenario'" class="rounded border border-zinc-800 bg-zinc-950/50 p-4">
                        <summary class="cursor-pointer text-sm font-semibold">고급 시나리오 옵션</summary>
                        <p class="mt-2 text-xs text-zinc-500" data-testid="reset-defaults-source">
                            {{
                                resetDefaultsSource === 'PROFILE'
                                    ? '이 서버의 메타에 저장된 기본값을 적용했습니다.'
                                    : '서버별 기본값이 없어 시스템 기본값을 적용했습니다.'
                            }}
                        </p>
                        <div class="mt-4 grid gap-4 text-sm md:grid-cols-2">
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-sync">{{ RESET_OPTION_COPY.sync.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.sync.label"
                                        :text="RESET_OPTION_COPY.sync.help"
                                        test-id="reset-help-sync"
                                    />
                                </div>
                                <select
                                    id="reset-sync"
                                    v-model="form.sync"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                >
                                    <option :value="true">사용</option>
                                    <option :value="false">미사용</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-fiction">{{ RESET_OPTION_COPY.fiction.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.fiction.label"
                                        :text="RESET_OPTION_COPY.fiction.help"
                                        test-id="reset-help-fiction"
                                    />
                                </div>
                                <select
                                    id="reset-fiction"
                                    v-model.number="form.fiction"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-fiction"
                                >
                                    <option :value="0">연의</option>
                                    <option :value="1">가상</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-extend">{{ RESET_OPTION_COPY.extend.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.extend.label"
                                        :text="RESET_OPTION_COPY.extend.help"
                                        test-id="reset-help-extend"
                                    />
                                </div>
                                <select
                                    id="reset-extend"
                                    v-model="form.extend"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-extend"
                                >
                                    <option :value="true">포함</option>
                                    <option :value="false">미포함</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-block-general-create">
                                        {{ RESET_OPTION_COPY.blockGeneralCreate.label }}
                                    </label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.blockGeneralCreate.label"
                                        :text="RESET_OPTION_COPY.blockGeneralCreate.help"
                                        test-id="reset-help-block-general-create"
                                    />
                                </div>
                                <select
                                    id="reset-block-general-create"
                                    v-model.number="form.blockGeneralCreate"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-block-general-create"
                                >
                                    <option :value="0">가능</option>
                                    <option :value="2">장수명 무작위</option>
                                    <option :value="1">불가</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-npc-mode">{{ RESET_OPTION_COPY.npcMode.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.npcMode.label"
                                        :text="RESET_OPTION_COPY.npcMode.help"
                                        test-id="reset-help-npc-mode"
                                    />
                                </div>
                                <select
                                    id="reset-npc-mode"
                                    v-model.number="form.npcMode"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-npc-mode"
                                >
                                    <option :value="0">불가</option>
                                    <option :value="1">가능</option>
                                    <option :value="2">선택 생성 가능</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-autorun-enabled">{{ RESET_OPTION_COPY.autorun.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.autorun.label"
                                        :text="RESET_OPTION_COPY.autorun.help"
                                        test-id="reset-help-autorun"
                                    />
                                </div>
                                <select
                                    id="reset-autorun-enabled"
                                    v-model="form.autorunEnabled"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-autorun-enabled"
                                >
                                    <option :value="false">꺼짐</option>
                                    <option :value="true">사용</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-join-mode">{{ RESET_OPTION_COPY.joinMode.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.joinMode.label"
                                        :text="RESET_OPTION_COPY.joinMode.help"
                                        test-id="reset-help-join-mode"
                                    />
                                </div>
                                <select
                                    id="reset-join-mode"
                                    v-model="form.joinMode"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-join-mode"
                                >
                                    <option value="full">일반</option>
                                    <option value="onlyRandom">랜덤 임관</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-show-img-level">{{ RESET_OPTION_COPY.showImgLevel.label }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.showImgLevel.label"
                                        :text="RESET_OPTION_COPY.showImgLevel.help"
                                        test-id="reset-help-show-img-level"
                                    />
                                </div>
                                <select
                                    id="reset-show-img-level"
                                    v-model.number="form.showImgLevel"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-show-img-level"
                                >
                                    <option :value="0">안함</option>
                                    <option :value="1">전콘</option>
                                    <option :value="2">전콘, 병종</option>
                                    <option :value="3">전콘, 병종, NPC</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-tournament-trig">
                                        {{ RESET_OPTION_COPY.tournamentTrig.label }}
                                    </label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.tournamentTrig.label"
                                        :text="RESET_OPTION_COPY.tournamentTrig.help"
                                        test-id="reset-help-tournament-trig"
                                    />
                                </div>
                                <select
                                    id="reset-tournament-trig"
                                    v-model="form.tournamentTrig"
                                    class="w-full rounded bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-tournament-trig"
                                >
                                    <option :value="false">수동</option>
                                    <option :value="true">자동</option>
                                </select>
                            </div>
                            <div v-if="form.autorunEnabled" class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    <label for="reset-autorun-minutes">{{
                                        RESET_OPTION_COPY.autorunLimit.label
                                    }}</label>
                                    <CompactHelp
                                        :label="RESET_OPTION_COPY.autorunLimit.label"
                                        :text="RESET_OPTION_COPY.autorunLimit.help"
                                        test-id="reset-help-autorun-limit"
                                    />
                                </div>
                                <input
                                    id="reset-autorun-minutes"
                                    v-model.number="form.autorunUserMinutes"
                                    type="number"
                                    min="1"
                                    max="43200"
                                    class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5"
                                    data-testid="reset-autorun-minutes"
                                />
                            </div>
                            <fieldset
                                v-if="form.autorunEnabled"
                                class="space-y-2 rounded border border-zinc-800 p-3 md:col-span-2"
                            >
                                <legend class="px-1 text-xs text-zinc-400">자율행동 종류</legend>
                                <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                                    <label
                                        v-for="option in RESET_AUTORUN_LABELS"
                                        :key="option.value"
                                        class="flex items-center gap-1.5"
                                    >
                                        <input
                                            v-model="form[RESET_AUTORUN_FORM_KEYS[option.value]]"
                                            type="checkbox"
                                            :data-testid="
                                                option.value === 'recruit_high'
                                                    ? 'reset-autorun-recruit-high'
                                                    : option.value === 'chief'
                                                      ? 'reset-autorun-chief'
                                                      : undefined
                                            "
                                        />
                                        {{ option.label }}
                                    </label>
                                </div>
                            </fieldset>
                        </div>
                    </details>

                    <div v-if="mode === 'scenario'" class="space-y-2 rounded border border-zinc-800 p-3">
                        <p class="text-xs leading-5 text-zinc-400">
                            초기화 시작 → 가오픈 시작 → 정식 오픈 순서입니다. 초기화 시작을 비우면 바로 작업합니다.
                        </p>
                        <div class="grid gap-4 md:grid-cols-3">
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5 text-xs text-zinc-400">
                                    <label for="reset-scheduled-at">{{ RESET_SCHEDULE_COPY.scheduledAt.label }}</label>
                                    <CompactHelp
                                        :label="RESET_SCHEDULE_COPY.scheduledAt.label"
                                        :text="RESET_SCHEDULE_COPY.scheduledAt.help"
                                        test-id="reset-help-scheduled-at"
                                    />
                                    <span>(선택 · UTC+9)</span>
                                </div>
                                <input
                                    id="reset-scheduled-at"
                                    v-model="form.scheduledAt"
                                    type="datetime-local"
                                    class="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                                    data-testid="reset-scheduled-at"
                                />
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5 text-xs text-zinc-400">
                                    <label for="reset-preopen-at">{{ RESET_SCHEDULE_COPY.preopenAt.label }}</label>
                                    <CompactHelp
                                        :label="RESET_SCHEDULE_COPY.preopenAt.label"
                                        :text="RESET_SCHEDULE_COPY.preopenAt.help"
                                        test-id="reset-help-preopen-at"
                                    />
                                    <span>(선택 · UTC+9)</span>
                                </div>
                                <input
                                    id="reset-preopen-at"
                                    v-model="form.preopenAt"
                                    type="datetime-local"
                                    class="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                                    data-testid="reset-preopen-at"
                                />
                            </div>
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5 text-xs text-zinc-400">
                                    <label for="reset-open-at">{{ RESET_SCHEDULE_COPY.openAt.label }}</label>
                                    <CompactHelp
                                        :label="RESET_SCHEDULE_COPY.openAt.label"
                                        :text="RESET_SCHEDULE_COPY.openAt.help"
                                        test-id="reset-help-open-at"
                                    />
                                    <span>(선택 · UTC+9)</span>
                                </div>
                                <input
                                    id="reset-open-at"
                                    v-model="form.openAt"
                                    type="datetime-local"
                                    class="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                                    data-testid="reset-open-at"
                                />
                            </div>
                        </div>
                        <label
                            class="flex cursor-pointer items-start gap-3 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200"
                        >
                            <input
                                v-model="form.publishSchedule"
                                type="checkbox"
                                class="publish-schedule-checkbox mt-0.5 h-4 w-4 accent-amber-500"
                                data-testid="reset-publish-schedule"
                            />
                            <span>
                                <span class="block font-medium">예약 등록 즉시 로비에 오픈 일정 공개</span>
                                <span class="mt-0.5 block text-xs leading-5 text-zinc-500">
                                    빌드는 초기화 시작 시각까지 대기합니다. 공개하려면 위 세 시각을 모두 입력해야
                                    합니다.
                                </span>
                            </span>
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
                            :disabled="
                                submitting ||
                                !selectedProfileIdentityReady ||
                                Boolean(activeOperation) ||
                                !form.sourceRef.trim()
                            "
                            data-testid="request-deploy"
                            @click="requestDeploy"
                        >
                            DB 유지 배포
                        </button>
                        <button
                            v-else
                            type="submit"
                            class="w-full rounded bg-amber-500 px-4 py-3 font-bold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                            :disabled="
                                submitting ||
                                !selectedProfileIdentityReady ||
                                Boolean(activeOperation) ||
                                form.scenarioId === null
                            "
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
                <div
                    class="rounded border border-amber-800/80 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
                    data-testid="gateway-build-recovery-guide"
                >
                    <strong>빌드가 멈춘 경우:</strong> 로그의 마지막 단계가 build일 때만 <strong>빌드 중단</strong>을
                    누르고 CANCELLED를 확인한 뒤 <strong>재시도</strong>하세요. migration 또는 process 전환이 시작된
                    뒤에는 DB와 runtime 보호를 위해 중단할 수 없습니다.
                </div>
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
                            {{ gatewayReleaseLogEmptyMessage }}
                        </div>
                        <div
                            v-for="entry in gatewayReleaseLogs"
                            :key="entry.cursor"
                            :class="
                                entry.level === 'ERROR'
                                    ? 'text-red-300'
                                    : entry.level === 'OUTPUT'
                                      ? 'text-zinc-300'
                                      : 'text-cyan-300'
                            "
                        >
                            <span class="text-zinc-600">{{ formatLogTime(entry.createdAt) }}</span>
                            <span class="ml-2 text-violet-300">[{{ entry.phase }}]</span>
                            <span class="ml-2 whitespace-pre-wrap break-all">{{ entry.message }}</span>
                        </div>
                    </div>
                </section>
                <div class="overflow-x-auto">
                    <table
                        class="w-full table-fixed text-left text-xs sm:min-w-[680px]"
                        data-testid="gateway-release-table"
                    >
                        <colgroup>
                            <col class="w-[32%] sm:w-[144px]" />
                            <col class="w-[17%] sm:w-[68px]" />
                            <col class="w-[20%] sm:w-[88px]" />
                            <col class="hidden sm:table-column sm:w-[128px]" />
                            <col class="hidden sm:table-column sm:w-[112px]" />
                            <col class="w-[31%] sm:w-[140px]" />
                        </colgroup>
                        <thead class="border-b border-zinc-700 text-zinc-500">
                            <tr>
                                <th class="p-2">시각</th>
                                <th class="p-2">작업</th>
                                <th class="p-2">상태</th>
                                <th class="hidden p-2 sm:table-cell">소스</th>
                                <th class="hidden p-2 sm:table-cell">해석 커밋</th>
                                <th class="p-2">상세</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="operation in gatewayReleaseOperations" :key="operation.id">
                                <tr class="border-b border-zinc-800 align-top">
                                    <td class="p-2">{{ formatTime(operation.createdAt) }}</td>
                                    <td class="p-2">
                                        <div>{{ operation.type }}</div>
                                        <div
                                            class="mt-1 truncate font-mono text-[10px] text-zinc-500 sm:hidden"
                                            :title="operation.sourceRef"
                                        >
                                            {{ operation.sourceRef ?? '-' }}
                                        </div>
                                    </td>
                                    <td class="p-2 font-semibold">{{ operation.status }}</td>
                                    <td class="hidden p-2 font-mono sm:table-cell">
                                        <div class="truncate" :title="operation.sourceRef">
                                            {{ operation.sourceRef }}
                                        </div>
                                    </td>
                                    <td class="hidden p-2 font-mono sm:table-cell">
                                        {{ shortSha(operation.resolvedCommitSha) }}
                                    </td>
                                    <td class="p-2">
                                        <div class="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                class="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
                                                :class="
                                                    operation.id === selectedGatewayOperationId
                                                        ? 'border-violet-500 text-violet-200'
                                                        : ''
                                                "
                                                @click="selectGatewayReleaseOperation(operation.id)"
                                            >
                                                로그
                                            </button>
                                            <button
                                                v-if="operation.error"
                                                type="button"
                                                class="rounded border border-red-800 px-2 py-1 text-red-300 hover:bg-red-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                                                :aria-expanded="expandedGatewayErrorOperationId === operation.id"
                                                :aria-controls="`gateway-release-error-${operation.id}`"
                                                data-testid="gateway-release-error-toggle"
                                                @click="toggleGatewayReleaseError(operation.id)"
                                            >
                                                {{
                                                    expandedGatewayErrorOperationId === operation.id
                                                        ? '오류 닫기'
                                                        : '오류 보기'
                                                }}
                                            </button>
                                            <button
                                                v-if="operation.status === 'QUEUED' || operation.status === 'RUNNING'"
                                                type="button"
                                                class="rounded border border-red-800 px-2 py-1 text-red-300 hover:bg-red-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                                                @click="cancelGatewayRelease(operation)"
                                            >
                                                {{ operation.status === 'RUNNING' ? '빌드 중단' : '취소' }}
                                            </button>
                                            <button
                                                v-else-if="
                                                    operation.status === 'FAILED' || operation.status === 'CANCELLED'
                                                "
                                                type="button"
                                                class="rounded border border-amber-700 px-2 py-1 text-amber-300 hover:bg-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                                                @click="retryGatewayRelease(operation)"
                                            >
                                                재시도
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                <tr
                                    v-if="operation.error"
                                    v-show="expandedGatewayErrorOperationId === operation.id"
                                    :id="`gateway-release-error-${operation.id}`"
                                    class="border-b border-red-900/70 bg-red-950/30"
                                    data-testid="gateway-release-error-detail"
                                >
                                    <td colspan="6" class="p-4">
                                        <div
                                            class="rounded border border-red-900/70 bg-zinc-950 px-4 py-3"
                                            role="region"
                                            :aria-label="`${operation.type} 릴리스 오류 상세`"
                                        >
                                            <div class="mb-2 text-xs font-semibold text-red-300">오류 상세</div>
                                            <pre
                                                class="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-red-200"
                                                >{{ operation.error }}</pre>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>
            </section>

            <section
                v-if="mode !== 'gateway' && selectedProfileOperationId"
                class="overflow-hidden rounded border border-zinc-700 bg-zinc-950"
                data-testid="profile-operation-log-panel"
                aria-live="polite"
            >
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
                    <div>
                        <h3 class="text-sm font-semibold text-zinc-100">빌드·작업 로그</h3>
                        <p class="mt-1 font-mono text-[11px] text-zinc-500">
                            {{ selectedProfileOperationId }}
                        </p>
                    </div>
                    <div class="flex items-center gap-2 text-xs">
                        <span
                            class="h-2 w-2 rounded-full"
                            :class="
                                profileOperationLogConnection === 'reconnecting'
                                    ? 'animate-pulse bg-amber-400'
                                    : ['QUEUED', 'RUNNING'].includes(
                                            profileOperationLogStatus || selectedProfileOperation?.status || ''
                                        )
                                      ? 'animate-pulse bg-emerald-400'
                                      : 'bg-zinc-500'
                            "
                        ></span>
                        <span data-testid="profile-operation-log-status">
                            {{ profileOperationLogStatus || selectedProfileOperation?.status || '연결 중' }}
                            <template v-if="profileOperationLogConnection === 'reconnecting'"> · 재연결 중</template>
                        </span>
                    </div>
                </div>
                <div
                    ref="profileOperationLogViewport"
                    class="h-72 overflow-y-auto px-4 py-3 font-mono text-xs leading-5"
                    data-testid="profile-operation-log"
                >
                    <div v-if="!profileOperationLogs.length" class="text-zinc-500">
                        {{ profileOperationLogEmptyMessage }}
                    </div>
                    <div
                        v-for="entry in profileOperationLogs"
                        :key="entry.cursor"
                        :class="
                            entry.level === 'ERROR'
                                ? 'text-red-300'
                                : entry.level === 'OUTPUT'
                                  ? 'text-zinc-300'
                                  : 'text-cyan-300'
                        "
                    >
                        <span class="text-zinc-600">{{ formatLogTime(entry.createdAt) }}</span>
                        <span class="ml-2 text-violet-300">[{{ entry.phase }}]</span>
                        <span class="ml-2 whitespace-pre-wrap break-all">{{
                            displayOperationText(entry.message)
                        }}</span>
                    </div>
                </div>
            </section>

            <section v-if="mode !== 'gateway'" class="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
                <div
                    class="mb-4 rounded border border-amber-800/80 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
                    data-testid="profile-build-recovery-guide"
                >
                    <strong>DB 보존 업데이트 빌드가 멈춘 경우:</strong> <strong>빌드 중단</strong>을 누르고 CANCELLED를
                    확인한 뒤 <strong>재시도</strong>하세요. 기존 profile runtime과 게임 DB는 유지됩니다.
                    RESET·migration·process 전환 단계는 이 화면에서 강제 중단하지 않습니다.
                </div>
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="text-lg font-semibold">작업 이력</h3>
                    <span class="text-right text-xs text-zinc-500">진행 상태를 3초마다 갱신</span>
                </div>
                <div>
                    <table class="w-full table-fixed text-left text-xs sm:text-sm" data-testid="operations-table">
                        <colgroup>
                            <col class="w-[42%]" />
                            <col class="w-[24%]" />
                            <col class="w-[34%]" />
                        </colgroup>
                        <thead class="border-b border-zinc-700 text-xs text-zinc-500">
                            <tr>
                                <th class="p-2">요청 · 작업</th>
                                <th class="p-2">상태</th>
                                <th class="p-2">보기</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="operation in operations" :key="operation.id">
                                <tr class="border-b border-zinc-800 align-top" data-testid="operation-summary-row">
                                    <td class="p-2">
                                        <div class="font-semibold text-zinc-100">
                                            {{ operationTypeLabel(operation.type) }}
                                        </div>
                                        <div class="mt-1 text-[11px] leading-4 text-zinc-400">
                                            {{ formatTime(operation.createdAt) }}
                                        </div>
                                        <div
                                            v-if="operation.scheduledAt"
                                            class="mt-1 text-[11px] leading-4 text-amber-300"
                                        >
                                            예약 {{ formatTime(operation.scheduledAt) }}
                                        </div>
                                    </td>
                                    <td class="p-2">
                                        <span
                                            class="inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold leading-none"
                                            :class="operationStatusClass(operation.status)"
                                            :data-operation-status="operation.status"
                                        >
                                            {{ operationStatusLabel(operation.status) }}
                                        </span>
                                    </td>
                                    <td class="p-2">
                                        <div class="flex flex-wrap gap-1.5">
                                            <button
                                                type="button"
                                                class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
                                                :class="
                                                    operation.id === selectedProfileOperationId
                                                        ? 'border-violet-500 text-violet-200'
                                                        : ''
                                                "
                                                @click="selectProfileOperation(operation.id)"
                                            >
                                                로그
                                            </button>
                                            <button
                                                type="button"
                                                class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
                                                :aria-expanded="expandedProfileOperationId === operation.id"
                                                :aria-controls="`profile-operation-detail-${operation.id}`"
                                                data-testid="operation-details-toggle"
                                                @click="toggleProfileOperationDetails(operation.id)"
                                            >
                                                {{ operation.error ? '오류 상세' : '상세' }}
                                            </button>
                                            <button
                                                v-if="
                                                    operation.status === 'QUEUED' ||
                                                    (operation.status === 'RUNNING' && operation.type === 'DEPLOY')
                                                "
                                                type="button"
                                                class="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                                                @click="cancelOperation(operation)"
                                            >
                                                {{ operation.status === 'RUNNING' ? '빌드 중단' : '취소' }}
                                            </button>
                                            <button
                                                v-else-if="
                                                    operation.status === 'FAILED' || operation.status === 'CANCELLED'
                                                "
                                                type="button"
                                                class="rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                                                @click="retryOperation(operation)"
                                            >
                                                재시도
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                <tr
                                    v-show="expandedProfileOperationId === operation.id"
                                    :id="`profile-operation-detail-${operation.id}`"
                                    class="border-b border-zinc-700 bg-zinc-950/60"
                                    data-testid="operation-detail"
                                >
                                    <td colspan="3" class="p-3 sm:p-4">
                                        <div
                                            class="rounded border border-zinc-800 bg-zinc-950 px-3 py-3"
                                            role="region"
                                            :aria-label="`${operationTypeLabel(operation.type)} 상세`"
                                        >
                                            <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                                                <div>
                                                    <dt class="text-[11px] font-semibold text-zinc-500">서버</dt>
                                                    <dd class="mt-1 break-all text-xs text-zinc-300">
                                                        {{ profileDisplayName(operation.profileName) }}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt class="text-[11px] font-semibold text-zinc-500">작업 ID</dt>
                                                    <dd class="mt-1 break-all font-mono text-xs text-zinc-300">
                                                        {{ operation.id }}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt class="text-[11px] font-semibold text-zinc-500">소스</dt>
                                                    <dd
                                                        class="mt-1 break-all font-mono text-xs text-zinc-300"
                                                        data-testid="operation-source-ref"
                                                    >
                                                        {{ operation.sourceMode ?? '-' }}
                                                        {{ operation.sourceRef ?? '' }}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt class="text-[11px] font-semibold text-zinc-500">해석 커밋</dt>
                                                    <dd class="mt-1 break-all font-mono text-xs text-zinc-300">
                                                        {{ operation.resolvedCommitSha ?? '-' }}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt class="text-[11px] font-semibold text-zinc-500">요청자</dt>
                                                    <dd class="mt-1 break-all font-mono text-xs text-zinc-300">
                                                        {{ operation.requestedBy }}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt class="text-[11px] font-semibold text-zinc-500">완료 시각</dt>
                                                    <dd class="mt-1 text-xs text-zinc-300">
                                                        {{ formatTime(operation.completedAt) }}
                                                    </dd>
                                                </div>
                                                <div v-if="operation.reason" class="sm:col-span-2">
                                                    <dt class="text-[11px] font-semibold text-zinc-500">사유</dt>
                                                    <dd
                                                        class="mt-1 whitespace-pre-wrap break-all text-xs text-zinc-300"
                                                    >
                                                        {{ operation.reason }}
                                                    </dd>
                                                </div>
                                                <div v-if="operation.error" class="sm:col-span-2">
                                                    <dt class="text-[11px] font-semibold text-red-400">오류</dt>
                                                    <dd class="mt-1 whitespace-pre-wrap break-all text-xs text-red-300">
                                                        {{ displayOperationText(operation.error) }}
                                                    </dd>
                                                </div>
                                            </dl>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                            <tr v-if="operations.length === 0">
                                <td colspan="3" class="p-6 text-center text-zinc-500">작업 이력이 없습니다.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    </AdminConsoleLayout>
</template>

<style scoped>
.publish-schedule-checkbox:focus-visible {
    outline: 2px solid #fcd34d;
    outline-offset: 2px;
}
</style>
