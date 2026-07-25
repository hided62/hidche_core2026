<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@sammo-ts/gateway-api';

import MapPreview from '../components/MapPreview.vue';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import { createGameTrpc, type GameRouter } from '../utils/gameTrpc';
import { trpc } from '../utils/trpc';

type GatewayOutput = inferRouterOutputs<AppRouter>;
type GameOutput = inferRouterOutputs<GameRouter>;
type LobbyProfile = GatewayOutput['lobby']['profiles'][number];
type LobbyInfo = GameOutput['lobby']['info'];
type PublicMap = GameOutput['public']['getCachedMap'];
type PublicMapLayout = GameOutput['public']['getMapLayout'];

const router = useRouter();
const username = ref('');
const password = ref('');
const loginError = ref('');
const loginLoading = ref(false);
const statusLoading = ref(false);
const statusError = ref('');
const profile = ref<LobbyProfile | null>(null);
const info = ref<LobbyInfo | null>(null);
const mapData = ref<PublicMap | null>(null);
const mapLayout = ref<PublicMapLayout | null>(null);

const statusTitle = computed(() => `${profile.value?.korName ?? '체'} 현황`);
const dateText = computed(() => {
    if (!info.value) {
        return '';
    }
    return `西紀 ${info.value.year}年 ${info.value.month}月`;
});

const loadPublicStatus = async (): Promise<void> => {
    statusLoading.value = true;
    statusError.value = '';
    try {
        const profiles = await trpc.lobby.profiles.query();
        profile.value =
            profiles.find((entry) => entry.status === 'RUNNING') ??
            profiles.find((entry) => entry.status === 'PREOPEN') ??
            profiles[0] ??
            null;
        if (!profile.value) {
            statusError.value = '공개 중인 서버가 없습니다.';
            return;
        }
        const game = createGameTrpc(profile.value.profile, profile.value.apiPort);
        const [nextInfo, nextLayout, nextMap] = await Promise.all([
            game.lobby.info.query(),
            game.public.getMapLayout.query(),
            game.public.getCachedMap.query(),
        ]);
        info.value = nextInfo;
        mapLayout.value = nextLayout;
        mapData.value = nextMap;
    } catch (error) {
        statusError.value = error instanceof Error ? error.message : '서버 현황을 불러오지 못했습니다.';
    } finally {
        statusLoading.value = false;
    }
};

onMounted(async () => {
    try {
        const me = await trpc.me.query();
        if (me) {
            await router.push('/lobby');
            return;
        }
    } catch {
        // 공개 로그인 화면은 API 상태 메시지와 함께 계속 표시한다.
    }
    await loadPublicStatus();
});

const handleLogin = async (): Promise<void> => {
    loginError.value = '';
    loginLoading.value = true;
    try {
        const result = await trpc.auth.login.mutate({
            username: username.value,
            password: password.value,
        });
        window.localStorage.setItem('sammo-session-token', result.sessionToken);
        await router.push('/lobby');
    } catch (error) {
        loginError.value = error instanceof Error ? error.message : '로그인에 실패했습니다.';
    } finally {
        loginLoading.value = false;
    }
};

const handleKakao = async (): Promise<void> => {
    loginError.value = '';
    try {
        const result = await trpc.auth.kakaoStart.query({ mode: 'login' });
        window.location.assign(result.authUrl);
    } catch (error) {
        loginError.value = error instanceof Error ? error.message : '카카오 로그인을 시작하지 못했습니다.';
    }
};
</script>

<template>
    <DefaultLayout>
        <div class="gateway-home">
            <h2>삼국지 모의전투 HiDCHe</h2>

            <section id="login_card" class="login-card">
                <h3>로그인</h3>
                <form id="main_form" @submit.prevent="handleLogin">
                    <label for="username">계정명</label>
                    <input
                        id="username"
                        v-model="username"
                        autocomplete="username"
                        type="text"
                        placeholder="계정명"
                        autofocus
                        required
                    />
                    <label for="password">비밀번호</label>
                    <input
                        id="password"
                        v-model="password"
                        autocomplete="current-password"
                        type="password"
                        placeholder="비밀번호"
                        required
                    />
                    <button id="btn_kakao_login" class="kakao-button" type="button" @click="handleKakao">
                        가입&amp;<br />로그인
                    </button>
                    <button class="login-button" type="submit" :disabled="loginLoading">
                        {{ loginLoading ? '로그인 중…' : '로그인' }}
                    </button>
                </form>
                <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
            </section>

            <section id="map-subframe" class="status-card">
                <header>
                    <strong>{{ statusTitle }}</strong>
                    <span>{{ dateText }}</span>
                </header>
                <div v-if="mapData && mapLayout" class="map-frame">
                    <MapPreview :map-data="mapData" :map-layout="mapLayout" />
                </div>
                <div v-else class="status-message">
                    {{ statusLoading ? '현황을 불러오는 중…' : statusError }}
                </div>
                <ul v-if="info" class="status-summary">
                    <li>서버: {{ profile?.korName }} / 시나리오: {{ profile?.scenario }}</li>
                    <li>유저 {{ info.userCnt }}명 · NPC {{ info.npcCnt }}명 · {{ info.nationCnt }}국 경쟁중</li>
                    <li>{{ info.turnTerm }}분 턴 서버</li>
                </ul>
                <button type="button" class="refresh-button" :disabled="statusLoading" @click="loadPublicStatus">
                    현황 새로고침
                </button>
            </section>
        </div>
    </DefaultLayout>
</template>

<style scoped>
.gateway-home {
    display: flex;
    width: min(100% - 24px, 700px);
    margin: 120px auto 30px;
    flex-direction: column;
    align-items: center;
    gap: 20px;
}

.gateway-home h2 {
    margin: 0 0 2px;
    color: #fff;
    font-size: 20px;
    font-weight: 400;
    line-height: 1.2;
    text-align: center;
}

.login-card {
    width: min(100%, 450px);
    overflow: hidden;
    border: 1px solid #444;
    border-radius: 6px;
    background: #303030;
}

.login-card h3 {
    margin: 0;
    border-bottom: 1px solid #555;
    background: #444;
    padding: 6px 12px;
    color: #fff;
    font-size: 20px;
    font-weight: 500;
}

.login-card form {
    display: grid;
    grid-template-columns: 1fr 1.8fr;
    gap: 12px 10px;
    align-items: center;
    padding: 18px 14px;
}

.login-card label {
    text-align: center;
}

.login-card input {
    min-width: 0;
    border: 1px solid #ced4da;
    border-radius: 4px;
    background: #ddd;
    color: #303030;
    padding: 6px 10px;
}

.login-card input:focus {
    border-color: #8bb8e5;
    outline: 0;
    box-shadow: 0 0 0 3px rgb(55 90 127 / 35%);
}

.kakao-button,
.login-button {
    min-height: 40px;
    border: 1px solid transparent;
    border-radius: 4px;
    font-weight: 700;
    cursor: pointer;
}

.kakao-button {
    background: #fee500;
    color: #191919;
    line-height: 1;
}

.login-button {
    background: #375a7f;
    color: #fff;
}

.login-button:hover,
.login-button:focus {
    background: #2f4d6c;
}

.login-button:disabled {
    cursor: default;
    opacity: 0.65;
}

.login-error {
    margin: 0 14px 14px;
    color: #ff8a80;
    text-align: center;
}

.status-card {
    width: min(100%, 700px);
    overflow: hidden;
    border: 1px solid #444;
    border-radius: 6px;
    background: #000;
}

.status-card > header {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid #555;
    background: #444;
    padding: 5px 12px;
}

.map-frame {
    width: 100%;
    min-height: 320px;
    overflow: hidden;
}

.status-message {
    display: grid;
    min-height: 320px;
    place-items: center;
    color: #888;
}

.status-summary {
    margin: 0;
    padding: 8px 18px;
    font-size: 12px;
}

.refresh-button {
    float: right;
    margin: 0 8px 8px;
    border: 0;
    background: transparent;
    color: #3498db;
    cursor: pointer;
}

@media (max-width: 519px) {
    .gateway-home {
        width: calc(100% - 16px);
        margin-top: 110px;
    }

    .login-card form {
        grid-template-columns: 0.85fr 1.35fr;
    }

    .map-frame,
    .status-message {
        min-height: 280px;
    }
}
</style>
