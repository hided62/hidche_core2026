import { createRequire } from 'node:module';
import path from 'node:path';

// Scope the bridge to the Vue CLI. Vite, ESLint and other compiler API
// consumers keep resolving the workspace's stock TypeScript 6 installation.
const requireFromFrontend = createRequire(path.resolve('package.json'));
const requireFromToolchain = createRequire(import.meta.url);
const { run } = requireFromFrontend('vue-tsc');
run(requireFromToolchain.resolve('typescript-native-bridge/lib/tsc.js'));
