import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const normalizeBasePath = (value: string | undefined): string => {
    const pathValue = (value ?? '/').trim();
    if (!pathValue || pathValue === '/') {
        return '/';
    }
    return `/${pathValue.replace(/^\/+|\/+$/g, '')}/`;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        base: normalizeBasePath(env.VITE_APP_BASE_PATH),
        plugins: [vue(), tailwindcss()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            host: '0.0.0.0',
            port: 3001,
        },
        preview: {
            host: '0.0.0.0',
        },
    };
});
