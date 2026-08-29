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
        reporters: [process.env.SAMMO_TEST_REPORTER === 'verbose' ? 'default' : 'minimal'],
        testTimeout: 10_000,
    },
});
