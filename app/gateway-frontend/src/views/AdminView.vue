<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import { trpc } from '../utils/trpc';

type AdminUserSanctions = {
    bannedUntil?: string;
    mutedUntil?: string;
    suspendedUntil?: string;
    warningCount?: number;
    flags?: string[];
    notes?: string;
    serverRestrictions?: Record<
        string,
        {
            blockedFeatures?: string[];
            until?: string;
            reason?: string;
            notes?: string;
        }
    >;
};

type AdminSanctionsPatch = {
    bannedUntil?: string | null;
    mutedUntil?: string | null;
    suspendedUntil?: string | null;
    warningCount?: number | null;
    flags?: string[] | null;
    notes?: string | null;
    serverRestrictions?: Record<
        string,
        {
            blockedFeatures?: string[];
            until?: string | null;
            reason?: string | null;
            notes?: string | null;
        } | null
    > | null;
};

type AdminUser = {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    sanctions: AdminUserSanctions;
    oauthType: string;
    oauthId?: string;
    email?: string;
    kakaoVerifiedAt?: string;
    kakaoGraceStartedAt: string;
    kakaoGraceUntil?: string;
    profileIconResetAt?: string;
    deleteAfter?: string;
    createdAt: string;
};

type AdminCapability = {
    permission: string;
    label: string;
    description: string;
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    scope: 'GLOBAL' | 'PROFILE';
};

type AdminAuditEvent = {
    id: string;
    correlationId: string;
    actorUsername: string;
    targetType?: string;
    targetId?: string;
    profileName?: string;
    action: string;
    outcome: 'STARTED' | 'SUCCEEDED' | 'FAILED';
    reason?: string;
    summary: Record<string, unknown>;
    errorMessage?: string;
    createdAt: string;
};

type KakaoGracePolicy = {
    profileName: string;
    requiresKakaoVerification: boolean;
    kakaoVerified: boolean;
    accessAllowed: boolean;
    canCreateGeneral: boolean;
    graceEndsAt: string | null;
    generalCreationGraceDays: number;
    accessGraceDays: number;
};

type AdminPublicUser = {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    createdAt: string;
};

type AdminProfile = {
    profileName: string;
    profile: string;
    scenario: string;
    status: string;
    apiPort: number;
    runtime: {
        apiRunning: boolean;
        daemonRunning: boolean;
        auctionRunning: boolean;
        battleSimRunning: boolean;
        tournamentRunning: boolean;
    };
    buildCommitSha?: string;
    activeOperation?: {
        id: string;
        status: 'QUEUED' | 'RUNNING';
    } | null;
    meta: Record<string, unknown>;
    runtimeActions: Array<{
        id: string;
        action: string;
        durationMinutes: number | null;
        status: 'REQUESTED' | 'PARTIAL' | 'APPLIED' | 'FAILED' | 'IGNORED';
        detail: string | null;
        handler: string | null;
        handledAt: string | null;
        createdAt: string;
    }>;
};

type ScenarioNationPreview = {
    id: number;
    name: string;
    color: string;
    cities: string[];
    generals: number;
    generalsEx: number;
    generalsNeutral: number;
};

type ScenarioPreview = {
    id: number;
    title: string;
    year: number | null;
    npcCount: number;
    npcExCount: number;
    npcNeutralCount: number;
    nations: ScenarioNationPreview[];
};

type ScenarioCatalogState = {
    scenarios: ScenarioPreview[];
    loading: boolean;
    status: string;
};

type InstallFormState = {
    scenarioId: number;
    turnTermMinutes: number;
    sync: boolean;
    fiction: number;
    extend: boolean;
    blockGeneralCreate: number;
    npcMode: number;
    showImgLevel: number;
    tournamentTrig: boolean;
    joinMode: 'full' | 'onlyRandom';
    autorunUserMinutes: number;
    autorunUserOptions: Record<string, boolean>;
    openAt: string;
    preopenAt: string;
    gitRef: string;
    reason: string;
};

type AdminAction =
    'RESUME' | 'PAUSE' | 'STOP' | 'ACCELERATE' | 'DELAY' | 'RESET_NOW' | 'RESET_SCHEDULED' | 'OPEN_SURVEY' | 'SHUTDOWN';

type AdminClient = {
    capabilities: {
        list: { query: () => Promise<AdminCapability[]> };
    };
    audit: {
        list: { query: (input?: { limit?: number }) => Promise<AdminAuditEvent[]> };
    };
    system: {
        getNotice: {
            query: () => Promise<{ notice: string }>;
        };
        setNotice: {
            mutate: (input: { notice: string }) => Promise<{ notice: string }>;
        };
    };
    users: {
        getLocalAccountStatus: {
            query: () => Promise<{ enabled: boolean }>;
        };
        createLocal: {
            mutate: (input: {
                username: string;
                password: string;
                displayName?: string;
            }) => Promise<{ user: AdminPublicUser }>;
        };
        lookup: {
            query: (input: { id?: string; username?: string; email?: string }) => Promise<AdminUser | null>;
        };
        getKakaoGracePolicies: {
            query: (input: { userId: string }) => Promise<{
                kakaoVerified: boolean;
                kakaoGraceStartedAt: string;
                kakaoGraceUntil: string | null;
                profiles: KakaoGracePolicy[];
            }>;
        };
        updateKakaoGrace: {
            mutate: (input: { userId: string; until: string | null; reason: string }) => Promise<{
                kakaoGraceUntil: string | null;
            }>;
        };
        listHistory: {
            query: (input: { userId: string; limit?: number }) => Promise<AdminAuditEvent[]>;
        };
        resetPassword: {
            mutate: (input: { userId: string; newPassword?: string; reason: string }) => Promise<{ password: string }>;
        };
        updateRoles: {
            mutate: (input: {
                userId: string;
                roles: string[];
                mode?: 'set' | 'grant' | 'revoke';
                reason: string;
            }) => Promise<{ roles: string[] }>;
        };
        updateSanctions: {
            mutate: (input: {
                userId: string;
                patch: AdminSanctionsPatch;
                reason: string;
            }) => Promise<{ sanctions: AdminUserSanctions }>;
        };
        setServerRestriction: {
            mutate: (input: {
                userId: string;
                profile: string;
                restriction: {
                    blockedFeatures?: string[];
                    until?: string | null;
                    reason?: string | null;
                    notes?: string | null;
                } | null;
                reason: string;
            }) => Promise<{ sanctions: AdminUserSanctions }>;
        };
        resetProfileIcon: {
            mutate: (input: { userId: string; reason: string }) => Promise<{
                profileIconResetAt: string;
                flushPublished: boolean;
            }>;
        };
        scheduleDeletion: {
            mutate: (input: { userId: string; retentionDays: number; reason: string }) => Promise<{
                ok: boolean;
                deleteAfter: string;
            }>;
        };
    };
    profiles: {
        list: {
            query: () => Promise<AdminProfile[]>;
        };
        listScenarios: {
            query: (input?: { gitRef?: string }) => Promise<ScenarioPreview[]>;
        };
        updateMeta: {
            mutate: (input: {
                profileName: string;
                patch: {
                    korName?: string | null;
                    color?: string | null;
                    inGameNotice?: string | null;
                    profileImageUrl?: string | null;
                    nextSeasonIdx?: number | null;
                    localAccountAccessGraceDays?: number | null;
                    localAccountGeneralCreationGraceDays?: number | null;
                };
                reason: string;
            }) => Promise<AdminProfile | null>;
        };
        install: {
            mutate: (input: {
                profileName: string;
                install: {
                    scenarioId: number;
                    turnTermMinutes: number;
                    sync: boolean;
                    fiction: number;
                    extend: boolean;
                    blockGeneralCreate: number;
                    npcMode: number;
                    showImgLevel: number;
                    tournamentTrig: boolean;
                    joinMode: 'full' | 'onlyRandom';
                    autorunUser?: {
                        limitMinutes: number;
                        options: string[];
                    } | null;
                    openAt?: string;
                    preopenAt?: string;
                    gitRef?: string;
                };
                reason?: string;
            }) => Promise<{ ok: boolean; operationId: string; action?: unknown }>;
        };
        requestAction: {
            mutate: (input: {
                profileName: string;
                action: AdminAction;
                durationMinutes?: number;
                scheduledAt?: string;
                reason?: string;
            }) => Promise<{ ok: boolean; action?: AdminProfile['runtimeActions'][number] }>;
        };
    };
};

const adminClient = trpc.admin as unknown as AdminClient;

const sessionToken = ref('');
const sessionTokenStatus = ref('');

if (typeof window !== 'undefined') {
    sessionToken.value = window.localStorage.getItem('sammo-session-token') ?? '';
}

const saveSessionToken = () => {
    const value = sessionToken.value.trim();
    if (typeof window !== 'undefined') {
        if (value) {
            window.localStorage.setItem('sammo-session-token', value);
        } else {
            window.localStorage.removeItem('sammo-session-token');
        }
    }
    sessionTokenStatus.value = value ? '저장됨' : '삭제됨';
};

const noticeDraft = ref('');
const noticeStatus = ref('');
const noticeLoading = ref(false);

const profiles = ref<AdminProfile[]>([]);
const profilesLoading = ref(false);
const profileEdits = ref<
    Record<
        string,
        {
            korName: string;
            color: string;
            inGameNotice: string;
            profileImageUrl: string;
            nextSeasonIdx: string;
            localAccountAccessGraceDays: string;
            localAccountGeneralCreationGraceDays: string;
            reason: string;
        }
    >
>({});
const profileActions = ref<
    Record<
        string,
        {
            durationMinutes: string;
            scheduledAt: string;
            reason: string;
        }
    >
>({});
const profileActionStatus = ref<Record<string, string>>({});
const profileActionSubmitting = ref<Record<string, boolean>>({});
const scenarioCatalogs = ref<Record<string, ScenarioCatalogState>>({});
const profileInstalls = ref<Record<string, InstallFormState>>({});
const profileInstallStatus = ref<Record<string, string>>({});
const profileInstallSubmitting = ref<Record<string, boolean>>({});
const profileInstallOperationId = ref<Record<string, string>>({});

const runtimeActionPending = (profile: AdminProfile): boolean => {
    return profile.runtimeActions.some((action) => action.status === 'REQUESTED' || action.status === 'PARTIAL');
};

const validDuration = (profileName: string): boolean => {
    const value = Number(profileActions.value[profileName]?.durationMinutes);
    return Number.isInteger(value) && value >= 1 && value <= 1440;
};

const runtimeActionStatusClass = (status: AdminProfile['runtimeActions'][number]['status']): string => {
    if (status === 'APPLIED') return 'text-emerald-400';
    if (status === 'FAILED') return 'text-red-400';
    if (status === 'IGNORED') return 'text-orange-400';
    if (status === 'PARTIAL') return 'text-amber-400';
    return 'text-zinc-400';
};

const isRuntimeActionTerminal = (status: AdminProfile['runtimeActions'][number]['status']): boolean =>
    status === 'APPLIED' || status === 'FAILED' || status === 'IGNORED';

const formatRuntimeActionTime = (value: string | null): string =>
    value ? new Date(value).toLocaleString('ko-KR') : '';

const autorunOptionLabels = [
    { key: 'develop', label: '내정' },
    { key: 'warp', label: '순간이동' },
    { key: 'recruit', label: '징병' },
    { key: 'recruit_high', label: '모병' },
    { key: 'train', label: '훈사' },
    { key: 'battle', label: '출병' },
    { key: 'chief', label: '기본 사령턴' },
] as const;

const turnTermOptions = [120, 60, 30, 20, 10, 5, 2, 1] as const;

const userLookupMode = ref<'username' | 'id' | 'email'>('username');
const userLookupValue = ref('');
const userLoading = ref(false);
const userError = ref('');
const userResult = ref<AdminUser | null>(null);

const localAccountEnabled = ref(false);
const localAccountStatus = ref('');
const localAccountResult = ref('');
const localAccountLoading = ref(false);
const localAccountForm = ref({
    username: '',
    password: '',
    displayName: '',
});

const passwordInput = ref('');
const passwordResult = ref('');
const passwordStatus = ref('');

const rolesInput = ref('');
const rolesMode = ref<'set' | 'grant' | 'revoke'>('grant');
const rolesStatus = ref('');
const capabilities = ref<AdminCapability[]>([]);
const selectedCapability = ref('');
const capabilityProfile = ref('');
const userActionReason = ref('');

const banUntil = ref('');
const banReason = ref('');
const banStatus = ref('');

const profileIconStatus = ref('');

const restrictionProfile = ref('');
const restrictionFeatures = ref('');
const restrictionUntil = ref('');
const restrictionReason = ref('');
const restrictionNotes = ref('');
const restrictionStatus = ref('');

const forceDeleteStatus = ref('');
const deletionRetentionDays = ref(30);
const kakaoGraceUntil = ref('');
const kakaoGraceStatus = ref('');
const kakaoPolicies = ref<KakaoGracePolicy[]>([]);
const userHistory = ref<AdminAuditEvent[]>([]);
const globalAuditHistory = ref<AdminAuditEvent[]>([]);
const globalAuditStatus = ref('');

const hasUser = computed(() => Boolean(userResult.value));

const loadLocalAccountStatus = async () => {
    localAccountStatus.value = '';
    try {
        const result = await adminClient.users.getLocalAccountStatus.query();
        localAccountEnabled.value = result.enabled;
        localAccountStatus.value = result.enabled ? '' : 'ENV 설정이 비활성화 상태입니다.';
    } catch (error) {
        localAccountEnabled.value = false;
        localAccountStatus.value = '로컬 계정 생성 설정 확인 실패';
    }
};

const loadNotice = async () => {
    noticeLoading.value = true;
    try {
        const result = await adminClient.system.getNotice.query();
        noticeDraft.value = result.notice;
    } catch (error) {
        noticeStatus.value = '공지 불러오기 실패';
    } finally {
        noticeLoading.value = false;
    }
};

const saveNotice = async () => {
    noticeLoading.value = true;
    noticeStatus.value = '';
    try {
        const result = await adminClient.system.setNotice.mutate({
            notice: noticeDraft.value,
        });
        noticeDraft.value = result.notice;
        noticeStatus.value = '저장 완료';
    } catch (error) {
        noticeStatus.value = '저장 실패';
    } finally {
        noticeLoading.value = false;
    }
};

const ensureProfileBuffers = (profile: AdminProfile) => {
    if (!profileEdits.value[profile.profileName]) {
        const meta = (profile.meta ?? {}) as Record<string, unknown>;
        profileEdits.value[profile.profileName] = {
            korName: String(meta.korName ?? profile.profile),
            color: String(meta.color ?? '#ffffff'),
            inGameNotice: String(meta.inGameNotice ?? ''),
            profileImageUrl: String(meta.profileImageUrl ?? ''),
            nextSeasonIdx:
                typeof meta.nextSeasonIdx === 'number' && Number.isFinite(meta.nextSeasonIdx)
                    ? String(Math.floor(meta.nextSeasonIdx))
                    : '',
            localAccountAccessGraceDays:
                typeof meta.localAccountAccessGraceDays === 'number'
                    ? String(Math.floor(meta.localAccountAccessGraceDays))
                    : '',
            localAccountGeneralCreationGraceDays:
                typeof meta.localAccountGeneralCreationGraceDays === 'number'
                    ? String(Math.floor(meta.localAccountGeneralCreationGraceDays))
                    : '',
            reason: '',
        };
    }
    if (!profileActions.value[profile.profileName]) {
        profileActions.value[profile.profileName] = {
            durationMinutes: '',
            scheduledAt: '',
            reason: '',
        };
    }
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatLocalInput = (date: Date): string =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(
        date.getMinutes()
    )}`;

const toLocalInputValue = (value: unknown): string => {
    if (typeof value !== 'string') {
        return '';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    return formatLocalInput(parsed);
};

const readNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const readBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const readString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

const buildAutorunOptionMap = (options?: string[]): Record<string, boolean> => {
    const map: Record<string, boolean> = {};
    autorunOptionLabels.forEach(({ key }) => {
        map[key] = options ? options.includes(key) : true;
    });
    return map;
};

const normalizeGitRefInput = (value: string): string => value.trim();

const getScenarioCatalogKey = (gitRef: string): string => normalizeGitRefInput(gitRef);

const getScenarioCatalogStateByRef = (gitRef: string): ScenarioCatalogState => {
    const key = getScenarioCatalogKey(gitRef);
    return (
        scenarioCatalogs.value[key] ?? {
            scenarios: [],
            loading: false,
            status: '',
        }
    );
};

const ensureProfileInstallBuffers = (profile: AdminProfile) => {
    if (profileInstalls.value[profile.profileName]) {
        return;
    }
    const meta = (profile.meta ?? {}) as Record<string, unknown>;
    const install = (meta.install ?? {}) as Record<string, unknown>;
    const autorunUser = (install.autorunUser ?? {}) as Record<string, unknown>;
    const autorunOptionsRaw = Array.isArray(autorunUser.options)
        ? autorunUser.options.filter((option): option is string => typeof option === 'string')
        : undefined;
    const scenarioId = Number(profile.scenario);

    const installGitRef = readString(install.gitRef, '');
    const buildCommitRef = typeof profile.buildCommitSha === 'string' ? profile.buildCommitSha : '';

    profileInstalls.value[profile.profileName] = {
        scenarioId: Number.isFinite(scenarioId) ? scenarioId : readNumber(install.scenarioId, 0),
        turnTermMinutes: readNumber(install.turnTermMinutes, 60),
        sync: readBoolean(install.sync, true),
        fiction: readNumber(install.fiction, 1),
        extend: readBoolean(install.extend, true),
        blockGeneralCreate: readNumber(install.blockGeneralCreate, 0),
        npcMode: readNumber(install.npcMode, 0),
        showImgLevel: readNumber(install.showImgLevel, 3),
        tournamentTrig: readBoolean(install.tournamentTrig, true),
        joinMode: readString(install.joinMode, 'full') === 'onlyRandom' ? 'onlyRandom' : 'full',
        autorunUserMinutes: readNumber(autorunUser.limitMinutes, 1440),
        autorunUserOptions: buildAutorunOptionMap(autorunOptionsRaw),
        openAt: toLocalInputValue(install.openAt),
        preopenAt: toLocalInputValue(install.preopenAt),
        gitRef: installGitRef || buildCommitRef,
        reason: '',
    };
};

const buildScenarioMap = (items: ScenarioPreview[]): Map<number, ScenarioPreview> => {
    const map = new Map<number, ScenarioPreview>();
    items.forEach((scenario) => {
        map.set(scenario.id, scenario);
    });
    return map;
};

const buildScenarioGroups = (items: ScenarioPreview[]): Record<string, ScenarioPreview[]> => {
    const pattern = /【(.*?)[0-9\-_.a-zA-Z]*】/;
    const groups: Record<string, ScenarioPreview[]> = {};
    for (const scenario of items) {
        const match = pattern.exec(scenario.title);
        const category = match?.[1] ?? '기타';
        if (!groups[category]) {
            groups[category] = [];
        }
        groups[category].push(scenario);
    }
    return groups;
};

const getScenarioPreview = (profileName: string): ScenarioPreview | null => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return null;
    }
    const catalog = getScenarioCatalogStateByRef(install.gitRef);
    const map = buildScenarioMap(catalog.scenarios);
    return map.get(install.scenarioId) ?? null;
};

const getScenarioGroups = (profileName: string): Record<string, ScenarioPreview[]> => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return {};
    }
    const catalog = getScenarioCatalogStateByRef(install.gitRef);
    return buildScenarioGroups(catalog.scenarios);
};

const getScenarioLoading = (profileName: string): boolean => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return false;
    }
    return getScenarioCatalogStateByRef(install.gitRef).loading;
};

const getScenarioStatus = (profileName: string): string => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return '';
    }
    return getScenarioCatalogStateByRef(install.gitRef).status;
};

const loadProfiles = async () => {
    profilesLoading.value = true;
    try {
        const result = await adminClient.profiles.list.query();
        result.forEach((profile) => {
            ensureProfileBuffers(profile);
            ensureProfileInstallBuffers(profile);
            const latest = profile.runtimeActions[0];
            if (latest && isRuntimeActionTerminal(latest.status)) {
                profileActionStatus.value = {
                    ...profileActionStatus.value,
                    [profile.profileName]: '',
                };
            }
        });
        profiles.value = result;
        const refs = new Set<string>();
        refs.add('');
        result.forEach((profile) => {
            const install = profileInstalls.value[profile.profileName];
            if (install?.gitRef) {
                refs.add(normalizeGitRefInput(install.gitRef));
            }
        });
        await Promise.all(Array.from(refs).map((gitRef) => loadScenarioCatalog(gitRef)));
    } catch (error) {
        profileActionStatus.value = {
            ...profileActionStatus.value,
            global: '프로필 목록을 불러오지 못했습니다.',
        };
    } finally {
        profilesLoading.value = false;
    }
};

const refreshRuntimeActionUntilTerminal = async (profileName: string, actionId: string): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = profiles.value
            .find((profile) => profile.profileName === profileName)
            ?.runtimeActions.find((action) => action.id === actionId);
        if (current && isRuntimeActionTerminal(current.status)) {
            profileActionStatus.value = {
                ...profileActionStatus.value,
                [profileName]: '',
            };
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        try {
            const result = await adminClient.profiles.list.query();
            result.forEach((profile) => {
                ensureProfileBuffers(profile);
                ensureProfileInstallBuffers(profile);
            });
            profiles.value = result;
        } catch {
            // 일시적인 조회 실패는 다음 bounded poll에서 다시 확인합니다.
        }
    }
};

const loadScenarioCatalog = async (gitRef: string) => {
    const key = getScenarioCatalogKey(gitRef);
    const previous = scenarioCatalogs.value[key];
    scenarioCatalogs.value = {
        ...scenarioCatalogs.value,
        [key]: {
            scenarios: previous?.scenarios ?? [],
            loading: true,
            status: '',
        },
    };
    try {
        const result = await adminClient.profiles.listScenarios.query(key ? { gitRef: key } : undefined);
        scenarioCatalogs.value = {
            ...scenarioCatalogs.value,
            [key]: {
                scenarios: result,
                loading: false,
                status: '',
            },
        };
    } catch (error) {
        scenarioCatalogs.value = {
            ...scenarioCatalogs.value,
            [key]: {
                scenarios: previous?.scenarios ?? [],
                loading: false,
                status: '시나리오 목록을 불러오지 못했습니다.',
            },
        };
    }
};

const loadScenariosForProfile = async (profileName: string) => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return;
    }
    if (profileInstallSubmitting.value[profileName]) {
        return;
    }
    await loadScenarioCatalog(install.gitRef);
};

const updateProfileMeta = async (profileName: string) => {
    const edit = profileEdits.value[profileName];
    if (!edit) {
        return;
    }
    const nextSeasonRaw = edit.nextSeasonIdx.trim();
    const nextSeasonIdx = nextSeasonRaw === '' ? null : Number(nextSeasonRaw);
    if (nextSeasonIdx !== null && (!Number.isFinite(nextSeasonIdx) || nextSeasonIdx < 0)) {
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: '다음 시즌 번호는 0 이상 숫자여야 합니다.',
        };
        return;
    }
    const readGraceDays = (value: string): number | null => {
        if (!value.trim()) return null;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 365 ? parsed : Number.NaN;
    };
    const accessGraceDays = readGraceDays(edit.localAccountAccessGraceDays);
    const creationGraceDays = readGraceDays(edit.localAccountGeneralCreationGraceDays);
    if (Number.isNaN(accessGraceDays) || Number.isNaN(creationGraceDays)) {
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: 'Kakao 유예일은 0~365 사이 정수여야 합니다.',
        };
        return;
    }
    if (edit.reason.trim().length < 3) {
        profileActionStatus.value = { ...profileActionStatus.value, [profileName]: '변경 사유를 입력하세요.' };
        return;
    }
    const patch = {
        korName: edit.korName.trim() || null,
        color: edit.color.trim() || null,
        inGameNotice: edit.inGameNotice.trim() || null,
        profileImageUrl: edit.profileImageUrl.trim() || null,
        nextSeasonIdx: nextSeasonIdx === null ? null : Math.floor(nextSeasonIdx),
        localAccountAccessGraceDays: accessGraceDays,
        localAccountGeneralCreationGraceDays: creationGraceDays,
    };
    try {
        const updated = await adminClient.profiles.updateMeta.mutate({
            profileName,
            patch,
            reason: edit.reason.trim(),
        });
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: updated ? '메타 저장 완료' : '메타 저장 실패',
        };
        if (updated) {
            profiles.value = profiles.value.map((item) =>
                item.profileName === profileName ? { ...item, ...updated } : item
            );
        }
    } catch (error) {
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: '메타 저장 실패',
        };
    }
};

const requestProfileAction = async (profileName: string, action: AdminAction) => {
    if (profileActionSubmitting.value[profileName]) {
        return;
    }
    profileActionSubmitting.value = {
        ...profileActionSubmitting.value,
        [profileName]: true,
    };
    const actionState = profileActions.value[profileName];
    const timeShiftAction = action === 'ACCELERATE' || action === 'DELAY';
    const durationMinutes =
        timeShiftAction && actionState?.durationMinutes ? Number(actionState.durationMinutes) : undefined;
    const durationValue = durationMinutes && validDuration(profileName) ? durationMinutes : undefined;
    const scheduledAt =
        action === 'RESET_SCHEDULED' && actionState?.scheduledAt
            ? new Date(actionState.scheduledAt).toISOString()
            : undefined;
    const reason = actionState?.reason.trim() || undefined;
    let runtimeActionId: string | undefined;
    try {
        const result = await adminClient.profiles.requestAction.mutate({
            profileName,
            action,
            durationMinutes: durationValue,
            scheduledAt,
            reason,
        });
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]:
                result.action && (action === 'ACCELERATE' || action === 'DELAY')
                    ? `접수됨 · ${result.action.status} · ${action} ${result.action.durationMinutes ?? ''}분`
                    : `요청 접수: ${action}`,
        };
        if (result.action) {
            runtimeActionId = result.action.id;
            await loadProfiles();
        }
    } catch (error) {
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: `요청 실패: ${action}`,
        };
    } finally {
        profileActionSubmitting.value = {
            ...profileActionSubmitting.value,
            [profileName]: false,
        };
    }
    if (runtimeActionId) {
        void refreshRuntimeActionUntilTerminal(profileName, runtimeActionId);
    }
};

const requestInstall = async (profileName: string) => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return;
    }
    const options = Object.entries(install.autorunUserOptions)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key);
    const autorunUser =
        install.autorunUserMinutes > 0 && options.length
            ? {
                  limitMinutes: install.autorunUserMinutes,
                  options,
              }
            : null;
    const openAt = install.openAt ? new Date(install.openAt) : null;
    if (openAt && Number.isNaN(openAt.getTime())) {
        profileInstallStatus.value = {
            ...profileInstallStatus.value,
            [profileName]: '오픈 시간이 올바르지 않습니다.',
        };
        return;
    }
    const preopenAt = install.preopenAt ? new Date(install.preopenAt) : null;
    if (preopenAt && Number.isNaN(preopenAt.getTime())) {
        profileInstallStatus.value = {
            ...profileInstallStatus.value,
            [profileName]: '가오픈 시간이 올바르지 않습니다.',
        };
        return;
    }
    try {
        profileInstallSubmitting.value = { ...profileInstallSubmitting.value, [profileName]: true };
        const gitRef = normalizeGitRefInput(install.gitRef);
        const result = await adminClient.profiles.install.mutate({
            profileName,
            install: {
                scenarioId: install.scenarioId,
                turnTermMinutes: install.turnTermMinutes,
                sync: install.sync,
                fiction: install.fiction,
                extend: install.extend,
                blockGeneralCreate: install.blockGeneralCreate,
                npcMode: install.npcMode,
                showImgLevel: install.showImgLevel,
                tournamentTrig: install.tournamentTrig,
                joinMode: install.joinMode,
                autorunUser,
                openAt: openAt ? openAt.toISOString() : undefined,
                preopenAt: preopenAt ? preopenAt.toISOString() : undefined,
                gitRef: gitRef ? gitRef : undefined,
            },
            reason: install.reason.trim() || undefined,
        });
        profileInstallStatus.value = {
            ...profileInstallStatus.value,
            [profileName]: openAt ? '설치 작업을 예약했습니다.' : '설치 작업을 등록했습니다.',
        };
        profileInstallOperationId.value = {
            ...profileInstallOperationId.value,
            [profileName]: result.operationId,
        };
        await loadProfiles();
    } catch (error) {
        profileInstallStatus.value = {
            ...profileInstallStatus.value,
            [profileName]: error instanceof Error ? `설치 요청 실패: ${error.message}` : '설치 요청 실패',
        };
    } finally {
        profileInstallSubmitting.value = { ...profileInstallSubmitting.value, [profileName]: false };
    }
};

const lookupUser = async () => {
    userLoading.value = true;
    userError.value = '';
    passwordStatus.value = '';
    rolesStatus.value = '';
    banStatus.value = '';
    restrictionStatus.value = '';
    profileIconStatus.value = '';
    forceDeleteStatus.value = '';
    try {
        const payload =
            userLookupMode.value === 'id'
                ? { id: userLookupValue.value.trim() }
                : userLookupMode.value === 'email'
                  ? { email: userLookupValue.value.trim() }
                  : { username: userLookupValue.value.trim() };
        const result = await adminClient.users.lookup.query(payload);
        if (!result) {
            userResult.value = null;
            userError.value = '사용자를 찾을 수 없습니다.';
            return;
        }
        userResult.value = result;
        const [grace, history] = await Promise.all([
            adminClient.users.getKakaoGracePolicies.query({ userId: result.id }),
            adminClient.users.listHistory.query({ userId: result.id, limit: 50 }),
        ]);
        kakaoPolicies.value = grace.profiles;
        kakaoGraceUntil.value = grace.kakaoGraceUntil ? toLocalInputValue(grace.kakaoGraceUntil) : '';
        userHistory.value = history;
    } catch (error) {
        userError.value = '조회 실패';
    } finally {
        userLoading.value = false;
    }
};

const requireUserActionReason = (): string | null => {
    const reason = userActionReason.value.trim();
    if (reason.length < 3) {
        userError.value = '민감한 관리자 조치에는 3자 이상의 사유가 필요합니다.';
        return null;
    }
    return reason;
};

const loadGlobalAudit = async () => {
    if (!capabilities.value.some((entry) => entry.permission === 'admin.audit.read')) return;
    try {
        globalAuditHistory.value = await adminClient.audit.list.query({ limit: 100 });
        globalAuditStatus.value = '';
    } catch {
        globalAuditStatus.value = '감사 원장을 불러오지 못했습니다.';
    }
};

const refreshUserHistory = async () => {
    if (!userResult.value) return;
    userHistory.value = await adminClient.users.listHistory.query({ userId: userResult.value.id, limit: 50 });
    await loadGlobalAudit();
};

const loadCapabilities = async () => {
    try {
        capabilities.value = await adminClient.capabilities.list.query();
        selectedCapability.value = capabilities.value[0]?.permission ?? '';
        await loadGlobalAudit();
    } catch {
        capabilities.value = [];
    }
};

const applyCapabilitySelection = () => {
    const capability = capabilities.value.find((entry) => entry.permission === selectedCapability.value);
    if (!capability) return;
    if (capability.scope === 'PROFILE' && !capabilityProfile.value.trim()) {
        rolesStatus.value = 'Profile 범위를 입력하세요.';
        return;
    }
    rolesInput.value =
        capability.scope === 'PROFILE'
            ? `${capability.permission}:${capabilityProfile.value.trim()}`
            : capability.permission;
};

const updateKakaoGrace = async (clear = false) => {
    if (!userResult.value) return;
    const reason = requireUserActionReason();
    if (!reason) return;
    try {
        const result = await adminClient.users.updateKakaoGrace.mutate({
            userId: userResult.value.id,
            until: clear || !kakaoGraceUntil.value ? null : new Date(kakaoGraceUntil.value).toISOString(),
            reason,
        });
        userResult.value = {
            ...userResult.value,
            kakaoGraceUntil: result.kakaoGraceUntil ?? undefined,
        };
        kakaoGraceStatus.value = result.kakaoGraceUntil ? 'OAuth 유예 연장 완료' : '개별 유예 해제 완료';
        const grace = await adminClient.users.getKakaoGracePolicies.query({ userId: userResult.value.id });
        kakaoPolicies.value = grace.profiles;
        await refreshUserHistory();
    } catch {
        kakaoGraceStatus.value = 'OAuth 유예 변경 실패';
    }
};

const resetUserPassword = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    passwordStatus.value = '';
    passwordResult.value = '';
    try {
        const result = await adminClient.users.resetPassword.mutate({
            userId: userResult.value.id,
            newPassword: passwordInput.value.trim() || undefined,
            reason,
        });
        passwordResult.value = result.password;
        passwordStatus.value = '초기화 완료';
        passwordInput.value = '';
        await refreshUserHistory();
    } catch (error) {
        passwordStatus.value = '초기화 실패';
    }
};

const updateUserRoles = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    const roles = rolesInput.value
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
    if (!roles.length) {
        rolesStatus.value = '역할을 입력하세요.';
        return;
    }
    rolesStatus.value = '';
    try {
        const result = await adminClient.users.updateRoles.mutate({
            userId: userResult.value.id,
            roles,
            mode: rolesMode.value,
            reason,
        });
        userResult.value = { ...userResult.value, roles: result.roles };
        rolesStatus.value = '권한 업데이트 완료';
        await refreshUserHistory();
    } catch (error) {
        rolesStatus.value = '권한 업데이트 실패';
    }
};

const applyBan = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    const until = banUntil.value ? new Date(banUntil.value).toISOString() : null;
    const patch = {
        bannedUntil: until,
        notes: banReason.value.trim() || undefined,
    };
    try {
        const result = await adminClient.users.updateSanctions.mutate({
            userId: userResult.value.id,
            patch,
            reason,
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        banStatus.value = '차단 설정 완료';
        await refreshUserHistory();
    } catch (error) {
        banStatus.value = '차단 설정 실패';
    }
};

const clearBan = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    try {
        const result = await adminClient.users.updateSanctions.mutate({
            userId: userResult.value.id,
            patch: { bannedUntil: null },
            reason,
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        banStatus.value = '차단 해제 완료';
        await refreshUserHistory();
    } catch (error) {
        banStatus.value = '차단 해제 실패';
    }
};

const resetProfileIcon = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    try {
        const result = await adminClient.users.resetProfileIcon.mutate({
            userId: userResult.value.id,
            reason,
        });
        userResult.value = {
            ...userResult.value,
            profileIconResetAt: result.profileIconResetAt,
        };
        profileIconStatus.value = result.flushPublished
            ? '아이콘 초기화 요청 완료'
            : '아이콘은 초기화됐지만 실행 중 서버 알림에 실패했습니다. 다시 요청해 주세요.';
        await refreshUserHistory();
    } catch (error) {
        profileIconStatus.value = '아이콘 초기화 실패';
    }
};

const applyRestriction = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    if (!restrictionProfile.value.trim()) {
        restrictionStatus.value = '서버 프로필명을 입력하세요.';
        return;
    }
    const features = restrictionFeatures.value
        .split(',')
        .map((feature) => feature.trim())
        .filter(Boolean);
    const restriction = {
        blockedFeatures: features.length ? features : undefined,
        until: restrictionUntil.value ? new Date(restrictionUntil.value).toISOString() : undefined,
        reason: restrictionReason.value.trim() || undefined,
        notes: restrictionNotes.value.trim() || undefined,
    };
    try {
        const result = await adminClient.users.setServerRestriction.mutate({
            userId: userResult.value.id,
            profile: restrictionProfile.value.trim(),
            restriction,
            reason,
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        restrictionStatus.value = '서버 제재 적용 완료';
        await refreshUserHistory();
    } catch (error) {
        restrictionStatus.value = '서버 제재 적용 실패';
    }
};

const clearRestriction = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    if (!restrictionProfile.value.trim()) {
        restrictionStatus.value = '서버 프로필명을 입력하세요.';
        return;
    }
    try {
        const result = await adminClient.users.setServerRestriction.mutate({
            userId: userResult.value.id,
            profile: restrictionProfile.value.trim(),
            restriction: null,
            reason,
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        restrictionStatus.value = '서버 제재 해제 완료';
        await refreshUserHistory();
    } catch (error) {
        restrictionStatus.value = '서버 제재 해제 실패';
    }
};

const scheduleDeleteUser = async () => {
    if (!userResult.value) {
        return;
    }
    const reason = requireUserActionReason();
    if (!reason) return;
    if (typeof window !== 'undefined') {
        const confirmed = window.confirm(`${deletionRetentionDays.value}일 보존 후 탈퇴하도록 예약하시겠습니까?`);
        if (!confirmed) {
            return;
        }
    }
    try {
        const result = await adminClient.users.scheduleDeletion.mutate({
            userId: userResult.value.id,
            retentionDays: deletionRetentionDays.value,
            reason,
        });
        userResult.value = { ...userResult.value, deleteAfter: result.deleteAfter };
        forceDeleteStatus.value = `탈퇴 예약 완료: ${new Date(result.deleteAfter).toLocaleString('ko-KR')}`;
        await refreshUserHistory();
    } catch (error) {
        forceDeleteStatus.value = '탈퇴 예약 실패';
    }
};

const createLocalAccount = async () => {
    localAccountStatus.value = '';
    localAccountResult.value = '';
    if (!localAccountEnabled.value) {
        localAccountStatus.value = 'ENV 설정이 비활성화 상태입니다.';
        return;
    }
    const username = localAccountForm.value.username.trim();
    const password = localAccountForm.value.password.trim();
    const displayName = localAccountForm.value.displayName.trim();
    if (!username || !password) {
        localAccountStatus.value = '아이디와 비밀번호를 입력하세요.';
        return;
    }
    localAccountLoading.value = true;
    try {
        const result = await adminClient.users.createLocal.mutate({
            username,
            password,
            displayName: displayName || undefined,
        });
        localAccountResult.value = `생성됨: ${result.user.username} (${result.user.id})`;
        localAccountStatus.value = '로컬 계정 생성 완료';
        localAccountForm.value = {
            username: result.user.username,
            password: '',
            displayName: '',
        };
        userLookupMode.value = 'username';
        userLookupValue.value = result.user.username;
        await lookupUser();
    } catch (error) {
        localAccountStatus.value = '로컬 계정 생성 실패';
    } finally {
        localAccountLoading.value = false;
    }
};

onMounted(() => {
    void loadCapabilities();
    void loadLocalAccountStatus();
    void loadNotice();
    void loadProfiles();
});
</script>

<template>
    <DefaultLayout>
        <div class="max-w-6xl mx-auto px-4 py-10 space-y-10">
            <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div class="space-y-2">
                    <h2 class="text-3xl font-bold text-white">관리자 콘솔</h2>
                    <p class="text-sm text-zinc-400">유저 관리와 서버 운영 제어를 위한 관리자 전용 대시보드입니다.</p>
                </div>
                <RouterLink
                    to="/admin/server-operations"
                    class="rounded bg-amber-500 px-4 py-2 text-center text-sm font-bold text-black hover:bg-amber-400"
                >
                    서버 배포 · 시나리오 초기화
                </RouterLink>
            </div>

            <section class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-3">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-semibold">관리자 세션 토큰</h3>
                    <span class="text-xs text-zinc-500">{{ sessionTokenStatus }}</span>
                </div>
                <div class="flex flex-col md:flex-row gap-3">
                    <input
                        v-model="sessionToken"
                        type="password"
                        class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500"
                        placeholder="세션 토큰 입력"
                    />
                    <button
                        class="bg-yellow-600 hover:bg-yellow-500 text-black font-semibold px-4 py-2 rounded"
                        @click="saveSessionToken"
                    >
                        저장
                    </button>
                </div>
            </section>

            <div class="grid lg:grid-cols-2 gap-8">
                <section class="min-w-0 space-y-6">
                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h3 class="text-lg font-semibold">유저 관리</h3>
                        <form class="space-y-3" @submit.prevent="lookupUser">
                            <div class="flex flex-col md:flex-row gap-2">
                                <select
                                    v-model="userLookupMode"
                                    class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                >
                                    <option value="username">계정명</option>
                                    <option value="email">이메일</option>
                                    <option value="id">UUID</option>
                                </select>
                                <input
                                    v-model="userLookupValue"
                                    type="text"
                                    class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500"
                                    placeholder="검색 값 입력"
                                />
                                <button
                                    class="bg-blue-700 hover:bg-blue-600 text-white font-semibold px-4 py-2 rounded"
                                    :disabled="userLoading"
                                >
                                    조회
                                </button>
                            </div>
                            <div v-if="userError" class="text-xs text-red-400">{{ userError }}</div>
                        </form>

                        <div v-if="userResult" class="bg-zinc-950 border border-zinc-800 rounded p-4 space-y-2">
                            <div class="flex justify-between items-center">
                                <div class="text-sm font-semibold">{{ userResult.username }}</div>
                                <div class="text-xs text-zinc-500">{{ userResult.id }}</div>
                            </div>
                            <div class="text-xs text-zinc-400">표시명: {{ userResult.displayName }}</div>
                            <div class="text-xs text-zinc-400">권한: {{ userResult.roles.join(', ') || '-' }}</div>
                            <div class="text-xs text-zinc-500">
                                OAuth: {{ userResult.oauthType }} {{ userResult.email ?? '' }}
                            </div>
                            <div class="text-xs text-zinc-500">
                                Kakao 인증: {{ userResult.kakaoVerifiedAt ? '완료' : '미완료' }} · 유예 시작:
                                {{ new Date(userResult.kakaoGraceStartedAt).toLocaleString('ko-KR') }}
                            </div>
                            <div v-if="userResult.kakaoGraceUntil" class="text-xs text-amber-300">
                                관리자 유예: {{ new Date(userResult.kakaoGraceUntil).toLocaleString('ko-KR') }}까지
                            </div>
                            <div v-if="userResult.deleteAfter" class="text-xs text-red-300">
                                탈퇴 예약: {{ new Date(userResult.deleteAfter).toLocaleString('ko-KR') }}
                            </div>
                            <div class="text-xs text-zinc-500">가입일: {{ userResult.createdAt }}</div>
                            <div class="text-xs text-zinc-400 mt-2">제재 상태</div>
                            <pre class="text-[11px] text-zinc-400 bg-black/50 p-2 rounded whitespace-pre-wrap"
                                >{{ JSON.stringify(userResult.sanctions, null, 2) }}
              </pre>
                        </div>
                    </div>

                    <div class="bg-zinc-900 border border-amber-800/70 rounded-lg p-5 space-y-3">
                        <h4 class="text-base font-semibold">민감 조치 공통 사유</h4>
                        <input
                            v-model="userActionReason"
                            type="text"
                            maxlength="200"
                            class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                            placeholder="권한·제재·복구·탈퇴 조치 사유 (필수)"
                        />
                        <div class="text-xs text-zinc-500">사유와 정화된 입력은 관리자 감사 원장에 기록됩니다.</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <div class="flex items-center justify-between">
                            <h4 class="text-base font-semibold">로컬 계정 생성</h4>
                            <span class="text-xs text-zinc-500"> ENV {{ localAccountEnabled ? 'ON' : 'OFF' }} </span>
                        </div>
                        <div class="text-xs text-zinc-500">카카오 OAuth 없이 로그인 가능한 계정을 생성합니다.</div>
                        <div class="grid gap-2">
                            <input
                                v-model="localAccountForm.username"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="아이디"
                                :disabled="!localAccountEnabled || localAccountLoading"
                            />
                            <input
                                v-model="localAccountForm.password"
                                type="password"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="비밀번호"
                                :disabled="!localAccountEnabled || localAccountLoading"
                            />
                            <input
                                v-model="localAccountForm.displayName"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="표시명 (선택)"
                                :disabled="!localAccountEnabled || localAccountLoading"
                            />
                            <button
                                class="bg-cyan-600 hover:bg-cyan-500 text-black font-semibold px-4 py-2 rounded"
                                :disabled="!localAccountEnabled || localAccountLoading"
                                @click="createLocalAccount"
                            >
                                계정 생성
                            </button>
                        </div>
                        <div class="text-xs text-zinc-500">{{ localAccountStatus }}</div>
                        <div v-if="localAccountResult" class="text-xs text-emerald-400">
                            {{ localAccountResult }}
                        </div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">비밀번호 리셋</h4>
                        <div class="flex flex-col md:flex-row gap-2">
                            <input
                                v-model="passwordInput"
                                type="text"
                                class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="직접 지정 시 입력"
                                :disabled="!hasUser"
                            />
                            <button
                                class="bg-emerald-600 hover:bg-emerald-500 text-black font-semibold px-4 py-2 rounded"
                                :disabled="!hasUser"
                                @click="resetUserPassword"
                            >
                                초기화
                            </button>
                        </div>
                        <div class="text-xs text-zinc-400">임시 비밀번호: {{ passwordResult || '-' }}</div>
                        <div class="text-xs text-zinc-500">{{ passwordStatus }}</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">특수 권한 부여</h4>
                        <div class="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                            <select
                                v-model="selectedCapability"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                            >
                                <option
                                    v-for="capability in capabilities"
                                    :key="capability.permission"
                                    :value="capability.permission"
                                >
                                    {{ capability.label }} · {{ capability.risk }}
                                </option>
                            </select>
                            <input
                                v-model="capabilityProfile"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="Profile 범위 (예: che:default)"
                                :disabled="!hasUser"
                            />
                            <button
                                class="bg-zinc-700 hover:bg-zinc-600 px-3 py-2 rounded text-sm"
                                :disabled="!hasUser"
                                @click="applyCapabilitySelection"
                            >
                                선택 반영
                            </button>
                        </div>
                        <div v-if="selectedCapability" class="text-xs text-zinc-500">
                            {{ capabilities.find((item) => item.permission === selectedCapability)?.description }}
                        </div>
                        <div class="flex flex-col md:flex-row gap-2">
                            <select
                                v-model="rolesMode"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                            >
                                <option value="grant">추가</option>
                                <option value="revoke">제거</option>
                                <option value="set">덮어쓰기</option>
                            </select>
                            <input
                                v-model="rolesInput"
                                type="text"
                                class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="admin, moderator 등"
                                :disabled="!hasUser"
                            />
                            <button
                                class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded"
                                :disabled="!hasUser"
                                @click="updateUserRoles"
                            >
                                적용
                            </button>
                        </div>
                        <div class="text-xs text-zinc-500">{{ rolesStatus }}</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">Kakao 인증 유예</h4>
                        <div class="text-xs text-zinc-500">
                            기본·서버별 유예가 끝난 사용자를 예외적으로 더 허용할 때 사용합니다.
                        </div>
                        <div class="flex flex-col md:flex-row gap-2">
                            <input
                                v-model="kakaoGraceUntil"
                                type="datetime-local"
                                class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                            />
                            <button
                                class="bg-yellow-600 hover:bg-yellow-500 text-black px-4 py-2 rounded"
                                :disabled="!hasUser"
                                @click="updateKakaoGrace(false)"
                            >
                                유예 연장
                            </button>
                            <button
                                class="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded"
                                :disabled="!hasUser"
                                @click="updateKakaoGrace(true)"
                            >
                                개별 유예 해제
                            </button>
                        </div>
                        <div class="text-xs text-zinc-500">{{ kakaoGraceStatus }}</div>
                        <div class="overflow-x-auto">
                            <table class="w-full min-w-[620px] text-xs">
                                <thead class="text-zinc-500">
                                    <tr>
                                        <th class="p-2 text-left">Profile</th>
                                        <th>접근</th>
                                        <th>장수 생성</th>
                                        <th>기본 접근 유예</th>
                                        <th>종료</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for="policy in kakaoPolicies"
                                        :key="policy.profileName"
                                        class="border-t border-zinc-800"
                                    >
                                        <td class="p-2">{{ policy.profileName }}</td>
                                        <td class="text-center">{{ policy.accessAllowed ? '허용' : '차단' }}</td>
                                        <td class="text-center">{{ policy.canCreateGeneral ? '허용' : '차단' }}</td>
                                        <td class="text-center">{{ policy.accessGraceDays }}일</td>
                                        <td class="text-center">
                                            {{
                                                policy.graceEndsAt
                                                    ? new Date(policy.graceEndsAt).toLocaleString('ko-KR')
                                                    : '-'
                                            }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">유저 차단</h4>
                        <div class="flex flex-col gap-2">
                            <input
                                v-model="banUntil"
                                type="datetime-local"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                            />
                            <input
                                v-model="banReason"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="사유"
                                :disabled="!hasUser"
                            />
                            <div class="flex gap-2">
                                <button
                                    class="bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2 rounded"
                                    :disabled="!hasUser"
                                    @click="applyBan"
                                >
                                    차단 설정
                                </button>
                                <button
                                    class="bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-4 py-2 rounded"
                                    :disabled="!hasUser"
                                    @click="clearBan"
                                >
                                    차단 해제
                                </button>
                            </div>
                        </div>
                        <div class="text-xs text-zinc-500">{{ banStatus }}</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">서버별 기능 제재</h4>
                        <div class="grid gap-2">
                            <input
                                v-model="restrictionProfile"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="profile:scenario"
                                :disabled="!hasUser"
                            />
                            <input
                                v-model="restrictionFeatures"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="login, message 등"
                                :disabled="!hasUser"
                            />
                            <input
                                v-model="restrictionUntil"
                                type="datetime-local"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                            />
                            <input
                                v-model="restrictionReason"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="사유"
                                :disabled="!hasUser"
                            />
                            <input
                                v-model="restrictionNotes"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="메모"
                                :disabled="!hasUser"
                            />
                            <div class="flex gap-2">
                                <button
                                    class="bg-amber-600 hover:bg-amber-500 text-black font-semibold px-4 py-2 rounded"
                                    :disabled="!hasUser"
                                    @click="applyRestriction"
                                >
                                    제재 적용
                                </button>
                                <button
                                    class="bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-4 py-2 rounded"
                                    :disabled="!hasUser"
                                    @click="clearRestriction"
                                >
                                    제재 해제
                                </button>
                            </div>
                        </div>
                        <div class="text-xs text-zinc-500">{{ restrictionStatus }}</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">프로필 아이콘 초기화</h4>
                        <button
                            class="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-4 py-2 rounded"
                            :disabled="!hasUser"
                            @click="resetProfileIcon"
                        >
                            아이콘 초기화 요청
                        </button>
                        <div class="text-xs text-zinc-500">{{ profileIconStatus }}</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold text-red-400">관리자 탈퇴 예약</h4>
                        <input
                            v-model.number="deletionRetentionDays"
                            type="number"
                            min="1"
                            max="90"
                            class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                            aria-label="탈퇴 전 보존 일수"
                            :disabled="!hasUser"
                        />
                        <button
                            class="bg-red-700 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded"
                            :disabled="!hasUser"
                            @click="scheduleDeleteUser"
                        >
                            보존 기간 후 탈퇴 예약
                        </button>
                        <div class="text-xs text-zinc-500">{{ forceDeleteStatus }}</div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <h4 class="text-base font-semibold">사용자 관리자 조치 이력</h4>
                        <div v-if="!userHistory.length" class="text-xs text-zinc-500">기록이 없습니다.</div>
                        <div v-else class="max-h-80 overflow-auto space-y-2">
                            <div
                                v-for="event in userHistory"
                                :key="event.id"
                                class="border border-zinc-800 rounded p-3 text-xs"
                            >
                                <div class="flex justify-between gap-3">
                                    <span
                                        :class="
                                            event.outcome === 'FAILED'
                                                ? 'text-red-300'
                                                : event.outcome === 'SUCCEEDED'
                                                  ? 'text-emerald-300'
                                                  : 'text-amber-300'
                                        "
                                    >
                                        {{ event.outcome }} · {{ event.action }}
                                    </span>
                                    <span class="text-zinc-500">{{
                                        new Date(event.createdAt).toLocaleString('ko-KR')
                                    }}</span>
                                </div>
                                <div class="text-zinc-400">
                                    {{ event.actorUsername }} · {{ event.reason ?? '사유 없음' }}
                                </div>
                                <div v-if="event.errorMessage" class="text-red-300">{{ event.errorMessage }}</div>
                                <pre class="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-500">{{
                                    JSON.stringify(event.summary, null, 2)
                                }}</pre>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="min-w-0 space-y-6">
                    <div
                        v-if="capabilities.some((entry) => entry.permission === 'admin.audit.read')"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
                        <div class="flex items-center justify-between gap-3">
                            <h3 class="text-lg font-semibold">전체 관리자 감사 원장</h3>
                            <button
                                class="rounded bg-zinc-700 px-3 py-2 text-xs hover:bg-zinc-600"
                                @click="loadGlobalAudit"
                            >
                                새로고침
                            </button>
                        </div>
                        <div v-if="globalAuditStatus" class="text-xs text-red-400">{{ globalAuditStatus }}</div>
                        <div v-if="!globalAuditHistory.length" class="text-xs text-zinc-500">기록이 없습니다.</div>
                        <div v-else class="max-h-96 space-y-2 overflow-auto">
                            <div
                                v-for="event in globalAuditHistory"
                                :key="event.id"
                                class="rounded border border-zinc-800 p-3 text-xs"
                            >
                                <div class="flex justify-between gap-3">
                                    <span
                                        :class="
                                            event.outcome === 'FAILED'
                                                ? 'text-red-300'
                                                : event.outcome === 'SUCCEEDED'
                                                  ? 'text-emerald-300'
                                                  : 'text-amber-300'
                                        "
                                    >
                                        {{ event.outcome }} · {{ event.action }}
                                    </span>
                                    <span class="text-zinc-500">{{
                                        new Date(event.createdAt).toLocaleString('ko-KR')
                                    }}</span>
                                </div>
                                <div class="text-zinc-400">
                                    {{ event.actorUsername }} · {{ event.targetType ?? '-' }}
                                    {{ event.targetId ?? event.profileName ?? '' }} · {{ event.reason ?? '사유 없음' }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                        <div class="flex justify-between items-center">
                            <h3 class="text-lg font-semibold">서버 공지</h3>
                            <span class="text-xs text-zinc-500">{{ noticeStatus }}</span>
                        </div>
                        <textarea
                            v-model="noticeDraft"
                            class="w-full bg-zinc-950 border border-zinc-700 rounded p-3 text-sm text-white min-h-[140px]"
                            placeholder="로비 공지 입력"
                        />
                        <div class="flex gap-2">
                            <button
                                class="bg-blue-700 hover:bg-blue-600 text-white font-semibold px-4 py-2 rounded"
                                :disabled="noticeLoading"
                                @click="saveNotice"
                            >
                                공지 저장
                            </button>
                            <button
                                class="bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-4 py-2 rounded"
                                :disabled="noticeLoading"
                                @click="loadNotice"
                            >
                                다시 불러오기
                            </button>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <h3 class="text-lg font-semibold">서버별 관리</h3>
                            <button
                                class="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-3 py-1.5 rounded"
                                :disabled="profilesLoading"
                                @click="loadProfiles"
                            >
                                새로고침
                            </button>
                        </div>
                        <div
                            v-for="profile in profiles"
                            :key="profile.profileName"
                            class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                        >
                            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                <div>
                                    <div class="text-base font-semibold">
                                        {{ profile.profileName }} ({{ profile.profile }})
                                    </div>
                                    <div class="text-xs text-zinc-500">시나리오: {{ profile.scenario }}</div>
                                </div>
                                <div class="text-xs text-zinc-400">
                                    상태: {{ profile.status }} / API: {{ profile.runtime.apiRunning ? 'ON' : 'OFF' }} /
                                    DAEMON: {{ profile.runtime.daemonRunning ? 'ON' : 'OFF' }} / AUCTION:
                                    {{ profile.runtime.auctionRunning ? 'ON' : 'OFF' }} / BATTLE SIM:
                                    {{ profile.runtime.battleSimRunning ? 'ON' : 'OFF' }} / TOURNAMENT:
                                    {{ profile.runtime.tournamentRunning ? 'ON' : 'OFF' }}
                                </div>
                            </div>

                            <div class="text-xs text-zinc-400">빌드 커밋: {{ profile.buildCommitSha ?? '미지정' }}</div>

                            <div class="grid md:grid-cols-2 gap-3">
                                <div class="space-y-2">
                                    <label class="text-xs text-zinc-400">표시명</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].korName"
                                        type="text"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                    />
                                    <label class="text-xs text-zinc-400">색상</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].color"
                                        type="text"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                    />
                                    <label class="text-xs text-zinc-400">인게임 공지</label>
                                    <textarea
                                        v-model="profileEdits[profile.profileName].inGameNotice"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-white min-h-[80px]"
                                    />
                                    <label class="text-xs text-zinc-400">프로필 이미지</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].profileImageUrl"
                                        type="text"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                    />
                                    <label class="text-xs text-zinc-400">다음 시즌 번호</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].nextSeasonIdx"
                                        type="number"
                                        min="0"
                                        step="1"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                        placeholder="예: 12"
                                    />
                                    <div class="text-xs text-zinc-500">리셋 시 적용할 시즌 번호를 지정합니다.</div>
                                    <label class="text-xs text-zinc-400">Kakao 미인증 접근 유예일</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].localAccountAccessGraceDays"
                                        type="number"
                                        min="0"
                                        max="365"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                        placeholder="비우면 Gateway 기본값"
                                    />
                                    <label class="text-xs text-zinc-400">Kakao 미인증 장수 생성 유예일</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].localAccountGeneralCreationGraceDays"
                                        type="number"
                                        min="0"
                                        max="365"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                        placeholder="비우면 서버 기본값"
                                    />
                                    <div class="text-xs text-zinc-500">
                                        게임 규칙 자체가 아니라 Gateway가 game token을 발급할 때 적용하는 profile별 계정
                                        정책입니다.
                                    </div>
                                    <label class="text-xs text-zinc-400">메타 변경 사유</label>
                                    <input
                                        v-model="profileEdits[profile.profileName].reason"
                                        type="text"
                                        maxlength="200"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                        placeholder="변경 사유 (필수)"
                                    />
                                    <button
                                        class="bg-emerald-600 hover:bg-emerald-500 text-black font-semibold px-4 py-2 rounded"
                                        @click="updateProfileMeta(profile.profileName)"
                                    >
                                        메타 저장
                                    </button>
                                </div>

                                <div class="space-y-2">
                                    <label class="text-xs text-zinc-400">특수 동작 메모</label>
                                    <input
                                        v-model="profileActions[profile.profileName].reason"
                                        type="text"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                        placeholder="사유 / 메모"
                                    />
                                    <label
                                        class="text-xs text-zinc-400"
                                        :for="`runtime-duration-${profile.profileName}`"
                                    >
                                        가속/연기 (분)
                                    </label>
                                    <input
                                        :id="`runtime-duration-${profile.profileName}`"
                                        v-model="profileActions[profile.profileName].durationMinutes"
                                        type="number"
                                        min="1"
                                        max="1440"
                                        step="1"
                                        :aria-describedby="`runtime-duration-help-${profile.profileName}`"
                                        :aria-invalid="
                                            profileActions[profile.profileName].durationMinutes
                                                ? !validDuration(profile.profileName)
                                                : undefined
                                        "
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                    />
                                    <div
                                        :id="`runtime-duration-help-${profile.profileName}`"
                                        class="text-xs text-zinc-500"
                                    >
                                        1~1440 사이의 정수로 입력해 주세요.
                                    </div>
                                    <label class="text-xs text-zinc-400">리셋 예약</label>
                                    <input
                                        v-model="profileActions[profile.profileName].scheduledAt"
                                        type="datetime-local"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                    />
                                    <div class="grid grid-cols-2 gap-2 pt-2">
                                        <button
                                            class="bg-blue-700 hover:bg-blue-600 text-white font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'RESUME')"
                                        >
                                            재개
                                        </button>
                                        <button
                                            class="bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'PAUSE')"
                                        >
                                            일시정지
                                        </button>
                                        <button
                                            class="bg-red-700 hover:bg-red-600 text-white font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'STOP')"
                                        >
                                            중지
                                        </button>
                                        <button
                                            class="bg-orange-600 hover:bg-orange-500 text-black font-semibold px-3 py-2 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                            :disabled="
                                                profileActionSubmitting[profile.profileName] ||
                                                !validDuration(profile.profileName) ||
                                                runtimeActionPending(profile)
                                            "
                                            @click="requestProfileAction(profile.profileName, 'ACCELERATE')"
                                        >
                                            가속
                                        </button>
                                        <button
                                            class="bg-yellow-600 hover:bg-yellow-500 text-black font-semibold px-3 py-2 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                            :disabled="
                                                profileActionSubmitting[profile.profileName] ||
                                                !validDuration(profile.profileName) ||
                                                runtimeActionPending(profile)
                                            "
                                            @click="requestProfileAction(profile.profileName, 'DELAY')"
                                        >
                                            연기
                                        </button>
                                        <button
                                            class="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'RESET_NOW')"
                                        >
                                            즉시 리셋
                                        </button>
                                        <button
                                            class="bg-purple-800 hover:bg-purple-700 text-white font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'RESET_SCHEDULED')"
                                        >
                                            리셋 예약
                                        </button>
                                        <button
                                            class="bg-zinc-800 text-zinc-500 font-semibold px-3 py-2 rounded cursor-not-allowed"
                                            disabled
                                            title="게임 내 설문 관리 화면에서 생성해 주세요."
                                            :aria-describedby="`survey-action-help-${profile.profileName}`"
                                        >
                                            설문 오픈 (게임 내 관리)
                                        </button>
                                        <button
                                            class="bg-black hover:bg-zinc-800 text-white font-semibold px-3 py-2 rounded col-span-2"
                                            @click="requestProfileAction(profile.profileName, 'SHUTDOWN')"
                                        >
                                            서버 폐쇄
                                        </button>
                                    </div>
                                    <div class="text-xs text-zinc-500">
                                        {{ profileActionStatus[profile.profileName] }}
                                    </div>
                                    <div
                                        v-if="profile.runtimeActions[0]"
                                        class="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs"
                                        role="status"
                                        aria-live="polite"
                                    >
                                        <div :class="runtimeActionStatusClass(profile.runtimeActions[0].status)">
                                            {{ profile.runtimeActions[0].status }} ·
                                            {{ profile.runtimeActions[0].action }}
                                            {{
                                                profile.runtimeActions[0].durationMinutes
                                                    ? `${profile.runtimeActions[0].durationMinutes}분`
                                                    : ''
                                            }}
                                        </div>
                                        <div v-if="profile.runtimeActions[0].detail" class="mt-1 text-zinc-500">
                                            {{ profile.runtimeActions[0].detail }}
                                        </div>
                                        <div
                                            v-if="
                                                profile.runtimeActions[0].handler || profile.runtimeActions[0].handledAt
                                            "
                                            class="mt-1 text-zinc-600"
                                        >
                                            {{ profile.runtimeActions[0].handler || '처리자 미상' }}
                                            {{
                                                profile.runtimeActions[0].handledAt
                                                    ? ` · ${formatRuntimeActionTime(profile.runtimeActions[0].handledAt)}`
                                                    : ''
                                            }}
                                        </div>
                                    </div>
                                    <div
                                        :id="`survey-action-help-${profile.profileName}`"
                                        class="text-xs text-zinc-500"
                                    >
                                        설문 생성은 해당 게임의 설문 관리 화면에서 진행해 주세요.
                                    </div>
                                    <button type="button" class="text-xs text-zinc-400 underline" @click="loadProfiles">
                                        실제 처리 상태 새로고침
                                    </button>
                                </div>
                            </div>

                            <div
                                v-if="profileInstalls[profile.profileName]"
                                class="border-t border-zinc-800 pt-4 space-y-3"
                            >
                                <div class="flex items-center justify-between">
                                    <h4 class="text-sm font-semibold">설치/리셋</h4>
                                    <div class="text-right text-xs text-zinc-500">
                                        <div>{{ profileInstallStatus[profile.profileName] }}</div>
                                        <RouterLink
                                            v-if="profileInstallOperationId[profile.profileName]"
                                            :to="{
                                                path: '/admin/server-operations',
                                                query: { operationId: profileInstallOperationId[profile.profileName] },
                                            }"
                                            class="block break-all text-amber-400 underline hover:text-amber-300"
                                        >
                                            작업 {{ profileInstallOperationId[profile.profileName] }} 상태 보기
                                        </RouterLink>
                                    </div>
                                </div>
                                <div class="grid lg:grid-cols-2 gap-4">
                                    <div class="space-y-3">
                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">Git ref (선택)</label>
                                            <div class="flex gap-2">
                                                <input
                                                    v-model="profileInstalls[profile.profileName].gitRef"
                                                    type="text"
                                                    class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                    placeholder="main / v1.0.0 / abc123"
                                                />
                                                <button
                                                    class="bg-zinc-700 hover:bg-zinc-600 text-white text-sm px-3 py-2 rounded"
                                                    :disabled="getScenarioLoading(profile.profileName)"
                                                    @click="loadScenariosForProfile(profile.profileName)"
                                                >
                                                    불러오기
                                                </button>
                                            </div>
                                            <div class="text-xs text-zinc-500">
                                                비워두면 현재 저장소 기준으로 불러옵니다.
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">시나리오 선택</label>
                                            <select
                                                v-model.number="profileInstalls[profile.profileName].scenarioId"
                                                class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                :disabled="getScenarioLoading(profile.profileName)"
                                            >
                                                <option v-if="getScenarioLoading(profile.profileName)" disabled>
                                                    불러오는 중...
                                                </option>
                                                <template
                                                    v-for="(items, group) in getScenarioGroups(profile.profileName)"
                                                    :key="group"
                                                >
                                                    <optgroup :label="group">
                                                        <option
                                                            v-for="scenario in items"
                                                            :key="scenario.id"
                                                            :value="scenario.id"
                                                        >
                                                            {{ scenario.title }}
                                                        </option>
                                                    </optgroup>
                                                </template>
                                            </select>
                                            <div
                                                v-if="getScenarioStatus(profile.profileName)"
                                                class="text-xs text-red-400"
                                            >
                                                {{ getScenarioStatus(profile.profileName) }}
                                            </div>
                                        </div>

                                        <div class="grid grid-cols-2 gap-2">
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">턴 시간(분)</label>
                                                <select
                                                    v-model.number="
                                                        profileInstalls[profile.profileName].turnTermMinutes
                                                    "
                                                    class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                >
                                                    <option v-for="term in turnTermOptions" :key="term" :value="term">
                                                        {{ term }}
                                                    </option>
                                                </select>
                                            </div>
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">시간 동기화</label>
                                                <div class="flex gap-2">
                                                    <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                        <input
                                                            v-model="profileInstalls[profile.profileName].sync"
                                                            class="accent-yellow-500"
                                                            type="radio"
                                                            :value="true"
                                                        />
                                                        Y
                                                    </label>
                                                    <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                        <input
                                                            v-model="profileInstalls[profile.profileName].sync"
                                                            class="accent-yellow-500"
                                                            type="radio"
                                                            :value="false"
                                                        />
                                                        N
                                                    </label>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">NPC 상성</label>
                                            <div class="flex gap-2">
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].fiction"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="0"
                                                    />
                                                    연의
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].fiction"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="1"
                                                    />
                                                    가상
                                                </label>
                                            </div>
                                        </div>

                                        <div class="grid grid-cols-2 gap-2">
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">확장 NPC</label>
                                                <div class="flex gap-2">
                                                    <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                        <input
                                                            v-model="profileInstalls[profile.profileName].extend"
                                                            class="accent-yellow-500"
                                                            type="radio"
                                                            :value="true"
                                                        />
                                                        포함
                                                    </label>
                                                    <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                        <input
                                                            v-model="profileInstalls[profile.profileName].extend"
                                                            class="accent-yellow-500"
                                                            type="radio"
                                                            :value="false"
                                                        />
                                                        미포함
                                                    </label>
                                                </div>
                                            </div>
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">임관 모드</label>
                                                <div class="flex gap-2">
                                                    <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                        <input
                                                            v-model="profileInstalls[profile.profileName].joinMode"
                                                            class="accent-yellow-500"
                                                            type="radio"
                                                            value="full"
                                                        />
                                                        일반
                                                    </label>
                                                    <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                        <input
                                                            v-model="profileInstalls[profile.profileName].joinMode"
                                                            class="accent-yellow-500"
                                                            type="radio"
                                                            value="onlyRandom"
                                                        />
                                                        랜덤 임관
                                                    </label>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">장수 임의 생성</label>
                                            <div class="flex gap-2 flex-wrap">
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].blockGeneralCreate
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="0"
                                                    />
                                                    가능
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].blockGeneralCreate
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="2"
                                                    />
                                                    장수명 무작위
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].blockGeneralCreate
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="1"
                                                    />
                                                    불가
                                                </label>
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">NPC 빙의</label>
                                            <div class="flex gap-2 flex-wrap">
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].npcMode"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="1"
                                                    />
                                                    가능
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].npcMode"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="0"
                                                    />
                                                    불가
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].npcMode"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="2"
                                                    />
                                                    선택 생성 가능
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="space-y-3">
                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">이미지 표기</label>
                                            <div class="flex gap-2 flex-wrap">
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].showImgLevel
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="0"
                                                    />
                                                    안함
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].showImgLevel
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="1"
                                                    />
                                                    전콘
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].showImgLevel
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="2"
                                                    />
                                                    전콘, 병종
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="
                                                            profileInstalls[profile.profileName].showImgLevel
                                                        "
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="3"
                                                    />
                                                    전콘, 병종, NPC
                                                </label>
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">토너먼트 자동 시작</label>
                                            <div class="flex gap-2">
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model="profileInstalls[profile.profileName].tournamentTrig"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="false"
                                                    />
                                                    수동
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model="profileInstalls[profile.profileName].tournamentTrig"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="true"
                                                    />
                                                    자동
                                                </label>
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">휴식 턴 자동 행동</label>
                                            <div class="flex flex-wrap gap-2">
                                                <label
                                                    v-for="option in autorunOptionLabels"
                                                    :key="option.key"
                                                    class="flex items-center gap-1 text-xs text-zinc-300"
                                                >
                                                    <input
                                                        v-model="
                                                            profileInstalls[profile.profileName].autorunUserOptions[
                                                                option.key
                                                            ]
                                                        "
                                                        class="accent-yellow-500"
                                                        type="checkbox"
                                                    />
                                                    {{ option.label }}
                                                </label>
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">유효 시간(분)</label>
                                            <select
                                                v-model.number="profileInstalls[profile.profileName].autorunUserMinutes"
                                                class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                            >
                                                <option :value="0">꺼짐</option>
                                                <option :value="43200">항상</option>
                                                <option :value="10">10분</option>
                                                <option :value="20">20분</option>
                                                <option :value="30">30분</option>
                                                <option :value="60">1시간</option>
                                                <option :value="120">2시간</option>
                                                <option :value="180">3시간</option>
                                                <option :value="240">4시간</option>
                                                <option :value="360">6시간</option>
                                                <option :value="480">8시간</option>
                                                <option :value="600">10시간</option>
                                                <option :value="720">12시간</option>
                                                <option :value="1440">24시간</option>
                                                <option :value="2160">36시간</option>
                                                <option :value="2880">48시간</option>
                                                <option :value="3600">60시간</option>
                                                <option :value="4320">72시간</option>
                                            </select>
                                        </div>

                                        <div class="grid grid-cols-2 gap-2">
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">오픈 예약</label>
                                                <input
                                                    v-model="profileInstalls[profile.profileName].openAt"
                                                    type="datetime-local"
                                                    class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                />
                                            </div>
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">가오픈 예약</label>
                                                <input
                                                    v-model="profileInstalls[profile.profileName].preopenAt"
                                                    type="datetime-local"
                                                    class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                />
                                            </div>
                                        </div>

                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">설치 메모</label>
                                            <input
                                                v-model="profileInstalls[profile.profileName].reason"
                                                type="text"
                                                class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                placeholder="사유/메모"
                                            />
                                        </div>

                                        <button
                                            class="bg-emerald-600 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 text-black font-semibold px-4 py-2 rounded w-full"
                                            :disabled="
                                                profileInstallSubmitting[profile.profileName] ||
                                                Boolean(profile.activeOperation)
                                            "
                                            @click="requestInstall(profile.profileName)"
                                        >
                                            {{
                                                profileInstallSubmitting[profile.profileName]
                                                    ? '등록 중…'
                                                    : profile.activeOperation
                                                      ? '설치 작업 진행 중'
                                                      : '설치 적용'
                                            }}
                                        </button>

                                        <div
                                            v-if="getScenarioPreview(profile.profileName)"
                                            class="bg-zinc-950 border border-zinc-800 rounded p-3 text-xs text-zinc-300 space-y-2"
                                        >
                                            <div class="font-semibold text-zinc-200">
                                                {{ getScenarioPreview(profile.profileName)?.title }}
                                            </div>
                                            <div>
                                                시작 연도: {{ getScenarioPreview(profile.profileName)?.year ?? '-' }}년
                                            </div>
                                            <div>
                                                NPC: {{ getScenarioPreview(profile.profileName)?.npcCount }}명
                                                <span v-if="getScenarioPreview(profile.profileName)?.npcExCount"
                                                    >+{{ getScenarioPreview(profile.profileName)?.npcExCount }}명</span
                                                >
                                                <span v-if="getScenarioPreview(profile.profileName)?.npcNeutralCount">
                                                    / 중립
                                                    {{ getScenarioPreview(profile.profileName)?.npcNeutralCount }}명
                                                </span>
                                            </div>
                                            <div class="space-y-1">
                                                <div class="text-zinc-400">국가</div>
                                                <div class="space-y-1">
                                                    <div
                                                        v-for="nation in getScenarioPreview(profile.profileName)
                                                            ?.nations ?? []"
                                                        :key="nation.id"
                                                        class="text-[11px]"
                                                    >
                                                        <span :style="{ color: nation.color }">{{ nation.name }}</span>
                                                        {{ nation.generals }}명
                                                        <span v-if="nation.generalsEx">(+{{ nation.generalsEx }})</span>
                                                        <span class="text-zinc-500"
                                                            >· {{ nation.cities.join(', ') }}</span
                                                        >
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div v-if="profileActionStatus.global" class="text-xs text-red-400">
                            {{ profileActionStatus.global }}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </DefaultLayout>
</template>
