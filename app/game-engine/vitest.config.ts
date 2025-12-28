import path from 'node:path';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [
        tsconfigPaths({
            projects: [path.resolve(__dirname, '../../tsconfig.paths.json')],
        }),
    ],
    test: {
        environment: 'node',
        globals: true,
        include: ['test/**/*.test.ts'],
    },
});
