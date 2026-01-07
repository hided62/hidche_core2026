import { defineConfig } from 'tsdown';

export default defineConfig({
    workspace: {
        include: ['packages/*', 'app/*'],
        exclude: ['**/*-frontend/**'],
    },
    entry: 'src/index.ts',
    format: 'es',
    outDir: 'dist',
    dts: {
        build: true
    },
    sourcemap: true,
    target: 'node22',
    platform: 'node',
    fixedExtension: false,
    hash: false,
});
