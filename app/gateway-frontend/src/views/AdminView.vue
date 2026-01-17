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
    profileIconResetAt?: string;
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
    profileIconResetAt?: string | null;
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
    };
    buildCommitSha?: string;
    meta: Record<string, unknown>;
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
    reason: string;
};

type AdminAction =
    | 'RESUME'
    | 'PAUSE'
    | 'STOP'
    | 'ACCELERATE'
    | 'DELAY'
    | 'RESET_NOW'
    | 'RESET_SCHEDULED'
    | 'OPEN_SURVEY'
    | 'SHUTDOWN';

type AdminClient = {
    system: {
        getNotice: {
            query: () => Promise<{ notice: string }>;
        };
        setNotice: {
            mutate: (input: { notice: string }) => Promise<{ notice: string }>;
        };
    };
    users: {
        lookup: {
            query: (input: { id?: string; username?: string; email?: string }) => Promise<AdminUser | null>;
        };
        resetPassword: {
            mutate: (input: { userId: string; newPassword?: string }) => Promise<{ password: string }>;
        };
        updateRoles: {
            mutate: (input: {
                userId: string;
                roles: string[];
                mode?: 'set' | 'grant' | 'revoke';
            }) => Promise<{ roles: string[] }>;
        };
        updateSanctions: {
            mutate: (input: {
                userId: string;
                patch: AdminSanctionsPatch;
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
            }) => Promise<{ sanctions: AdminUserSanctions }>;
        };
        resetProfileIcon: {
            mutate: (input: { userId: string }) => Promise<{ profileIconResetAt?: string }>;
        };
        forceDelete: {
            mutate: (input: { userId: string }) => Promise<{ ok: boolean }>;
        };
    };
    profiles: {
        list: {
            query: () => Promise<AdminProfile[]>;
        };
        listScenarios: {
            query: () => Promise<ScenarioPreview[]>;
        };
        updateMeta: {
            mutate: (input: {
                profileName: string;
                patch: {
                    korName?: string | null;
                    color?: string | null;
                    inGameNotice?: string | null;
                    profileImageUrl?: string | null;
                };
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
                };
                reason?: string;
            }) => Promise<{ ok: boolean; action?: unknown }>;
        };
        requestAction: {
            mutate: (input: {
                profileName: string;
                action: AdminAction;
                durationMinutes?: number;
                scheduledAt?: string;
                reason?: string;
            }) => Promise<{ ok: boolean }>;
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
const scenarios = ref<ScenarioPreview[]>([]);
const scenariosLoading = ref(false);
const scenariosStatus = ref('');
const profileInstalls = ref<Record<string, InstallFormState>>({});
const profileInstallStatus = ref<Record<string, string>>({});

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

const passwordInput = ref('');
const passwordResult = ref('');
const passwordStatus = ref('');

const rolesInput = ref('');
const rolesMode = ref<'set' | 'grant' | 'revoke'>('grant');
const rolesStatus = ref('');

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

const hasUser = computed(() => Boolean(userResult.value));

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

const readBoolean = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

const readString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

const buildAutorunOptionMap = (options?: string[]): Record<string, boolean> => {
    const map: Record<string, boolean> = {};
    autorunOptionLabels.forEach(({ key }) => {
        map[key] = options ? options.includes(key) : true;
    });
    return map;
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
        reason: '',
    };
};

const scenarioMap = computed(() => {
    const map = new Map<number, ScenarioPreview>();
    scenarios.value.forEach((scenario) => {
        map.set(scenario.id, scenario);
    });
    return map;
});

const scenarioGroups = computed(() => {
    const pattern = /【(.*?)[0-9\-_.a-zA-Z]*】/;
    const groups: Record<string, ScenarioPreview[]> = {};
    for (const scenario of scenarios.value) {
        const match = pattern.exec(scenario.title);
        const category = match?.[1] ?? '기타';
        if (!groups[category]) {
            groups[category] = [];
        }
        groups[category].push(scenario);
    }
    return groups;
});

const getScenarioPreview = (profileName: string): ScenarioPreview | null => {
    const install = profileInstalls.value[profileName];
    if (!install) {
        return null;
    }
    return scenarioMap.value.get(install.scenarioId) ?? null;
};

const loadProfiles = async () => {
    profilesLoading.value = true;
    try {
        const result = await adminClient.profiles.list.query();
        result.forEach((profile) => {
            ensureProfileBuffers(profile);
            ensureProfileInstallBuffers(profile);
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

const loadScenarios = async () => {
    scenariosLoading.value = true;
    scenariosStatus.value = '';
    try {
        const result = await adminClient.profiles.listScenarios.query();
        scenarios.value = result;
    } catch (error) {
        scenariosStatus.value = '시나리오 목록을 불러오지 못했습니다.';
    } finally {
        scenariosLoading.value = false;
    }
};

const updateProfileMeta = async (profileName: string) => {
    const edit = profileEdits.value[profileName];
    if (!edit) {
        return;
    }
    const patch = {
        korName: edit.korName.trim() || null,
        color: edit.color.trim() || null,
        inGameNotice: edit.inGameNotice.trim() || null,
        profileImageUrl: edit.profileImageUrl.trim() || null,
    };
    try {
        const updated = await adminClient.profiles.updateMeta.mutate({
            profileName,
            patch,
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
    const actionState = profileActions.value[profileName];
    const durationMinutes = actionState?.durationMinutes ? Number(actionState.durationMinutes) : undefined;
    const durationValue = durationMinutes && durationMinutes > 0 ? durationMinutes : undefined;
    const scheduledAt = actionState?.scheduledAt ? new Date(actionState.scheduledAt).toISOString() : undefined;
    const reason = actionState?.reason.trim() || undefined;
    try {
        await adminClient.profiles.requestAction.mutate({
            profileName,
            action,
            durationMinutes: durationValue,
            scheduledAt,
            reason,
        });
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: `요청 완료: ${action}`,
        };
    } catch (error) {
        profileActionStatus.value = {
            ...profileActionStatus.value,
            [profileName]: `요청 실패: ${action}`,
        };
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
        await adminClient.profiles.install.mutate({
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
            },
            reason: install.reason.trim() || undefined,
        });
        profileInstallStatus.value = {
            ...profileInstallStatus.value,
            [profileName]: openAt ? '설치 예약 완료' : '설치 요청 완료',
        };
        await loadProfiles();
    } catch (error) {
        profileInstallStatus.value = {
            ...profileInstallStatus.value,
            [profileName]: '설치 요청 실패',
        };
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
    } catch (error) {
        userError.value = '조회 실패';
    } finally {
        userLoading.value = false;
    }
};

const resetUserPassword = async () => {
    if (!userResult.value) {
        return;
    }
    passwordStatus.value = '';
    passwordResult.value = '';
    try {
        const result = await adminClient.users.resetPassword.mutate({
            userId: userResult.value.id,
            newPassword: passwordInput.value.trim() || undefined,
        });
        passwordResult.value = result.password;
        passwordStatus.value = '초기화 완료';
        passwordInput.value = '';
    } catch (error) {
        passwordStatus.value = '초기화 실패';
    }
};

const updateUserRoles = async () => {
    if (!userResult.value) {
        return;
    }
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
        });
        userResult.value = { ...userResult.value, roles: result.roles };
        rolesStatus.value = '권한 업데이트 완료';
    } catch (error) {
        rolesStatus.value = '권한 업데이트 실패';
    }
};

const applyBan = async () => {
    if (!userResult.value) {
        return;
    }
    const until = banUntil.value ? new Date(banUntil.value).toISOString() : null;
    const patch = {
        bannedUntil: until,
        notes: banReason.value.trim() || undefined,
    };
    try {
        const result = await adminClient.users.updateSanctions.mutate({
            userId: userResult.value.id,
            patch,
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        banStatus.value = '차단 설정 완료';
    } catch (error) {
        banStatus.value = '차단 설정 실패';
    }
};

const clearBan = async () => {
    if (!userResult.value) {
        return;
    }
    try {
        const result = await adminClient.users.updateSanctions.mutate({
            userId: userResult.value.id,
            patch: { bannedUntil: null },
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        banStatus.value = '차단 해제 완료';
    } catch (error) {
        banStatus.value = '차단 해제 실패';
    }
};

const resetProfileIcon = async () => {
    if (!userResult.value) {
        return;
    }
    try {
        const result = await adminClient.users.resetProfileIcon.mutate({
            userId: userResult.value.id,
        });
        userResult.value = {
            ...userResult.value,
            sanctions: {
                ...userResult.value.sanctions,
                profileIconResetAt: result.profileIconResetAt,
            },
        };
        profileIconStatus.value = '아이콘 초기화 요청 완료';
    } catch (error) {
        profileIconStatus.value = '아이콘 초기화 실패';
    }
};

const applyRestriction = async () => {
    if (!userResult.value) {
        return;
    }
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
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        restrictionStatus.value = '서버 제재 적용 완료';
    } catch (error) {
        restrictionStatus.value = '서버 제재 적용 실패';
    }
};

const clearRestriction = async () => {
    if (!userResult.value) {
        return;
    }
    if (!restrictionProfile.value.trim()) {
        restrictionStatus.value = '서버 프로필명을 입력하세요.';
        return;
    }
    try {
        const result = await adminClient.users.setServerRestriction.mutate({
            userId: userResult.value.id,
            profile: restrictionProfile.value.trim(),
            restriction: null,
        });
        userResult.value = { ...userResult.value, sanctions: result.sanctions };
        restrictionStatus.value = '서버 제재 해제 완료';
    } catch (error) {
        restrictionStatus.value = '서버 제재 해제 실패';
    }
};

const forceDeleteUser = async () => {
    if (!userResult.value) {
        return;
    }
    if (typeof window !== 'undefined') {
        const confirmed = window.confirm('정말로 강제 탈퇴 처리하시겠습니까?');
        if (!confirmed) {
            return;
        }
    }
    try {
        await adminClient.users.forceDelete.mutate({ userId: userResult.value.id });
        userResult.value = null;
        forceDeleteStatus.value = '강제 탈퇴 완료';
    } catch (error) {
        forceDeleteStatus.value = '강제 탈퇴 실패';
    }
};

onMounted(() => {
    void loadNotice();
    void loadProfiles();
    void loadScenarios();
});
</script>

<template>
    <DefaultLayout>
        <div class="max-w-6xl mx-auto px-4 py-10 space-y-10">
            <div class="space-y-2">
                <h2 class="text-3xl font-bold text-white">관리자 콘솔</h2>
                <p class="text-sm text-zinc-400">유저 관리와 서버 운영 제어를 위한 관리자 전용 대시보드입니다.</p>
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
                <section class="space-y-6">
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
                            <div class="text-xs text-zinc-500">가입일: {{ userResult.createdAt }}</div>
                            <div class="text-xs text-zinc-400 mt-2">제재 상태</div>
                            <pre class="text-[11px] text-zinc-400 bg-black/50 p-2 rounded whitespace-pre-wrap"
                                >{{ JSON.stringify(userResult.sanctions, null, 2) }}
              </pre
                            >
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
                        <h4 class="text-base font-semibold text-red-400">강제 탈퇴</h4>
                        <button
                            class="bg-red-700 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded"
                            :disabled="!hasUser"
                            @click="forceDeleteUser"
                        >
                            강제 탈퇴 처리
                        </button>
                        <div class="text-xs text-zinc-500">{{ forceDeleteStatus }}</div>
                    </div>
                </section>

                <section class="space-y-6">
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
                                    DAEMON: {{ profile.runtime.daemonRunning ? 'ON' : 'OFF' }}
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
                                    <label class="text-xs text-zinc-400">가속/연기 (분)</label>
                                    <input
                                        v-model="profileActions[profile.profileName].durationMinutes"
                                        type="number"
                                        min="1"
                                        max="1440"
                                        class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                    />
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
                                            class="bg-orange-600 hover:bg-orange-500 text-black font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'ACCELERATE')"
                                        >
                                            가속
                                        </button>
                                        <button
                                            class="bg-yellow-600 hover:bg-yellow-500 text-black font-semibold px-3 py-2 rounded"
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
                                            class="bg-teal-700 hover:bg-teal-600 text-white font-semibold px-3 py-2 rounded"
                                            @click="requestProfileAction(profile.profileName, 'OPEN_SURVEY')"
                                        >
                                            설문 오픈
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
                                </div>
                            </div>

                            <div
                                v-if="profileInstalls[profile.profileName]"
                                class="border-t border-zinc-800 pt-4 space-y-3"
                            >
                                <div class="flex items-center justify-between">
                                    <h4 class="text-sm font-semibold">설치/리셋</h4>
                                    <span class="text-xs text-zinc-500">{{ profileInstallStatus[profile.profileName] }}</span>
                                </div>
                                <div class="grid lg:grid-cols-2 gap-4">
                                    <div class="space-y-3">
                                        <div class="space-y-1">
                                            <label class="text-xs text-zinc-400">시나리오 선택</label>
                                            <select
                                                v-model.number="profileInstalls[profile.profileName].scenarioId"
                                                class="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                                                :disabled="scenariosLoading"
                                            >
                                                <option v-if="scenariosLoading" disabled>불러오는 중...</option>
                                                <template v-for="(items, group) in scenarioGroups" :key="group">
                                                    <optgroup :label="group">
                                                        <option v-for="scenario in items" :key="scenario.id" :value="scenario.id">
                                                            {{ scenario.title }}
                                                        </option>
                                                    </optgroup>
                                                </template>
                                            </select>
                                            <div v-if="scenariosStatus" class="text-xs text-red-400">
                                                {{ scenariosStatus }}
                                            </div>
                                        </div>

                                        <div class="grid grid-cols-2 gap-2">
                                            <div class="space-y-1">
                                                <label class="text-xs text-zinc-400">턴 시간(분)</label>
                                                <select
                                                    v-model.number="profileInstalls[profile.profileName].turnTermMinutes"
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
                                                        v-model.number="profileInstalls[profile.profileName].blockGeneralCreate"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="0"
                                                    />
                                                    가능
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].blockGeneralCreate"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="2"
                                                    />
                                                    장수명 무작위
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].blockGeneralCreate"
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
                                                        v-model.number="profileInstalls[profile.profileName].showImgLevel"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="0"
                                                    />
                                                    안함
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].showImgLevel"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="1"
                                                    />
                                                    전콘
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].showImgLevel"
                                                        class="accent-yellow-500"
                                                        type="radio"
                                                        :value="2"
                                                    />
                                                    전콘, 병종
                                                </label>
                                                <label class="flex items-center gap-1 text-xs text-zinc-300">
                                                    <input
                                                        v-model.number="profileInstalls[profile.profileName].showImgLevel"
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
                                                        v-model="profileInstalls[profile.profileName].autorunUserOptions[option.key]"
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
                                            class="bg-emerald-600 hover:bg-emerald-500 text-black font-semibold px-4 py-2 rounded w-full"
                                            @click="requestInstall(profile.profileName)"
                                        >
                                            설치 적용
                                        </button>

                                        <div v-if="getScenarioPreview(profile.profileName)" class="bg-zinc-950 border border-zinc-800 rounded p-3 text-xs text-zinc-300 space-y-2">
                                            <div class="font-semibold text-zinc-200">
                                                {{ getScenarioPreview(profile.profileName)?.title }}
                                            </div>
                                            <div>시작 연도: {{ getScenarioPreview(profile.profileName)?.year ?? '-' }}년</div>
                                            <div>
                                                NPC: {{ getScenarioPreview(profile.profileName)?.npcCount }}명
                                                <span v-if="getScenarioPreview(profile.profileName)?.npcExCount">+{{ getScenarioPreview(profile.profileName)?.npcExCount }}명</span>
                                                <span v-if="getScenarioPreview(profile.profileName)?.npcNeutralCount">
                                                    / 중립 {{ getScenarioPreview(profile.profileName)?.npcNeutralCount }}명
                                                </span>
                                            </div>
                                            <div class="space-y-1">
                                                <div class="text-zinc-400">국가</div>
                                                <div class="space-y-1">
                                                    <div
                                                        v-for="nation in getScenarioPreview(profile.profileName)?.nations ?? []"
                                                        :key="nation.id"
                                                        class="text-[11px]"
                                                    >
                                                        <span :style="{ color: nation.color }">{{ nation.name }}</span>
                                                        {{ nation.generals }}명
                                                        <span v-if="nation.generalsEx">(+{{ nation.generalsEx }})</span>
                                                        <span class="text-zinc-500">· {{ nation.cities.join(', ') }}</span>
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
