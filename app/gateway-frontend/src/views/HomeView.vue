<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@sammo-ts/gateway-api';
import { gatewayProfileCapabilities } from '@sammo-ts/common';

import MapPreview from '../components/MapPreview.vue';
import KakaoOtpDialog from '../components/KakaoOtpDialog.vue';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import { createGameTrpc, type GameRouter } from '../utils/gameTrpc';
import { trpc } from '../utils/trpc';
import { formatLog } from '../utils/formatLog';
import { sealPassword } from '../utils/passwordEnvelope';
import { resolveServerSeasonStatus } from '../utils/serverSeasonStatus';

type GatewayOutput = inferRouterOutputs<AppRouter>;
type GameOutput = inferRouterOutputs<GameRouter>;
type LobbyProfile = GatewayOutput['lobby']['profiles'][number];
type LobbyInfo = GameOutput['lobby']['info'];
type PublicMap = GameOutput['public']['getCachedMap'];
type PublicMapLayout = GameOutput['public']['getMapLayout'];
const PROFILE_PUBLIC_STATUS_ORDER: LobbyProfile['status'][] = ['RUNNING', 'PREOPEN', 'PAUSED', 'COMPLETED'];

const router = useRouter();
const username = ref('');
const password = ref('');
const loginError = ref('');
const loginLoading = ref(false);
const otpChallenge = ref<{ challengeId: string; expiresAt: string; attemptsRemaining: number } | null>(null);
const statusLoading = ref(false);
const statusError = ref('');
const profile = ref<LobbyProfile | null>(null);
const info = ref<LobbyInfo | null>(null);
const mapData = ref<PublicMap | null>(null);
const mapLayout = ref<PublicMapLayout | null>(null);

const statusTitle = computed(() => (profile.value ? `${profile.value.korName} 현황` : '서버 현황'));
const dateText = computed(() => {
    if (!info.value) {
        return '';
    }
    return `西紀 ${info.value.year}年 ${info.value.month}月`;
});
const seasonStatus = computed(() => (info.value ? resolveServerSeasonStatus(info.value) : null));

const loadPublicStatus = async (): Promise<void> => {
    statusLoading.value = true;
    statusError.value = '';
    profile.value = null;
    info.value = null;
    mapData.value = null;
    mapLayout.value = null;
    try {
        const profiles = await trpc.lobby.profiles.query();
        profile.value =
            PROFILE_PUBLIC_STATUS_ORDER.map((status) =>
                profiles.find(
                    (entry) => entry.status === status && gatewayProfileCapabilities(entry.status).userAccessible
                )
            ).find((entry) => entry !== undefined) ?? null;
        if (!profile.value) {
            statusError.value = '현재 공개 중인 서버가 없습니다.';
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
    } catch {
        statusError.value = '서버 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
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
        const credential = await sealPassword(password.value);
        const result = await trpc.auth.login.mutate({
            username: username.value,
            credential,
        });
        if (result.status === 'otp') {
            otpChallenge.value = result;
            return;
        }
        window.localStorage.setItem('sammo-session-token', result.sessionToken);
        await router.push('/lobby');
    } catch (error) {
        loginError.value = error instanceof Error ? error.message : '로그인에 실패했습니다.';
    } finally {
        loginLoading.value = false;
    }
};

const handleOtpVerified = async (sessionToken: string): Promise<void> => {
    window.localStorage.setItem('sammo-session-token', sessionToken);
    otpChallenge.value = null;
    await router.push('/lobby');
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

const handlePasswordReset = async (): Promise<void> => {
    loginError.value = '';
    try {
        const result = await trpc.auth.kakaoStart.query({ mode: 'change_pw' });
        window.location.assign(result.authUrl);
    } catch (error) {
        loginError.value = error instanceof Error ? error.message : '비밀번호 초기화를 시작하지 못했습니다.';
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
                        카카오<br />로그인
                    </button>
                    <button class="login-button" type="submit" :disabled="loginLoading">
                        {{ loginLoading ? '로그인 중…' : '로그인' }}
                    </button>
                    <button class="reset-button" type="button" @click="handlePasswordReset">비밀번호 초기화</button>
                    <RouterLink class="signup-button" to="/signup">아이디로 회원가입</RouterLink>
                </form>
                <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
            </section>

            <section id="map-subframe" class="status-card">
                <header>
                    <strong>{{ statusTitle }}</strong>
                    <span>{{ dateText }}</span>
                </header>
                <div v-if="mapData && mapLayout" class="map-frame">
                    <MapPreview :map-data="mapData" :map-layout="mapLayout" mode="detail" />
                </div>
                <div v-else class="status-message">
                    {{ statusLoading ? '현황을 불러오는 중…' : statusError }}
                </div>
                <ul v-if="info" class="status-summary">
                    <li>서버: {{ profile?.korName }} / 시나리오: {{ profile?.scenario }}</li>
                    <li>
                        유저 {{ info.userCnt }}명 · NPC {{ info.npcCnt }}명 ·
                        <span class="season-status" :title="seasonStatus?.period">{{ seasonStatus?.label }}</span>
                    </li>
                    <li>{{ info.turnTerm }}분 턴 서버</li>
                </ul>
                <div v-if="mapData?.history?.length" class="status-history">
                    <!-- 레거시 로그의 허용된 색상·강조·전투 구조만 안전한 HTML로 재구성한다. -->
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <div v-for="entry in mapData.history" :key="entry.id" v-html="formatLog(entry.text)" />
                </div>
                <button type="button" class="refresh-button" :disabled="statusLoading" @click="loadPublicStatus">
                    현황 새로고침
                </button>
            </section>
        </div>
    </DefaultLayout>
    <KakaoOtpDialog
        v-if="otpChallenge"
        :challenge-id="otpChallenge.challengeId"
        @verified="handleOtpVerified"
        @cancel="otpChallenge = null"
    />
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
.login-button,
.reset-button {
    min-height: 40px;
    border: 1px solid transparent;
    border-radius: 4px;
    font-weight: 700;
    cursor: pointer;
}

.signup-button {
    grid-column: 1 / -1;
    min-height: 30px;
    border: 1px solid #375a7f;
    border-radius: 4px;
    background: #223851;
    color: #fff;
    font-weight: 700;
    line-height: 30px;
    text-align: center;
    text-decoration: none;
}

.signup-button:hover,
.signup-button:focus {
    background: #2f4d6c;
}

.reset-button {
    grid-column: 1 / -1;
    min-height: 30px;
    border-color: #555;
    background: #191919;
    color: #ddd;
}

.reset-button:hover,
.reset-button:focus {
    background: #303030;
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

.status-history {
    border-top: 1px solid #444;
    padding: 8px 12px;
    color: #ddd;
    font-family: 'Times New Roman', serif;
    font-size: 14px;
    line-height: 1.35;
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
