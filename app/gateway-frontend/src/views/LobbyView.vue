<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@sammo-ts/gateway-api';
import { writeGameSessionTransfer } from '@sammo-ts/common/auth/gameSessionTransfer';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import MapPreview from '../components/MapPreview.vue';
import { useToast } from '../composables/useToast';
import { trpc } from '../utils/trpc';
import { createGameTrpc } from '../utils/gameTrpc';
import type { GameRouter } from '../utils/gameTrpc';
import { resolveServerSeasonStatus } from '../utils/serverSeasonStatus';
import { configuredSharedIconPublicUrl, configuredUserIconPublicUrl } from '../utils/imageAssets';

type GatewayRouterOutput = inferRouterOutputs<AppRouter>;
type GameRouterOutput = inferRouterOutputs<GameRouter>;
type MeOutput = GatewayRouterOutput['me'];
type LobbyProfile = GatewayRouterOutput['lobby']['profiles'][number];
type LobbyInfo = GameRouterOutput['lobby']['info'];
type LobbyGeneral = NonNullable<LobbyInfo['myGeneral']>;
type PublicMap = GameRouterOutput['public']['getCachedMap'];
type PublicMapLayout = GameRouterOutput['public']['getMapLayout'];
type MapPreviewBundle = {
    mapData: PublicMap;
    mapLayout: PublicMapLayout;
};
type ProfileLoadState = {
    status: 'loading' | 'retrying' | 'ready';
    failures: number;
};

const PROFILE_REQUEST_TIMEOUT_MS = 10_000;
const PROFILE_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 15_000] as const;
const router = useRouter();
const me = ref<MeOutput>(null);
const notice = ref('');
const profiles = ref<LobbyProfile[]>([]);
const profileDetails = ref<Record<string, LobbyInfo | undefined>>({});
const profileMapPreviews = ref<Record<string, MapPreviewBundle | undefined>>({});
const profileLoadStates = ref<Record<string, ProfileLoadState | undefined>>({});
const selectedMapProfileName = ref<string | null>(null);
const entryLoading = ref<Record<string, boolean>>({});
const logoutLoading = ref(false);
const logoutError = ref('');
const { error: showErrorToast } = useToast();
const profileRetryTimers = new Map<string, number>();
const profileRequestControllers = new Map<string, AbortController>();
let lobbyMounted = true;

watch(logoutError, (value) => value && showErrorToast(value), { flush: 'sync' });
const canAccessAdmin = computed(
    () =>
        me.value?.roles.some(
            (role) =>
                role === 'superuser' || role === 'admin' || role === 'admin.superuser' || role.startsWith('admin.')
        ) ?? false
);
const needsKakaoVerification = computed(
    () =>
        me.value !== null &&
        !me.value.kakaoVerified &&
        profiles.value.some((profile) => profile.localAccountPolicy?.requiresKakaoVerification === true)
);
const userIconBaseUrl = configuredUserIconPublicUrl();
const sharedIconBaseUrl = configuredSharedIconPublicUrl();
const publicMapProfiles = computed(() => profiles.value.filter((profile) => profile.lifecycle.userAccessible));
const selectedMapProfile = computed(
    () => publicMapProfiles.value.find((profile) => profile.profileName === selectedMapProfileName.value) ?? null
);
const selectedMapPreview = computed(() =>
    selectedMapProfileName.value ? profileMapPreviews.value[selectedMapProfileName.value] : undefined
);

watch(publicMapProfiles, (availableProfiles) => {
    if (!availableProfiles.some((profile) => profile.profileName === selectedMapProfileName.value)) {
        selectedMapProfileName.value = availableProfiles[0]?.profileName ?? null;
    }
});

const selectMapProfile = (profileName: string): void => {
    selectedMapProfileName.value = profileName;
};

const handleMapTabKeydown = (event: KeyboardEvent, profileName: string): void => {
    const currentIndex = publicMapProfiles.value.findIndex((profile) => profile.profileName === profileName);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % publicMapProfiles.value.length;
    if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + publicMapProfiles.value.length) % publicMapProfiles.value.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = publicMapProfiles.value.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    selectedMapProfileName.value = publicMapProfiles.value[nextIndex]?.profileName ?? null;
    const tabButtons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]'
    );
    tabButtons?.[nextIndex]?.focus();
};

const formatGraceEndsAt = (value: string | null | undefined): string => formatServerDateTime(value);
const serverSeasonStatus = (info: LobbyInfo) => resolveServerSeasonStatus(info);
const formatAnnouncementDate = (value: string | null | undefined): string =>
    formatServerDateTime(value, { fallback: '-' });
const profileScenarioTitle = (profileName: string): string =>
    profileDetails.value[profileName]?.scenarioTitle.trim() || '-';
const npcModeText = (mode: number): string => ['불가', '가능', '선택 생성'][mode] ?? '불가';
const autorunDetailText = (autorun: LobbyInfo['autorunUser']): string => {
    if (!autorun) return '';

    const enabled = new Set(autorun.options);
    const labels: string[] = [];
    if (enabled.has('develop')) labels.push('내정');
    if (enabled.has('warp')) labels.push('순간이동');
    if (enabled.has('recruit_high')) labels.push('모병');
    else if (enabled.has('recruit')) labels.push('징병');
    if (enabled.has('train')) labels.push('훈련/사기진작');
    if (enabled.has('battle')) labels.push('출병');
    if (enabled.has('chief')) labels.push('사령턴');

    const limit =
        autorun.limitMinutes >= 43_200
            ? '항상 유효'
            : autorun.limitMinutes % 60 === 0
              ? `${autorun.limitMinutes / 60}시간 유효`
              : `${autorun.limitMinutes}분 유효`;
    labels.push(limit);
    return labels.join(', ');
};
const autorunTooltipId = (profileName: string, scope = 'current'): string =>
    'profile-autorun-' + scope + '-' + profileName.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
const upcomingResetPhaseText = (profile: LobbyProfile): string => {
    if (profile.upcomingReset?.phase === 'DELAYED') return '준비 지연 · 일정 확인 중';
    if (profile.upcomingReset?.phase === 'READY') return '오픈 준비 완료 · 가오픈 대기';
    if (profile.upcomingReset?.phase === 'PREPARING') return '오픈 준비 중';
    return '오픈 예정 · 빌드 대기';
};
const isProfileRuntimeAvailable = (profile: LobbyProfile): boolean => profile.lifecycle.userAccessible;
const unavailableProfileText = (profile: LobbyProfile): string => {
    if (!profile.lifecycle.dataInitialized) return '- DB 초기화 전 · 접근 불가 -';
    if (profile.status === 'RESERVED') return '- 준 비 중 · 접근 불가 -';
    if (profile.status === 'DISABLED') return '- 비 활 성 -';
    return '- 서버 중지 · 접근 불가 -';
};
const profileLoadState = (profileName: string): ProfileLoadState | undefined => profileLoadStates.value[profileName];
const setProfileLoadState = (profileName: string, state: ProfileLoadState): void => {
    profileLoadStates.value = {
        ...profileLoadStates.value,
        [profileName]: state,
    };
};
const clearProfileRetry = (profileName: string): void => {
    const timer = profileRetryTimers.get(profileName);
    if (timer !== undefined) {
        window.clearTimeout(timer);
        profileRetryTimers.delete(profileName);
    }
};
const requestOptions = (componentSignal: AbortSignal): { signal: AbortSignal } => ({
    signal: AbortSignal.any([componentSignal, AbortSignal.timeout(PROFILE_REQUEST_TIMEOUT_MS)]),
});
const encodeLegacyIconPath = (value: string): string =>
    value
        .split('/')
        .map((segment) => {
            if (segment === '.') return '%2E';
            if (segment === '..') return '%2E%2E';
            return encodeURIComponent(segment);
        })
        .join('/');
const resolveGeneralPicture = (general: LobbyGeneral): string => {
    const picture = general.picture?.trim() || 'default.jpg';
    return general.imageServer
        ? `${userIconBaseUrl.replace(/\/$/, '')}/${encodeLegacyIconPath(picture)}`
        : `${sharedIconBaseUrl}/${encodeLegacyIconPath(picture)}`;
};
const handleGeneralPictureError = (event: Event): void => {
    const image = event.currentTarget as HTMLImageElement;
    if (image.dataset.generalIconFallbackSource === image.currentSrc) {
        return;
    }
    image.dataset.generalIconFallbackSource = image.currentSrc;
    image.src = `${sharedIconBaseUrl}/default.jpg`;
};

const loadProfileDetails = async (profile: LobbyProfile, sessionToken: string | null): Promise<void> => {
    if (!lobbyMounted || !isProfileRuntimeAvailable(profile)) {
        return;
    }
    clearProfileRetry(profile.profileName);
    profileRequestControllers.get(profile.profileName)?.abort();
    const requestController = new AbortController();
    profileRequestControllers.set(profile.profileName, requestController);
    const previousFailures = profileLoadState(profile.profileName)?.failures ?? 0;
    setProfileLoadState(profile.profileName, { status: 'loading', failures: previousFailures });

    const publicGameTrpc = createGameTrpc(profile.profile, profile.apiPort);
    let gameTrpc = publicGameTrpc;
    let authenticated = sessionToken === null;
    if (sessionToken) {
        try {
            const issued = await trpc.auth.issueGameSession.mutate(
                {
                    sessionToken,
                    profile: profile.profileName,
                },
                requestOptions(requestController.signal)
            );
            const exchanged = await publicGameTrpc.auth.exchangeGatewayToken.mutate(
                {
                    gatewayToken: issued.gameToken,
                },
                requestOptions(requestController.signal)
            );
            gameTrpc = createGameTrpc(profile.profile, profile.apiPort, exchanged.accessToken);
            authenticated = true;
        } catch (error) {
            console.error(`Failed to authenticate lobby game session for ${profile.profileName}`, error);
        }
    }

    const [infoResult, layoutResult, mapResult] = await Promise.allSettled([
        gameTrpc.lobby.info.query(undefined, requestOptions(requestController.signal)),
        gameTrpc.public.getMapLayout.query(undefined, requestOptions(requestController.signal)),
        gameTrpc.public.getCachedMap.query(undefined, requestOptions(requestController.signal)),
    ]);
    if (profileRequestControllers.get(profile.profileName) !== requestController) {
        return;
    }
    profileRequestControllers.delete(profile.profileName);
    if (!lobbyMounted) {
        return;
    }

    if (infoResult.status === 'fulfilled') {
        profileDetails.value[profile.profileName] = infoResult.value;
    } else {
        console.error(`Failed to fetch info for ${profile.profileName}`, infoResult.reason);
    }
    if (layoutResult.status === 'fulfilled' && mapResult.status === 'fulfilled') {
        profileMapPreviews.value[profile.profileName] = {
            mapLayout: layoutResult.value,
            mapData: mapResult.value,
        };
    }

    const fullyLoaded =
        authenticated &&
        infoResult.status === 'fulfilled' &&
        layoutResult.status === 'fulfilled' &&
        mapResult.status === 'fulfilled';
    if (fullyLoaded) {
        setProfileLoadState(profile.profileName, { status: 'ready', failures: 0 });
        return;
    }

    const failures = previousFailures + 1;
    setProfileLoadState(profile.profileName, { status: 'retrying', failures });
    const retryDelay = PROFILE_RETRY_DELAYS_MS[Math.min(failures - 1, PROFILE_RETRY_DELAYS_MS.length - 1)];
    const timer = window.setTimeout(() => {
        profileRetryTimers.delete(profile.profileName);
        void loadProfileDetails(profile, sessionToken);
    }, retryDelay);
    profileRetryTimers.set(profile.profileName, timer);
};

const retryProfileDetails = (profile: LobbyProfile): void => {
    clearProfileRetry(profile.profileName);
    setProfileLoadState(profile.profileName, { status: 'loading', failures: 0 });
    void loadProfileDetails(profile, window.localStorage.getItem('sammo-session-token'));
};

onMounted(async () => {
    try {
        me.value = await trpc.me.query();
        if (!me.value) {
            await router.push('/');
            return;
        }

        notice.value = await trpc.lobby.notice.query();
        profiles.value = await trpc.lobby.profiles.query();
        const sessionToken = window.localStorage.getItem('sammo-session-token');
        await Promise.all(profiles.value.map((profile) => loadProfileDetails(profile, sessionToken)));
    } catch (e) {
        console.error('Failed to load lobby', e);
    }
});

onUnmounted(() => {
    lobbyMounted = false;
    for (const timer of profileRetryTimers.values()) {
        window.clearTimeout(timer);
    }
    profileRetryTimers.clear();
    for (const controller of profileRequestControllers.values()) {
        controller.abort();
    }
    profileRequestControllers.clear();
});

const handleLogout = async () => {
    if (logoutLoading.value) {
        return;
    }
    logoutError.value = '';
    const sessionToken = window.localStorage.getItem('sammo-session-token');
    if (!sessionToken) {
        await router.replace('/');
        return;
    }
    logoutLoading.value = true;
    try {
        await trpc.auth.logout.mutate({ sessionToken });
        window.localStorage.removeItem('sammo-session-token');
        window.localStorage.removeItem('sammo-game-token');
        window.localStorage.removeItem('sammo-game-profile');
        me.value = null;
        await router.replace('/');
    } catch (error) {
        logoutError.value = error instanceof Error ? error.message : '로그아웃에 실패했습니다.';
    } finally {
        logoutLoading.value = false;
    }
};

const handleKakaoVerification = async (): Promise<void> => {
    const sessionToken = window.localStorage.getItem('sammo-session-token');
    if (!sessionToken) {
        await router.push('/');
        return;
    }
    try {
        const result = await trpc.auth.kakaoStart.query({
            mode: 'verify',
        });
        window.location.assign(result.authUrl);
    } catch (error) {
        showErrorToast(error instanceof Error ? error.message : '카카오 인증을 시작하지 못했습니다.');
    }
};

const resolveGameUrl = (path: string, profileName: string, gameToken: string): string | null => {
    const profile = profileName.split(':', 1)[0] ?? profileName;
    const baseUrl =
        import.meta.env.VITE_GAME_WEB_URL ??
        import.meta.env.VITE_GAME_WEB_URL_TEMPLATE?.replaceAll('{profile}', encodeURIComponent(profile)) ??
        '';
    if (!baseUrl) {
        return null;
    }
    const base = new URL(baseUrl, window.location.origin);
    const normalizedPath = path.replace(/^\//, '');
    const url = new URL(normalizedPath, base);
    let transferredInSessionStorage = false;
    if (url.origin === window.location.origin) {
        try {
            transferredInSessionStorage = writeGameSessionTransfer(window.sessionStorage, {
                profile: profileName,
                gatewayToken: gameToken,
            });
        } catch {
            transferredInSessionStorage = false;
        }
    }
    if (!transferredInSessionStorage) {
        url.searchParams.set('profile', profileName);
        url.searchParams.set('gameToken', gameToken);
    }
    return url.toString();
};

const handleEnter = async (profile: LobbyProfile, targetPath: string) => {
    if (entryLoading.value[profile.profileName]) {
        return;
    }
    const sessionToken = window.localStorage.getItem('sammo-session-token');
    if (!sessionToken) {
        await router.push('/');
        return;
    }
    entryLoading.value[profile.profileName] = true;
    try {
        const issued = await trpc.auth.issueGameSession.mutate({
            sessionToken,
            profile: profile.profileName,
        });
        const url = resolveGameUrl(targetPath, issued.profile, issued.gameToken);
        if (!url) {
            showErrorToast('게임 프론트엔드 주소가 설정되지 않았습니다.');
            return;
        }
        window.location.href = url;
    } catch (e) {
        console.error('Failed to issue game session', e);
        showErrorToast(e instanceof Error ? e.message : '게임 서버 접속에 실패했습니다.');
    } finally {
        entryLoading.value[profile.profileName] = false;
    }
};
</script>

<template>
    <DefaultLayout>
        <div class="max-w-5xl mx-auto pt-24 pb-8 px-4 space-y-8">
            <!-- Notice -->
            <div v-if="notice" class="text-center">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span data-testid="gateway-notice" class="text-orange-500 text-3xl font-bold" v-html="notice"></span>
            </div>

            <section
                v-if="needsKakaoVerification"
                id="kakao-verification-banner"
                class="bg-amber-950/70 border border-amber-600 rounded p-4 text-amber-100"
            >
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                        <strong class="block text-amber-300">카카오 인증이 필요합니다.</strong>
                        <span class="text-sm">
                            유예기간이 지나면 게임에 입장할 수 없습니다. che·kwe·twe는 인증 전 장수 생성도 제한됩니다.
                        </span>
                    </div>
                    <button
                        id="connect-kakao"
                        class="shrink-0 bg-yellow-400 hover:bg-yellow-300 text-black font-bold px-5 py-2 rounded"
                        type="button"
                        @click="handleKakaoVerification"
                    >
                        카카오 인증 연결
                    </button>
                </div>
            </section>

            <!-- Server List Table -->
            <div class="bg-zinc-900 border border-zinc-800 rounded shadow-xl overflow-hidden">
                <div
                    class="bg-zinc-800 px-6 py-3 text-center font-bold text-white border-b border-zinc-700 text-xl tracking-widest"
                >
                    서 버 선 택
                </div>
                <div class="profile-table-frame" data-testid="profile-table-scroll">
                    <table class="profile-table w-full text-sm text-left">
                        <thead class="bg-zinc-800 text-zinc-400 uppercase text-xs">
                            <tr>
                                <th class="px-4 py-3 border-b border-zinc-700 w-24 text-center">서 버</th>
                                <th class="px-4 py-3 border-b border-zinc-700">정 보</th>
                                <th class="px-4 py-3 border-b border-zinc-700 w-48 text-center" colspan="2">
                                    캐 릭 터
                                </th>
                                <th class="px-4 py-3 border-b border-zinc-700 w-32 text-center">선 택</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-800">
                            <tr
                                v-for="profile in profiles"
                                :key="profile.profileName"
                                class="hover:bg-zinc-800/50 transition-colors"
                            >
                                <!-- Server Name -->
                                <td class="profile-server-cell px-4 py-4 text-center border-r border-zinc-800">
                                    <div
                                        :style="{ color: profile.color }"
                                        class="text-lg font-bold cursor-help"
                                        :title="
                                            profileDetails[profile.profileName]
                                                ? serverSeasonStatus(profileDetails[profile.profileName]!).period
                                                : ''
                                        "
                                    >
                                        {{ profile.korName }}섭
                                    </div>
                                    <div
                                        v-if="profileDetails[profile.profileName]"
                                        class="season-status mt-1 whitespace-nowrap text-xs text-zinc-500"
                                    >
                                        {{ serverSeasonStatus(profileDetails[profile.profileName]!).label }}
                                    </div>
                                    <div
                                        v-if="profile.status === 'PAUSED'"
                                        class="mt-1 whitespace-nowrap text-xs text-amber-300"
                                        data-testid="profile-paused-status"
                                    >
                                        턴 일시정지 · 조회/예약턴 가능
                                    </div>
                                    <div
                                        v-if="
                                            profile.localAccountPolicy?.requiresKakaoVerification &&
                                            !profile.localAccountPolicy.canCreateGeneral
                                        "
                                        class="mt-2 text-xs text-red-400"
                                    >
                                        인증 전 생성 불가
                                    </div>
                                    <div
                                        v-else-if="profile.localAccountPolicy?.requiresKakaoVerification"
                                        class="mt-2 text-xs text-amber-300"
                                    >
                                        {{ formatGraceEndsAt(profile.localAccountPolicy.graceEndsAt) }}까지 유예
                                    </div>
                                </td>

                                <!-- Server Info -->
                                <td class="profile-info-cell px-4 py-4 border-r border-zinc-800">
                                    <div
                                        v-if="profile.upcomingReset"
                                        class="upcoming-reset-announcement"
                                        data-testid="upcoming-reset-announcement"
                                    >
                                        <div
                                            class="upcoming-reset-phase"
                                            :class="{ 'is-delayed': profile.upcomingReset.phase === 'DELAYED' }"
                                            data-testid="upcoming-reset-phase"
                                        >
                                            {{ upcomingResetPhaseText(profile) }}
                                        </div>
                                        <div data-testid="upcoming-reset-scheduled-at">
                                            - 초기화 시작 :
                                            {{ formatAnnouncementDate(profile.upcomingReset.scheduledAt) }} -
                                        </div>
                                        <div data-testid="upcoming-reset-preopen-at">
                                            - 가오픈 일시 :
                                            {{ formatAnnouncementDate(profile.upcomingReset.preopenAt) }} -
                                        </div>
                                        <div data-testid="upcoming-reset-open-at">
                                            - 오픈 일시 : {{ formatAnnouncementDate(profile.upcomingReset.openAt) }} -
                                        </div>
                                        <div data-testid="upcoming-reset-scenario-announcement">
                                            <span class="text-orange-400" data-testid="upcoming-reset-scenario-title">
                                                {{ profile.upcomingReset.scenarioTitle }} </span
                                            >{{ ' ' }}
                                            <span class="text-green-400">
                                                {{ profile.upcomingReset.turnTermMinutes }}분 턴 서버
                                            </span>
                                        </div>
                                        <div class="profile-announcement-settings text-xs text-zinc-500">
                                            (상성 설정:{{ profile.upcomingReset.fictionMode }}), (빙의 여부:{{
                                                npcModeText(profile.upcomingReset.npcMode)
                                            }}), (최대 스탯:{{ profile.upcomingReset.defaultStatTotal }}), (기타
                                            설정:<template v-if="profile.upcomingReset.otherTextInfo"
                                                >{{ profile.upcomingReset.otherTextInfo
                                                }}<template v-if="profile.upcomingReset.autorunUser"
                                                    >,
                                                </template></template
                                            ><span
                                                v-if="profile.upcomingReset.autorunUser"
                                                class="copyable-autorun"
                                                tabindex="0"
                                                :aria-describedby="autorunTooltipId(profile.profileName, 'upcoming')"
                                                >자율행동<span
                                                    :id="autorunTooltipId(profile.profileName, 'upcoming')"
                                                    class="copyable-autorun-detail"
                                                    role="tooltip"
                                                    ><span class="copyable-autorun-bracket">[</span
                                                    ><span>{{
                                                        autorunDetailText(profile.upcomingReset.autorunUser)
                                                    }}</span
                                                    ><span class="copyable-autorun-bracket">]</span></span
                                                ></span
                                            ><template
                                                v-if="
                                                    !profile.upcomingReset.otherTextInfo &&
                                                    !profile.upcomingReset.autorunUser
                                                "
                                                >없음</template
                                            >)
                                        </div>
                                    </div>
                                    <template v-if="profileDetails[profile.profileName]">
                                        <div
                                            class="space-y-1"
                                            :class="{ 'mt-3 border-t border-zinc-800 pt-3': profile.upcomingReset }"
                                        >
                                            <template v-if="profile.status === 'PREOPEN'">
                                                <div
                                                    v-if="profileDetails[profile.profileName]?.preopenAt"
                                                    data-testid="profile-preopen-at"
                                                >
                                                    - 가오픈 일시 :
                                                    {{
                                                        formatAnnouncementDate(
                                                            profileDetails[profile.profileName]?.preopenAt
                                                        )
                                                    }}
                                                    -
                                                </div>
                                                <div data-testid="profile-open-at">
                                                    - 오픈 일시 :
                                                    {{
                                                        formatAnnouncementDate(
                                                            profileDetails[profile.profileName]?.opentime ||
                                                                profileDetails[profile.profileName]?.starttime
                                                        )
                                                    }}
                                                    -
                                                </div>
                                                <div data-testid="profile-scenario-announcement">
                                                    <span
                                                        class="text-orange-400"
                                                        data-testid="profile-scenario-title"
                                                        >{{ profileScenarioTitle(profile.profileName) }}</span
                                                    >{{ ' ' }}
                                                    <span class="text-green-400">
                                                        {{ profileDetails[profile.profileName]?.turnTerm }}분 턴 서버
                                                    </span>
                                                </div>
                                            </template>
                                            <template v-else>
                                                <div>
                                                    서기 {{ profileDetails[profile.profileName]?.year }}년
                                                    {{ profileDetails[profile.profileName]?.month }}월 (<span
                                                        class="text-orange-400"
                                                        data-testid="profile-scenario-title"
                                                        >{{ profileScenarioTitle(profile.profileName) }}</span
                                                    >)
                                                </div>
                                                <div class="text-zinc-400">
                                                    유저 : {{ profileDetails[profile.profileName]?.userCnt }} /
                                                    {{ profileDetails[profile.profileName]?.maxUserCnt }}명
                                                    <span class="text-cyan-400 ml-2"
                                                        >NPC : {{ profileDetails[profile.profileName]?.npcCnt }}명</span
                                                    >
                                                    <span class="text-green-400 ml-2"
                                                        >({{ profileDetails[profile.profileName]?.turnTerm }}분 턴
                                                        서버)</span
                                                    >
                                                </div>
                                            </template>
                                            <div class="profile-announcement-settings text-xs text-zinc-500">
                                                (상성 설정:{{ profileDetails[profile.profileName]?.fictionMode }}),
                                                <template v-if="profile.status === 'PREOPEN'">
                                                    (빙의 여부:{{
                                                        npcModeText(profileDetails[profile.profileName]?.npcMode ?? 0)
                                                    }}), (최대 스탯:{{
                                                        profileDetails[profile.profileName]?.defaultStatTotal
                                                    }}),
                                                </template>
                                                (기타 설정:<template
                                                    v-if="profileDetails[profile.profileName]?.otherTextInfo"
                                                    >{{ profileDetails[profile.profileName]?.otherTextInfo
                                                    }}<template v-if="profileDetails[profile.profileName]?.autorunUser"
                                                        >,
                                                    </template></template
                                                ><span
                                                    v-if="profileDetails[profile.profileName]?.autorunUser"
                                                    class="copyable-autorun"
                                                    tabindex="0"
                                                    :aria-describedby="autorunTooltipId(profile.profileName)"
                                                    >자율행동<span
                                                        :id="autorunTooltipId(profile.profileName)"
                                                        class="copyable-autorun-detail"
                                                        role="tooltip"
                                                        ><span class="copyable-autorun-bracket">[</span
                                                        ><span>{{
                                                            autorunDetailText(
                                                                profileDetails[profile.profileName]!.autorunUser
                                                            )
                                                        }}</span
                                                        ><span class="copyable-autorun-bracket">]</span></span
                                                    ></span
                                                >)
                                            </div>
                                        </div>
                                    </template>
                                    <template v-else-if="!isProfileRuntimeAvailable(profile) && !profile.upcomingReset">
                                        <div class="text-center text-zinc-600 py-2">
                                            {{ unavailableProfileText(profile) }}
                                        </div>
                                    </template>
                                    <template v-else-if="profileLoadState(profile.profileName)?.status === 'retrying'">
                                        <div
                                            class="text-center text-zinc-500 py-1"
                                            role="status"
                                            data-testid="profile-info-retrying"
                                        >
                                            <div>서버 응답을 기다리고 있습니다.</div>
                                            <button
                                                type="button"
                                                class="mt-2 text-xs text-orange-300 underline underline-offset-2 hover:text-orange-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-300"
                                                @click="retryProfileDetails(profile)"
                                            >
                                                지금 다시 확인
                                            </button>
                                        </div>
                                    </template>
                                    <template v-else>
                                        <div class="text-center text-zinc-500 py-2">정보를 불러오는 중...</div>
                                    </template>
                                </td>

                                <!-- Character Info -->
                                <td class="profile-portrait-cell px-2 py-4 w-16 border-r border-zinc-800">
                                    <div
                                        v-if="profileDetails[profile.profileName]?.myGeneral"
                                        class="w-12 h-12 mx-auto bg-zinc-800 rounded overflow-hidden border border-zinc-700"
                                    >
                                        <img
                                            :src="
                                                resolveGeneralPicture(profileDetails[profile.profileName]!.myGeneral!)
                                            "
                                            class="w-full h-full object-cover"
                                            @error="handleGeneralPictureError"
                                        />
                                    </div>
                                </td>
                                <td class="profile-general-cell px-4 py-4 border-r border-zinc-800 text-center">
                                    <div v-if="profileDetails[profile.profileName]?.myGeneral" class="font-medium">
                                        {{ profileDetails[profile.profileName]?.myGeneral?.name }}
                                    </div>
                                    <div v-else class="text-zinc-600">- 미 등 록 -</div>
                                </td>

                                <!-- Action -->
                                <td class="profile-action-cell px-4 py-4 text-center">
                                    <template v-if="profileDetails[profile.profileName]">
                                        <button
                                            v-if="profileDetails[profile.profileName]?.myGeneral"
                                            class="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors"
                                            :disabled="entryLoading[profile.profileName]"
                                            @click="handleEnter(profile, '/')"
                                        >
                                            입장
                                        </button>
                                        <div
                                            v-else-if="
                                                profileDetails[profile.profileName]!.userCnt >=
                                                profileDetails[profile.profileName]!.maxUserCnt
                                            "
                                            class="text-zinc-500"
                                        >
                                            - 장수 등록 마감 -
                                        </div>
                                        <div v-else class="grid gap-1">
                                            <button
                                                v-if="profileDetails[profile.profileName]?.selectionPoolEnabled"
                                                class="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors"
                                                :disabled="entryLoading[profile.profileName]"
                                                @click="handleEnter(profile, '/select-general')"
                                            >
                                                장수선택
                                            </button>
                                            <template v-else>
                                                <button
                                                    class="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors"
                                                    :disabled="
                                                        entryLoading[profile.profileName] ||
                                                        profile.localAccountPolicy?.canCreateGeneral === false
                                                    "
                                                    @click="handleEnter(profile, '/join')"
                                                >
                                                    {{
                                                        profile.localAccountPolicy?.canCreateGeneral === false
                                                            ? '인증 필요'
                                                            : '장수생성'
                                                    }}
                                                </button>
                                                <button
                                                    v-if="profileDetails[profile.profileName]?.npcPossessionEnabled"
                                                    class="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors"
                                                    :disabled="
                                                        entryLoading[profile.profileName] ||
                                                        profile.localAccountPolicy?.canCreateGeneral === false
                                                    "
                                                    @click="handleEnter(profile, '/join?tab=possess')"
                                                >
                                                    장수빙의
                                                </button>
                                            </template>
                                        </div>
                                    </template>
                                    <template v-else-if="!isProfileRuntimeAvailable(profile)">
                                        <span class="text-zinc-700">-</span>
                                    </template>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <!-- Footer Info -->
                <div class="bg-zinc-800/50 p-4 text-xs text-zinc-500 space-y-2 border-t border-zinc-800">
                    <p class="text-red-500 font-bold">
                        ★ 1명이 2개 이상의 계정을 사용하거나 타 유저의 턴을 대신 입력하는 것이 적발될 경우 차단 될 수
                        있습니다.
                    </p>
                    <p>계정은 한번 등록으로 계속 사용합니다. 각 서버 리셋시 캐릭터만 새로 생성하면 됩니다.</p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 mt-2">
                        <p>
                            <span class="text-zinc-300 font-bold">체섭</span> : 메인서버입니다. 천하통일에 도전하여
                            왕조일람과 명예의전당에 올라봅시다! (주로 1턴=60분)
                        </p>
                        <p>
                            <span class="text-zinc-300 font-bold">퀘섭</span> : 마이너 서버 그룹1. 비교적 느린 시간으로
                            운영됩니다.
                        </p>
                        <p>
                            <span class="text-zinc-300 font-bold">풰섭</span> : 마이너 서버 그룹1. 비교적 느린 시간으로
                            운영됩니다.
                        </p>
                        <p>
                            <span class="text-zinc-300 font-bold">퉤섭</span> : 마이너 서버 그룹2. 비교적 빠른 시간으로
                            운영됩니다.
                        </p>
                        <p>
                            <span class="text-zinc-300 font-bold">냐섭</span> : 마이너 서버 그룹3. 독특한 컨셉 위주로
                            운영됩니다.
                        </p>
                        <p>
                            <span class="text-zinc-300 font-bold">퍄섭</span> : 마이너 서버 그룹3. 독특한 컨셉 위주로
                            운영됩니다.
                        </p>
                        <p>
                            <span class="text-zinc-300 font-bold">훼섭</span> : 운영자 테스트 서버입니다. 기습적으로
                            열리고, 닫힐 수 있습니다.
                        </p>
                    </div>
                </div>
            </div>

            <div class="bg-zinc-900 border border-zinc-800 rounded shadow-xl overflow-hidden">
                <div
                    class="bg-zinc-800 px-6 py-2 text-center font-bold text-white border-b border-zinc-700 tracking-widest"
                >
                    공개 지도 미리보기
                </div>
                <div class="p-4">
                    <div
                        v-if="publicMapProfiles.length"
                        class="map-preview-tabs"
                        role="tablist"
                        aria-label="공개 지도 서버 선택"
                    >
                        <button
                            v-for="profile in publicMapProfiles"
                            :id="`map-preview-tab-${profile.profileName}`"
                            :key="profile.profileName"
                            type="button"
                            role="tab"
                            :aria-selected="selectedMapProfileName === profile.profileName"
                            :aria-controls="`map-preview-panel-${profile.profileName}`"
                            :tabindex="selectedMapProfileName === profile.profileName ? 0 : -1"
                            class="map-preview-tab"
                            :class="{ 'is-active': selectedMapProfileName === profile.profileName }"
                            :style="{ '--profile-color': profile.color }"
                            @mouseenter="selectMapProfile(profile.profileName)"
                            @focus="selectMapProfile(profile.profileName)"
                            @click="selectMapProfile(profile.profileName)"
                            @keydown="handleMapTabKeydown($event, profile.profileName)"
                        >
                            {{ profile.korName }}섭
                        </button>
                    </div>
                    <div
                        v-if="selectedMapProfile"
                        :id="`map-preview-panel-${selectedMapProfile.profileName}`"
                        role="tabpanel"
                        :aria-labelledby="`map-preview-tab-${selectedMapProfile.profileName}`"
                        class="map-preview-panel"
                        data-testid="public-map-preview-panel"
                    >
                        <div v-if="selectedMapPreview">
                            <MapPreview
                                :map-data="selectedMapPreview.mapData"
                                :map-layout="selectedMapPreview.mapLayout"
                                mode="detail"
                            />
                            <div
                                v-if="profileDetails[selectedMapProfile.profileName]"
                                class="map-preview-summary"
                                data-testid="public-map-preview-summary"
                            >
                                <span class="map-preview-runtime-status" :style="{ color: selectedMapProfile.color }">
                                    {{ selectedMapProfile.status }}
                                </span>
                                <span>
                                    유저 {{ profileDetails[selectedMapProfile.profileName]?.userCnt ?? '-' }} /
                                    {{ profileDetails[selectedMapProfile.profileName]?.maxUserCnt ?? '-' }}
                                </span>
                                <span>{{ profileDetails[selectedMapProfile.profileName]?.nationCnt ?? '-' }}국</span>
                                <span>{{ profileDetails[selectedMapProfile.profileName]?.turnTerm ?? '-' }}분 턴</span>
                            </div>
                        </div>
                        <div v-else class="text-xs text-zinc-500 py-8 text-center">지도를 불러오는 중...</div>
                    </div>
                    <div v-else class="text-sm text-zinc-500 py-8 text-center" data-testid="public-map-empty">
                        현재 공개 중인 서버가 없습니다.
                    </div>
                </div>
            </div>

            <div class="bg-zinc-900 border border-zinc-800 rounded shadow-xl overflow-hidden">
                <div
                    class="bg-zinc-800 px-6 py-2 text-center font-bold text-white border-b border-zinc-700 tracking-widest"
                >
                    커 뮤 니 티 도 구
                </div>
                <div class="p-6 text-center">
                    <p class="m-0 text-sm text-zinc-400">
                        시나리오와 빌드 옵션을 확인하고 운영자에게 전달할 오픈 건의 문구를 만들 수 있습니다.
                    </p>
                    <RouterLink
                        to="/open-suggestion"
                        class="open-suggestion-link mt-4 inline-flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
                    >
                        오픈 건의 양식 작성
                    </RouterLink>
                </div>
            </div>

            <!-- Account Management -->
            <div class="bg-zinc-900 border border-zinc-800 rounded shadow-xl overflow-hidden">
                <div
                    class="bg-zinc-800 px-6 py-2 text-center font-bold text-white border-b border-zinc-700 tracking-widest"
                >
                    계 정 관 리
                </div>
                <div class="account-actions p-6">
                    <RouterLink
                        to="/account"
                        class="account-navigation-button bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
                    >
                        비밀번호 & 전콘 & 탈퇴
                    </RouterLink>
                    <button
                        id="btn_logout"
                        class="legacy-logout-button"
                        :disabled="logoutLoading"
                        @click="handleLogout"
                    >
                        {{ logoutLoading ? '로그아웃 중…' : '로 그 아 웃' }}
                    </button>
                    <RouterLink
                        v-if="canAccessAdmin"
                        to="/admin"
                        class="account-navigation-button account-admin-button bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
                    >
                        관리자 페이지
                    </RouterLink>
                </div>
                <p v-if="logoutError" class="px-6 pb-4 text-center text-sm text-red-400" role="alert">
                    {{ logoutError }}
                </p>
            </div>
        </div>
    </DefaultLayout>
</template>

<style scoped>
.account-actions {
    display: flex;
    justify-content: center;
    gap: 16px;
}

.account-navigation-button {
    display: flex;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    text-align: center;
}

.open-suggestion-link {
    min-height: 44px;
    text-decoration: none;
}

.open-suggestion-link:focus-visible {
    outline: 2px solid #fdba74;
    outline-offset: 2px;
}

.legacy-logout-button {
    box-sizing: border-box;
    width: 200px;
    height: 48px;
    border: 0;
    border-radius: 6px;
    background: #303030;
    color: #fff;
    cursor: pointer;
    font-family: Pretendard, sans-serif;
    font-size: 16px;
    font-weight: 700;
    line-height: 24px;
    padding: 10px;
}

.profile-table-frame {
    overflow-x: auto;
}

.profile-table {
    min-width: 760px;
}

.season-status {
    user-select: none;
}

.upcoming-reset-announcement {
    border-left: 2px solid #f59e0b;
    padding-left: 10px;
    line-height: 1.5;
}

.upcoming-reset-phase {
    margin-bottom: 4px;
    color: #fbbf24;
    font-size: 12px;
    font-weight: 700;
}

.upcoming-reset-phase.is-delayed {
    color: #fca5a5;
}

.copyable-autorun {
    position: relative;
    cursor: help;
    text-decoration: underline;
    text-underline-offset: 2px;
}

.copyable-autorun-detail {
    display: inline;
    color: transparent;
    font-size: 0;
}

.copyable-autorun-bracket {
    color: transparent;
    font-size: 0;
}

.copyable-autorun:hover .copyable-autorun-detail,
.copyable-autorun:focus-visible .copyable-autorun-detail {
    position: absolute;
    z-index: 30;
    right: 0;
    bottom: calc(100% + 6px);
    display: block;
    box-sizing: border-box;
    width: max-content;
    max-width: min(520px, calc(100vw - 32px));
    padding: 6px 8px;
    border: 1px solid #52525b;
    border-radius: 4px;
    background: #18181b;
    box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
    color: #f4f4f5;
    font-size: 12px;
    line-height: 1.4;
    text-align: left;
    white-space: normal;
}

.copyable-autorun:focus-visible {
    border-radius: 2px;
    outline: 2px solid #fdba74;
    outline-offset: 2px;
}

@media (max-width: 640px) {
    .copyable-autorun:hover .copyable-autorun-detail,
    .copyable-autorun:focus-visible .copyable-autorun-detail {
        position: fixed;
        right: 16px;
        bottom: 16px;
        left: 16px;
        width: auto;
        max-width: none;
    }
}

.map-preview-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    border-bottom: 1px solid #3f3f46;
    padding: 0 2px;
}

@media (max-width: 799px) {
    .profile-table-frame {
        overflow-x: visible;
    }

    .profile-table {
        display: block;
        width: 100%;
        min-width: 0;
    }

    .profile-table thead {
        display: none;
    }

    .profile-table tbody {
        display: grid;
        gap: 1px;
        background: #27272a;
    }

    .profile-table tbody tr {
        display: grid;
        min-width: 0;
        grid-template-areas:
            'server info info'
            'portrait general action';
        grid-template-columns: 88px minmax(0, 1fr) 104px;
        background: #18181b;
    }

    .profile-table tbody td {
        box-sizing: border-box;
        width: auto;
        min-width: 0;
        padding: 12px 8px;
    }

    .profile-server-cell {
        grid-area: server;
        border-bottom: 1px solid #27272a;
    }

    .profile-server-cell > div {
        overflow-wrap: anywhere;
        white-space: normal;
    }

    .profile-info-cell {
        grid-area: info;
        border-right: 0;
        border-bottom: 1px solid #27272a;
    }

    .profile-portrait-cell {
        grid-area: portrait;
    }

    .profile-general-cell {
        grid-area: general;
    }

    .profile-action-cell {
        grid-area: action;
    }
}

.map-preview-tab {
    flex: 0 0 auto;
    border: 1px solid #3f3f46;
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
    background: #18181b;
    color: #a1a1aa;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    padding: 7px 16px;
}

.map-preview-tab:hover,
.map-preview-tab:focus,
.map-preview-tab.is-active {
    background: #27272a;
    color: var(--profile-color, #fff);
}

.map-preview-tab:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -3px;
}

.map-preview-tab.is-active {
    box-shadow: inset 0 3px 0 var(--profile-color, #fff);
}

.map-preview-panel {
    min-width: 0;
    border: 1px solid #3f3f46;
    border-top: 0;
    border-radius: 0 0 6px 6px;
    background: rgb(9 9 11 / 50%);
    padding: 12px;
}

.map-preview-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;
    margin-top: 8px;
    color: #a1a1aa;
    font-size: 12px;
    line-height: 18px;
}

.map-preview-summary > span + span::before {
    margin-inline: 6px;
    color: #52525b;
    content: '·';
}

.map-preview-runtime-status {
    font-weight: 600;
}

.legacy-logout-button:hover,
.legacy-logout-button:focus,
.legacy-logout-button:active {
    background: #303030;
    color: #fff;
}

.legacy-logout-button:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
}

.legacy-logout-button:disabled {
    cursor: default;
    opacity: 0.65;
}

@media (max-width: 640px) {
    .account-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .account-actions > * {
        width: 100%;
        min-width: 0;
    }

    .account-navigation-button {
        height: 48px;
        padding: 10px 4px;
        font-size: clamp(12px, 3.2vw, 16px);
        line-height: 24px;
        white-space: nowrap;
    }

    .account-admin-button {
        grid-column: 1 / -1;
    }
}

@media (max-width: 360px) {
    .account-actions {
        grid-template-columns: minmax(0, 1fr);
    }

    .account-admin-button {
        grid-column: auto;
    }
}
</style>
