import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const ROOT_DIR = process.cwd();
const PHP_ROOT = path.join(ROOT_DIR, 'legacy', 'hwe', 'sammo', 'Command');
const TS_ROOT = path.join(ROOT_DIR, 'packages', 'logic', 'src', 'actions');

const DEFAULT_MODE = 'all';
const DEFAULT_SIMILARITY = 0.6;

const HELP_TEXT = `
Usage: node tools/compare-command-constraints.mjs [options]

Compare pair:
  TS buildConstraints      <-> PHP fullConditionConstraints
  TS buildMinConstraints   <-> PHP minConditionConstraints

Options:
  --mode all|full|min      Compare all (default), only full, or only min constraints.
  --include <regex>        Include command keys matching regex (e.g. "General/che_훈련").
  --strict                 Compare with argument signatures.
  --json                   Print JSON report.
  --show-matches           Print matched command keys.
  --similarity <0..1>      Near-match threshold for non-strict mode (default: 0.6).
  --help                   Show this help.
`;

const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log(HELP_TEXT.trim());
    process.exit(0);
}

const readArgValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx < 0) {
        return null;
    }
    return args[idx + 1] ?? null;
};

const mode = readArgValue('--mode') ?? DEFAULT_MODE;
if (!['all', 'full', 'min'].includes(mode)) {
    console.error(`Invalid --mode: ${mode}`);
    console.error(HELP_TEXT.trim());
    process.exit(1);
}

const includePattern = readArgValue('--include');
const includeRegex = includePattern ? new RegExp(includePattern) : null;
const strict = args.includes('--strict');
const asJson = args.includes('--json');
const showMatches = args.includes('--show-matches');
const similarityArg = readArgValue('--similarity');
const similarityThreshold = similarityArg === null ? DEFAULT_SIMILARITY : Number(similarityArg);
if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
    console.error(`Invalid --similarity: ${similarityArg}`);
    process.exit(1);
}

const collectFiles = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFiles(fullPath)));
        } else {
            files.push(fullPath);
        }
    }
    return files;
};

const buildLineIndex = (text) => {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') {
            starts.push(i + 1);
        }
    }
    return starts;
};

const getLineNumber = (lineStarts, index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lineStarts[mid] <= index && (mid === lineStarts.length - 1 || lineStarts[mid + 1] > index)) {
            return mid + 1;
        }
        if (lineStarts[mid] > index) {
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return 1;
};

const scanToDelimiter = (text, startIndex, delimiter) => {
    let i = startIndex;
    let depth = 0;
    let quote = null;
    let escaped = false;
    while (i < text.length) {
        const ch = text[i];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                quote = null;
            }
            i += 1;
            continue;
        }
        if (ch === '\'' || ch === '"') {
            quote = ch;
            i += 1;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth += 1;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth > 0) {
                depth -= 1;
            }
        } else if (ch === delimiter && depth === 0) {
            return { value: text.slice(startIndex, i), endIndex: i + 1 };
        }
        i += 1;
    }
    return { value: text.slice(startIndex), endIndex: text.length };
};

const scanToParenEnd = (text, startIndex) => {
    let i = startIndex;
    let depth = 0;
    let quote = null;
    let escaped = false;
    while (i < text.length) {
        const ch = text[i];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                quote = null;
            }
            i += 1;
            continue;
        }
        if (ch === '\'' || ch === '"') {
            quote = ch;
            i += 1;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth += 1;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth > 0) {
                depth -= 1;
            } else if (ch === ')') {
                return { value: text.slice(startIndex, i), endIndex: i + 1 };
            }
        }
        i += 1;
    }
    return { value: text.slice(startIndex), endIndex: text.length };
};

const splitTopLevel = (text, delimiter) => {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
            current += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '\'' || ch === '"') {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth += 1;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth > 0) {
                depth -= 1;
            }
        } else if (ch === delimiter && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current) {
        parts.push(current);
    }
    return parts;
};

const normalizeConstraintName = (name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) {
        return '';
    }
    const base = trimmed.includes('::') ? trimmed.split('::').pop() : trimmed;
    return base[0]?.toLowerCase() + base.slice(1);
};

const splitNameTokens = (name) => {
    if (!name) {
        return [];
    }
    const spaced = String(name)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9가-힣]+/g, ' ')
        .trim()
        .toLowerCase();
    const rawTokens = spaced ? spaced.split(/\s+/g) : [];
    const tokens = [];
    for (let i = 0; i < rawTokens.length; i += 1) {
        const token = rawTokens[i];
        if (!token) {
            continue;
        }
        if (token === 'different') {
            tokens.push('notsame');
            continue;
        }
        if (token === 'exists' || token === 'exist') {
            tokens.push('exist');
            continue;
        }
        if (token === 'not' && rawTokens[i + 1] === 'same') {
            tokens.push('notsame');
            i += 1;
            continue;
        }
        tokens.push(token);
    }
    return tokens;
};

const nameSimilarity = (a, b) => {
    const setA = new Set(splitNameTokens(a));
    const setB = new Set(splitNameTokens(b));
    if (setA.size === 0 || setB.size === 0) {
        return 0;
    }
    let common = 0;
    for (const item of setA) {
        if (setB.has(item)) {
            common += 1;
        }
    }
    const unionSize = new Set([...setA, ...setB]).size;
    return unionSize > 0 ? common / unionSize : 0;
};

const normalizePhpArgument = (argText) => {
    let out = String(argText ?? '').trim();
    if (!out) {
        return '';
    }
    out = out.replace(/\s+/g, ' ');
    out = out.replace(/\$this->arg\[[^\]]+\]/g, '$arg');
    out = out.replace(/\$this->[A-Za-z_][A-Za-z0-9_]*/g, '$this');
    out = out.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, '$');
    out = out.replace(/\s*\.\s*/g, '.');
    return out;
};

const normalizeTsExpression = (expr) => {
    if (!expr) {
        return '';
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        return `'${expr.text}'`;
    }
    if (ts.isNumericLiteral(expr)) {
        return expr.text;
    }
    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
        return 'true';
    }
    if (expr.kind === ts.SyntaxKind.FalseKeyword) {
        return 'false';
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword) {
        return 'null';
    }
    if (ts.isIdentifier(expr)) {
        return '$';
    }
    if (ts.isPropertyAccessExpression(expr)) {
        return '$';
    }
    if (ts.isElementAccessExpression(expr)) {
        return '$';
    }
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        return 'fn';
    }
    if (ts.isObjectLiteralExpression(expr)) {
        const keys = [];
        for (const prop of expr.properties) {
            if (ts.isPropertyAssignment(prop)) {
                if (ts.isIdentifier(prop.name)) {
                    keys.push(prop.name.text);
                } else if (ts.isStringLiteral(prop.name)) {
                    keys.push(prop.name.text);
                }
            }
        }
        return `{${keys.sort().join(',')}}`;
    }
    if (ts.isArrayLiteralExpression(expr)) {
        return `[${expr.elements.length}]`;
    }
    if (ts.isTemplateExpression(expr)) {
        return '`template`';
    }
    if (ts.isParenthesizedExpression(expr)) {
        return normalizeTsExpression(expr.expression);
    }
    if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
        return normalizeTsExpression(expr.expression);
    }
    if (ts.isConditionalExpression(expr)) {
        return `cond(${normalizeTsExpression(expr.whenTrue)}|${normalizeTsExpression(expr.whenFalse)})`;
    }
    if (ts.isCallExpression(expr)) {
        const callee = ts.isIdentifier(expr.expression)
            ? expr.expression.text
            : ts.isPropertyAccessExpression(expr.expression)
              ? expr.expression.name.text
              : 'call';
        return `${callee}(${expr.arguments.map((arg) => normalizeTsExpression(arg)).join(',')})`;
    }
    return 'expr';
};

const makeConstraintEntry = ({ side, kind, name, args, file, line, raw }) => {
    const normalizedName = normalizeConstraintName(name);
    const argsKey = args?.length ? args.join('|') : '';
    return {
        side,
        kind,
        name,
        normalizedName,
        args: args ?? [],
        argsKey,
        signature: `${normalizedName}(${argsKey})`,
        file,
        line,
        raw: String(raw ?? '').trim(),
    };
};

const tryParsePhpConstraintCallAt = (text, startIndex, side, kind, file, lineStarts, baseOffset = 0) => {
    const helperPrefix = 'ConstraintHelper::';
    if (!text.startsWith(helperPrefix, startIndex)) {
        return null;
    }
    const nameStart = startIndex + helperPrefix.length;
    let i = nameStart;
    while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) {
        i += 1;
    }
    const rawName = text.slice(nameStart, i);
    while (i < text.length && /\s/.test(text[i])) {
        i += 1;
    }
    if (text[i] !== '(') {
        return null;
    }
    const { value: argBody, endIndex } = scanToParenEnd(text, i + 1);
    const argParts = splitTopLevel(argBody, ',')
        .map((arg) => normalizePhpArgument(arg))
        .filter((arg) => arg.length > 0);
    const line = getLineNumber(lineStarts, startIndex + baseOffset);
    const raw = text.slice(startIndex, endIndex);
    return {
        entry: makeConstraintEntry({
            side,
            kind,
            name: rawName,
            args: argParts,
            file,
            line,
            raw,
        }),
        endIndex,
    };
};

const extractPhpConstraintsFromExpression = (text, side, kind, file, lineStarts, baseOffset = 0) => {
    const entries = [];
    let i = 0;
    while (i < text.length) {
        const parsed = tryParsePhpConstraintCallAt(text, i, side, kind, file, lineStarts, baseOffset);
        if (parsed) {
            entries.push(parsed.entry);
            i = parsed.endIndex;
            continue;
        }
        i += 1;
    }
    return entries;
};

const extractPhpFileConstraints = (file, text) => {
    const lineStarts = buildLineIndex(text);
    const byKind = {
        full: [],
        min: [],
    };

    const regex = /\$this->(fullConditionConstraints|minConditionConstraints)\s*(\[\s*\])?\s*=/g;
    while (true) {
        const match = regex.exec(text);
        if (!match) {
            break;
        }
        const target = match[1] === 'fullConditionConstraints' ? 'full' : 'min';
        const start = match.index + match[0].length;
        const { value, endIndex } = scanToDelimiter(text, start, ';');
        const expr = value.trim();
        if (!expr) {
            regex.lastIndex = endIndex;
            continue;
        }

        if (/^\$this->(fullConditionConstraints|minConditionConstraints)\s*$/i.test(expr)) {
            const src = /minConditionConstraints/.test(expr) ? 'min' : 'full';
            byKind[target].push(...byKind[src]);
            regex.lastIndex = endIndex;
            continue;
        }

        const extracted = extractPhpConstraintsFromExpression(
            value,
            'php',
            target,
            path.relative(ROOT_DIR, file),
            lineStarts,
            start
        );
        byKind[target].push(...extracted);
        regex.lastIndex = endIndex;
    }

    return byKind;
};

const readStringLikeProperty = (objLiteral, keyName) => {
    for (const prop of objLiteral.properties) {
        if (!ts.isPropertyAssignment(prop)) {
            continue;
        }
        const key = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : null;
        if (key !== keyName) {
            continue;
        }
        if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
            return prop.initializer.text;
        }
    }
    return null;
};

const isConstraintLikeArrow = (expr) => {
    if (!ts.isArrowFunction(expr) && !ts.isFunctionExpression(expr)) {
        return false;
    }
    if (expr.type && /Constraint/.test(expr.type.getText())) {
        return true;
    }
    if (!expr.body) {
        return false;
    }
    if (ts.isObjectLiteralExpression(expr.body)) {
        return readStringLikeProperty(expr.body, 'name') !== null;
    }
    if (ts.isBlock(expr.body)) {
        for (const stmt of expr.body.statements) {
            if (!ts.isReturnStatement(stmt) || !stmt.expression) {
                continue;
            }
            if (ts.isObjectLiteralExpression(stmt.expression)) {
                if (readStringLikeProperty(stmt.expression, 'name') !== null) {
                    return true;
                }
            }
        }
    }
    return false;
};

const collectTsConstraintFactories = (sourceFile) => {
    const imported = new Set();
    const local = new Set();

    const visitImports = (node) => {
        if (ts.isImportDeclaration(node)) {
            const moduleText = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
            if (moduleText.includes('/constraints/')) {
                const bindings = node.importClause?.namedBindings;
                if (bindings && ts.isNamedImports(bindings)) {
                    for (const element of bindings.elements) {
                        imported.add(element.name.text);
                    }
                }
            }
        }
        ts.forEachChild(node, visitImports);
    };

    const visitLocal = (node) => {
        if (ts.isFunctionDeclaration(node) && node.name) {
            if (node.type && /Constraint/.test(node.type.getText(sourceFile))) {
                local.add(node.name.text);
            } else if (node.body) {
                for (const stmt of node.body.statements) {
                    if (!ts.isReturnStatement(stmt) || !stmt.expression) {
                        continue;
                    }
                    if (ts.isObjectLiteralExpression(stmt.expression)) {
                        if (readStringLikeProperty(stmt.expression, 'name') !== null) {
                            local.add(node.name.text);
                        }
                    }
                }
            }
        }

        if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name) || !decl.initializer) {
                    continue;
                }
                if (isConstraintLikeArrow(decl.initializer)) {
                    local.add(decl.name.text);
                }
            }
        }

        ts.forEachChild(node, visitLocal);
    };

    visitImports(sourceFile);
    visitLocal(sourceFile);

    return new Set([...imported, ...local]);
};

const extractTsCallEntry = (callExpr, sourceFile, side, kind, file) => {
    let callName = null;
    if (ts.isIdentifier(callExpr.expression)) {
        callName = callExpr.expression.text;
    } else if (ts.isPropertyAccessExpression(callExpr.expression)) {
        callName = callExpr.expression.name.text;
    }
    if (!callName) {
        return null;
    }

    const args = callExpr.arguments.map((arg) => normalizeTsExpression(arg)).filter((item) => item.length > 0);
    const { line } = sourceFile.getLineAndCharacterOfPosition(callExpr.getStart(sourceFile));
    return makeConstraintEntry({
        side,
        kind,
        name: callName,
        args,
        file,
        line: line + 1,
        raw: callExpr.getText(sourceFile),
    });
};

const extractTsObjectConstraintEntry = (objExpr, sourceFile, side, kind, file) => {
    const name = readStringLikeProperty(objExpr, 'name');
    if (!name) {
        return null;
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(objExpr.getStart(sourceFile));
    return makeConstraintEntry({
        side,
        kind,
        name,
        args: [],
        file,
        line: line + 1,
        raw: objExpr.getText(sourceFile),
    });
};

const extractTsConstraintEntriesFromExpr = (expr, sourceFile, side, kind, file, factorySet, variableMap, visited) => {
    const results = [];
    if (!expr) {
        return results;
    }

    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
        return extractTsConstraintEntriesFromExpr(
            expr.expression,
            sourceFile,
            side,
            kind,
            file,
            factorySet,
            variableMap,
            visited
        );
    }

    if (ts.isArrayLiteralExpression(expr)) {
        for (const element of expr.elements) {
            if (ts.isSpreadElement(element)) {
                results.push(
                    ...extractTsConstraintEntriesFromExpr(
                        element.expression,
                        sourceFile,
                        side,
                        kind,
                        file,
                        factorySet,
                        variableMap,
                        visited
                    )
                );
                continue;
            }
            results.push(
                ...extractTsConstraintEntriesFromExpr(
                    element,
                    sourceFile,
                    side,
                    kind,
                    file,
                    factorySet,
                    variableMap,
                    visited
                )
            );
        }
        return results;
    }

    if (ts.isConditionalExpression(expr)) {
        results.push(
            ...extractTsConstraintEntriesFromExpr(
                expr.whenTrue,
                sourceFile,
                side,
                kind,
                file,
                factorySet,
                variableMap,
                visited
            )
        );
        results.push(
            ...extractTsConstraintEntriesFromExpr(
                expr.whenFalse,
                sourceFile,
                side,
                kind,
                file,
                factorySet,
                variableMap,
                visited
            )
        );
        return results;
    }

    if (ts.isIdentifier(expr)) {
        const key = expr.text;
        if (visited.has(key)) {
            return results;
        }
        const saved = variableMap.get(key);
        if (!saved) {
            return results;
        }
        visited.add(key);
        results.push(...saved);
        visited.delete(key);
        return results;
    }

    if (ts.isObjectLiteralExpression(expr)) {
        const entry = extractTsObjectConstraintEntry(expr, sourceFile, side, kind, file);
        if (entry) {
            results.push(entry);
        }
        return results;
    }

    if (ts.isCallExpression(expr)) {
        let callName = null;
        if (ts.isIdentifier(expr.expression)) {
            callName = expr.expression.text;
        } else if (ts.isPropertyAccessExpression(expr.expression)) {
            callName = expr.expression.name.text;
        }
        if (!callName) {
            return results;
        }
        const looksConstraintFactory =
            factorySet.has(callName) ||
            /^(req|not|be|exists|exist|friendly|different|always|near|allow|disallow|must|check|occupied|supplied|hasRoute|available)/i.test(
                callName
            );
        if (looksConstraintFactory) {
            const entry = extractTsCallEntry(expr, sourceFile, side, kind, file);
            if (entry) {
                results.push(entry);
            }
        }
        return results;
    }

    return results;
};

const dedupeEntries = (entries) => {
    const map = new Map();
    for (const entry of entries) {
        const key = `${entry.signature}|${entry.file}|${entry.line}`;
        if (!map.has(key)) {
            map.set(key, entry);
        }
    }
    return [...map.values()];
};

const extractTsMethodConstraints = (methodDecl, sourceFile, side, kind, file, factorySet) => {
    const results = [];
    const variableMap = new Map();

    const saveVarEntries = (name, entries) => {
        const prev = variableMap.get(name) ?? [];
        prev.push(...entries);
        variableMap.set(name, dedupeEntries(prev));
    };

    const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const varName = node.name.text;
            const entries = extractTsConstraintEntriesFromExpr(
                node.initializer,
                sourceFile,
                side,
                kind,
                file,
                factorySet,
                variableMap,
                new Set()
            );
            if (entries.length > 0 || /constraint/i.test(varName)) {
                saveVarEntries(varName, entries);
            }
        }

        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left)
        ) {
            const varName = node.left.text;
            const entries = extractTsConstraintEntriesFromExpr(
                node.right,
                sourceFile,
                side,
                kind,
                file,
                factorySet,
                variableMap,
                new Set()
            );
            if (entries.length > 0 || variableMap.has(varName) || /constraint/i.test(varName)) {
                variableMap.set(varName, dedupeEntries(entries));
            }
        }

        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const target = node.expression.expression;
            const methodName = node.expression.name.text;
            if (methodName === 'push' && ts.isIdentifier(target)) {
                const arrayName = target.text;
                if (variableMap.has(arrayName) || /constraint/i.test(arrayName)) {
                    const pushed = [];
                    for (const arg of node.arguments) {
                        pushed.push(
                            ...extractTsConstraintEntriesFromExpr(
                                arg,
                                sourceFile,
                                side,
                                kind,
                                file,
                                factorySet,
                                variableMap,
                                new Set()
                            )
                        );
                    }
                    if (pushed.length > 0) {
                        saveVarEntries(arrayName, pushed);
                    }
                }
            }
        }

        if (ts.isReturnStatement(node) && node.expression) {
            const returnEntries = extractTsConstraintEntriesFromExpr(
                node.expression,
                sourceFile,
                side,
                kind,
                file,
                factorySet,
                variableMap,
                new Set()
            );
            results.push(...returnEntries);
        }

        ts.forEachChild(node, visit);
    };

    if (methodDecl.body) {
        for (const stmt of methodDecl.body.statements) {
            visit(stmt);
        }
    }

    return dedupeEntries(results);
};

const extractTsFileConstraints = (file, text) => {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const factorySet = collectTsConstraintFactories(sourceFile);
    const relFile = path.relative(ROOT_DIR, file);
    const byKind = {
        full: [],
        min: [],
    };

    const visit = (node) => {
        if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
            const name = node.name.text;
            if (name === 'buildConstraints') {
                byKind.full.push(
                    ...extractTsMethodConstraints(node, sourceFile, 'ts', 'full', relFile, factorySet)
                );
            }
            if (name === 'buildMinConstraints') {
                byKind.min.push(
                    ...extractTsMethodConstraints(node, sourceFile, 'ts', 'min', relFile, factorySet)
                );
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    byKind.full = dedupeEntries(byKind.full);
    byKind.min = dedupeEntries(byKind.min);
    return byKind;
};

const includeCommand = (key) => {
    if (!includeRegex) {
        return true;
    }
    return includeRegex.test(key);
};

const loadPhpConstraints = async () => {
    const files = (await collectFiles(PHP_ROOT)).filter((file) => file.endsWith('.php'));
    const byCommand = new Map();

    for (const file of files) {
        const baseName = path.basename(file, '.php');
        if (['BaseCommand', 'GeneralCommand', 'NationCommand'].includes(baseName)) {
            continue;
        }
        const relPath = path.relative(PHP_ROOT, file);
        const dirName = relPath.split(path.sep)[0];
        if (!['General', 'Nation'].includes(dirName)) {
            continue;
        }
        const key = `${dirName}/${baseName}`;
        if (!includeCommand(key)) {
            continue;
        }

        const text = await fs.readFile(file, 'utf-8');
        const extracted = extractPhpFileConstraints(file, text);
        byCommand.set(key, extracted);
    }

    return byCommand;
};

const loadTsConstraints = async () => {
    const files = (await collectFiles(TS_ROOT)).filter((file) => file.endsWith('.ts'));
    const byCommand = new Map();

    for (const file of files) {
        const baseName = path.basename(file, '.ts');
        if (!/^che_|^cr_|^event_|^휴식$/.test(baseName)) {
            continue;
        }
        const relPath = path.relative(TS_ROOT, file).split(path.sep).join('/');
        let key = null;
        if (relPath.startsWith('turn/general/') || relPath.startsWith('instant/general/')) {
            key = `General/${baseName}`;
        } else if (relPath.startsWith('turn/nation/') || relPath.startsWith('instant/nation/')) {
            key = `Nation/${baseName}`;
        }
        if (!key || !includeCommand(key)) {
            continue;
        }

        const text = await fs.readFile(file, 'utf-8');
        const extracted = extractTsFileConstraints(file, text);
        byCommand.set(key, extracted);
    }

    return byCommand;
};

const indexByName = (entries) => {
    const map = new Map();
    for (const entry of entries) {
        const key = strict ? entry.signature : entry.normalizedName;
        const list = map.get(key) ?? [];
        list.push(entry);
        map.set(key, list);
    }
    return map;
};

const pairNearMatches = (missing, extra) => {
    const usedTs = new Set();
    const near = [];
    const unresolvedMissing = [];

    for (const phpName of missing) {
        let best = null;
        for (const tsName of extra) {
            if (usedTs.has(tsName)) {
                continue;
            }
            const score = nameSimilarity(phpName, tsName);
            if (!best || score > best.score) {
                best = { phpName, tsName, score };
            }
        }
        if (best && best.score >= similarityThreshold) {
            near.push(best);
            usedTs.add(best.tsName);
        } else {
            unresolvedMissing.push(phpName);
        }
    }

    const unresolvedExtra = extra.filter((name) => !usedTs.has(name));
    return { near, unresolvedMissing, unresolvedExtra };
};

const compareConstraintSet = (phpEntries, tsEntries, kind) => {
    const phpIndex = indexByName(phpEntries);
    const tsIndex = indexByName(tsEntries);
    const phpKeys = [...phpIndex.keys()].sort();
    const tsKeys = [...tsIndex.keys()].sort();

    let missingInTs = phpKeys.filter((key) => !tsIndex.has(key));
    let extraInTs = tsKeys.filter((key) => !phpIndex.has(key));
    let near = [];

    if (!strict) {
        const nearPair = pairNearMatches(missingInTs, extraInTs);
        near = nearPair.near;
        missingInTs = nearPair.unresolvedMissing;
        extraInTs = nearPair.unresolvedExtra;
    }

    let status = 'MATCH';
    if (missingInTs.length > 0 || extraInTs.length > 0) {
        status = 'MISMATCH';
    } else if (near.length > 0) {
        status = 'NEAR_MATCH';
    }

    const argDiffs = [];
    if (!strict) {
        const common = phpKeys.filter((key) => tsIndex.has(key));
        for (const key of common) {
            const phpArgSet = new Set((phpIndex.get(key) ?? []).map((entry) => entry.argsKey));
            const tsArgSet = new Set((tsIndex.get(key) ?? []).map((entry) => entry.argsKey));
            const phpArgs = [...phpArgSet].sort();
            const tsArgs = [...tsArgSet].sort();
            if (phpArgs.length === 1 && tsArgs.length === 1 && phpArgs[0] !== tsArgs[0]) {
                argDiffs.push({
                    name: key,
                    php: phpArgs[0],
                    ts: tsArgs[0],
                });
            }
        }
    }

    return {
        kind,
        status,
        phpCount: phpEntries.length,
        tsCount: tsEntries.length,
        phpUnique: phpKeys.length,
        tsUnique: tsKeys.length,
        missingInTs,
        extraInTs,
        near,
        argDiffs,
        phpIndex,
        tsIndex,
    };
};

const buildReport = (phpByCommand, tsByCommand) => {
    const allKeys = [...new Set([...phpByCommand.keys(), ...tsByCommand.keys()])].sort();
    const commands = [];
    const missingCommandInTs = [];
    const missingCommandInPhp = [];

    for (const key of allKeys) {
        const php = phpByCommand.get(key);
        const tsEntry = tsByCommand.get(key);
        if (!php) {
            missingCommandInPhp.push(key);
            continue;
        }
        if (!tsEntry) {
            missingCommandInTs.push(key);
            continue;
        }

        const fullResult = compareConstraintSet(php.full ?? [], tsEntry.full ?? [], 'full');
        const minResult = compareConstraintSet(php.min ?? [], tsEntry.min ?? [], 'min');

        let overallStatus = 'MATCH';
        const activeResults = [];
        if (mode === 'all' || mode === 'full') {
            activeResults.push(fullResult);
        }
        if (mode === 'all' || mode === 'min') {
            activeResults.push(minResult);
        }

        if (activeResults.some((result) => result.status === 'MISMATCH')) {
            overallStatus = 'MISMATCH';
        } else if (activeResults.some((result) => result.status === 'NEAR_MATCH')) {
            overallStatus = 'NEAR_MATCH';
        }

        commands.push({
            key,
            status: overallStatus,
            full: fullResult,
            min: minResult,
        });
    }

    const comparedCommands = commands.filter((command) => {
        if (mode === 'full') {
            return true;
        }
        if (mode === 'min') {
            return true;
        }
        return true;
    });

    const totals = {
        phpCommands: phpByCommand.size,
        tsCommands: tsByCommand.size,
        comparedCommands: comparedCommands.length,
        match: comparedCommands.filter((item) => item.status === 'MATCH').length,
        nearMatch: comparedCommands.filter((item) => item.status === 'NEAR_MATCH').length,
        mismatch: comparedCommands.filter((item) => item.status === 'MISMATCH').length,
        missingCommandInTs: missingCommandInTs.length,
        missingCommandInPhp: missingCommandInPhp.length,
    };

    return {
        totals,
        missingCommandInTs,
        missingCommandInPhp,
        commands: comparedCommands,
    };
};

const renderEntryBucket = (index, name) => {
    const list = index.get(name) ?? [];
    if (list.length === 0) {
        return '-';
    }
    const first = list[0];
    const extra = list.length > 1 ? ` (+${list.length - 1} more)` : '';
    if (strict) {
        return `${first.file}:${first.line}${extra} | ${name}`;
    }
    return `${first.file}:${first.line}${extra} | ${first.name}`;
};

const printReport = (report) => {
    console.log(
        `Compare command constraints (mode: ${mode}, strict: ${strict ? 'on' : 'off'}, similarity: ${similarityThreshold})`
    );
    console.log(`PHP commands: ${report.totals.phpCommands}`);
    console.log(`TS commands: ${report.totals.tsCommands}`);
    console.log(`Compared commands: ${report.totals.comparedCommands}`);
    console.log(`Match: ${report.totals.match}`);
    console.log(`Near match: ${report.totals.nearMatch}`);
    console.log(`Mismatch: ${report.totals.mismatch}`);
    console.log(`Missing command in TS: ${report.totals.missingCommandInTs}`);
    console.log(`Missing command in PHP: ${report.totals.missingCommandInPhp}`);

    if (report.missingCommandInTs.length > 0) {
        console.log('\nMissing command in TS:');
        for (const key of report.missingCommandInTs) {
            console.log(`- ${key}`);
        }
    }

    if (report.missingCommandInPhp.length > 0) {
        console.log('\nMissing command in PHP:');
        for (const key of report.missingCommandInPhp) {
            console.log(`- ${key}`);
        }
    }

    const mismatches = report.commands.filter((item) => item.status !== 'MATCH');
    if (mismatches.length > 0) {
        console.log('\nDetails:');
        for (const command of mismatches) {
            console.log(`\n== ${command.key} [${command.status}] ==`);
            const kinds = mode === 'all' ? ['full', 'min'] : [mode];
            for (const kind of kinds) {
                const result = command[kind];
                if (!result) {
                    continue;
                }
                if (result.status === 'MATCH' && result.argDiffs.length === 0) {
                    continue;
                }
                console.log(`- ${kind}: ${result.status}`);
                if (result.missingInTs.length > 0) {
                    console.log(`  PHP only (${result.missingInTs.length}):`);
                    for (const name of result.missingInTs) {
                        console.log(`    - ${renderEntryBucket(result.phpIndex, name)}`);
                    }
                }
                if (result.extraInTs.length > 0) {
                    console.log(`  TS only (${result.extraInTs.length}):`);
                    for (const name of result.extraInTs) {
                        console.log(`    - ${renderEntryBucket(result.tsIndex, name)}`);
                    }
                }
                if (result.near.length > 0) {
                    console.log(`  Near match (${result.near.length}):`);
                    for (const pair of result.near) {
                        console.log(`    - PHP "${pair.phpName}" ~ TS "${pair.tsName}" (score ${pair.score.toFixed(2)})`);
                    }
                }
                if (result.argDiffs.length > 0) {
                    console.log(`  Arg diff hints (${result.argDiffs.length}):`);
                    for (const diff of result.argDiffs) {
                        console.log(`    - ${diff.name}: PHP(${diff.php}) vs TS(${diff.ts})`);
                    }
                }
            }
        }
    } else if (showMatches) {
        console.log('\nAll compared commands matched.');
    }

    if (showMatches) {
        const matched = report.commands.filter((item) => item.status === 'MATCH').map((item) => item.key);
        if (matched.length > 0) {
            console.log('\nMatched commands:');
            for (const key of matched) {
                console.log(`- ${key}`);
            }
        }
    }
};

const main = async () => {
    const [phpByCommand, tsByCommand] = await Promise.all([loadPhpConstraints(), loadTsConstraints()]);
    const report = buildReport(phpByCommand, tsByCommand);
    if (asJson) {
        const jsonFriendly = {
            ...report,
            commands: report.commands.map((command) => ({
                key: command.key,
                status: command.status,
                full: {
                    ...command.full,
                    phpIndex: undefined,
                    tsIndex: undefined,
                },
                min: {
                    ...command.min,
                    phpIndex: undefined,
                    tsIndex: undefined,
                },
            })),
        };
        console.log(JSON.stringify(jsonFriendly, null, 2));
        return;
    }
    printReport(report);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
