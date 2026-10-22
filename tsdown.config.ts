import { defineConfig } from 'tsdown';
import { emitDeclarations } from './tools/build-scripts/emit-declarations.mjs';

export default defineConfig({
    workspace: {
        include: ['packages/*', 'app/*'],
        exclude: ['**/*-frontend/**'],
    },
    entry: 'src/index.ts',
    format: 'es',
    outDir: 'dist',
    dts: false,
    hooks: { 'build:done': emitDeclarations },
    sourcemap: true,
    target: 'node22',
    platform: 'node',
    fixedExtension: false,
    hash: false,
});
