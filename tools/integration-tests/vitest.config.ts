import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['test/**/*.test.ts'],
        testTimeout: 120_000,
        fileParallelism: false,
        reporters: [process.env.SAMMO_TEST_REPORTER === 'verbose' ? 'default' : 'minimal'],
    },
});
