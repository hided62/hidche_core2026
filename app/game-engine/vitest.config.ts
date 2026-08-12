import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['test/**/*.test.ts'],
        maxWorkers: 4,
        testTimeout: 10_000,
    },
});
