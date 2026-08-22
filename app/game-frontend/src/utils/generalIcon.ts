import {
    configuredSharedIconPublicUrl,
    configuredUserIconPublicUrl,
    DEFAULT_USER_ICON_PUBLIC_URL,
    externalizeLegacyImageUrl,
} from './imageAssets.ts';
import { gameFrontendRuntimeConfig } from '../config/runtimeConfig.ts';

export const DEFAULT_GENERAL_ICON_URL = `${configuredSharedIconPublicUrl()}/default.jpg`;
export const DEFAULT_GATEWAY_USER_ICON_BASE_URL = DEFAULT_USER_ICON_PUBLIC_URL;

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

export const resolveGeneralIconUrl = (
    source: GeneralIconSource,
    {
        legacyBaseUrl = configuredSharedIconPublicUrl(),
        userIconBaseUrl = configuredUserIconPublicUrl(),
    }: GeneralIconOptions = {}
): string => {
    const picture = source.picture?.trim() || 'default.jpg';
    const baseUrl = source.imageServer ? userIconBaseUrl : legacyBaseUrl;
    const encodedPicture = encodeLegacyIconPath(picture);
    return `${trimTrailingSlashes(baseUrl)}/${encodedPicture}`;
};

export const resolveGeneralIconBackgroundImage = (source: GeneralIconSource, options?: GeneralIconOptions): string => {
    const resolved = resolveGeneralIconUrl(source, options);
    return `url(${JSON.stringify(resolved)}), url(${JSON.stringify(DEFAULT_GENERAL_ICON_URL)})`;
};

export const resolveMessageGeneralIconUrl = (
    icon: string | null | undefined,
    userIconBaseUrl = configuredUserIconPublicUrl()
): string => {
    const normalized = icon?.trim();
    if (!normalized) {
        return DEFAULT_GENERAL_ICON_URL;
    }

    const userIconMatch = /^\/?d_pic\/(.+)$/u.exec(normalized);
    if (userIconMatch) {
        return resolveGeneralIconUrl({ picture: userIconMatch[1], imageServer: 1 }, { userIconBaseUrl });
    }

    if (normalized.startsWith('/image/')) {
        return externalizeLegacyImageUrl(normalized);
    }
    if (normalized.startsWith('/') || /^https?:\/\//iu.test(normalized)) {
        return normalized;
    }
    return `${gameFrontendRuntimeConfig.appBasePath}${normalized.replace(/^\/+/u, '')}`;
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
