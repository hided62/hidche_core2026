<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import { trpc } from '../utils/trpc';

const props = defineProps<{
    challengeId: string;
}>();

const emit = defineEmits<{
    verified: [sessionToken: string, validUntil: string];
    cancel: [];
}>();

const code = ref('');
const errorMessage = ref('');
const submitting = ref(false);
const codeInput = ref<HTMLInputElement | null>(null);

watch(
    () => props.challengeId,
    async () => {
        code.value = '';
        errorMessage.value = '';
        await nextTick();
        codeInput.value?.focus();
    },
    { immediate: true }
);

const submit = async (): Promise<void> => {
    errorMessage.value = '';
    submitting.value = true;
    try {
        const result = await trpc.auth.kakaoOtp.mutate({
            challengeId: props.challengeId,
            code: code.value,
        });
        emit('verified', result.sessionToken, result.validUntil);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '인증 코드를 확인하지 못했습니다.';
        code.value = '';
        await nextTick();
        codeInput.value?.focus();
    } finally {
        submitting.value = false;
    }
};
</script>

<template>
    <Teleport to="body">
        <div class="otp-backdrop" @keydown.esc="emit('cancel')">
            <section
                class="otp-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="kakao-otp-title"
                aria-describedby="kakao-otp-description"
            >
                <header>
                    <h2 id="kakao-otp-title">인증 코드 필요</h2>
                    <button class="close-button" type="button" aria-label="닫기" @click="emit('cancel')">×</button>
                </header>
                <form @submit.prevent="submit">
                    <div id="kakao-otp-description" class="otp-copy">
                        인증 코드가 필요합니다.<br /><br />
                        카카오톡의 '나와의 채팅'란을 확인해 주세요.<br />
                        (별도의 알림[소리, 진동, 숫자]이 발생하지 않습니다.)
                    </div>
                    <label class="otp-input-row" for="kakao-otp-code">
                        <span>인증 코드</span>
                        <input
                            id="kakao-otp-code"
                            ref="codeInput"
                            v-model="code"
                            type="text"
                            inputmode="numeric"
                            pattern="[0-9]{4}"
                            maxlength="4"
                            autocomplete="one-time-code"
                            placeholder="인증 코드"
                            required
                        />
                    </label>
                    <p v-if="errorMessage" class="otp-error" role="alert">{{ errorMessage }}</p>
                    <footer>
                        <button class="cancel-button" type="button" @click="emit('cancel')">취소</button>
                        <button class="submit-button" type="submit" :disabled="submitting">
                            {{ submitting ? '확인 중…' : '제출' }}
                        </button>
                    </footer>
                </form>
            </section>
        </div>
    </Teleport>
</template>

<style scoped>
.otp-backdrop {
    position: fixed;
    z-index: 1000;
    inset: 0;
    overflow-y: auto;
    background: rgb(0 0 0 / 60%);
}

.otp-dialog {
    width: min(calc(100% - 16px), 500px);
    margin: 28px auto;
    overflow: hidden;
    border: 1px solid #444;
    border-radius: 5px;
    background: #303030;
    color: #fff;
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}

@media (max-width: 575px) {
    .otp-dialog {
        margin-top: 8px;
    }
}

.otp-dialog header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #555;
    padding: 16px;
}

.otp-dialog h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 500;
}

.close-button {
    width: 26px;
    height: 30px;
    border: 1px solid #aaa;
    background: #fff;
    color: #000;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
}

.otp-copy {
    padding: 18px 18px 0;
    line-height: 1.5;
}

.otp-input-row {
    display: grid;
    grid-template-columns: auto 1fr;
    margin: 22px 16px 0;
}

.otp-input-row span,
.otp-input-row input {
    border: 1px solid #000;
    padding: 6px 12px;
}

.otp-input-row span {
    border-radius: 4px 0 0 4px;
    background: #303030;
    color: #adb5bd;
}

.otp-input-row input {
    min-width: 0;
    border-left: 0;
    border-radius: 0 4px 4px 0;
    background: #ddd;
    color: #303030;
}

.otp-input-row input:focus-visible {
    outline: 0;
    border-color: #9a9a9a;
    box-shadow: 0 0 0 4px rgb(55 90 127 / 25%);
}

.close-button:focus-visible {
    outline: 2px solid #375a7f;
    outline-offset: 1px;
}

.otp-error {
    margin: 8px 18px 0;
    font-size: 13px;
}

.otp-error {
    color: #ff8a80;
}

.otp-dialog footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
    border-top: 1px solid #555;
    padding: 15px 16px;
}

.otp-dialog footer button {
    min-width: 64px;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 7px 12px;
    color: #fff;
    cursor: pointer;
    transition:
        color 0.15s ease-in-out,
        background-color 0.15s ease-in-out,
        border-color 0.15s ease-in-out,
        box-shadow 0.15s ease-in-out;
}

.cancel-button {
    border-color: #444 !important;
    background: #444;
}

.cancel-button:active {
    background: #363636;
}

.submit-button {
    border-color: #325172 !important;
    background: #375a7f;
}

.submit-button:hover {
    background: #375a7f;
}

.submit-button:focus-visible {
    outline: 0;
    box-shadow: 0 0 0 4px rgb(85 115 146 / 50%);
}

.submit-button:active {
    background: #2c4866;
}

.submit-button:disabled {
    border-color: #375a7f !important;
    background: #375a7f;
    cursor: pointer;
    opacity: 0.65;
}
</style>
