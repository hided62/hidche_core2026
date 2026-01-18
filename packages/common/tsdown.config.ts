import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'auth/gameToken': 'src/auth/gameToken.ts',
    },
    format: 'es',
    outDir: 'dist',
    dts: {
        build: true,
    },
    sourcemap: true,
    target: 'node22',
    platform: 'node',
    fixedExtension: false,
    hash: false,
});
