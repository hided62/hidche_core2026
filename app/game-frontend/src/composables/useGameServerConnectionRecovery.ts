import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { trpc } from '../utils/trpc';
import {
    GAME_SERVER_RECONNECTED_EVENT,
    gameServerConnection,
    retryDelayForFailure,
} from '../utils/gameServerConnection';

export const useGameServerConnectionRecovery = () => {
    const reconnecting = computed(() => gameServerConnection.status.value === 'reconnecting');
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;
    let mounted = false;
    let wasReconnecting = false;

    const clearRetry = (): void => {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
    };

    const scheduleRetry = (): void => {
        if (!mounted || !reconnecting.value || retryTimer) return;
        failureCount += 1;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void trpc.lobby.info
                .query()
                .catch(() => undefined)
                .finally(() => scheduleRetry());
        }, retryDelayForFailure(failureCount));
    };

    const retryNow = (): void => {
        if (!reconnecting.value) return;
        clearRetry();
        failureCount = 0;
        void trpc.lobby.info
            .query()
            .catch(() => undefined)
            .finally(() => scheduleRetry());
    };

    const stopWatching = watch(
        reconnecting,
        (current) => {
            if (current) {
                wasReconnecting = true;
                scheduleRetry();
                return;
            }
            clearRetry();
            failureCount = 0;
            if (wasReconnecting && mounted) {
                window.dispatchEvent(new Event(GAME_SERVER_RECONNECTED_EVENT));
            }
            wasReconnecting = false;
        },
        { immediate: true }
    );

    onMounted(() => {
        mounted = true;
        window.addEventListener('online', retryNow);
        scheduleRetry();
    });

    onBeforeUnmount(() => {
        mounted = false;
        clearRetry();
        stopWatching();
        window.removeEventListener('online', retryNow);
    });

    return { reconnecting };
};
