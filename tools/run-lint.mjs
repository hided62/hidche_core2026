import { spawnSync } from 'node:child_process';

const allLintTargets = [
    'app/game-api',
    'app/game-engine',
    'app/game-frontend',
    'app/gateway-api',
    'app/gateway-frontend',
    'app/release-controller',
    'packages/common',
    'packages/infra',
    'packages/logic',
    'tools/legacy-db-migration',
];
const targetArgumentIndex = process.argv.indexOf('--target');
const requestedTarget = targetArgumentIndex === -1 ? undefined : process.argv[targetArgumentIndex + 1];
if (targetArgumentIndex !== -1 && !requestedTarget) {
    console.error('Usage: run-lint.mjs --target <workspace-path>');
    process.exit(2);
}
if (requestedTarget && !allLintTargets.includes(requestedTarget)) {
    console.error(`Unknown lint target: ${requestedTarget}`);
    process.exit(2);
}
const lintTargets = requestedTarget ? [requestedTarget] : allLintTargets;
const eslintTargets = [
    ...lintTargets,
    ...(!requestedTarget ? ['eslint.config.js', 'eslint.promise.config.js', 'tools/run-lint.mjs'] : []),
];
const vueTargets = ['app/game-frontend', 'app/gateway-frontend']
    .filter((target) => lintTargets.includes(target))
    .map((target) => ({ glob: `${target}/**/*.vue`, project: `${target}/tsconfig.json`, target }));
const shouldFix = process.argv.includes('--fix');
const useCache = !process.argv.includes('--no-cache');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const withNodeHeap = (heapSizeMb, extraEnv = {}) => {
    const inheritedOptions = (process.env.NODE_OPTIONS ?? '')
        .replace(/--max[-_]old[-_]space[-_]size(?:=|\s+)\d+/g, '')
        .trim();
    return {
        ...process.env,
        ...extraEnv,
        NODE_OPTIONS: `${inheritedOptions} --max-old-space-size=${heapSizeMb}`.trim(),
    };
};

const run = (label, args, env = process.env) => {
    console.log(`\n[lint] ${label}`);
    const result = spawnSync(pnpmCommand, ['exec', ...args], {
        env,
        stdio: 'inherit',
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
};

run(
    'ESLint syntax and Vue rules',
    [
        'eslint',
        ...(shouldFix ? ['--fix'] : []),
        ...(useCache
            ? ['--cache', '--cache-strategy', 'content', '--cache-location', 'node_modules/.cache/eslint/syntax']
            : []),
        ...eslintTargets,
    ],
    withNodeHeap(512, { ESLINT_TYPE_AWARE: '0' })
);
for (const lintTarget of lintTargets) {
    run(`Oxlint type-aware TypeScript promise rules: ${lintTarget}`, ['oxlint', lintTarget]);
}
for (const vueTarget of vueTargets) {
    const cacheName = vueTarget.target.split('/')[1];
    run(
        `ESLint type-aware Vue promise rules: ${vueTarget.glob}`,
        [
            'eslint',
            '--config',
            'eslint.promise.config.js',
            ...(useCache
                ? [
                      '--cache',
                      '--cache-strategy',
                      'content',
                      '--cache-location',
                      `node_modules/.cache/eslint/${cacheName}-vue-promise`,
                  ]
                : []),
            vueTarget.glob,
        ],
        withNodeHeap(1280, { ESLINT_TYPED_PROJECT: vueTarget.project })
    );
}
