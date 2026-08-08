<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminConsoleLayout from '../layouts/AdminConsoleLayout.vue';
import { trpc } from '../utils/trpc';

type AdminSection = 'users' | 'servers' | 'system' | 'audit';

const props = defineProps<{
    section: AdminSection;
    profileName?: string;
}>();

const pageMeta: Record<AdminSection, { title: string; description: string; eyebrow: string }> = {
    users: {
        title: '사용자 관리',
        description: '계정 조회와 생성, 인증 유예, 권한, 제재, 복구 및 탈퇴 예약을 한 사용자 단위로 관리합니다.',
        eyebrow: 'Accounts and access',
    },
    servers: {
        title: '서버 관리',
        description: '프로필별 공개 정보와 계정 정책, 게임 실행 상태 및 운영 동작을 관리합니다.',
        eyebrow: 'Profile operations',
    },
    system: {
        title: '공지 · 접속',
        description: 'Gateway 공통 공지와 관리자 세션 연결 상태를 관리합니다.',
        eyebrow: 'Gateway settings',
    },
    audit: {
        title: '감사 로그',
        description: '관리자 조치의 실행 결과, 대상과 사유를 시간순으로 확인합니다.',
        eyebrow: 'Audit trail',
    },
};

const currentPage = computed(() => pageMeta[props.section]);

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

type AdminUserListItem = {
    id: string;
    username: string;
    displayName: string;
    email?: string;
    oauthType: 'NONE' | 'KAKAO';
    roles: string[];
    hasActiveSanction: boolean;
    deleteAfter?: string;
    createdAt: string;
};

type UserWorkspaceSection = 'account' | 'access' | 'restrictions' | 'lifecycle';

type AdminCapability = {
    permission: string;
    label: string;
    description: string;
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    scope: 'GLOBAL' | 'PROFILE';
    scopes?: string[];
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
    specialAccess: {
        kind: 'OPERATOR' | SpecialAccountAccessGrant['kind'];
        grantId: string | null;
        expiresAt: string | null;
        allowsGeneralCreation: boolean;
    } | null;
};

type SpecialAccountAccessGrant = {
    id: string;
    userId: string;
    kind: 'TESTER' | 'RECOVERY' | 'OTHER';
    profiles: string[];
    allowsGeneralCreation: boolean;
    expiresAt?: string;
    reason: string;
    grantedByUserId: string;
    revokedAt?: string;
    revokedReason?: string;
    createdAt: string;
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
        list: {
            query: (input?: { query?: string; limit?: number; cursor?: string }) => Promise<{
                users: AdminUserListItem[];
                total: number;
                nextCursor?: string;
            }>;
        };
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
                specialAccessGrants: SpecialAccountAccessGrant[];
                profiles: KakaoGracePolicy[];
            }>;
        };
        updateKakaoGrace: {
            mutate: (input: { userId: string; until: string | null; reason: string }) => Promise<{
                kakaoGraceUntil: string | null;
            }>;
        };
        grantSpecialAccess: {
            mutate: (input: {
                userId: string;
                kind: SpecialAccountAccessGrant['kind'];
                profiles: string[];
                allowsGeneralCreation: boolean;
                expiresAt: string | null;
                reason: string;
            }) => Promise<SpecialAccountAccessGrant>;
        };
        revokeSpecialAccess: {
            mutate: (input: { userId: string; grantId: string; reason: string }) => Promise<SpecialAccountAccessGrant>;
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
const visibleProfiles = computed(() =>
    props.profileName ? profiles.value.filter((profile) => profile.profileName === props.profileName) : profiles.value
);

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

const userLookupMode = ref<'username' | 'id' | 'email'>('username');
const userLookupValue = ref('');
const userLoading = ref(false);
const userError = ref('');
const userResult = ref<AdminUser | null>(null);
const userDirectoryQuery = ref('');
const userDirectory = ref<AdminUserListItem[]>([]);
const userDirectoryTotal = ref(0);
const userDirectoryNextCursor = ref<string>();
const userDirectoryLoading = ref(false);
const userDirectoryError = ref('');
const userWorkspaceSection = ref<UserWorkspaceSection>('account');

const userWorkspaceSections: Array<{ id: UserWorkspaceSection; label: string; description: string }> = [
    { id: 'account', label: '계정', description: '기본 정보와 로컬 계정 생성' },
    { id: 'access', label: '접근 · 권한', description: '비밀번호, 운영 권한, Kakao 접근' },
    { id: 'restrictions', label: '보안 · 제재', description: '차단, 서버 제한, 아이콘 초기화' },
    { id: 'lifecycle', label: '탈퇴 · 이력', description: '탈퇴 예약과 관리자 조치 이력' },
];

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
const hasCapability = (permission: string, profileName?: string): boolean =>
    capabilities.value.some((entry) => {
        if (entry.permission !== permission && entry.permission !== 'admin.profiles.manage') return false;
        if (!profileName || entry.scope === 'GLOBAL') return true;
        return !entry.scopes?.length || entry.scopes.includes('*') || entry.scopes.includes(profileName);
    });
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
const specialAccessGrants = ref<SpecialAccountAccessGrant[]>([]);
const specialAccessKind = ref<SpecialAccountAccessGrant['kind']>('RECOVERY');
const specialAccessProfiles = ref('');
const specialAccessAllowsGeneralCreation = ref(true);
const specialAccessExpiresAt = ref('');
const specialAccessStatus = ref('');
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

const toLocalInputValue = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}`;
};

const loadProfiles = async () => {
    profilesLoading.value = true;
    try {
        const result = await adminClient.profiles.list.query();
        result.forEach((profile) => {
            ensureProfileBuffers(profile);
            const latest = profile.runtimeActions[0];
            if (latest && isRuntimeActionTerminal(latest.status)) {
                profileActionStatus.value = {
                    ...profileActionStatus.value,
                    [profile.profileName]: '',
                };
            }
        });
        profiles.value = result;
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
            });
            profiles.value = result;
        } catch {
            // 일시적인 조회 실패는 다음 bounded poll에서 다시 확인합니다.
        }
    }
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
        specialAccessGrants.value = grace.specialAccessGrants;
        kakaoGraceUntil.value = grace.kakaoGraceUntil ? toLocalInputValue(grace.kakaoGraceUntil) : '';
        userHistory.value = history;
    } catch (error) {
        userError.value = '조회 실패';
    } finally {
        userLoading.value = false;
    }
};

const loadUserDirectory = async (append = false) => {
    userDirectoryLoading.value = true;
    userDirectoryError.value = '';
    try {
        const result = await adminClient.users.list.query({
            query: userDirectoryQuery.value.trim() || undefined,
            limit: 30,
            cursor: append ? userDirectoryNextCursor.value : undefined,
        });
        userDirectory.value = append ? [...userDirectory.value, ...result.users] : result.users;
        userDirectoryTotal.value = result.total;
        userDirectoryNextCursor.value = result.nextCursor;
    } catch {
        userDirectoryError.value = '계정 목록을 불러오지 못했습니다.';
    } finally {
        userDirectoryLoading.value = false;
    }
};

const selectDirectoryUser = async (user: AdminUserListItem) => {
    userLookupMode.value = 'id';
    userLookupValue.value = user.id;
    await lookupUser();
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
        if (props.section === 'users' || props.section === 'audit') await loadGlobalAudit();
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
        specialAccessGrants.value = grace.specialAccessGrants;
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
    } catch {
        kakaoGraceStatus.value = 'OAuth 유예 변경 실패';
    }
};

const grantSpecialAccess = async () => {
    if (!userResult.value) return;
    const reason = requireUserActionReason();
    if (!reason) return;
    specialAccessStatus.value = '';
    try {
        await adminClient.users.grantSpecialAccess.mutate({
            userId: userResult.value.id,
            kind: specialAccessKind.value,
            profiles: specialAccessProfiles.value
                .split(',')
                .map((profile) => profile.trim())
                .filter(Boolean),
            allowsGeneralCreation: specialAccessAllowsGeneralCreation.value,
            expiresAt: specialAccessExpiresAt.value ? new Date(specialAccessExpiresAt.value).toISOString() : null,
            reason,
        });
        const policy = await adminClient.users.getKakaoGracePolicies.query({ userId: userResult.value.id });
        kakaoPolicies.value = policy.profiles;
        specialAccessGrants.value = policy.specialAccessGrants;
        specialAccessStatus.value = '특수 접근 자격을 부여했습니다.';
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
    } catch {
        specialAccessStatus.value = '특수 접근 자격 부여에 실패했습니다.';
    }
};

const revokeSpecialAccess = async (grantId: string) => {
    if (!userResult.value) return;
    const reason = requireUserActionReason();
    if (!reason) return;
    try {
        await adminClient.users.revokeSpecialAccess.mutate({ userId: userResult.value.id, grantId, reason });
        const policy = await adminClient.users.getKakaoGracePolicies.query({ userId: userResult.value.id });
        kakaoPolicies.value = policy.profiles;
        specialAccessGrants.value = policy.specialAccessGrants;
        specialAccessStatus.value = '특수 접근 자격을 해제했습니다.';
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
    } catch {
        specialAccessStatus.value = '특수 접근 자격 해제에 실패했습니다.';
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([refreshUserHistory(), loadUserDirectory()]);
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
        await Promise.all([lookupUser(), loadUserDirectory()]);
    } catch (error) {
        localAccountStatus.value = '로컬 계정 생성 실패';
    } finally {
        localAccountLoading.value = false;
    }
};

onMounted(() => {
    if (props.section === 'users' || props.section === 'audit' || props.section === 'servers') {
        void loadCapabilities();
    }
    if (props.section === 'users') {
        void loadUserDirectory();
        void loadLocalAccountStatus();
    }
    if (props.section === 'system') {
        void loadNotice();
    }
    if (props.section === 'servers') {
        void loadProfiles();
    }
});
</script>

<template>
    <AdminConsoleLayout
        :title="currentPage.title"
        :description="currentPage.description"
        :eyebrow="currentPage.eyebrow"
    >
        <div class="space-y-8">
            <section v-if="section === 'system'" class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-3">
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

            <div class="space-y-8">
                <section v-if="section === 'users'" class="grid min-w-0 items-start gap-6 xl:grid-cols-2">
                    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4 xl:col-span-2">
                        <div class="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <h3 class="text-lg font-semibold">계정 디렉터리</h3>
                                <p class="mt-1 text-xs text-zinc-500">
                                    최근 가입 계정을 먼저 보여줍니다. 계정명·표시명·이메일·UUID 일부로 검색할 수
                                    있습니다.
                                </p>
                            </div>
                            <span class="text-xs text-zinc-400">총 {{ userDirectoryTotal }}개</span>
                        </div>
                        <form class="flex flex-col gap-2 md:flex-row" @submit.prevent="loadUserDirectory(false)">
                            <input
                                v-model="userDirectoryQuery"
                                type="search"
                                class="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500"
                                placeholder="계정명, 표시명, 이메일 또는 UUID 검색"
                            />
                            <button
                                class="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded"
                                :disabled="userDirectoryLoading"
                            >
                                목록 검색
                            </button>
                        </form>
                        <div v-if="userDirectoryError" class="text-xs text-red-400">{{ userDirectoryError }}</div>
                        <div
                            v-if="userDirectory.length"
                            class="max-h-[28rem] overflow-y-auto rounded border border-zinc-800 bg-zinc-950"
                            role="region"
                            aria-label="계정 목록"
                        >
                            <button
                                v-for="user in userDirectory"
                                :key="user.id"
                                type="button"
                                class="grid w-full gap-1 border-b border-zinc-800 px-4 py-3 text-left last:border-b-0 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow-500 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center"
                                :class="
                                    userResult?.id === user.id ? 'bg-zinc-900 ring-1 ring-inset ring-yellow-700' : ''
                                "
                                @click="selectDirectoryUser(user)"
                            >
                                <span class="min-w-0">
                                    <span class="block truncate text-sm font-semibold text-white">{{
                                        user.username
                                    }}</span>
                                    <span class="block truncate text-xs text-zinc-400">{{ user.displayName }}</span>
                                </span>
                                <span class="min-w-0 text-xs text-zinc-500">
                                    <span class="block truncate">{{ user.email || '이메일 없음' }}</span>
                                    <span
                                        >{{ user.oauthType }} ·
                                        {{ new Date(user.createdAt).toLocaleDateString('ko-KR') }}</span
                                    >
                                </span>
                                <span class="flex flex-wrap gap-1 md:justify-end">
                                    <span
                                        v-if="user.hasActiveSanction"
                                        class="rounded bg-red-950 px-2 py-1 text-[11px] text-red-300"
                                        >제재 중</span
                                    >
                                    <span
                                        v-if="user.deleteAfter"
                                        class="rounded bg-orange-950 px-2 py-1 text-[11px] text-orange-300"
                                        >탈퇴 예약</span
                                    >
                                    <span class="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300">{{
                                        user.roles[0] || '역할 없음'
                                    }}</span>
                                </span>
                            </button>
                        </div>
                        <div
                            v-else-if="!userDirectoryLoading"
                            class="rounded border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-500"
                        >
                            조건에 맞는 계정이 없습니다.
                        </div>
                        <button
                            v-if="userDirectoryNextCursor"
                            type="button"
                            class="w-full rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                            :disabled="userDirectoryLoading"
                            @click="loadUserDirectory(true)"
                        >
                            더 보기
                        </button>

                        <details class="rounded border border-zinc-800 bg-black/20 p-3">
                            <summary class="cursor-pointer text-xs font-semibold text-zinc-400">
                                정확한 값으로 직접 열기
                            </summary>
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
                        </details>

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

                    <div
                        v-if="hasUser"
                        class="bg-zinc-900 border border-amber-800/70 rounded-lg p-5 space-y-3 xl:col-span-2"
                    >
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

                    <nav
                        v-if="hasUser"
                        class="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-2 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-4"
                        aria-label="사용자 관리 기능"
                    >
                        <button
                            v-for="item in userWorkspaceSections"
                            :key="item.id"
                            type="button"
                            class="rounded px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500"
                            :class="
                                userWorkspaceSection === item.id
                                    ? 'bg-yellow-600 text-black'
                                    : 'bg-zinc-950 text-zinc-300 hover:bg-zinc-800'
                            "
                            :aria-current="userWorkspaceSection === item.id ? 'page' : undefined"
                            @click="userWorkspaceSection = item.id"
                        >
                            <span class="block text-sm font-semibold">{{ item.label }}</span>
                            <span class="mt-1 block text-[11px] opacity-75">{{ item.description }}</span>
                        </button>
                    </nav>

                    <div
                        v-if="userWorkspaceSection === 'account'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4 xl:col-span-2"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'access'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'access'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4 xl:col-span-2"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'access'"
                        class="bg-zinc-900 border border-amber-800/60 rounded-lg p-5 space-y-4"
                    >
                        <h4 class="text-base font-semibold">Kakao 없는 특수 계정 접근</h4>
                        <div class="text-xs text-zinc-400">
                            운영자 role은 자동으로 모든 서버에 접근합니다. 테스트·복구·기타 계정은 아래에서 서버 범위와
                            만료를 명시해 부여합니다. 복구 자격은 만료가 필수이며 최대 90일입니다.
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <select
                                v-model="specialAccessKind"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                            >
                                <option value="RECOVERY">휴대폰 분실·계정 복구</option>
                                <option value="TESTER">특수 테스트</option>
                                <option value="OTHER">기타 예외</option>
                            </select>
                            <input
                                v-model="specialAccessExpiresAt"
                                type="datetime-local"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                :disabled="!hasUser"
                                aria-label="특수 접근 만료 시각"
                            />
                            <input
                                v-model="specialAccessProfiles"
                                type="text"
                                class="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                placeholder="che 또는 che:2 (쉼표 구분, 비우면 전체)"
                                :disabled="!hasUser"
                            />
                            <label class="flex items-center gap-2 text-sm text-zinc-300 px-2">
                                <input
                                    v-model="specialAccessAllowsGeneralCreation"
                                    type="checkbox"
                                    :disabled="!hasUser"
                                />
                                장수 생성 허용
                            </label>
                        </div>
                        <button
                            class="bg-amber-600 hover:bg-amber-500 text-black font-semibold px-4 py-2 rounded"
                            :disabled="!hasUser"
                            @click="grantSpecialAccess"
                        >
                            특수 접근 부여
                        </button>
                        <div class="text-xs text-zinc-500">{{ specialAccessStatus }}</div>
                        <div v-if="specialAccessGrants.length" class="space-y-2">
                            <div
                                v-for="grant in specialAccessGrants"
                                :key="grant.id"
                                class="bg-black/30 border border-zinc-800 rounded p-3 text-xs space-y-1"
                            >
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <span class="font-semibold text-amber-200">
                                        {{ grant.kind }} ·
                                        {{ grant.profiles.length ? grant.profiles.join(', ') : '전체 profile' }}
                                    </span>
                                    <button
                                        v-if="!grant.revokedAt"
                                        class="bg-red-900 hover:bg-red-800 text-red-100 px-3 py-1 rounded"
                                        @click="revokeSpecialAccess(grant.id)"
                                    >
                                        해제
                                    </button>
                                </div>
                                <div>
                                    장수 생성 {{ grant.allowsGeneralCreation ? '허용' : '차단' }} · 만료
                                    {{ grant.expiresAt ? new Date(grant.expiresAt).toLocaleString('ko-KR') : '없음' }}
                                </div>
                                <div class="text-zinc-500">부여 사유: {{ grant.reason }}</div>
                                <div v-if="grant.revokedAt" class="text-red-300">
                                    해제됨: {{ new Date(grant.revokedAt).toLocaleString('ko-KR') }} ·
                                    {{ grant.revokedReason }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="userWorkspaceSection === 'access'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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
                                        <th>특수 자격</th>
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
                                        <td class="text-center">{{ policy.specialAccess?.kind ?? '-' }}</td>
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

                    <div
                        v-if="userWorkspaceSection === 'restrictions'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'restrictions'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'restrictions'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4 xl:col-span-2"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'lifecycle'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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

                    <div
                        v-if="userWorkspaceSection === 'lifecycle'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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

                <section v-if="section !== 'users'" class="min-w-0 space-y-6">
                    <div
                        v-if="
                            section === 'audit' && capabilities.some((entry) => entry.permission === 'admin.audit.read')
                        "
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

                    <div
                        v-if="
                            section === 'audit' &&
                            !capabilities.some((entry) => entry.permission === 'admin.audit.read')
                        "
                        class="rounded-lg border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400"
                    >
                        감사 로그를 조회할 권한이 없습니다.
                    </div>

                    <div
                        v-if="section === 'system'"
                        class="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4"
                    >
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

                    <div v-if="section === 'servers'" class="space-y-4">
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
                            v-for="profile in visibleProfiles"
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

                            <nav class="flex flex-wrap gap-2" :aria-label="`${profile.profileName} 관리 탭`">
                                <RouterLink
                                    :to="`/admin/servers/${encodeURIComponent(profile.profileName)}`"
                                    class="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-white"
                                >
                                    상태 · 설정
                                </RouterLink>
                                <RouterLink
                                    v-if="hasCapability('admin.profiles.deploy', profile.profileName)"
                                    :to="`/admin/servers/${encodeURIComponent(profile.profileName)}/version`"
                                    class="rounded border border-blue-800 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-950"
                                >
                                    버전 업데이트
                                </RouterLink>
                                <RouterLink
                                    v-if="hasCapability('admin.scenarios.reset', profile.profileName)"
                                    :to="`/admin/servers/${encodeURIComponent(profile.profileName)}/scenario`"
                                    class="rounded border border-purple-800 px-3 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-950"
                                >
                                    시나리오 초기화
                                </RouterLink>
                            </nav>

                            <div class="grid md:grid-cols-2 gap-3">
                                <div
                                    v-if="hasCapability('admin.profiles.settings', profile.profileName)"
                                    class="space-y-2"
                                >
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

                                <div
                                    v-if="hasCapability('admin.profiles.runtime', profile.profileName)"
                                    class="space-y-2"
                                >
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
                                v-if="
                                    hasCapability('admin.profiles.deploy', profile.profileName) ||
                                    hasCapability('admin.scenarios.reset', profile.profileName)
                                "
                                class="border-t border-zinc-800 pt-4"
                            >
                                <div
                                    class="flex flex-col gap-3 rounded border border-violet-900/70 bg-violet-950/20 p-4 md:flex-row md:items-center md:justify-between"
                                >
                                    <div>
                                        <h4 class="text-sm font-semibold text-violet-200">버전과 시즌 수명주기</h4>
                                        <p class="mt-1 text-xs text-zinc-500">
                                            DB를 보존하는 코드 배포와 DB를 교체하는 시나리오 초기화는 별도 작업입니다.
                                        </p>
                                    </div>
                                    <div class="flex flex-wrap gap-2">
                                        <RouterLink
                                            v-if="hasCapability('admin.profiles.deploy', profile.profileName)"
                                            :to="`/admin/servers/${encodeURIComponent(profile.profileName)}/version`"
                                            class="rounded border border-blue-700 px-3 py-2 text-center text-xs font-semibold text-blue-200 hover:bg-blue-950"
                                        >
                                            버전 업데이트
                                        </RouterLink>
                                        <RouterLink
                                            v-if="hasCapability('admin.scenarios.reset', profile.profileName)"
                                            :to="`/admin/servers/${encodeURIComponent(profile.profileName)}/scenario`"
                                            class="rounded border border-purple-700 px-3 py-2 text-center text-xs font-semibold text-purple-200 hover:bg-purple-950"
                                        >
                                            시나리오 초기화
                                        </RouterLink>
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
    </AdminConsoleLayout>
</template>
