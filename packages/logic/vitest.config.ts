import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@sammo-ts/common': path.resolve(__dirname, '../common/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['test/**/*.test.ts']
    }
});
