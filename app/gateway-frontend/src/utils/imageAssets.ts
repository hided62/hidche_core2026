export const DEFAULT_IMAGE_PUBLIC_URL = 'https://sam-image.hided.net';
export const DEFAULT_SHARED_ICON_PUBLIC_URL = `${DEFAULT_IMAGE_PUBLIC_URL}/icons`;
export const DEFAULT_USER_ICON_PUBLIC_URL = DEFAULT_SHARED_ICON_PUBLIC_URL;

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/u, '');

const configuredValue = (value: string | undefined, fallback: string): string => {
    const normalized = value?.trim();
    return trimTrailingSlashes(normalized || fallback);
};

export const configuredImagePublicUrl = (): string =>
    configuredValue(import.meta.env?.VITE_IMAGE_PUBLIC_URL, DEFAULT_IMAGE_PUBLIC_URL);

export const configuredSharedIconPublicUrl = (): string => `${configuredImagePublicUrl()}/icons`;

export const configuredUserIconPublicUrl = (): string =>
    configuredValue(
        import.meta.env?.VITE_GATEWAY_USER_ICON_BASE_URL,
        `${configuredImagePublicUrl()}/icons`
    );

export const configuredGameAssetUrl = (): string => {
    const explicit = import.meta.env?.VITE_GAME_ASSET_URL?.trim();
    if (!explicit) {
        return `${configuredImagePublicUrl()}/game`;
    }
    const normalized = trimTrailingSlashes(explicit);
    return normalized.endsWith('/game') ? normalized : `${normalized}/game`;
};

export const installImageAssetCssVariables = (): void => {
    const root = document.documentElement.style;
    const gameAssetUrl = configuredGameAssetUrl();
    root.setProperty('--sammo-texture-walnut', `url(${JSON.stringify(`${gameAssetUrl}/back_walnut.jpg`)})`);
    root.setProperty('--sammo-texture-green', `url(${JSON.stringify(`${gameAssetUrl}/back_green.jpg`)})`);
    root.setProperty('--sammo-texture-blue', `url(${JSON.stringify(`${gameAssetUrl}/back_blue.jpg`)})`);
};
