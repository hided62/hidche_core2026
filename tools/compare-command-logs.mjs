import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript-legacy';

const ROOT_DIR = process.cwd();
const PHP_ROOT = path.join(ROOT_DIR, 'legacy', 'hwe', 'sammo', 'Command');
const TS_ROOT = path.join(ROOT_DIR, 'packages', 'logic', 'src', 'actions');

const DEFAULT_MODE = 'action';
const DEFAULT_EXCLUDE_GUARDS = true;
const DEFAULT_EXCLUDE_TARGET = true;
const DEFAULT_IGNORE_FILE = 'tools/compare-command-logs.ignore.json';

const ARG_HELP = `
Usage: node tools/compare-command-logs.mjs [options]

Options:
    --mode action|history|all   Compare action logs (default), history logs, or all logs.
    --include <regex>           Only include command keys matching regex.
    --include-guards            Include guard/invalid-state logs (default: excluded).
    --include-target            Include target/broadcast logs (default: excluded).
    --count-sensitive           Compare duplicated template counts (default: off).
    --strict                    Compare raw templates without normalization.
    --keep-date                 Keep <1>...</> date markers in normalized output.
    --ignore-file <path>        JSON ignore list file (default: tools/compare-command-logs.ignore.json).
    --checklist                 Output a markdown checklist for mismatches.
    --check                     Exit non-zero when a command is missing or mismatched.
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
const includeGuards = args.includes('--include-guards');
const includeTarget = args.includes('--include-target');
const countSensitive = args.includes('--count-sensitive');
const checklist = args.includes('--checklist');
const check = args.includes('--check');
const ignoreFileIndex = args.indexOf('--ignore-file');
const ignoreFile = ignoreFileIndex >= 0 ? args[ignoreFileIndex + 1] : DEFAULT_IGNORE_FILE;

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

const guardPatterns = [
    /정보를 찾지 못했습니다/,
    /정보가 없습니다/,
    /병종 정보를 확인할 수 없어/,
    /현재 선택할 수 없는 병종입니다/,
    /도시 정보가 없어/,
    /도달할 방법이 없습니다/,
];

const excludeGuards = DEFAULT_EXCLUDE_GUARDS && !includeGuards;
const excludeTarget = DEFAULT_EXCLUDE_TARGET && !includeTarget;

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

        if (ch === "'" || ch === '"') {
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

        if (ch === "'" || ch === '"') {
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
                return { value: text.slice(startIndex, i), endIndex: i + 1, endedBy: ')' };
            }
        } else if (ch === ',' && depth === 0) {
            return { value: text.slice(startIndex, i), endIndex: i + 1, endedBy: ',' };
        }

        i += 1;
    }
    return { value: text.slice(startIndex), endIndex: text.length, endedBy: null };
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

        if (ch === "'" || ch === '"') {
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

        if (ch === "'" || ch === '"') {
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
    if (quote !== "'" && quote !== '"') {
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

const PHP_LOG_METHODS = {
    pushGeneralActionLog: { scope: 'GENERAL', category: 'ACTION', generalMethod: true },
    pushGeneralHistoryLog: { scope: 'GENERAL', category: 'HISTORY', generalMethod: true },
    pushNationalActionLog: { scope: 'NATION', category: 'ACTION', generalMethod: false },
    pushNationalHistoryLog: { scope: 'NATION', category: 'HISTORY', generalMethod: false },
    pushGlobalActionLog: { scope: 'SYSTEM', category: 'ACTION', generalMethod: false },
    pushGlobalHistoryLog: { scope: 'SYSTEM', category: 'HISTORY', generalMethod: false },
};

const findPhpActorGeneralVars = (text) => {
    const vars = new Set();
    const regex = /\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\$this->generalObj\s*;/g;
    while (true) {
        const match = regex.exec(text);
        if (!match) {
            break;
        }
        vars.add(match[1]);
    }
    return vars;
};

const findPhpActorLoggerVars = (text, actorGeneralVars) => {
    const vars = new Set(['logger']);
    const regex =
        /\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\$this->generalObj|\$[A-Za-z_][A-Za-z0-9_]*)\s*->\s*getLogger\s*\(\s*\)\s*;/g;
    while (true) {
        const match = regex.exec(text);
        if (!match) {
            break;
        }
        const lhs = match[1];
        const rhs = match[2];
        if (rhs === '$this->generalObj') {
            vars.add(lhs);
            continue;
        }
        const generalVar = rhs.slice(1);
        if (actorGeneralVars.has(generalVar)) {
            vars.add(lhs);
        }
    }
    return vars;
};

const isPhpActorLoggerExpr = (calleeExpr, actorGeneralVars, actorLoggerVars) => {
    if (!calleeExpr) {
        return false;
    }

    if (calleeExpr.includes('$this->generalObj->getLogger(')) {
        return true;
    }

    for (const actorGeneralVar of actorGeneralVars) {
        if (calleeExpr.includes(`$${actorGeneralVar}->getLogger(`)) {
            return true;
        }
    }

    const variableOnly = calleeExpr.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
    if (variableOnly) {
        return actorLoggerVars.has(variableOnly[1]);
    }

    return false;
};

const extractPhpLogCalls = (text, assignments) => {
    const results = [];
    const lineStarts = buildLineIndex(text);
    const actorGeneralVars = findPhpActorGeneralVars(text);
    const actorLoggerVars = findPhpActorLoggerVars(text, actorGeneralVars);
    const regex =
        /([$\w><:\-\(\)]+)\s*->\s*(pushGeneralActionLog|pushGeneralHistoryLog|pushNationalActionLog|pushNationalHistoryLog|pushGlobalActionLog|pushGlobalHistoryLog)\s*\(/g;

    while (true) {
        const match = regex.exec(text);
        if (!match) {
            break;
        }

        const calleeExpr = match[1]?.trim() ?? '';
        const methodName = match[2];
        const methodMeta = PHP_LOG_METHODS[methodName];
        if (!methodMeta) {
            continue;
        }

        const startIndex = match.index + match[0].length;
        const { value, endIndex, endedBy } = scanToFirstArgumentEnd(text, startIndex);
        let format = null;
        if (endedBy === ',') {
            const rest = text.slice(endIndex);
            const afterComma = endIndex + (rest.match(/^\s*/)?.[0].length ?? 0);
            const { value: secondArg } = scanToParenEnd(text, afterComma);
            const formatMatch = secondArg.match(/ActionLogger::([A-Za-z_]+)/);
            if (formatMatch) {
                format = formatMatch[1];
            }
        }

        const parsed = parsePhpExprToTemplate(value, assignments, match.index);
        const hasGeneralId =
            methodMeta.generalMethod && !isPhpActorLoggerExpr(calleeExpr, actorGeneralVars, actorLoggerVars);

        results.push({
            pos: match.index,
            raw: value.trim(),
            template: parsed.template,
            line: getLineNumber(lineStarts, match.index),
            format,
            category: methodMeta.category,
            scope: methodMeta.scope,
            hasGeneralId,
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
        return { category: null, scope: null, format: null, hasGeneralId: false };
    }

    let category = null;
    let scope = null;
    let format = null;
    let hasGeneralId = false;

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
        if (key === 'format') {
            format = tsEnumValue(prop.initializer, 'LogFormat');
        }
        if (key === 'generalId') {
            hasGeneralId = true;
        }
    }

    return { category, scope, format, hasGeneralId };
};

const renderTsExpr = (expr, resolveConst) => {
    if (!expr) {
        return '${}';
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        return expr.text;
    }
    if (ts.isIdentifier(expr)) {
        const resolved = resolveConst?.(expr.text);
        if (resolved != null) {
            return resolved;
        }
        return '${}';
    }
    if (ts.isTemplateExpression(expr)) {
        let out = expr.head.text;
        for (const span of expr.templateSpans) {
            const inlined = renderTsExpr(span.expression, resolveConst);
            out += inlined === '${}' ? '${}' : inlined;
            out += span.literal.text;
        }
        return out;
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return `${renderTsExpr(expr.left, resolveConst)}${renderTsExpr(expr.right, resolveConst)}`;
    }
    if (ts.isParenthesizedExpression(expr)) {
        return renderTsExpr(expr.expression, resolveConst);
    }
    return '${}';
};

const extractTsLogs = (filePath, text) => {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const constants = new Map();
    const results = [];

    const collectConstants = (node) => {
        if (ts.isVariableStatement(node)) {
            const isConst = node.declarationList.flags & ts.NodeFlags.Const;
            if (isConst) {
                for (const decl of node.declarationList.declarations) {
                    if (!ts.isIdentifier(decl.name) || !decl.initializer) {
                        continue;
                    }
                    if (ts.isStringLiteral(decl.initializer) || ts.isNoSubstitutionTemplateLiteral(decl.initializer)) {
                        constants.set(decl.name.text, decl.initializer.text);
                    }
                }
            }
        }
        ts.forEachChild(node, collectConstants);
    };

    collectConstants(sourceFile);
    const resolveConst = (name) => constants.get(name) ?? null;

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
                    template: renderTsExpr(firstArg, resolveConst),
                    raw: firstArg ? firstArg.getText(sourceFile) : '',
                    line: line + 1,
                    category: info.category,
                    scope: info.scope,
                    format: info.format,
                    hasGeneralId: info.hasGeneralId,
                    isProperty,
                });
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (results.length > 0) {
        return results;
    }

    // Wrapper 파일(event_*.ts)에서 팩토리 호출만 있는 경우 로그를 보완 추출한다.
    const factoryResults = [];
    const visitFactory = (node) => {
        if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
            ts.forEachChild(node, visitFactory);
            return;
        }
        if (node.expression.text !== 'createEventResearchCommand') {
            ts.forEachChild(node, visitFactory);
            return;
        }
        const [arg] = node.arguments;
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
            ts.forEachChild(node, visitFactory);
            return;
        }
        const nameProp = arg.properties.find(
            (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'name'
        );
        if (!nameProp || !ts.isPropertyAssignment(nameProp)) {
            ts.forEachChild(node, visitFactory);
            return;
        }
        const nameExpr = nameProp.initializer;
        if (!ts.isStringLiteral(nameExpr) && !ts.isNoSubstitutionTemplateLiteral(nameExpr)) {
            ts.forEachChild(node, visitFactory);
            return;
        }
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        factoryResults.push(
            {
                kind: 'factory',
                template: '<M>${}</> 완료',
                raw: '`<M>${ACTION_NAME}</> 완료`',
                line: line + 1,
                category: 'ACTION',
                scope: 'GENERAL',
                format: 'MONTH',
                hasGeneralId: false,
                isProperty: false,
            },
            {
                kind: 'factory',
                template: '<M>${}</> 완료',
                raw: '`<M>${ACTION_NAME}</> 완료`',
                line: line + 1,
                category: 'HISTORY',
                scope: 'GENERAL',
                format: 'YEAR_MONTH',
                hasGeneralId: false,
                isProperty: false,
            },
            {
                kind: 'factory',
                template: '<Y>${}</>${} <M>${}</> 완료',
                raw: '`<Y>${generalName}</>${josaYi} <M>${ACTION_NAME}</> 완료`',
                line: line + 1,
                category: 'HISTORY',
                scope: 'NATION',
                format: 'YEAR_MONTH',
                hasGeneralId: false,
                isProperty: false,
            }
        );
        ts.forEachChild(node, visitFactory);
    };
    visitFactory(sourceFile);
    return factoryResults;
};

const normalizeTemplate = (text) => {
    if (strict) {
        return text.trim();
    }
    let out = text;
    if (!keepDate) {
        out = out.replace(/<1>.*?<\/>/g, '');
    }
    out = out.replace(/<\/?b>/g, '');
    out = out.replace(/\{\$\{[^}]*\}[^}]*\}/g, '${}');
    out = out.replace(/\$\{[^}]*\}/g, '${}');
    out = out.replace(/\{\$[A-Za-z_][A-Za-z0-9_]*\}/g, '${}');
    out = out.replace(/\$[A-Za-z_][A-Za-z0-9_]*\b/g, '${}');
    out = out.replace(/\s+/g, ' ').trim();
    return out;
};

const isGuardLog = (template) => guardPatterns.some((pattern) => pattern.test(normalizeTemplate(template)));

const isTargetLog = (entry) => {
    if (!entry) {
        return false;
    }
    return !!entry.hasGeneralId;
};

const loadIgnoreConfig = async () => {
    try {
        const raw = await fs.readFile(path.join(ROOT_DIR, ignoreFile), 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed ?? {};
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
};

const compileIgnoreRules = (config) => {
    const global = config.Global ?? {};
    const normalizeList = (list) => (Array.isArray(list) ? list.map((item) => normalizeTemplate(String(item))) : []);
    const compileRegex = (list) => (Array.isArray(list) ? list.map((item) => new RegExp(String(item))) : []);

    return {
        globalTemplates: new Set(normalizeList(global.templates)),
        globalRegex: compileRegex(global.regex),
        perCommand: new Map(
            Object.entries(config)
                .filter(([key]) => key !== 'Global')
                .map(([key, value]) => [
                    key,
                    {
                        templates: new Set(normalizeList(value?.templates)),
                        regex: compileRegex(value?.regex),
                    },
                ])
        ),
    };
};

const shouldIgnoreTemplate = (key, template, rules) => {
    const normalized = normalizeTemplate(template);
    if (rules.globalTemplates.has(normalized)) {
        return true;
    }
    if (rules.globalRegex.some((regex) => regex.test(normalized))) {
        return true;
    }
    const commandRule = rules.perCommand.get(key);
    if (!commandRule) {
        return false;
    }
    if (commandRule.templates.has(normalized)) {
        return true;
    }
    if (commandRule.regex.some((regex) => regex.test(normalized))) {
        return true;
    }
    return false;
};

const shouldIncludeEntryByMode = (entry) => {
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

const buildTemplateCountMap = (entries) => {
    const map = new Map();
    for (const entry of entries) {
        const template = normalizeTemplate(entry.template);
        map.set(template, (map.get(template) ?? 0) + 1);
    }
    return map;
};

const diffTemplateCounts = (lhsCounts, rhsCounts) => {
    const items = [];
    for (const [template, lhsCount] of lhsCounts.entries()) {
        const rhsCount = rhsCounts.get(template) ?? 0;
        if (lhsCount > rhsCount) {
            items.push({ template, count: lhsCount - rhsCount });
        }
    }
    return items;
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
            category: log.category,
            scope: log.scope,
            format: log.format,
            hasGeneralId: log.hasGeneralId,
        }));
        const filtered = normalized.filter((entry) => {
            if (!shouldIncludeEntryByMode(entry)) {
                return false;
            }
            if (excludeGuards && isGuardLog(entry.template)) {
                return false;
            }
            if (excludeTarget && isTargetLog(entry)) {
                return false;
            }
            return true;
        });
        if (filtered.length === 0) {
            continue;
        }
        logsByKey.set(key, filtered);
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
            .filter((entry) => shouldIncludeEntryByMode(entry))
            .map((entry) => ({
                file: path.relative(ROOT_DIR, file),
                line: entry.line,
                template: entry.template,
                raw: entry.raw,
                category: entry.category,
                scope: entry.scope,
                format: entry.format,
                hasGeneralId: entry.hasGeneralId,
            }));

        const filteredEntries = filtered.filter((entry) => {
            if (excludeGuards && isGuardLog(entry.template)) {
                return false;
            }
            if (excludeTarget && isTargetLog(entry)) {
                return false;
            }
            return true;
        });

        if (filteredEntries.length === 0) {
            continue;
        }
        logsByKey.set(key, filteredEntries);
    }

    return logsByKey;
};

const buildReport = (phpLogs, tsLogs, ignoreRules) => {
    const keys = new Set([...phpLogs.keys(), ...tsLogs.keys()]);
    const sortedKeys = [...keys].sort();

    const missingInTs = [];
    const missingInPhp = [];
    const mismatches = [];
    const matches = [];
    const ignored = [];

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

        const rawMissingDetails = [];
        const rawExtraDetails = [];
        if (countSensitive) {
            const phpCounts = buildTemplateCountMap(phpEntries);
            const tsCounts = buildTemplateCountMap(tsEntries);
            rawMissingDetails.push(...diffTemplateCounts(phpCounts, tsCounts));
            rawExtraDetails.push(...diffTemplateCounts(tsCounts, phpCounts));
        } else {
            const phpSet = new Set(phpEntries.map((entry) => normalizeTemplate(entry.template)));
            const tsSet = new Set(tsEntries.map((entry) => normalizeTemplate(entry.template)));
            for (const template of phpSet) {
                if (!tsSet.has(template)) {
                    rawMissingDetails.push({ template, count: 1 });
                }
            }
            for (const template of tsSet) {
                if (!phpSet.has(template)) {
                    rawExtraDetails.push({ template, count: 1 });
                }
            }
        }

        const missingDetails = rawMissingDetails.filter(
            (item) => !shouldIgnoreTemplate(key, item.template, ignoreRules)
        );
        const extraDetails = rawExtraDetails.filter((item) => !shouldIgnoreTemplate(key, item.template, ignoreRules));
        const ignoredMissingDetails = rawMissingDetails.filter(
            (item) => !missingDetails.some((kept) => kept.template === item.template)
        );
        const ignoredExtraDetails = rawExtraDetails.filter(
            (item) => !extraDetails.some((kept) => kept.template === item.template)
        );

        const missing = missingDetails.map((item) => item.template);
        const extra = extraDetails.map((item) => item.template);
        const ignoredMissing = ignoredMissingDetails.map((item) => item.template);
        const ignoredExtra = ignoredExtraDetails.map((item) => item.template);

        if (missing.length === 0 && extra.length === 0) {
            matches.push(key);
        } else {
            mismatches.push({ key, phpEntries, tsEntries, missing, extra, missingDetails, extraDetails });
        }
        if (ignoredMissing.length > 0 || ignoredExtra.length > 0) {
            ignored.push({
                key,
                missing: ignoredMissing,
                extra: ignoredExtra,
                missingDetails: ignoredMissingDetails,
                extraDetails: ignoredExtraDetails,
            });
        }
    }

    return {
        totals: {
            phpCommands: phpLogs.size,
            tsCommands: tsLogs.size,
            sharedCommands: keys.size - missingInPhp.length - missingInTs.length,
            matches: matches.length,
            mismatches: mismatches.length,
            ignored: ignored.length,
        },
        missingInTs,
        missingInPhp,
        mismatches,
        ignored,
    };
};

const renderChecklist = (report) => {
    const lines = [];
    lines.push(`# Command Log Checklist`);
    lines.push('');
    lines.push(`Mode: ${mode}`);
    lines.push(`Strict: ${strict ? 'on' : 'off'}`);
    lines.push(`Keep date: ${keepDate ? 'on' : 'off'}`);
    lines.push(`Exclude guards: ${excludeGuards ? 'on' : 'off'}`);
    lines.push(`Exclude target: ${excludeTarget ? 'on' : 'off'}`);
    lines.push(`Ignore file: ${ignoreFile}`);
    lines.push('');

    if (report.mismatches.length === 0) {
        lines.push('- [x] All command logs match.');
        return lines.join('\n');
    }

    for (const mismatch of report.mismatches) {
        lines.push(`- [ ] ${mismatch.key}`);
        if (mismatch.missing.length > 0) {
            lines.push(`PHP only: ${mismatch.missing.join(' | ')}`);
        }
        if (mismatch.extra.length > 0) {
            lines.push(`TS only: ${mismatch.extra.join(' | ')}`);
        }
    }
    return lines.join('\n');
};

const main = async () => {
    const phpLogs = await loadPhpLogs();
    const tsLogs = await loadTsLogs();
    const ignoreConfig = await loadIgnoreConfig();
    const ignoreRules = compileIgnoreRules(ignoreConfig);
    const report = buildReport(phpLogs, tsLogs, ignoreRules);

    if (asJson) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log(
            `Compare command logs (mode: ${mode}, strict: ${strict ? 'on' : 'off'}, keepDate: ${keepDate ? 'on' : 'off'}, excludeGuards: ${excludeGuards ? 'on' : 'off'}, excludeTarget: ${excludeTarget ? 'on' : 'off'}, countSensitive: ${countSensitive ? 'on' : 'off'})`
        );
        console.log(`PHP commands: ${report.totals.phpCommands}`);
        console.log(`TS commands: ${report.totals.tsCommands}`);
        console.log(`Matched commands: ${report.totals.matches}`);
        console.log(`Mismatched commands: ${report.totals.mismatches}`);
        console.log(`Missing in TS: ${report.missingInTs.length}`);
        console.log(`Missing in PHP: ${report.missingInPhp.length}`);
        console.log(`Ignored mismatches: ${report.totals.ignored}`);

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
                if (mismatch.missingDetails.length > 0) {
                    console.log(
                        `PHP only: ${mismatch.missingDetails
                            .map((item) => (item.count > 1 ? `${item.template} x${item.count}` : item.template))
                            .join(' | ')}`
                    );
                }
                if (mismatch.extraDetails.length > 0) {
                    console.log(
                        `TS only: ${mismatch.extraDetails
                            .map((item) => (item.count > 1 ? `${item.template} x${item.count}` : item.template))
                            .join(' | ')}`
                    );
                }
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

        if (checklist) {
            console.log('\nChecklist:');
            console.log(renderChecklist(report));
        }
    }
    if (check && (report.totals.mismatches > 0 || report.missingInTs.length > 0 || report.missingInPhp.length > 0)) {
        process.exitCode = 1;
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
