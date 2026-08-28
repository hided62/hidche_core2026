import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameFeedbackStore } from '../src/composables/useGameFeedback.ts';

void test('keeps four recent toasts and replaces an exact duplicate', () => {
    const feedback = createGameFeedbackStore();

    feedback.info('첫 번째', 0);
    feedback.success('두 번째', 0);
    feedback.error('세 번째', 0);
    feedback.info('네 번째', 0);
    feedback.success('다섯 번째', 0);

    assert.deepEqual(
        feedback.toasts.value.map((toast) => toast.message),
        ['두 번째', '세 번째', '네 번째', '다섯 번째']
    );

    feedback.error('세 번째', 0);
    assert.deepEqual(
        feedback.toasts.value.map((toast) => `${toast.kind}:${toast.message}`),
        ['success:두 번째', 'info:네 번째', 'success:다섯 번째', 'error:세 번째']
    );
});

void test('queues acknowledgement dialogs and resolves each request in order', async () => {
    const feedback = createGameFeedbackStore();
    let firstResolved = false;
    let secondResolved = false;

    const first = feedback
        .showDialog({ kind: 'error', title: '첫 알림', message: '먼저 확인' })
        .then(() => (firstResolved = true));
    const second = feedback
        .showDialog({ kind: 'success', message: '다음 확인', acknowledgeLabel: '계속' })
        .then(() => (secondResolved = true));

    assert.equal(feedback.dialog.value?.title, '첫 알림');
    feedback.acknowledgeDialog();
    await first;
    assert.equal(firstResolved, true);
    assert.equal(secondResolved, false);
    assert.deepEqual(feedback.dialog.value, {
        id: 2,
        kind: 'success',
        title: '완료',
        message: '다음 확인',
        acknowledgeLabel: '계속',
        cancelLabel: null,
    });

    feedback.acknowledgeDialog();
    await second;
    assert.equal(secondResolved, true);
    assert.equal(feedback.dialog.value, null);
});

void test('confirmation dialogs resolve accept, cancel, and escape-safe cancellation distinctly', async () => {
    const feedback = createGameFeedbackStore();

    const accepted = feedback.confirm({ message: '저장할까요?', acknowledgeLabel: '저장' });
    assert.deepEqual(feedback.dialog.value, {
        id: 1,
        kind: 'info',
        title: '확인',
        message: '저장할까요?',
        acknowledgeLabel: '저장',
        cancelLabel: '취소',
    });
    feedback.acknowledgeDialog();
    assert.equal(await accepted, true);

    const cancelled = feedback.confirm('해산할까요?');
    feedback.cancelDialog();
    assert.equal(await cancelled, false);
    assert.equal(feedback.dialog.value, null);
});
