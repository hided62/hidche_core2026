import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        reporters: [process.env.SAMMO_TEST_REPORTER === 'verbose' ? 'default' : 'minimal'],
    },
});
