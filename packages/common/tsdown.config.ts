import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'auth/gameToken': 'src/auth/gameToken.ts',
        'auth/gameSessionTransfer': 'src/auth/gameSessionTransfer.ts',
        'auth/sanctions': 'src/auth/sanctions.ts',
        'navigation/menuConfig': 'src/navigation/menuConfig.ts',
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
