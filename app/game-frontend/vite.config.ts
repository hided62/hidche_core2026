import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import path from 'path';
import { deploymentVersionAssetSource } from './src/config/deploymentVersion.ts';
import { mergeViteEnv } from './src/config/viteEnv.ts';

const fullCommitShaPattern = /^[0-9a-f]{40,64}$/iu;

export const resolveBuildCommitSha = (explicitSha: string | undefined, repositoryRoot: string): string => {
    const normalizedExplicitSha = explicitSha?.trim();
    if (normalizedExplicitSha && fullCommitShaPattern.test(normalizedExplicitSha)) {
        return normalizedExplicitSha.toLowerCase();
    }
    try {
        const repositorySha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return fullCommitShaPattern.test(repositorySha) ? repositorySha.toLowerCase() : 'unknown';
    } catch {
        return 'unknown';
    }
};

export const createDeploymentVersionPlugin = (buildCommitSha: string): Plugin => ({
    name: 'sammo-deployment-version',
    generateBundle() {
        this.emitFile({
            type: 'asset',
            fileName: 'deployment-version.json',
            source: deploymentVersionAssetSource(buildCommitSha),
        });
    },
});

const normalizeBasePath = (value: string | undefined): string => {
    const pathValue = (value ?? '/').trim();
    if (!pathValue || pathValue === '/') {
        return '/';
    }
    return `/${pathValue.replace(/^\/+|\/+$/g, '')}/`;
};

const resolvePreviewAllowedHosts = (value: string | undefined): true | string[] => {
    const normalized = value?.trim();
    if (normalized === '*') {
        return true;
    }
    const hosts = (normalized ?? 'dev-sam-e2e.hided.net')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean);
    return hosts;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = mergeViteEnv(loadEnv(mode, process.cwd(), ''), process.env);
    const buildCommitSha = resolveBuildCommitSha(env.VITE_BUILD_COMMIT_SHA, path.resolve(import.meta.dirname, '../..'));
    return {
        base: normalizeBasePath(env.VITE_APP_BASE_PATH),
        plugins: [vue(), tailwindcss(), createDeploymentVersionPlugin(buildCommitSha)],
        define: {
            'import.meta.env.VITE_BUILD_COMMIT_SHA': JSON.stringify(buildCommitSha),
        },
        build: {
            sourcemap: true,
        },
        worker: {
            format: 'es',
            rolldownOptions: {
                output: {
                    codeSplitting: false,
                },
            },
        },
        resolve: {
            alias: {
                '@': path.resolve(import.meta.dirname, './src'),
            },
        },
        server: {
            host: '0.0.0.0',
            port: 3001,
        },
        preview: {
            host: '0.0.0.0',
            allowedHosts: resolvePreviewAllowedHosts(env.VITE_PREVIEW_ALLOWED_HOSTS),
        },
    };
});
