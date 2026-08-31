import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

const project = process.env.ESLINT_TYPED_PROJECT;
if (!project) {
    throw new Error('ESLINT_TYPED_PROJECT must point to the target tsconfig.json');
}

const typedParserOptions = {
    extraFileExtensions: ['.vue'],
    jsDocParsingMode: 'none',
    project: [project],
    tsconfigRootDir: import.meta.dirname,
};
const promiseRules = {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': [
        'error',
        {
            checksVoidReturn: {
                arguments: false,
                attributes: false,
            },
        },
    ],
};
const plugins = {
    '@typescript-eslint': tseslint.plugin,
};

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/*.d.ts',
            'legacy/**',
            'packages/infra/prisma/client/**',
            '**/generated/**',
            '.pnpm-store/**',
        ],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: typedParserOptions,
        },
        plugins,
        rules: promiseRules,
    },
    {
        files: ['**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                ...typedParserOptions,
                parser: tseslint.parser,
                sourceType: 'module',
            },
        },
        plugins,
        rules: promiseRules,
    }
);
