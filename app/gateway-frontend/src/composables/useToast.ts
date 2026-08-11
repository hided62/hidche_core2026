import { readonly, ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

export type Toast = {
    id: number;
    kind: ToastKind;
    message: string;
};

const visibleToasts = ref<Toast[]>([]);
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
let nextToastId = 1;

const dismiss = (id: number): void => {
    const timer = dismissTimers.get(id);
    if (timer) clearTimeout(timer);
    dismissTimers.delete(id);
    visibleToasts.value = visibleToasts.value.filter((toast) => toast.id !== id);
};

const show = (message: string, kind: ToastKind = 'info', durationMs = 5_000): number => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return -1;

    const duplicate = visibleToasts.value.find(
        (toast) => toast.message === normalizedMessage && toast.kind === kind
    );
    if (duplicate) {
        dismiss(duplicate.id);
    }

    const id = nextToastId++;
    visibleToasts.value = [...visibleToasts.value.slice(-3), { id, kind, message: normalizedMessage }];
    if (durationMs > 0) {
        dismissTimers.set(id, setTimeout(() => dismiss(id), durationMs));
    }
    return id;
};

const feedback = (message: string): number => {
    if (/실패|오류|못했|필요|입력|선택|유효|일치하지|비활성화|없습니다|해야 합니다/.test(message)) {
        return show(message, 'error');
    }
    if (/완료|성공|저장|등록|적용|변경|해제|부여|생성|철회|예약/.test(message)) {
        return show(message, 'success');
    }
    return show(message, 'info');
};

export const useToast = () => ({
    toasts: readonly(visibleToasts),
    show,
    success: (message: string, durationMs?: number) => show(message, 'success', durationMs),
    error: (message: string, durationMs?: number) => show(message, 'error', durationMs),
    info: (message: string, durationMs?: number) => show(message, 'info', durationMs),
    feedback,
    dismiss,
});
