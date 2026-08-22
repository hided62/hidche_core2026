const fullCommitShaPattern = /^[0-9a-f]{40,64}$/iu;

type VersionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type DeploymentVersionCheckerOptions = {
    currentCommitSha: string;
    versionUrl: string;
    fetchVersion?: typeof fetch;
    storage?: VersionStorage;
    now?: () => number;
    onVersionChanged: (availableCommitSha: string) => void;
};

export const deploymentVersionAssetSource = (buildCommitSha: string): string =>
    `${JSON.stringify({ commitSha: buildCommitSha })}\n`;

export const parseDeploymentCommitSha = (payload: unknown): string | null => {
    if (!payload || typeof payload !== 'object' || !('commitSha' in payload)) return null;
    const commitSha = String(payload.commitSha).trim().toLowerCase();
    return fullCommitShaPattern.test(commitSha) ? commitSha : null;
};

const notificationStorageKey = (versionUrl: string, availableCommitSha: string): string =>
    `sammo:deployment-version-notice:${versionUrl}:${availableCommitSha}`;

export const createDeploymentVersionChecker = (options: DeploymentVersionCheckerOptions) => {
    const currentCommitSha = options.currentCommitSha.trim().toLowerCase();
    const fetchVersion = options.fetchVersion ?? fetch;
    const now = options.now ?? Date.now;
    let inFlight: Promise<void> | null = null;
    let lastNotifiedCommitSha: string | null = null;

    const wasNotified = (key: string): boolean => {
        try {
            return options.storage?.getItem(key) === '1';
        } catch {
            return false;
        }
    };

    const rememberNotification = (key: string): void => {
        try {
            options.storage?.setItem(key, '1');
        } catch {
            // Session storage can be unavailable under restrictive browser policies.
        }
    };

    const run = async (): Promise<void> => {
        if (!fullCommitShaPattern.test(currentCommitSha)) return;
        const separator = options.versionUrl.includes('?') ? '&' : '?';
        const response = await fetchVersion(`${options.versionUrl}${separator}t=${now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) return;
        const availableCommitSha = parseDeploymentCommitSha(await response.json());
        if (!availableCommitSha || availableCommitSha === currentCommitSha) return;

        const storageKey = notificationStorageKey(options.versionUrl, availableCommitSha);
        if (lastNotifiedCommitSha === availableCommitSha || wasNotified(storageKey)) return;
        lastNotifiedCommitSha = availableCommitSha;
        rememberNotification(storageKey);
        options.onVersionChanged(availableCommitSha);
    };

    return {
        check: (): Promise<void> => {
            if (inFlight) return inFlight;
            inFlight = run()
                .catch(() => undefined)
                .finally(() => {
                    inFlight = null;
                });
            return inFlight;
        },
    };
};
