<script setup lang="ts">
import { ref } from 'vue';
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { trpc } from '../utils/trpc';

export interface DeletionPending {
    recoveryId: string;
    deleteAfter: string;
}
const props = defineProps<{ recovery: DeletionPending }>();
const emit = defineEmits<{ restored: [sessionToken: string]; cancel: [] }>();
const submitting = ref(false);
const errorMessage = ref('');
const restore = async (): Promise<void> => {
    if (submitting.value) return;
    submitting.value = true;
    errorMessage.value = '';
    try {
        const result = await trpc.auth.cancelDeletion.mutate({ recoveryId: props.recovery.recoveryId });
        if (result.status !== 'login') throw new Error('계정 상태가 변경되었습니다. 다시 로그인해 주세요.');
        emit('restored', result.sessionToken);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '탈퇴를 취소하지 못했습니다.';
    } finally {
        submitting.value = false;
    }
};
</script>

<template>
    <section class="deletion-recovery" role="group" aria-label="탈퇴 취소">
        <p>탈퇴 신청된 계정입니다.</p>
        <p>삭제 예정일: {{ formatServerDateTime(recovery.deleteAfter) }}</p>
        <p>계정을 계속 사용하려면 탈퇴를 취소해 주세요.</p>
        <div class="actions">
            <button type="button" :disabled="submitting" @click="restore">
                {{ submitting ? '처리 중...' : '탈퇴 취소' }}
            </button>
            <button type="button" :disabled="submitting" @click="emit('cancel')">돌아가기</button>
        </div>
        <p v-if="errorMessage" class="recovery-error" role="alert">{{ errorMessage }}</p>
    </section>
</template>

<style scoped>
.deletion-recovery {
    padding: 18px;
    text-align: center;
    color: #fff;
}
.deletion-recovery p {
    margin: 0 0 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
}
.actions {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.actions button {
    min-height: 42px;
    padding: 8px 16px;
    border: 1px solid #2f4d6c;
    border-radius: 4px;
    background: #375a7f;
    color: #fff;
    cursor: pointer;
}
.actions button:hover,
.actions button:active {
    background: #2f4d6c;
}
.actions button:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 2px;
}
.actions button:disabled {
    opacity: 0.6;
    cursor: wait;
}
.recovery-error {
    color: #ff8a80;
    margin-top: 12px !important;
}
</style>
