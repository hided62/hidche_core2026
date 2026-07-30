<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@sammo-ts/gateway-api';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import MapPreview from '../components/MapPreview.vue';
import { trpc } from '../utils/trpc';
import { createGameTrpc } from '../utils/gameTrpc';
import type { GameRouter } from '../utils/gameTrpc';

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

const router = useRouter();
const me = ref<MeOutput>(null);
const notice = ref('');
const profiles = ref<LobbyProfile[]>([]);
const profileDetails = ref<Record<string, LobbyInfo | undefined>>({});
const profileMapPreviews = ref<Record<string, MapPreviewBundle | undefined>>({});
const entryLoading = ref<Record<string, boolean>>({});
const logoutLoading = ref(false);
const logoutError = ref('');
const canAccessAdmin = computed(
    () =>
        me.value?.roles.some(
            (role) =>
                role === 'superuser' || role === 'admin' || role === 'admin.superuser' || role.startsWith('admin.')
        ) ?? false
);
const needsKakaoVerification = computed(() => me.value !== null && !me.value.kakaoVerified);
const userIconBaseUrl =
    import.meta.env.VITE_GATEWAY_USER_ICON_BASE_URL ?? '/gateway/api/user-icons';

const formatGraceEndsAt = (value: string | null | undefined): string =>
    value ? new Date(value).toLocaleString('ko-KR') : '';
const resolveGeneralPicture = (general: LobbyGeneral): string => {
    const picture = general.picture?.trim() || 'default.jpg';
    return general.imageServer
        ? `${userIconBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(picture)}`
        : `/image/icons/${encodeURIComponent(picture)}`;
};
const handleGeneralPictureError = (event: Event): void => {
    const image = event.currentTarget as HTMLImageElement;
    if (image.dataset.fallbackApplied === 'true') {
        return;
    }
    image.dataset.fallbackApplied = 'true';
    image.src = '/image/icons/default.jpg';
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

        const detailTasks = profiles.value.map(async (profile) => {
            if (profile.status !== 'RUNNING' && profile.status !== 'PREOPEN') {
                return;
            }
            const publicGameTrpc = createGameTrpc(profile.profile, profile.apiPort);
            let gameToken: string | undefined;
            if (sessionToken) {
                try {
                    const issued = await trpc.auth.issueGameSession.mutate({
                        sessionToken,
                        profile: profile.profileName,
                    });
                    const exchanged = await publicGameTrpc.auth.exchangeGatewayToken.mutate({
                        gatewayToken: issued.gameToken,
                    });
                    gameToken = exchanged.accessToken;
                } catch (error) {
                    console.error(`Failed to authenticate lobby game session for ${profile.profileName}`, error);
                }
            }
            const gameTrpc = gameToken
                ? createGameTrpc(profile.profile, profile.apiPort, gameToken)
                : publicGameTrpc;
            const [infoResult, layoutResult, mapResult] = await Promise.allSettled([
                gameTrpc.lobby.info.query(),
                gameTrpc.public.getMapLayout.query(),
                gameTrpc.public.getCachedMap.query(),
            ]);

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
        });

        await Promise.all(detailTasks);
    } catch (e) {
        console.error('Failed to load lobby', e);
    }
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
        alert(error instanceof Error ? error.message : '카카오 인증을 시작하지 못했습니다.');
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
    url.searchParams.set('profile', profileName);
    url.searchParams.set('gameToken', gameToken);
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
            alert('게임 프론트엔드 주소가 설정되지 않았습니다.');
            return;
        }
        window.location.href = url;
    } catch (e) {
        console.error('Failed to issue game session', e);
        alert(e instanceof Error ? e.message : '게임 서버 접속에 실패했습니다.');
    } finally {
        entryLoading.value[profile.profileName] = false;
    }
};
</script>

<template>
    <DefaultLayout>
        <div class="max-w-5xl mx-auto py-8 px-4 space-y-8">
            <!-- Notice -->
            <div v-if="notice" class="text-center">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span class="text-orange-500 text-3xl font-bold" v-html="notice"></span>
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
                            유예기간이 지나면 게임에 입장할 수 없습니다. che·kwe·twe는 인증 전 장수 생성도
                            제한됩니다.
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
                <table class="w-full text-sm text-left">
                    <thead class="bg-zinc-800 text-zinc-400 uppercase text-xs">
                        <tr>
                            <th class="px-4 py-3 border-b border-zinc-700 w-24 text-center">서 버</th>
                            <th class="px-4 py-3 border-b border-zinc-700">정 보</th>
                            <th class="px-4 py-3 border-b border-zinc-700 w-48 text-center" colspan="2">캐 릭 터</th>
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
                            <td class="px-4 py-4 text-center border-r border-zinc-800">
                                <div
                                    :style="{ color: profile.color }"
                                    class="text-lg font-bold cursor-help"
                                    :title="
                                        profileDetails[profile.profileName]?.starttime
                                            ? `시작일: ${profileDetails[profile.profileName]?.starttime}`
                                            : ''
                                    "
                                >
                                    {{ profile.korName }}섭
                                </div>
                                <div v-if="profileDetails[profile.profileName]" class="text-xs text-zinc-500 mt-1">
                                    &lt;{{ profileDetails[profile.profileName]?.nationCnt }}국 경쟁중&gt;
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
                            <td class="px-4 py-4 border-r border-zinc-800">
                                <template v-if="profileDetails[profile.profileName]">
                                    <div class="space-y-1">
                                        <div>
                                            서기 {{ profileDetails[profile.profileName]?.year }}년
                                            {{ profileDetails[profile.profileName]?.month }}월 (<span
                                                class="text-orange-400"
                                                >{{ profile.scenario }}</span
                                            >)
                                        </div>
                                        <div class="text-zinc-400">
                                            유저 : {{ profileDetails[profile.profileName]?.userCnt }} /
                                            {{ profileDetails[profile.profileName]?.maxUserCnt }}명
                                            <span class="text-cyan-400 ml-2"
                                                >NPC : {{ profileDetails[profile.profileName]?.npcCnt }}명</span
                                            >
                                            <span class="text-green-400 ml-2"
                                                >({{ profileDetails[profile.profileName]?.turnTerm }}분 턴 서버)</span
                                            >
                                        </div>
                                        <div class="text-xs text-zinc-500">
                                            (상성 설정:{{ profileDetails[profile.profileName]?.fictionMode }}), (기타
                                            설정:{{ profileDetails[profile.profileName]?.otherTextInfo }})
                                        </div>
                                    </div>
                                </template>
                                <template v-else-if="profile.status === 'STOPPED'">
                                    <div class="text-center text-zinc-600 py-2">- 폐 쇄 중 -</div>
                                </template>
                                <template v-else>
                                    <div class="text-center text-zinc-500 py-2">정보를 불러오는 중...</div>
                                </template>
                            </td>

                            <!-- Character Info -->
                            <td class="px-2 py-4 w-16 border-r border-zinc-800">
                                <div
                                    v-if="profileDetails[profile.profileName]?.myGeneral"
                                    class="w-12 h-12 mx-auto bg-zinc-800 rounded overflow-hidden border border-zinc-700"
                                >
                                    <img
                                        :src="
                                            resolveGeneralPicture(
                                                profileDetails[profile.profileName]!.myGeneral!
                                            )
                                        "
                                        class="w-full h-full object-cover"
                                        @error="handleGeneralPictureError"
                                    />
                                </div>
                            </td>
                            <td class="px-4 py-4 border-r border-zinc-800 text-center">
                                <div v-if="profileDetails[profile.profileName]?.myGeneral" class="font-medium">
                                    {{ profileDetails[profile.profileName]?.myGeneral?.name }}
                                </div>
                                <div v-else class="text-zinc-600">- 미 등 록 -</div>
                            </td>

                            <!-- Action -->
                            <td class="px-4 py-4 text-center">
                                <template v-if="profileDetails[profile.profileName]">
                                    <button
                                        v-if="profileDetails[profile.profileName]?.myGeneral"
                                        class="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors"
                                        :disabled="entryLoading[profile.profileName]"
                                        @click="handleEnter(profile, '/')"
                                    >
                                        입장
                                    </button>
                                    <button
                                        v-else
                                        class="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors"
                                        :disabled="
                                            entryLoading[profile.profileName] ||
                                            profile.localAccountPolicy?.canCreateGeneral === false
                                        "
                                        @click="
                                            handleEnter(
                                                profile,
                                                profileDetails[profile.profileName]?.selectionPoolEnabled
                                                    ? '/select-general'
                                                    : '/join'
                                            )
                                        "
                                    >
                                        {{
                                            profile.localAccountPolicy?.canCreateGeneral === false
                                                ? '인증 필요'
                                                : profileDetails[profile.profileName]?.selectionPoolEnabled
                                                  ? '장수선택'
                                                  : '장수생성'
                                        }}
                                    </button>
                                </template>
                                <template v-else-if="profile.status === 'STOPPED'">
                                    <span class="text-zinc-700">-</span>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
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
                <div class="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div
                        v-for="profile in profiles"
                        :key="profile.profileName"
                        class="border border-zinc-800 rounded bg-zinc-950/50 p-3"
                    >
                        <div class="flex items-center justify-between text-xs text-zinc-400 mb-2">
                            <span class="font-semibold" :style="{ color: profile.color }">
                                {{ profile.korName }}섭
                            </span>
                            <span>{{ profile.status }}</span>
                        </div>
                        <div v-if="profile.status === 'RUNNING' || profile.status === 'PREOPEN'">
                            <div v-if="profileMapPreviews[profile.profileName]">
                                <MapPreview
                                    :map-data="profileMapPreviews[profile.profileName]!.mapData"
                                    :map-layout="profileMapPreviews[profile.profileName]!.mapLayout"
                                />
                                <div v-if="profileDetails[profile.profileName]" class="text-xs text-zinc-400 mt-2">
                                    유저 {{ profileDetails[profile.profileName]?.userCnt ?? '-' }} /
                                    {{ profileDetails[profile.profileName]?.maxUserCnt ?? '-' }} ·
                                    {{ profileDetails[profile.profileName]?.nationCnt ?? '-' }}국 ·
                                    {{ profileDetails[profile.profileName]?.turnTerm ?? '-' }}분 턴
                                </div>
                            </div>
                            <div v-else class="text-xs text-zinc-500 py-8 text-center">지도를 불러오는 중...</div>
                        </div>
                        <div v-else class="text-xs text-zinc-600 py-8 text-center">- 폐 쇄 중 -</div>
                    </div>
                </div>
            </div>

            <!-- Account Management -->
            <div class="bg-zinc-900 border border-zinc-800 rounded shadow-xl overflow-hidden">
                <div
                    class="bg-zinc-800 px-6 py-2 text-center font-bold text-white border-b border-zinc-700 tracking-widest"
                >
                    계 정 관 리
                </div>
                <div class="p-6 flex justify-center space-x-4">
                    <RouterLink
                        to="/account"
                        class="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
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
                        class="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
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
</style>
