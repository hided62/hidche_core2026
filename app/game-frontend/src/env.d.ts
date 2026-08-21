/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<Record<string, never>, Record<string, never>, Record<string, never>>;
    export default component;
}

interface ImportMetaEnv {
    readonly VITE_APP_BASE_PATH?: string;
    readonly VITE_GATEWAY_API_URL?: string;
    readonly VITE_GAME_API_URL?: string;
    readonly VITE_GAME_SSE_URL?: string;
    readonly VITE_GAME_ASSET_URL?: string;
    readonly VITE_IMAGE_PUBLIC_URL?: string;
    readonly VITE_GAME_PROFILE?: string;
    readonly VITE_GATEWAY_WEB_URL?: string;
    readonly VITE_GATEWAY_USER_ICON_BASE_URL?: string;
    readonly VITE_BOARD_COMMUNITY_URL?: string;
    readonly VITE_BOARD_REQUEST_URL?: string;
    readonly VITE_BOARD_TIP_URL?: string;
    readonly VITE_BOARD_PATCH_URL?: string;
    readonly VITE_OFFICIAL_CHAT_URL?: string;
    readonly VITE_CASUAL_CHAT_URL?: string;
    readonly VITE_BUILD_COMMIT_SHA?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
