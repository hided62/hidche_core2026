import { onBeforeUnmount, onMounted } from 'vue';
import { createDeploymentVersionChecker } from '../config/deploymentVersion';
import { useGameFeedback } from './useGameFeedback';

const pollIntervalMs = 60_000;
const noticeMessage = '새 버전이 준비되었습니다. 새로고침하면 변경사항이 반영됩니다.';

const resolveSessionStorage = (): Pick<Storage, 'getItem' | 'setItem'> | undefined => {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
};

export const useDeploymentVersionNotice = (): void => {
    const currentCommitSha = import.meta.env.VITE_BUILD_COMMIT_SHA?.trim() ?? '';
    const versionUrl = `${import.meta.env.BASE_URL}deployment-version.json`;
    const { info: showInfoToast } = useGameFeedback();
    const checker = createDeploymentVersionChecker({
        currentCommitSha,
        versionUrl,
        storage: resolveSessionStorage(),
        onVersionChanged: () => showInfoToast(noticeMessage),
    });
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const checkWhenVisible = (): void => {
        if (document.visibilityState === 'visible') void checker.check();
    };

    onMounted(() => {
        void checker.check();
        pollTimer = setInterval(checkWhenVisible, pollIntervalMs);
        document.addEventListener('visibilitychange', checkWhenVisible);
        window.addEventListener('online', checkWhenVisible);
    });

    onBeforeUnmount(() => {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        document.removeEventListener('visibilitychange', checkWhenVisible);
        window.removeEventListener('online', checkWhenVisible);
    });
};
