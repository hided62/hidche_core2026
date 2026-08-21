import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'auth/gameToken': 'src/auth/gameToken.ts',
        'auth/gameSessionTransfer': 'src/auth/gameSessionTransfer.ts',
        'auth/sanctions': 'src/auth/sanctions.ts',
        'gateway/profileStatus': 'src/gateway/profileStatus.ts',
        'http/trpcTransport': 'src/http/trpcTransport.ts',
        'legacyArchive/ArchivedGeneralSnapshot': 'src/legacyArchive/ArchivedGeneralSnapshot.ts',
        'logging/formatLegacyLogHtml': 'src/logging/formatLegacyLogHtml.ts',
        'navigation/menuConfig': 'src/navigation/menuConfig.ts',
        'realtime/delta': 'src/realtime/delta.ts',
        'realtime/types': 'src/realtime/types.ts',
        'time/ServerDateTime': 'src/time/ServerDateTime.ts',
        'util/JosaUtil': 'src/util/JosaUtil.ts',
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
