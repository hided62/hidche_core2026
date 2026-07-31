export const DEFAULT_GENERAL_ICON_URL = '/image/icons/default.jpg';
export const DEFAULT_GATEWAY_USER_ICON_BASE_URL = '/gateway/api/user-icons';

export type GeneralIconSource = {
    picture?: string | null;
    imageServer?: number | null;
};

type GeneralIconOptions = {
    legacyBaseUrl?: string;
    userIconBaseUrl?: string;
};

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/u, '');

const encodeLegacyIconPath = (value: string): string =>
    value
        .split('/')
        .map((segment) => {
            if (segment === '.') return '%2E';
            if (segment === '..') return '%2E%2E';
            return encodeURIComponent(segment);
        })
        .join('/');

const configuredUserIconBaseUrl = (): string =>
    import.meta.env?.VITE_GATEWAY_USER_ICON_BASE_URL?.trim() || DEFAULT_GATEWAY_USER_ICON_BASE_URL;

export const resolveGeneralIconUrl = (
    source: GeneralIconSource,
    { legacyBaseUrl = '/image/icons', userIconBaseUrl = configuredUserIconBaseUrl() }: GeneralIconOptions = {}
): string => {
    const picture = source.picture?.trim() || 'default.jpg';
    const baseUrl = source.imageServer ? userIconBaseUrl : legacyBaseUrl;
    const encodedPicture = source.imageServer ? encodeURIComponent(picture) : encodeLegacyIconPath(picture);
    return `${trimTrailingSlashes(baseUrl)}/${encodedPicture}`;
};

export const resolveGeneralIconBackgroundImage = (source: GeneralIconSource, options?: GeneralIconOptions): string => {
    const resolved = resolveGeneralIconUrl(source, options);
    return `url(${JSON.stringify(resolved)}), url(${JSON.stringify(DEFAULT_GENERAL_ICON_URL)})`;
};

export const resolveMessageGeneralIconUrl = (
    icon: string | null | undefined,
    userIconBaseUrl = configuredUserIconBaseUrl()
): string => {
    const normalized = icon?.trim();
    if (!normalized) {
        return DEFAULT_GENERAL_ICON_URL;
    }

    const userIconMatch = /^\/?d_pic\/(.+)$/u.exec(normalized);
    if (userIconMatch) {
        return resolveGeneralIconUrl({ picture: userIconMatch[1], imageServer: 1 }, { userIconBaseUrl });
    }

    if (normalized.startsWith('/') || /^https?:\/\//iu.test(normalized)) {
        return normalized;
    }
    return `${import.meta.env.BASE_URL}${normalized.replace(/^\/+/u, '')}`;
};

export const useDefaultGeneralIcon = (event: Event): void => {
    if (
        typeof HTMLImageElement === 'undefined' ||
        !(event.currentTarget instanceof HTMLImageElement) ||
        event.currentTarget.dataset.generalIconFallbackSource === event.currentTarget.currentSrc
    ) {
        return;
    }
    event.currentTarget.dataset.generalIconFallbackSource = event.currentTarget.currentSrc;
    event.currentTarget.src = DEFAULT_GENERAL_ICON_URL;
};
