<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import DefaultLayout from '../layouts/DefaultLayout.vue';
import { sealPassword } from '../utils/passwordEnvelope';
import { trpc } from '../utils/trpc';

const router = useRouter();
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const displayName = ref('');
const termsAgreed = ref(false);
const privacyAgreed = ref(false);
const thirdPartyUse = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const usernameMessage = ref('');
const displayNameMessage = ref('');
const appBase = import.meta.env.BASE_URL;

const checkField = async (field: 'username' | 'displayName'): Promise<void> => {
    const value = field === 'username' ? username.value : displayName.value;
    if (!value) return;
    try {
        const result = await trpc.auth.checkRegistrationField.query({ field, value });
        if (field === 'username') {
            username.value = result.normalizedValue;
            usernameMessage.value = result.message;
        } else {
            displayName.value = result.normalizedValue;
            displayNameMessage.value = result.message;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : '입력값을 확인하지 못했습니다.';
        if (field === 'username') usernameMessage.value = message;
        else displayNameMessage.value = message;
    }
};

const register = async (): Promise<void> => {
    errorMessage.value = '';
    if (password.value !== confirmPassword.value) {
        errorMessage.value = '비밀번호가 일치하지 않습니다.';
        return;
    }
    if (!termsAgreed.value) {
        errorMessage.value = '약관에 동의해야 가입하실 수 있습니다.';
        return;
    }
    if (!privacyAgreed.value) {
        errorMessage.value = '개인정보 제공 및 이용에 대해 동의해야 가입하실 수 있습니다.';
        return;
    }
    submitting.value = true;
    try {
        const credential = await sealPassword(password.value);
        const result = await trpc.auth.registerLocal.mutate({
            username: username.value,
            credential,
            displayName: displayName.value,
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: thirdPartyUse.value,
        });
        window.localStorage.setItem('sammo-session-token', result.sessionToken);
        await router.replace('/lobby?welcome=local');
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '회원가입에 실패했습니다.';
    } finally {
        submitting.value = false;
    }
};
</script>

<template>
    <DefaultLayout>
        <main id="signup-container">
            <h1>삼국지 모의전투 HiDCHe</h1>
            <section class="signup-card">
                <h2>회원가입</h2>
                <form id="signup-form" @submit.prevent="register">
                    <div class="form-row">
                        <label for="signup-username">계정명</label>
                        <div>
                            <input
                                id="signup-username"
                                v-model="username"
                                autocomplete="username"
                                minlength="4"
                                maxlength="64"
                                required
                                autofocus
                                @blur="checkField('username')"
                            />
                            <small aria-live="polite">{{ usernameMessage }}</small>
                        </div>
                    </div>
                    <div class="form-row">
                        <label for="signup-password">비밀번호</label>
                        <input
                            id="signup-password"
                            v-model="password"
                            autocomplete="new-password"
                            type="password"
                            minlength="6"
                            required
                        />
                    </div>
                    <div class="form-row">
                        <label for="signup-confirm-password">비밀번호 확인</label>
                        <input
                            id="signup-confirm-password"
                            v-model="confirmPassword"
                            autocomplete="new-password"
                            type="password"
                            minlength="6"
                            required
                        />
                    </div>
                    <div class="form-row">
                        <label for="signup-display-name">닉네임</label>
                        <div>
                            <input
                                id="signup-display-name"
                                v-model="displayName"
                                maxlength="18"
                                required
                                @blur="checkField('displayName')"
                            />
                            <small>
                                깃수가 종료될 때 공개됩니다. 장수명과 달리 계속 고정되므로 신중하게 정해주세요.
                            </small>
                            <small aria-live="polite">{{ displayNameMessage }}</small>
                        </div>
                    </div>
                    <div class="agreement-row">
                        <span>이용 약관</span>
                        <div>
                            <iframe class="terms" :src="`${appBase}terms.1.html`" title="이용 약관"></iframe>
                            <label>
                                <input v-model="termsAgreed" type="checkbox" />
                                동의합니다.
                            </label>
                        </div>
                    </div>
                    <div class="agreement-row">
                        <span>개인정보 제공<br />및 이용 동의</span>
                        <div>
                            <iframe
                                class="terms"
                                :src="`${appBase}terms.2.html`"
                                title="개인정보 제공 및 이용 동의"
                            ></iframe>
                            <label>
                                <input v-model="privacyAgreed" type="checkbox" />
                                동의합니다.
                            </label>
                        </div>
                    </div>
                    <div class="agreement-row">
                        <span>개인정보 제3자 제공<br />(선택)</span>
                        <label>
                            <input v-model="thirdPartyUse" type="checkbox" />
                            동의합니다.
                        </label>
                    </div>
                    <aside class="verification-notice">
                        먼저 아이디와 비밀번호로 가입합니다. 계속 이용하려면 가입 후 카카오 인증을 연결해야 합니다.
                        che·kwe·twe는 인증 전 장수 생성이 제한되며, nya·pya·hwe는 표시된 유예기간 동안만
                        가능합니다.
                    </aside>
                    <div class="action-row">
                        <RouterLink class="back-link" to="/">돌아가기</RouterLink>
                        <button type="submit" :disabled="submitting">
                            {{ submitting ? '가입 중…' : '가입' }}
                        </button>
                    </div>
                </form>
                <p v-if="errorMessage" class="signup-error" role="alert">{{ errorMessage }}</p>
            </section>
        </main>
    </DefaultLayout>
</template>

<style scoped>
#signup-container {
    box-sizing: border-box;
    width: 100%;
    max-width: 1140px;
    margin: 0 auto 40px;
    padding: 0 12px;
    color: #fff;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
}

#signup-container h1 {
    margin: 0 0 8px;
    font-size: 48px;
    font-weight: 500;
    text-align: center;
}

.signup-card {
    overflow: hidden;
    border: 1px solid #444;
    border-radius: 4px;
    background: #303030;
    box-shadow: 0 2px 2px rgb(0 0 0 / 30%);
}

.signup-card h2 {
    margin: 0;
    border-bottom: 1px solid #555;
    background: #444;
    padding: 12px 20px;
    font-size: 32px;
    font-weight: 500;
}

#signup-form {
    display: grid;
    gap: 14px;
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
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #ced4da;
    border-radius: 4px;
    background: #ddd;
    padding: 7px 10px;
    color: #303030;
    font-size: 13px;
}

.form-row input:focus {
    border-color: #8bb8e5;
    outline: 0;
    box-shadow: 0 0 0 3px rgb(55 90 127 / 35%);
}

.form-row small {
    display: block;
    margin-top: 4px;
    color: #aaa;
    line-height: 1.35;
}

.terms {
    box-sizing: border-box;
    width: 100%;
    height: 200px;
    border: 1px solid #555;
    background: #fff;
}

.agreement-row label {
    display: block;
    padding-top: 6px;
}

.verification-notice {
    margin-left: 162px;
    border: 1px solid #725f2a;
    background: #2d2819;
    padding: 10px;
    color: #f6d77a;
    font-size: 13px;
    line-height: 1.45;
}

.action-row {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 12px;
    margin-left: 162px;
}

.action-row button,
.back-link {
    box-sizing: border-box;
    min-height: 42px;
    border: 1px solid #2f4d6c;
    border-radius: 4px;
    font-weight: 700;
}

.action-row button {
    background: #375a7f;
    color: #fff;
    cursor: pointer;
}

.action-row button:hover,
.action-row button:focus {
    background: #2f4d6c;
}

.action-row button:disabled {
    cursor: default;
    opacity: 0.65;
}

.back-link {
    display: grid;
    border-color: #555;
    background: #191919;
    color: #ddd;
    place-items: center;
    text-decoration: none;
}

.signup-error {
    margin: 0 18px 18px;
    color: #ff8a80;
    text-align: center;
}

@media (max-width: 1199px) {
    #signup-container {
        max-width: 960px;
    }
}

@media (max-width: 991px) {
    #signup-container {
        max-width: 720px;
    }
}

@media (max-width: 767px) {
    #signup-container {
        max-width: 540px;
    }
}

@media (max-width: 575px) {
    #signup-container {
        max-width: none;
    }

    #signup-container h1 {
        font-size: calc(1.425rem + 2.1vw);
    }

    .signup-card h2 {
        font-size: calc(1.325rem + 0.9vw);
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

    .verification-notice,
    .action-row {
        margin-left: 0;
    }

    .action-row {
        grid-template-columns: 1fr 1.6fr;
    }
}
</style>
