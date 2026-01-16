<script setup lang="ts">
import { ref, onMounted } from 'vue';
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

onMounted(async () => {
    try {
        me.value = await trpc.me.query();
        if (!me.value) {
            await router.push('/');
            return;
        }

        notice.value = await trpc.lobby.notice.query();
        profiles.value = await trpc.lobby.profiles.query();

        const detailTasks = profiles.value.map(async (profile) => {
            if (profile.status !== 'RUNNING' && profile.status !== 'PREOPEN') {
                return;
            }
            const gameTrpc = createGameTrpc(profile.apiPort);
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
    // TODO: Implement logout mutation in gateway-api
    // await trpc.auth.logout.mutation();
    await router.push('/');
};

const resolveGameUrl = (path: string, profileName: string, gameToken: string): string | null => {
    const baseUrl = import.meta.env.VITE_GAME_WEB_URL ?? '';
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
        alert('게임 서버 접속에 실패했습니다.');
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
                                        :src="profileDetails[profile.profileName]?.myGeneral?.picture ?? undefined"
                                        class="w-full h-full object-cover"
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
                                        :disabled="entryLoading[profile.profileName]"
                                        @click="handleEnter(profile, '/join')"
                                    >
                                        장수생성
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
                            <div v-else class="text-xs text-zinc-500 py-8 text-center">
                                지도를 불러오는 중...
                            </div>
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
                    <button
                        class="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
                    >
                        비밀번호 & 전콘 & 탈퇴
                    </button>
                    <button
                        class="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
                        @click="handleLogout"
                    >
                        로 그 아 웃
                    </button>
                    <button
                        v-if="me?.roles?.includes('admin')"
                        class="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded border border-zinc-700 transition-colors"
                    >
                        관리자 페이지
                    </button>
                </div>
            </div>
        </div>
    </DefaultLayout>
</template>
