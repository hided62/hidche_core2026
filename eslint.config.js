import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

// projectService reloads every TS project when this value changes between TS and Vue files.
const extraFileExtensions = ['.vue'];
const typeAware = process.env.ESLINT_TYPE_AWARE !== '0';
const typedParserOptions = typeAware
    ? {
          extraFileExtensions,
          jsDocParsingMode: 'none',
          projectService: true,
          tsconfigRootDir: import.meta.dirname,
      }
    : {};

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
                ...typedParserOptions,
                parser: tseslint.parser,
                sourceType: 'module',
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
            parserOptions: typedParserOptions,
        },
    },
    {
        files: ['**/*.{ts,tsx,vue}'],
        rules: {
            // TypeScript resolves ambient and imported names more accurately than ESLint's base rule.
            'no-undef': 'off',
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
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    fixStyle: 'separate-type-imports',
                },
            ],
            '@typescript-eslint/no-floating-promises': typeAware ? 'error' : 'off',
            '@typescript-eslint/no-misused-promises': [
                typeAware ? 'error' : 'off',
                {
                    checksVoidReturn: {
                        arguments: false,
                        attributes: false,
                    },
                },
            ],
        },
    },
    {
        files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    {
        files: ['app/game-engine/src/**/*.{ts,tsx}', 'packages/logic/src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-properties': [
                'error',
                {
                    object: 'Math',
                    property: 'random',
                    message: 'Authoritative game state must use an explicitly seeded RandUtil/LiteHashDRBG stream.',
                },
            ],
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
            'prettier/prettier': 'off',
        },
    },
    prettierConfig
);
