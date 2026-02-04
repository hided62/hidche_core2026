import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const ROOT_DIR = process.cwd();
const PHP_ROOT = path.join(ROOT_DIR, 'legacy', 'hwe', 'sammo', 'Command');
const TS_ROOT = path.join(ROOT_DIR, 'packages', 'logic', 'src', 'actions');

const DEFAULT_MODE = 'action';

const ARG_HELP = `
Usage: node tools/compare-command-logs.mjs [options]

Options:
    --mode action|history|all   Compare action logs (default), history logs, or all logs.
    --include <regex>           Only include command keys matching regex.
    --strict                    Compare raw templates without normalization.
    --keep-date                 Keep <1>...</> date markers in normalized output.
    --json                      Output JSON report.
    --help                      Show this help.
`;

const args = process.argv.slice(2);
const modeArgIndex = args.indexOf('--mode');
const mode = modeArgIndex >= 0 ? args[modeArgIndex + 1] : DEFAULT_MODE;
const includeIndex = args.indexOf('--include');
const includePattern = includeIndex >= 0 ? args[includeIndex + 1] : null;
const strict = args.includes('--strict');
const keepDate = args.includes('--keep-date');
const asJson = args.includes('--json');

if (args.includes('--help')) {
    console.log(ARG_HELP.trim());
    process.exit(0);
}

if (!['action', 'history', 'all'].includes(mode)) {
    console.error(`Invalid --mode ${mode}`);
    console.error(ARG_HELP.trim());
    process.exit(1);
}

const includeRegex = includePattern ? new RegExp(includePattern) : null;

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
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') {
            lineStarts.push(i + 1);
        }
    }
    return lineStarts;
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

const scanToFirstArgumentEnd = (text, startIndex) => {
    let i = startIndex;
    let depth = 0;
    let quote = null;
    let escaped = false;
    while (i < text.length) {
        const ch = text[i];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\\\') {
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
        } else if (ch === ',' && depth === 0) {
            return { value: text.slice(startIndex, i), endIndex: i + 1 };
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
        }

        if (ch === delimiter && depth === 0) {
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

const parsePhpStringLiteral = (segment) => {
    const trimmed = segment.trim();
    const quote = trimmed[0];
    if (quote !== '\'' && quote !== '"') {
        return null;
    }

    let result = '';
    let escaped = false;
    for (let i = 1; i < trimmed.length; i += 1) {
        const ch = trimmed[i];
        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === quote) {
            break;
        }
        result += ch;
    }

    if (quote === '"') {
        result = result.replace(/\{\$[A-Za-z_][A-Za-z0-9_]*\}/g, '${}');
        result = result.replace(/\$[A-Za-z_][A-Za-z0-9_]*\b/g, '${}');
    }

    return result;
};

const parsePhpExprToTemplate = (expr, assignments, callPos) => {
    const segments = splitTopLevel(expr, '.');
    const parts = [];
    let hasLiteral = false;

    for (const rawSegment of segments) {
        let segment = rawSegment.trim();
        while (segment.startsWith('(') && segment.endsWith(')')) {
            segment = segment.slice(1, -1).trim();
        }
        if (!segment) {
            continue;
        }

        const stringLiteral = parsePhpStringLiteral(segment);
        if (stringLiteral !== null) {
            parts.push(stringLiteral);
            hasLiteral = true;
            continue;
        }

        const varMatch = segment.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
        if (varMatch) {
            const varName = varMatch[1];
            const assignment = resolveAssignment(assignments, varName, callPos);
            if (assignment) {
                parts.push(assignment.template);
                hasLiteral = hasLiteral || assignment.hasLiteral;
            } else {
                parts.push('${}');
            }
            continue;
        }

        parts.push('${}');
    }

    return {
        template: parts.join(''),
        hasLiteral,
    };
};

const resolveAssignment = (assignments, name, callPos) => {
    const list = assignments.get(name);
    if (!list) {
        return null;
    }
    let candidate = null;
    for (const entry of list) {
        if (entry.pos <= callPos) {
            if (!candidate || entry.pos > candidate.pos) {
                candidate = entry;
            }
        }
    }
    return candidate;
};

const findPhpAssignments = (text) => {
    const assignments = new Map();
    const regex = /\$([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    while (true) {
        const match = regex.exec(text);
        if (!match) {
            break;
        }
        const varName = match[1];
        const afterIndex = match.index + match[0].length;
        const afterChar = text[afterIndex] ?? '';
        if (afterChar === '=' || afterChar === '>') {
            continue;
        }
        const { value, endIndex } = scanToDelimiter(text, afterIndex, ';');
        const parsed = parsePhpExprToTemplate(value, new Map(), match.index);
        if (!parsed.hasLiteral) {
            regex.lastIndex = endIndex;
            continue;
        }
        const list = assignments.get(varName) ?? [];
        list.push({
            pos: match.index,
            template: parsed.template,
            hasLiteral: parsed.hasLiteral,
        });
        assignments.set(varName, list);
        regex.lastIndex = endIndex;
    }
    return assignments;
};

const extractPhpLogCalls = (text, assignments) => {
    const results = [];
    const regex = /pushGeneralActionLog\s*\(/g;
    const lineStarts = buildLineIndex(text);

    while (true) {
        const match = regex.exec(text);
        if (!match) {
            break;
        }
        const startIndex = match.index + match[0].length;
        const { value } = scanToFirstArgumentEnd(text, startIndex);
        const parsed = parsePhpExprToTemplate(value, assignments, match.index);
        results.push({
            pos: match.index,
            raw: value.trim(),
            template: parsed.template,
            line: getLineNumber(lineStarts, match.index),
        });
    }

    return results;
};

const tsEnumValue = (node, enumName) => {
    if (!node) {
        return null;
    }
    if (ts.isPropertyAccessExpression(node)) {
        const left = node.expression.getText();
        if (left === enumName) {
            return node.name.text;
        }
    }
    return null;
};

const readOptionsInfo = (node) => {
    if (!node || !ts.isObjectLiteralExpression(node)) {
        return { category: null, scope: null };
    }

    let category = null;
    let scope = null;

    for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
            continue;
        }
        const key = ts.isIdentifier(prop.name) ? prop.name.text : null;
        if (!key) {
            continue;
        }
        if (key === 'category') {
            category = tsEnumValue(prop.initializer, 'LogCategory');
        }
        if (key === 'scope') {
            scope = tsEnumValue(prop.initializer, 'LogScope');
        }
    }

    return { category, scope };
};

const renderTsExpr = (expr) => {
    if (!expr) {
        return '${}';
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        return expr.text;
    }
    if (ts.isTemplateExpression(expr)) {
        let out = expr.head.text;
        for (const span of expr.templateSpans) {
            out += '${}';
            out += span.literal.text;
        }
        return out;
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return `${renderTsExpr(expr.left)}${renderTsExpr(expr.right)}`;
    }
    if (ts.isParenthesizedExpression(expr)) {
        return renderTsExpr(expr.expression);
    }
    return '${}';
};

const extractTsLogs = (filePath, text) => {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const results = [];

    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            let calleeName = null;
            let isProperty = false;
            if (ts.isPropertyAccessExpression(node.expression)) {
                calleeName = node.expression.name.text;
                isProperty = true;
            } else if (ts.isIdentifier(node.expression)) {
                calleeName = node.expression.text;
            }

            if (calleeName === 'addLog' || calleeName === 'createLogEffect') {
                const [firstArg, secondArg] = node.arguments;
                const info = readOptionsInfo(secondArg);
                const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                results.push({
                    kind: calleeName,
                    template: renderTsExpr(firstArg),
                    raw: firstArg ? firstArg.getText(sourceFile) : '',
                    line: line + 1,
                    category: info.category,
                    scope: info.scope,
                    isProperty,
                });
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return results;
};

const normalizeTemplate = (text) => {
    if (strict) {
        return text.trim();
    }
    let out = text;
    if (!keepDate) {
        out = out.replace(/<1>.*?<\/>/g, '');
    }
    out = out.replace(/\$\{[^}]*\}/g, '${}');
    out = out.replace(/\{\$[A-Za-z_][A-Za-z0-9_]*\}/g, '${}');
    out = out.replace(/\$[A-Za-z_][A-Za-z0-9_]*\b/g, '${}');
    out = out.replace(/\s+/g, ' ').trim();
    return out;
};

const shouldIncludeTsEntry = (entry) => {
    if (mode === 'all') {
        return true;
    }
    const category = entry.category;
    const scope = entry.scope;
    if (mode === 'action') {
        if (category && category !== 'ACTION') {
            return false;
        }
        if (scope && scope !== 'GENERAL') {
            return false;
        }
        return true;
    }
    if (mode === 'history') {
        if (category && category !== 'HISTORY') {
            return false;
        }
        if (scope && scope !== 'GENERAL') {
            return false;
        }
        return true;
    }
    return true;
};

const filterCommandKey = (key) => {
    if (!includeRegex) {
        return true;
    }
    return includeRegex.test(key);
};

const formatEntries = (entries) => {
    const map = new Map();
    for (const entry of entries) {
        const key = normalizeTemplate(entry.template);
        const list = map.get(key) ?? [];
        list.push(entry);
        map.set(key, list);
    }
    const lines = [];
    for (const [template, list] of map.entries()) {
        const first = list[0];
        const extra = list.length > 1 ? ` (+${list.length - 1} more)` : '';
        lines.push(`${first.file}:${first.line}${extra} | ${normalizeTemplate(template)}`);
    }
    return lines;
};

const loadPhpLogs = async () => {
    const files = (await collectFiles(PHP_ROOT)).filter((file) => file.endsWith('.php'));
    const logsByKey = new Map();

    for (const file of files) {
        const baseName = path.basename(file, '.php');
        if (['BaseCommand', 'GeneralCommand', 'NationCommand'].includes(baseName)) {
            continue;
        }
        const relPath = path.relative(PHP_ROOT, file);
        const dirName = relPath.split(path.sep)[0];
        const key = dirName === 'General' || dirName === 'Nation' ? `${dirName}/${baseName}` : baseName;
        if (!filterCommandKey(key)) {
            continue;
        }
        const text = await fs.readFile(file, 'utf-8');
        const assignments = findPhpAssignments(text);
        const logs = extractPhpLogCalls(text, assignments);
        if (logs.length === 0) {
            continue;
        }
        const normalized = logs.map((log) => ({
            file: path.relative(ROOT_DIR, file),
            line: log.line,
            template: log.template,
            raw: log.raw,
        }));
        logsByKey.set(key, normalized);
    }

    return logsByKey;
};

const loadTsLogs = async () => {
    const files = (await collectFiles(TS_ROOT)).filter((file) => file.endsWith('.ts'));
    const logsByKey = new Map();

    for (const file of files) {
        const baseName = path.basename(file, '.ts');
        if (!/^che_|^cr_|^event_|^휴식$/.test(baseName)) {
            continue;
        }
        const relPath = path.relative(TS_ROOT, file).split(path.sep).join('/');
        let key = baseName;
        if (relPath.startsWith('turn/general/') || relPath.startsWith('instant/general/')) {
            key = `General/${baseName}`;
        } else if (relPath.startsWith('turn/nation/') || relPath.startsWith('instant/nation/')) {
            key = `Nation/${baseName}`;
        }
        if (!filterCommandKey(key)) {
            continue;
        }
        const text = await fs.readFile(file, 'utf-8');
        const entries = extractTsLogs(file, text);
        const filtered = entries
            .filter((entry) => shouldIncludeTsEntry(entry))
            .map((entry) => ({
                file: path.relative(ROOT_DIR, file),
                line: entry.line,
                template: entry.template,
                raw: entry.raw,
                category: entry.category,
                scope: entry.scope,
            }));

        if (filtered.length === 0) {
            continue;
        }
        logsByKey.set(key, filtered);
    }

    return logsByKey;
};

const buildReport = (phpLogs, tsLogs) => {
    const keys = new Set([...phpLogs.keys(), ...tsLogs.keys()]);
    const sortedKeys = [...keys].sort();

    const missingInTs = [];
    const missingInPhp = [];
    const mismatches = [];
    const matches = [];

    for (const key of sortedKeys) {
        const phpEntries = phpLogs.get(key) ?? [];
        const tsEntries = tsLogs.get(key) ?? [];
        if (phpEntries.length === 0) {
            missingInPhp.push(key);
            continue;
        }
        if (tsEntries.length === 0) {
            missingInTs.push(key);
            continue;
        }

        const phpSet = new Set(phpEntries.map((entry) => normalizeTemplate(entry.template)));
        const tsSet = new Set(tsEntries.map((entry) => normalizeTemplate(entry.template)));

        const missing = [...phpSet].filter((item) => !tsSet.has(item));
        const extra = [...tsSet].filter((item) => !phpSet.has(item));
        if (missing.length === 0 && extra.length === 0) {
            matches.push(key);
        } else {
            mismatches.push({ key, phpEntries, tsEntries, missing, extra });
        }
    }

    return {
        totals: {
            phpCommands: phpLogs.size,
            tsCommands: tsLogs.size,
            sharedCommands: keys.size - missingInPhp.length - missingInTs.length,
            matches: matches.length,
            mismatches: mismatches.length,
        },
        missingInTs,
        missingInPhp,
        mismatches,
    };
};

const main = async () => {
    const phpLogs = await loadPhpLogs();
    const tsLogs = await loadTsLogs();
    const report = buildReport(phpLogs, tsLogs);

    if (asJson) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    console.log(`Compare command logs (mode: ${mode}, strict: ${strict ? 'on' : 'off'}, keepDate: ${keepDate ? 'on' : 'off'})`);
    console.log(`PHP commands: ${report.totals.phpCommands}`);
    console.log(`TS commands: ${report.totals.tsCommands}`);
    console.log(`Matched commands: ${report.totals.matches}`);
    console.log(`Mismatched commands: ${report.totals.mismatches}`);
    console.log(`Missing in TS: ${report.missingInTs.length}`);
    console.log(`Missing in PHP: ${report.missingInPhp.length}`);

    if (report.missingInTs.length > 0) {
        console.log('\nMissing in TS:');
        for (const key of report.missingInTs) {
            console.log(`- ${key}`);
        }
    }

    if (report.missingInPhp.length > 0) {
        console.log('\nMissing in PHP:');
        for (const key of report.missingInPhp) {
            console.log(`- ${key}`);
        }
    }

    if (report.mismatches.length > 0) {
        console.log('\nMismatch Details:');
        for (const mismatch of report.mismatches) {
            console.log(`\n== ${mismatch.key} ==`);
            const phpLines = formatEntries(mismatch.phpEntries);
            const tsLines = formatEntries(mismatch.tsEntries);

            console.log('PHP:');
            for (const line of phpLines) {
                console.log(line);
            }
            console.log('TS:');
            for (const line of tsLines) {
                console.log(line);
            }
        }
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
