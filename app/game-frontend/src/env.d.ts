/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<Record<string, never>, Record<string, never>, Record<string, never>>;
    export default component;
}

interface ImportMetaEnv {
    readonly VITE_GATEWAY_API_URL?: string;
    readonly VITE_GAME_API_URL?: string;
    readonly VITE_GAME_ASSET_URL?: string;
    readonly VITE_GAME_PROFILE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
