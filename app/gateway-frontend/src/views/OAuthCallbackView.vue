<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import DefaultLayout from '../layouts/DefaultLayout.vue';
import KakaoOtpDialog from '../components/KakaoOtpDialog.vue';
import { trpc } from '../utils/trpc';
import { sealPassword } from '../utils/passwordEnvelope';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const submitting = ref(false);
const errorMessage = ref('');
const infoMessage = ref('');
const oauthSessionId = ref('');
const email = ref('');
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const displayName = ref('');
const termsAgreed = ref(false);
const privacyAgreed = ref(false);
const thirdPartyUse = ref(false);
const otpChallenge = ref<{ challengeId: string; expiresAt: string; attemptsRemaining: number } | null>(null);
const otpSuccessStatus = ref<'login' | 'verified'>('login');
const appBase = import.meta.env.BASE_URL;

const completeExchange = async (): Promise<void> => {
    const code = typeof route.query.code === 'string' ? route.query.code : '';
    const state = typeof route.query.state === 'string' ? route.query.state : '';
    if (!code || !state) {
        errorMessage.value = '카카오 인증 응답이 올바르지 않습니다.';
        loading.value = false;
        return;
    }
    try {
        const result = await trpc.auth.kakaoExchange.mutate({ code, state });
        if (result.status === 'otp') {
            otpChallenge.value = result;
            otpSuccessStatus.value = result.successStatus;
            return;
        }
        if (result.status === 'login') {
            window.localStorage.setItem('sammo-session-token', result.sessionToken);
            await router.replace('/lobby');
            return;
        }
        if (result.status === 'verified') {
            window.localStorage.setItem('sammo-session-token', result.sessionToken);
            await router.replace('/lobby?verified=1');
            return;
        }
        if (result.status === 'change_pw') {
            infoMessage.value = '카카오톡으로 임시 비밀번호를 보냈습니다.';
            return;
        }
        oauthSessionId.value = result.oauthSessionId;
        email.value = result.email;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '카카오 인증을 완료하지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const register = async (): Promise<void> => {
    errorMessage.value = '';
    if (password.value !== confirmPassword.value) {
        errorMessage.value = '비밀번호 확인이 일치하지 않습니다.';
        return;
    }
    if (!termsAgreed.value || !privacyAgreed.value) {
        errorMessage.value = '이용약관과 개인정보 처리방침에 동의해야 합니다.';
        return;
    }
    submitting.value = true;
    try {
        const credential = await sealPassword(password.value);
        const result = await trpc.auth.register.mutate({
            oauthSessionId: oauthSessionId.value,
            username: username.value,
            credential,
            displayName: displayName.value,
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: thirdPartyUse.value,
        });
        if (result.status === 'otp') {
            otpChallenge.value = result;
            otpSuccessStatus.value = result.successStatus;
            oauthSessionId.value = '';
            return;
        }
        window.localStorage.setItem('sammo-session-token', result.sessionToken);
        await router.replace('/lobby');
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '회원가입에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};

const handleOtpVerified = async (sessionToken: string): Promise<void> => {
    window.localStorage.setItem('sammo-session-token', sessionToken);
    otpChallenge.value = null;
    await router.replace(otpSuccessStatus.value === 'verified' ? '/lobby?verified=1' : '/lobby');
};

onMounted(() => {
    void completeExchange();
});
</script>

<template>
    <DefaultLayout>
        <main id="oauth-container">
            <h1>삼국지 모의전투 HiDCHe</h1>
            <section class="oauth-card">
                <h2>회원가입</h2>
                <p v-if="loading" class="oauth-message">카카오 인증을 확인하는 중...</p>
                <p v-else-if="infoMessage" class="oauth-message" role="status">{{ infoMessage }}</p>
                <form v-else-if="oauthSessionId" @submit.prevent="register">
                    <div class="form-row">
                        <label for="oauth-email">카카오 이메일</label>
                        <input id="oauth-email" :value="email" readonly />
                    </div>
                    <div class="form-row">
                        <label for="oauth-username">계정명</label>
                        <input id="oauth-username" v-model="username" minlength="4" maxlength="64" required />
                    </div>
                    <div class="form-row">
                        <label for="oauth-password">비밀번호</label>
                        <input id="oauth-password" v-model="password" type="password" minlength="6" required />
                    </div>
                    <div class="form-row">
                        <label for="oauth-confirm">비밀번호 확인</label>
                        <input id="oauth-confirm" v-model="confirmPassword" type="password" minlength="6" required />
                    </div>
                    <div class="form-row">
                        <label for="oauth-display-name">닉네임</label>
                        <div>
                            <input
                                id="oauth-display-name"
                                v-model="displayName"
                                minlength="2"
                                maxlength="40"
                                required
                            />
                            <small>깃수가 종료될 때 공개됩니다. 계속 사용할 이름이므로 신중하게 정해주세요.</small>
                        </div>
                    </div>
                    <div class="agreement-row">
                        <span>이용 약관</span>
                        <label>
                            <input v-model="termsAgreed" type="checkbox" />
                            <a :href="`${appBase}terms.1.html`" target="_blank">내용 확인</a> 후 동의합니다.
                        </label>
                    </div>
                    <div class="agreement-row">
                        <span>개인정보 제공 및 이용</span>
                        <label>
                            <input v-model="privacyAgreed" type="checkbox" />
                            <a :href="`${appBase}terms.2.html`" target="_blank">내용 확인</a> 후 동의합니다.
                        </label>
                    </div>
                    <div class="agreement-row">
                        <span>개인정보 제3자 제공 (선택)</span>
                        <label>
                            <input v-model="thirdPartyUse" type="checkbox" />
                            동의합니다.
                        </label>
                    </div>
                    <button class="register-button" type="submit" :disabled="submitting">
                        {{ submitting ? '가입 중...' : '가입' }}
                    </button>
                </form>
                <p v-if="errorMessage" class="oauth-error" role="alert">{{ errorMessage }}</p>
                <RouterLink v-if="!loading && !oauthSessionId" class="back-link" to="/">돌아가기</RouterLink>
            </section>
        </main>
    </DefaultLayout>
    <KakaoOtpDialog
        v-if="otpChallenge"
        :challenge-id="otpChallenge.challengeId"
        @verified="handleOtpVerified"
        @cancel="otpChallenge = null"
    />
</template>

<style scoped>
#oauth-container {
    width: min(calc(100% - 24px), 700px);
    margin: 90px auto 40px;
    color: #fff;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
}

#oauth-container h1 {
    margin: 0 0 18px;
    font-size: 32px;
    font-weight: 400;
    text-align: center;
}

.oauth-card {
    border: 1px solid #444;
    border-radius: 4px;
    background: #303030;
    overflow: hidden;
}

.oauth-card h2 {
    margin: 0;
    border-bottom: 1px solid #555;
    background: #444;
    padding: 8px 14px;
    font-size: 20px;
}

.oauth-card form {
    display: grid;
    gap: 12px;
    padding: 18px;
}

.form-row,
.agreement-row {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 12px;
    align-items: start;
}

.form-row > label,
.agreement-row > span {
    padding-top: 7px;
    text-align: right;
}

.form-row input:not([type='checkbox']) {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #ced4da;
    border-radius: 4px;
    background: #ddd;
    color: #303030;
    padding: 7px 10px;
}

.form-row small {
    display: block;
    margin-top: 4px;
    color: #aaa;
}

.agreement-row label {
    padding: 7px 0;
}

.agreement-row a {
    color: #6db9ff;
}

.register-button {
    min-height: 42px;
    margin-left: 162px;
    border: 1px solid #2f4d6c;
    border-radius: 4px;
    background: #375a7f;
    color: #fff;
    font-weight: 700;
    cursor: pointer;
}

.register-button:hover,
.register-button:focus {
    background: #2f4d6c;
}

.register-button:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}

.oauth-message,
.oauth-error,
.back-link {
    display: block;
    margin: 18px;
    text-align: center;
}

.oauth-error {
    color: #ff8a80;
}

.back-link {
    color: #6db9ff;
}

@media (max-width: 519px) {
    #oauth-container {
        width: calc(100% - 16px);
        margin-top: 78px;
    }

    #oauth-container h1 {
        font-size: 24px;
    }

    .form-row,
    .agreement-row {
        grid-template-columns: 1fr;
        gap: 3px;
    }

    .form-row > label,
    .agreement-row > span {
        padding-top: 0;
        text-align: left;
    }

    .register-button {
        margin-left: 0;
    }
}
</style>
