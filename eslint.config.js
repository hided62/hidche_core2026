import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

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
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/recommended'],
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                ...globals.es2021,
            },
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
    },
    {
        files: ['**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                extraFileExtensions: ['.vue'],
                sourceType: 'module',
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            'vue/html-indent': ['error', 4],
            'vue/multi-word-component-names': 'off',
        },
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ['**/*.{ts,tsx,vue}'],
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-empty-object-type': 'off',
        },
    },
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        rules: {
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none',
                },
            ],
        },
    },
    {
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            'prettier/prettier': 'error',
        },
    },
    prettierConfig
);
