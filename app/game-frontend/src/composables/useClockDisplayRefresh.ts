import { onMounted, onUnmounted } from 'vue';
import { trpc } from '../utils/trpc';
import { advanceClockDisplay, clockSampleIsStale } from './useClockDisplay';

export const useClockDisplayRefresh = (): void => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let pending = false;
    let lastAttempt = -Infinity;
    const refresh = async () => {
        advanceClockDisplay();
        if (
            Date.now() - lastAttempt < 30_000 ||
            pending ||
            document.visibilityState !== 'visible' ||
            !clockSampleIsStale()
        )
            return;
        pending = true;
        lastAttempt = Date.now();
        try {
            await trpc.lobby.info.query();
        } catch {
            /* 다음 표본으로 복구한다. */
        } finally {
            pending = false;
        }
    };
    onMounted(() => {
        void refresh();
        timer = setInterval(() => {
            void refresh();
        }, 250);
    });
    onUnmounted(() => {
        if (timer) clearInterval(timer);
    });
};
