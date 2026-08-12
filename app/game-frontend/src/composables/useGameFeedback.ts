import { readonly, ref } from 'vue';

export type GameFeedbackKind = 'success' | 'error' | 'info';

export type GameToast = {
    id: number;
    kind: GameFeedbackKind;
    message: string;
};

export type GameNoticeDialog = {
    id: number;
    kind: GameFeedbackKind;
    title: string;
    message: string;
    acknowledgeLabel: string;
};

export type GameNoticeDialogOptions = {
    kind?: GameFeedbackKind;
    title?: string;
    message: string;
    acknowledgeLabel?: string;
};

type QueuedDialog = {
    dialog: GameNoticeDialog;
    resolve: () => void;
};

const titleFor = (kind: GameFeedbackKind): string => {
    if (kind === 'success') return '완료';
    if (kind === 'error') return '처리 실패';
    return '안내';
};

export const createGameFeedbackStore = () => {
    const visibleToasts = ref<GameToast[]>([]);
    const activeDialog = ref<GameNoticeDialog | null>(null);
    const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
    const dialogQueue: QueuedDialog[] = [];
    let activeDialogResolve: (() => void) | null = null;
    let nextId = 1;

    const dismissToast = (id: number): void => {
        const timer = dismissTimers.get(id);
        if (timer) clearTimeout(timer);
        dismissTimers.delete(id);
        visibleToasts.value = visibleToasts.value.filter((toast) => toast.id !== id);
    };

    const showToast = (message: string, kind: GameFeedbackKind = 'info', durationMs = 5_000): number => {
        const normalizedMessage = message.trim();
        if (!normalizedMessage) return -1;

        const duplicate = visibleToasts.value.find(
            (toast) => toast.message === normalizedMessage && toast.kind === kind
        );
        if (duplicate) dismissToast(duplicate.id);

        const id = nextId++;
        visibleToasts.value = [...visibleToasts.value.slice(-3), { id, kind, message: normalizedMessage }];
        if (durationMs > 0) {
            dismissTimers.set(id, setTimeout(() => dismissToast(id), durationMs));
        }
        return id;
    };

    const activateNextDialog = (): void => {
        const next = dialogQueue.shift();
        if (!next) {
            activeDialog.value = null;
            activeDialogResolve = null;
            return;
        }
        activeDialogResolve = next.resolve;
        activeDialog.value = next.dialog;
    };

    const showDialog = (options: GameNoticeDialogOptions): Promise<void> => {
        const message = options.message.trim();
        if (!message) return Promise.resolve();
        const kind = options.kind ?? 'info';
        return new Promise((resolve) => {
            dialogQueue.push({
                dialog: {
                    id: nextId++,
                    kind,
                    title: options.title?.trim() || titleFor(kind),
                    message,
                    acknowledgeLabel: options.acknowledgeLabel?.trim() || '확인',
                },
                resolve,
            });
            if (!activeDialog.value) activateNextDialog();
        });
    };

    const acknowledgeDialog = (): void => {
        const resolve = activeDialogResolve;
        activeDialog.value = null;
        activeDialogResolve = null;
        resolve?.();
        activateNextDialog();
    };

    return {
        toasts: readonly(visibleToasts),
        dialog: readonly(activeDialog),
        showToast,
        success: (message: string, durationMs?: number) => showToast(message, 'success', durationMs),
        error: (message: string, durationMs?: number) => showToast(message, 'error', durationMs),
        info: (message: string, durationMs?: number) => showToast(message, 'info', durationMs),
        showDialog,
        acknowledgeDialog,
        dismissToast,
    };
};

const gameFeedbackStore = createGameFeedbackStore();

export const useGameFeedback = () => gameFeedbackStore;
