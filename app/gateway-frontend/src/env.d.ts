/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

interface ImportMetaEnv {
    readonly VITE_APP_BASE_PATH?: string;
    readonly VITE_GATEWAY_API_URL?: string;
    readonly VITE_GAME_API_URL_TEMPLATE?: string;
    readonly VITE_GAME_ASSET_URL?: string;
    readonly VITE_GAME_WEB_URL?: string;
    readonly VITE_GAME_WEB_URL_TEMPLATE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
