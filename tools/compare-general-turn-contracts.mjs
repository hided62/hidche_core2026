import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRefRoot } from './resolve-ref-root.mjs';

const root = process.cwd();
const refRoot = resolveRefRoot(root);
const phpDir = path.join(refRoot, 'hwe/sammo/Command/General');
const tsDir = path.join(root, 'packages/logic/src/actions/turn/general');
const check = process.argv.includes('--check');

const activeAction = new Map([
    ['che_거병', 1],
    ['che_건국', 1],
    ['che_등용수락', 1],
    ['che_랜덤임관', 1],
    ['che_모반시도', 1],
    ['che_무작위건국', 1],
    ['che_방랑', 1],
    ['che_임관', 1],
    ['che_장수대상임관', 1],
    ['che_선양', 1],
    ['che_출병', 1],
    ['che_첩보', 0.5],
    ['che_하야', 1],
    ['cr_건국', 1],
]);

const readSources = async (dir, extension) => {
    const result = new Map();
    for (const name of await fs.readdir(dir)) {
        if (!name.endsWith(extension)) continue;
        const key = name.slice(0, -extension.length);
        if (!(key.startsWith('che_') || key.startsWith('cr_') || key === '휴식')) continue;
        result.set(key, await fs.readFile(path.join(dir, name), 'utf8'));
    }
    return result;
};

const php = await readSources(phpDir, '.php');
const ts = await readSources(tsDir, '.ts');
const handlerSource = await fs.readFile(path.join(root, 'app/game-engine/src/turn/reservedTurnHandler.ts'), 'utf8');

const phpParent = new Map();
for (const [key, source] of php) {
    const classMatch = source.match(/\bclass\s+\S+\s+extends\s+(?:Command\\GeneralCommand|([^\s{]+))/);
    const rawParent = classMatch?.[1];
    if (rawParent) phpParent.set(key, rawParent.split('\\').at(-1));
}

const literalMethod = (source, method) => {
    const match = source.match(
        new RegExp(`function\\s+${method}\\s*\\([^)]*\\)\\s*:[^{]+\\{[\\s\\S]*?return\\s+(-?\\d+(?:\\.\\d+)?)\\s*;`)
    );
    return match ? Number(match[1]) : null;
};

const resolvePhpMethod = (key, method, seen = new Set()) => {
    if (seen.has(key)) return null;
    seen.add(key);
    const source = php.get(key);
    if (!source) return null;
    const own = literalMethod(source, method);
    if (own !== null) return own;
    const parent = phpParent.get(key);
    return parent ? resolvePhpMethod(parent, method, seen) : 0;
};

const tsMethod = (source, method) => {
    const match = source.match(
        new RegExp(`${method}\\s*\\([^)]*\\)\\s*:\\s*number\\s*\\{[\\s\\S]*?return\\s+(-?\\d+(?:\\.\\d+)?)\\s*;`)
    );
    return match ? Number(match[1]) : 0;
};

const missingTs = [...php.keys()].filter((key) => !ts.has(key)).sort();
const extraTs = [...ts.keys()].filter((key) => !php.has(key)).sort();
const timingMismatches = [];
const activeMismatches = [];

for (const key of [...php.keys()].filter((value) => ts.has(value)).sort()) {
    const source = ts.get(key);
    const phpPre = resolvePhpMethod(key, 'getPreReqTurn');
    const phpPost = resolvePhpMethod(key, 'getPostReqTurn');
    const tsPre = tsMethod(source, 'getPreReqTurn');
    const tsPost = tsMethod(source, 'getPostReqTurn');
    if (phpPre !== tsPre || phpPost !== tsPost) {
        timingMismatches.push({ key, php: [phpPre, phpPost], ts: [tsPre, tsPost] });
    }

    const expectedActive = activeAction.get(key) ?? 0;
    const actualActive = tsMethod(source, 'getInheritanceActiveActionAmount');
    if (expectedActive !== actualActive) {
        activeMismatches.push({ key, php: expectedActive, ts: actualActive });
    }
}

const dynamicChecks = [
    {
        key: 'che_인재탐색',
        ok: /inherit_active_action[\s\S]*Math\.max\(Math\.sqrt\(1\s*\/\s*prop\),\s*1\)/.test(
            ts.get('che_인재탐색') ?? ''
        ),
        contract: '성공 시 max(sqrt(1 / 발견확률), 1)',
    },
    {
        key: 'generalCommand RNG seed',
        ok: /kind === 'general' \? 'generalCommand' : 'nationCommand'[\s\S]*currentYear[\s\S]*currentMonth[\s\S]*currentGeneral\.id,[\s\S]*key/.test(
            handlerSource
        ),
        contract: 'hiddenSeed, generalCommand, year, month, generalId, raw command key',
    },
    {
        key: 'preprocess RNG seed',
        ok: /buildSeedBase\(context\.world\),[\s\S]*'preprocess',[\s\S]*currentYear,[\s\S]*currentMonth,[\s\S]*currentGeneral\.id/.test(
            handlerSource
        ),
        contract: 'hiddenSeed, preprocess, year, month, generalId',
    },
    {
        key: 'post-turn myset',
        ok: /const incDefSettingChange = readConfigNumber\(options\.scenarioConfig,\s*'incDefSettingChange',\s*3\);[\s\S]*const maxDefSettingChange = readConfigNumber\(options\.scenarioConfig,\s*'maxDefSettingChange',\s*9\);[\s\S]*myset:\s*Math\.min\(\s*maxDefSettingChange,\s*readMetaNumber\(currentGeneral\.meta,\s*'myset',\s*0\)\s*\+\s*incDefSettingChange/.test(
            handlerSource
        ),
        contract: '매 턴 scenario 증가량/상한 적용 (기본 +3, 상한 9)',
    },
];

console.log(`General command inventory: PHP ${php.size}, TS ${ts.size}`);
console.log(`Missing TS: ${missingTs.length}; Extra TS: ${extraTs.length}`);
console.log(`Timing mismatches: ${timingMismatches.length}`);
console.log(`Active-action mismatches: ${activeMismatches.length}`);
for (const mismatch of timingMismatches) console.log('timing', JSON.stringify(mismatch));
for (const mismatch of activeMismatches) console.log('active', JSON.stringify(mismatch));
for (const item of dynamicChecks) console.log(`dynamic ${item.key}: ${item.ok ? 'ok' : 'missing'} (${item.contract})`);

if (
    check &&
    (missingTs.length > 0 ||
        extraTs.length > 0 ||
        timingMismatches.length > 0 ||
        activeMismatches.length > 0 ||
        dynamicChecks.some((item) => !item.ok))
) {
    process.exitCode = 1;
}
