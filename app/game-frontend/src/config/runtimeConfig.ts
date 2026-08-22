export const GAME_FRONTEND_RUNTIME_CONFIG_ID = 'sammo-runtime-config';

export interface GameFrontendRuntimeConfig {
    version: 1;
    profile?: string;
    profileName?: string;
    appBasePath: string;
    gameApiUrl: string;
    gameSseUrl: string;
    gatewayApiUrl: string;
    gatewayWebUrl: string;
    buildCommitSha: string;
    assetReleaseId?: string;
}

interface RuntimeConfigEnvironment {
    VITE_APP_BASE_PATH?: string;
    VITE_GAME_API_URL?: string;
    VITE_GAME_SSE_URL?: string;
    VITE_GAME_PROFILE?: string;
    VITE_GATEWAY_API_URL?: string;
    VITE_GATEWAY_WEB_URL?: string;
    VITE_BUILD_COMMIT_SHA?: string;
}

const normalizeBasePath = (value: string | undefined): string => {
    const normalized = value?.trim().replace(/^\/+|\/+$/gu, '') ?? '';
    return normalized ? `/${normalized}/` : '/';
};

const nonEmpty = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readEmbeddedConfig = (documentValue: Pick<Document, 'getElementById'> | undefined): Record<string, unknown> => {
    const source = documentValue?.getElementById(GAME_FRONTEND_RUNTIME_CONFIG_ID)?.textContent?.trim();
    if (!source) return {};
    try {
        const parsed: unknown = JSON.parse(source);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
};

export const resolveGameFrontendRuntimeConfig = (
    documentValue: Pick<Document, 'getElementById'> | undefined,
    env: RuntimeConfigEnvironment
): GameFrontendRuntimeConfig => {
    const embedded = readEmbeddedConfig(documentValue);
    const appBasePath = normalizeBasePath(nonEmpty(embedded.appBasePath) ?? env.VITE_APP_BASE_PATH);
    const profile = nonEmpty(embedded.profile) ?? nonEmpty(env.VITE_GAME_PROFILE);
    const profileName = nonEmpty(embedded.profileName);
    const assetReleaseId = nonEmpty(embedded.assetReleaseId);
    return Object.freeze({
        version: 1,
        ...(profile ? { profile } : {}),
        ...(profileName ? { profileName } : {}),
        appBasePath,
        gameApiUrl: nonEmpty(embedded.gameApiUrl) ?? nonEmpty(env.VITE_GAME_API_URL) ?? `${appBasePath}api/trpc`,
        gameSseUrl: nonEmpty(embedded.gameSseUrl) ?? nonEmpty(env.VITE_GAME_SSE_URL) ?? `${appBasePath}api/events`,
        gatewayApiUrl: nonEmpty(embedded.gatewayApiUrl) ?? nonEmpty(env.VITE_GATEWAY_API_URL) ?? '/gateway/api/trpc',
        gatewayWebUrl: nonEmpty(embedded.gatewayWebUrl) ?? nonEmpty(env.VITE_GATEWAY_WEB_URL) ?? '/gateway/',
        buildCommitSha: nonEmpty(embedded.buildCommitSha) ?? nonEmpty(env.VITE_BUILD_COMMIT_SHA) ?? 'unknown',
        ...(assetReleaseId ? { assetReleaseId } : {}),
    });
};

export const gameFrontendRuntimeConfig = resolveGameFrontendRuntimeConfig(
    typeof document === 'undefined' ? undefined : document,
    import.meta.env ?? {}
);
