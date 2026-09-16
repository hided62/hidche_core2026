import { writeGameSessionTransfer } from '@sammo-ts/common/auth/gameSessionTransfer';

// 기존 로비의 query fallback은 유지하되 새 관리자 진입은 sessionStorage 전달만 허용한다.
export const resolveGameUrl = (
    path: string,
    profileName: string,
    gameToken: string,
    allowLegacyQueryTransfer = true
): string | null => {
    const profile = profileName.split(':', 1)[0] ?? profileName;
    const baseUrl =
        import.meta.env.VITE_GAME_WEB_URL ??
        import.meta.env.VITE_GAME_WEB_URL_TEMPLATE?.replaceAll('{profile}', encodeURIComponent(profile)) ??
        '';
    if (!baseUrl) {
        return null;
    }
    const base = new URL(baseUrl, window.location.origin);
    const normalizedPath = path.replace(/^\//, '');
    const url = new URL(normalizedPath, base);
    let transferredInSessionStorage = false;
    if (url.origin === window.location.origin) {
        try {
            transferredInSessionStorage = writeGameSessionTransfer(window.sessionStorage, {
                profile: profileName,
                gatewayToken: gameToken,
            });
        } catch {
            transferredInSessionStorage = false;
        }
    }
    if (!transferredInSessionStorage) {
        if (!allowLegacyQueryTransfer) return null;
        url.searchParams.set('profile', profileName);
        url.searchParams.set('gameToken', gameToken);
    }
    return url.toString();
};
