import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        environment: 'node',
        globals: true,
        // Integration files share the explicitly supplied disposable schema.
        // Keep file-level TRUNCATE/setup boundaries from racing each other;
        // individual tests still create concurrent writers deliberately.
        fileParallelism: false,
        include: ['test/**/*.test.ts'],
        reporters: [process.env.SAMMO_TEST_REPORTER === 'verbose' ? 'default' : 'minimal'],
    },
});
