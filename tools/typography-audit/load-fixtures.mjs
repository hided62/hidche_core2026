import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'app/game-frontend/package.json'));
const ts = require('typescript');
const out = path.join(process.env.TYPOGRAPHY_OUTPUT_DIR ?? path.join(root, 'test-results/typography-audit'), 'modules');
fs.mkdirSync(out, { recursive: true });
const cache = new Map();
export async function fixture(relative) {
    const url = compile(path.join(root, relative));
    return import(url);
}
function compile(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const target = path.join(
        out,
        path
            .relative(root, filename)
            .replaceAll('/', '__')
            .replace(/\.tsx?$/, '.mjs')
    );
    const url = pathToFileURL(target).href;
    cache.set(filename, url);
    let source = fs
        .readFileSync(filename, 'utf8')
        .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
        .replaceAll('import.meta.dirname', JSON.stringify(path.dirname(filename)));
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const pieces = [],
        names = [];
    for (const node of ast.statements) {
        // Reuse only original fixture definitions, never register/execute the tests.
        if (
            ts.isImportDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isVariableStatement(node)
        ) {
            pieces.push(node.getFullText(ast));
            if (ts.isVariableStatement(node))
                for (const dec of node.declarationList.declarations)
                    if (ts.isIdentifier(dec.name)) names.push(dec.name.text);
            if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
        }
    }
    const isSpec = filename.endsWith('.spec.ts');
    const input = isSpec ? pieces.join('\n') + '\nexport { ' + names.join(', ') + ' };' : source;
    let js = ts.transpileModule(input, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    js = js.replace(/(from\s*|import\s*)['"]([^'"]+)['"]/g, (match, prefix, spec) => {
        if (spec.startsWith('node:')) return match;
        let dest;
        if (spec.startsWith('.')) {
            dest = path.resolve(path.dirname(filename), spec);
            if (!fs.existsSync(dest) && dest.endsWith('.js')) dest = dest.replace(/\.js$/, '.ts');
            if (!fs.existsSync(dest)) {
                if (fs.existsSync(dest + '.ts')) dest += '.ts';
                else if (fs.existsSync(dest + '.js')) dest += '.js';
            }
            dest = dest.endsWith('.ts') ? compile(dest) : pathToFileURL(dest).href;
        } else {
            let resolved = createRequire(filename).resolve(spec);
            if (spec === '@playwright/test') resolved = resolved.replace(/index\.js$/, 'index.mjs');
            dest = pathToFileURL(resolved).href;
        }
        return prefix + JSON.stringify(dest);
    });
    fs.writeFileSync(target, js);
    return url;
}
