import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LiteHashDRBG, RandUtil, type RNG } from '@sammo-ts/common';
import {
    ITEM_KEYS,
    DOMESTIC_TRAIT_KEYS,
    EVENT_DOMESTIC_TRAIT_KEYS,
    NATION_TRAIT_KEYS,
    PERSONALITY_TRAIT_KEYS,
    WAR_TRAIT_KEYS,
    loadDomesticTraitModules,
    loadItemModules,
    loadNationTraitModules,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    ActionLogger,
    formatLogText,
    LogCategory,
    LogFormat,
    LogScope,
    type LogEntryDraft,
    type UnitSetDefinition,
    type WarBattleOutcome,
    type WarBattleTraceEvent,
    type WarBattleTraceUnitSnapshot,
    type WarEngineConfig,
} from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import { processBattleSimJob } from '../../../app/game-api/src/battleSim/processor.js';
import { convertLog } from '../../../app/game-api/src/battleSim/logFormatter.js';
import type {
    BattleSimGeneralPayload,
    BattleSimJobPayload,
    BattleSimRequestPayload,
} from '../../../app/game-api/src/battleSim/types.js';

interface ReferenceTrace {
    engine: 'ref';
    seed: string;
    fixtureIdentity: FixtureIdentity;
    conquered: boolean;
    attacker: WarBattleTraceEvent['attacker'];
    city: WarBattleTraceEvent['city'];
    finishedDefenders: WarBattleTraceEvent['attacker'][];
    defenderOrder?: {
        before: Array<{ id: number; order: number }>;
        after: Array<{ id: number; order: number }>;
    };
    events: WarBattleTraceEvent[];
    rng: RandomCall[];
    boolRng: BoolRandomCall[];
    logs: {
        attacker: ReferenceLogBuckets;
        defenders: Record<string, ReferenceLogBuckets>;
        city: ReferenceLogBuckets;
    };
}

interface FixtureIdentity {
    schemaVersion: 1;
    seed: string;
    sha256: string;
}

interface BoolRandomCall {
    rngSeq: number;
    probability: number;
    result: boolean;
}

interface ReferenceLogBuckets {
    generalHistoryLog: string[];
    generalActionLog: string[];
    generalBattleResultLog: string[];
    generalBattleDetailLog: string[];
    nationalHistoryLog: string[];
    globalHistoryLog: string[];
    globalActionLog: string[];
}

interface CapturedCoreLogger {
    generalId?: number;
    nationId?: number;
    entries: LogEntryDraft[];
}

interface CoreLogCapture {
    loggerFactory: (options: { generalId?: number; nationId?: number }) => ActionLogger;
    byGeneralId: Map<number, CapturedCoreLogger>;
    city: CapturedCoreLogger | null;
}

class ComparisonCapturingActionLogger extends ActionLogger {
    public constructor(
        options: { generalId?: number; nationId?: number },
        private readonly capture: (entries: LogEntryDraft[]) => void
    ) {
        super(options);
    }

    public override flush(): LogEntryDraft[] {
        const entries = super.flush();
        this.capture(entries);
        return entries;
    }

    public override rollback(): LogEntryDraft[] {
        const entries = super.rollback();
        this.capture(entries);
        return entries;
    }
}

const createCoreLogCapture = (): CoreLogCapture => {
    const capture: CoreLogCapture = {
        byGeneralId: new Map(),
        city: null,
        loggerFactory: () => {
            throw new Error('loggerFactory is not initialized');
        },
    };
    capture.loggerFactory = (options) => {
        const bucket: CapturedCoreLogger = { ...options, entries: [] };
        if (options.generalId === undefined) {
            if (capture.city) {
                throw new Error('battle comparison created more than one city logger');
            }
            capture.city = bucket;
        } else {
            if (capture.byGeneralId.has(options.generalId)) {
                throw new Error(`battle comparison duplicated general logger ${options.generalId}`);
            }
            capture.byGeneralId.set(options.generalId, bucket);
        }
        return new ComparisonCapturingActionLogger(options, (entries) => bucket.entries.push(...entries));
    };
    return capture;
};

interface RandomCall {
    seq: number;
    operation: string;
    arguments: Record<string, unknown>;
    result: unknown;
}

interface ReferenceItemMetadata {
    rawName: string;
    name: string;
    info: string;
    cost: number | null;
    buyable: boolean;
    consumable: boolean;
    reqSecu: number;
}

type ReferenceTraitCatalog = Record<
    'nation' | 'domestic' | 'war' | 'personality',
    Record<string, { name: string; info: string }>
>;

class TracingRng implements RNG {
    public readonly calls: RandomCall[] = [];
    public readonly boolCalls: BoolRandomCall[] = [];

    public constructor(private readonly inner: RNG) {}

    public getMaxInt(): number {
        return this.inner.getMaxInt();
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        const result = this.inner.nextBytes(bytes);
        this.record('nextBytes', { bytes }, Buffer.from(result).toString('hex'));
        return result;
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        const result = this.inner.nextBits(bits);
        this.record('nextBits', { bits }, Buffer.from(result).toString('hex'));
        return result;
    }

    public nextInt(max?: number): number {
        const result = this.inner.nextInt(max);
        this.record('nextInt', { maxInclusive: max ?? null }, result);
        return result;
    }

    public nextFloat1(): number {
        const result = this.inner.nextFloat1();
        this.record('nextFloat1', {}, result);
        return result;
    }

    public createRandUtil(): RandUtil {
        const calls = this.calls;
        const boolCalls = this.boolCalls;
        return new (class extends RandUtil {
            public override nextBool(probability: number = 0.5): boolean {
                const rngSeq = calls.length;
                const result = super.nextBool(probability);
                boolCalls.push({ rngSeq, probability, result });
                return result;
            }
        })(this);
    }

    private record(operation: string, args: Record<string, unknown>, result: unknown): void {
        this.calls.push({ seq: this.calls.length, operation, arguments: args, result });
    }
}

const findWorkspaceRoot = (start: string): string | null => {
    let current = path.resolve(start);
    while (true) {
        if (
            fs.existsSync(path.join(current, 'docker_compose_files/reference/compose.yml')) &&
            fs.existsSync(path.join(current, 'ref/sam/hwe/compare/battle_trace.php'))
        ) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const assertFixtureGeneralCityContract = (fixtureJson: string, label = 'battle fixture'): FixtureIdentity => {
    const normalizedFixtureJson = fixtureJson.trim();
    const fixture = JSON.parse(normalizedFixtureJson) as unknown;
    if (!isRecord(fixture)) {
        throw new Error(`${label}: fixture root must be an object`);
    }

    const assertSide = (side: 'attacker' | 'defender', general: unknown, city: unknown, index?: number): void => {
        const suffix = index === undefined ? '' : `[${index}]`;
        if (!isRecord(general) || !isRecord(city)) {
            throw new Error(`${label}: ${side}${suffix} general/city must be objects`);
        }
        const generalCity = general['city'];
        const currentCity = city['city'];
        if (!Number.isSafeInteger(generalCity) || (generalCity as number) <= 0) {
            throw new Error(`${label}: ${side}General${suffix}.city must be an explicit positive integer`);
        }
        if (!Number.isSafeInteger(currentCity) || (currentCity as number) <= 0) {
            throw new Error(`${label}: ${side}City.city must be a positive integer`);
        }
        if (generalCity !== currentCity) {
            throw new Error(
                `${label}: ${side}General${suffix}.city=${String(generalCity)} must equal current city ${String(currentCity)}`
            );
        }
    };

    assertSide('attacker', fixture['attackerGeneral'], fixture['attackerCity']);
    const defenderCity = fixture['defenderCity'];
    const rawDefenders = fixture['defenderGenerals'];
    const defenders = Array.isArray(rawDefenders)
        ? rawDefenders
        : isRecord(rawDefenders)
          ? Object.values(rawDefenders)
          : null;
    if (!defenders) {
        throw new Error(`${label}: defenderGenerals must be an array or ID-keyed object`);
    }
    defenders.forEach((general, index) => assertSide('defender', general, defenderCity, index));

    const seed = typeof fixture['seed'] === 'string' ? fixture['seed'] : 'battle-differential';
    return {
        schemaVersion: 1,
        seed,
        sha256: sha256(normalizedFixtureJson),
    };
};

const assertReferenceFixtureIdentity = (
    reference: ReferenceTrace,
    fixtureJson: string,
    label = 'reference trace'
): void => {
    const expected = assertFixtureGeneralCityContract(fixtureJson, label);
    expect(reference.fixtureIdentity, `${label}: fixture identity`).toEqual(expected);
    expect(reference.seed, `${label}: seed`).toBe(expected.seed);
};

const referenceRuntimeCopyFilter = (resolvedCompareRoot: string, source: string): boolean => {
    const relative = path.relative(resolvedCompareRoot, source);
    return !(
        relative === '.git' ||
        relative.startsWith(`.git${path.sep}`) ||
        relative === 'vendor' ||
        relative.startsWith(`vendor${path.sep}`) ||
        relative === 'd_log' ||
        relative.startsWith(`d_log${path.sep}`) ||
        relative === path.join('hwe', 'd_setting') ||
        relative.startsWith(`${path.join('hwe', 'd_setting')}${path.sep}`)
    );
};

const assertSafeDockerNetworkName = (network: string): string => {
    if (!/^[A-Za-z0-9_.-]+$/u.test(network)) {
        throw new Error('Reference Docker network name contains unsupported characters.');
    }
    return network;
};

const resolveReferenceDockerNetwork = (workspaceRoot: string): string => {
    const explicitNetwork = process.env['REF_COMPARE_NETWORK'];
    if (explicitNetwork) {
        const network = assertSafeDockerNetworkName(explicitNetwork);
        try {
            const resolved = execFileSync('docker', ['network', 'inspect', '--format', '{{.Name}}', network], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }).trim();
            if (resolved !== network) {
                throw new Error('network identity mismatch');
            }
            return network;
        } catch {
            throw new Error('REF_COMPARE_NETWORK does not identify an available Docker network.');
        }
    }

    const composeDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    try {
        const phpContainerId = execFileSync('docker', ['compose', 'ps', '-q', 'php'], {
            cwd: composeDirectory,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        if (!phpContainerId || !/^[a-f0-9]+$/u.test(phpContainerId)) {
            throw new Error('reference php container is unavailable');
        }
        const networks = execFileSync(
            'docker',
            [
                'inspect',
                '--format',
                '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}',
                phpContainerId,
            ],
            {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        )
            .split(/\r?\n/u)
            .map((entry) => entry.trim())
            .filter(Boolean);
        if (networks.length !== 1) {
            throw new Error('reference php container must have exactly one discoverable network');
        }
        return assertSafeDockerNetworkName(networks[0]!);
    } catch {
        throw new Error(
            'Unable to discover the official reference Compose network. Start that stack or set REF_COMPARE_NETWORK explicitly.'
        );
    }
};

const runReferenceSourceScript = (options: {
    workspaceRoot: string;
    compareSourceRoot: string;
    script: string;
    args?: string[];
    input?: string;
    maxBuffer?: number;
}): string => {
    const resolvedCompareRoot = path.resolve(options.compareSourceRoot);
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sammo-ref-compare-'));
    fs.cpSync(resolvedCompareRoot, runtimeRoot, {
        recursive: true,
        filter: (source) => referenceRuntimeCopyFilter(resolvedCompareRoot, source),
    });
    fs.mkdirSync(path.join(runtimeRoot, 'd_log'));
    try {
        const network = resolveReferenceDockerNetwork(options.workspaceRoot);
        try {
            return execFileSync(
                'docker',
                [
                    'run',
                    '--rm',
                    '-i',
                    '--network',
                    network,
                    '-v',
                    `${runtimeRoot}:/var/www/html`,
                    '-v',
                    `${path.join(options.workspaceRoot, 'ref/sam/vendor')}:/var/www/html/vendor:ro`,
                    '-v',
                    `${path.join(options.workspaceRoot, 'ref/sam/hwe/d_setting')}:/var/www/html/hwe/d_setting:ro`,
                    'sam-rebuild-ref-php:8.3',
                    'php',
                    '-d',
                    'display_errors=0',
                    '-d',
                    'log_errors=0',
                    `/var/www/html/${options.script}`,
                    ...(options.args ?? []),
                ],
                {
                    input: options.input,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
                }
            );
        } catch (error) {
            const failure = error as { status?: number | null; stderr?: string | Buffer };
            const stderr = String(failure.stderr ?? '')
                .replace(/\s+/gu, ' ')
                .trim()
                .slice(0, 500);
            // Intentionally omit the raw child-process error as the cause: it
            // retains prior JSONL stdout and can expose a huge fixture corpus.
            // eslint-disable-next-line preserve-caught-error
            throw new Error(
                `reference comparison script failed (exit ${String(failure.status ?? 'unknown')})${stderr ? `: ${stderr}` : ''}`
            );
        }
    } finally {
        fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
};

const runReferenceTrace = (workspaceRoot: string, fixtureJson: string): ReferenceTrace => {
    assertFixtureGeneralCityContract(fixtureJson);
    const compareContainer = process.env.REF_COMPARE_CONTAINER;
    if (compareContainer) {
        const stdout = execFileSync(
            'docker',
            [
                'exec',
                '-i',
                compareContainer,
                'php',
                '-d',
                'error_reporting=8191',
                '/var/www/html/hwe/compare/battle_trace.php',
                '-',
            ],
            {
                input: fixtureJson,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        );
        const reference = JSON.parse(stdout) as ReferenceTrace;
        assertReferenceFixtureIdentity(reference, fixtureJson);
        return reference;
    }
    const compareSourceRoot = process.env.REF_COMPARE_SOURCE_ROOT;
    if (compareSourceRoot) {
        const stdout = runReferenceSourceScript({
            workspaceRoot,
            compareSourceRoot,
            script: 'hwe/compare/battle_trace.php',
            args: ['-'],
            input: fixtureJson,
        });
        const reference = JSON.parse(stdout) as ReferenceTrace;
        assertReferenceFixtureIdentity(reference, fixtureJson);
        return reference;
    }
    const stdout = execFileSync(
        'docker',
        ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/battle_trace.php', '-'],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            input: fixtureJson,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    const reference = JSON.parse(stdout) as ReferenceTrace;
    assertReferenceFixtureIdentity(reference, fixtureJson);
    return reference;
};

interface BattleReferenceManifest {
    schemaVersion: 1;
    fixtureCount: number;
    fixtureJsonlSha256: string;
    traceCount: number;
    traceJsonlSha256: string;
}

const normalizeJsonlForManifest = (lines: string[]): string => `${lines.map((line) => line.trim()).join('\n')}\n`;

const readBoundPrecomputedTraces = (tracePath: string, fixtureLines: string[]): ReferenceTrace[] => {
    const resolvedTracePath = path.resolve(tracePath);
    const rawTraceJsonl = fs.readFileSync(resolvedTracePath, 'utf8');
    const traceLines = rawTraceJsonl.split(/\r?\n/u).filter(Boolean);
    const manifestPath = path.resolve(
        process.env['BATTLE_REFERENCE_MANIFEST_PATH'] ?? `${resolvedTracePath}.manifest.json`
    );
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            'BATTLE_REFERENCE_TRACE_PATH requires BATTLE_REFERENCE_MANIFEST_PATH or a sibling .manifest.json file.'
        );
    }
    const manifest = readJson<BattleReferenceManifest>(manifestPath);
    if (manifest.schemaVersion !== 1) {
        throw new Error('Unsupported battle reference manifest schemaVersion.');
    }
    if (traceLines.length !== fixtureLines.length) {
        throw new Error(`precomputed ref corpus has ${traceLines.length} traces for ${fixtureLines.length} fixtures`);
    }
    const expectedFixtureJsonl = normalizeJsonlForManifest(fixtureLines);
    const checks: Array<[string, unknown, unknown]> = [
        ['fixtureCount', manifest.fixtureCount, fixtureLines.length],
        ['traceCount', manifest.traceCount, traceLines.length],
        ['fixtureJsonlSha256', manifest.fixtureJsonlSha256, sha256(expectedFixtureJsonl)],
        ['traceJsonlSha256', manifest.traceJsonlSha256, sha256(rawTraceJsonl)],
    ];
    for (const [label, actual, expected] of checks) {
        if (actual !== expected) {
            throw new Error(`battle reference manifest ${label} mismatch`);
        }
    }

    const traces = traceLines.map((line) => JSON.parse(line) as ReferenceTrace);
    traces.forEach((trace, index) => assertReferenceFixtureIdentity(trace, fixtureLines[index]!, `trace[${index}]`));
    return traces;
};

const runReferenceTraceBatch = (workspaceRoot: string, fixtureLines: string[]): ReferenceTrace[] => {
    fixtureLines.forEach((line, index) => assertFixtureGeneralCityContract(line, `fixture[${index}]`));
    const precomputedTracePath = process.env.BATTLE_REFERENCE_TRACE_PATH;
    if (precomputedTracePath) {
        return readBoundPrecomputedTraces(precomputedTracePath, fixtureLines);
    }
    const compareContainer = process.env.REF_COMPARE_CONTAINER;
    if (compareContainer) {
        const stdout = execFileSync(
            'docker',
            [
                'exec',
                '-i',
                compareContainer,
                'php',
                '-d',
                'error_reporting=8191',
                '/var/www/html/hwe/compare/battle_trace.php',
                '--jsonl',
            ],
            {
                input: `${fixtureLines.join('\n')}\n`,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                maxBuffer: 512 * 1024 * 1024,
            }
        );
        const traces = stdout
            .split(/\r?\n/u)
            .filter(Boolean)
            .map((line) => JSON.parse(line) as ReferenceTrace);
        if (traces.length !== fixtureLines.length) {
            throw new Error(`ref batch returned ${traces.length} traces for ${fixtureLines.length} fixtures`);
        }
        traces.forEach((trace, index) =>
            assertReferenceFixtureIdentity(trace, fixtureLines[index]!, `container trace[${index}]`)
        );
        return traces;
    }
    const compareSourceRoot = process.env.REF_COMPARE_SOURCE_ROOT;
    if (!compareSourceRoot) {
        const stdout = execFileSync(
            'docker',
            ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/battle_trace.php', '--jsonl'],
            {
                cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
                input: normalizeJsonlForManifest(fixtureLines),
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                maxBuffer: 512 * 1024 * 1024,
            }
        );
        const traces = stdout
            .split(/\r?\n/u)
            .filter(Boolean)
            .map((line) => JSON.parse(line) as ReferenceTrace);
        if (traces.length !== fixtureLines.length) {
            throw new Error(`ref batch returned ${traces.length} traces for ${fixtureLines.length} fixtures`);
        }
        traces.forEach((trace, index) =>
            assertReferenceFixtureIdentity(trace, fixtureLines[index]!, `compose trace[${index}]`)
        );
        return traces;
    }
    const stdout = runReferenceSourceScript({
        workspaceRoot,
        compareSourceRoot,
        script: 'hwe/compare/battle_trace.php',
        args: ['--jsonl'],
        input: normalizeJsonlForManifest(fixtureLines),
        maxBuffer: 512 * 1024 * 1024,
    });
    const traces = stdout
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ReferenceTrace);
    if (traces.length !== fixtureLines.length) {
        throw new Error(`ref batch returned ${traces.length} traces for ${fixtureLines.length} fixtures`);
    }
    traces.forEach((trace, index) =>
        assertReferenceFixtureIdentity(trace, fixtureLines[index]!, `source trace[${index}]`)
    );
    return traces;
};

const runReferenceItemCatalog = (workspaceRoot: string, itemKeys: string[]): Record<string, ReferenceItemMetadata> => {
    const compareSourceRoot = process.env.REF_COMPARE_SOURCE_ROOT;
    if (compareSourceRoot) {
        const stdout = runReferenceSourceScript({
            workspaceRoot,
            compareSourceRoot,
            script: 'hwe/compare/item_catalog.php',
            input: JSON.stringify(itemKeys),
        });
        return JSON.parse(stdout) as Record<string, ReferenceItemMetadata>;
    }
    const stdout = execFileSync(
        'docker',
        ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/item_catalog.php'],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            input: JSON.stringify(itemKeys),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as Record<string, ReferenceItemMetadata>;
};

const runReferenceTraitCatalog = (workspaceRoot: string): ReferenceTraitCatalog => {
    const compareSourceRoot = process.env.REF_COMPARE_SOURCE_ROOT;
    if (compareSourceRoot) {
        const stdout = runReferenceSourceScript({
            workspaceRoot,
            compareSourceRoot,
            script: 'hwe/compare/trait_catalog.php',
        });
        return JSON.parse(stdout) as ReferenceTraitCatalog;
    }
    const stdout = execFileSync(
        'docker',
        ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/trait_catalog.php'],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as ReferenceTraitCatalog;
};

const expectNearlyEqual = (actual: unknown, expected: unknown, label: string): void => {
    expect(typeof actual, `${label}: actual type`).toBe('number');
    expect(typeof expected, `${label}: reference type`).toBe('number');
    const actualNumber = actual as number;
    const expectedNumber = expected as number;
    expect(Number.isFinite(actualNumber), `${label}: actual must be finite`).toBe(true);
    expect(Number.isFinite(expectedNumber), `${label}: reference must be finite`).toBe(true);
    if (Number.isSafeInteger(actualNumber) && Number.isSafeInteger(expectedNumber)) {
        expect(actualNumber, `${label}: integer battle parity`).toBe(expectedNumber);
        return;
    }
    const tolerance = Math.max(
        Number.EPSILON * Math.max(1, Math.abs(expectedNumber)) * 16,
        Math.abs(expectedNumber) * 1e-12,
        1e-12
    );
    expect(
        Math.abs(actualNumber - expectedNumber),
        `${label}: core=${String(actualNumber)}, ref=${String(expectedNumber)}, tolerance=${tolerance}`
    ).toBeLessThanOrEqual(tolerance);
};

const isCanonicalEmptyMapPath = (label: string): boolean =>
    label.endsWith('.activatedSkills') || label.endsWith('.details');

const normalizeCanonicalEmptyMap = (value: unknown, label: string): unknown => {
    if (isCanonicalEmptyMapPath(label) && Array.isArray(value) && value.length === 0) {
        return {};
    }
    return value;
};

const assertCanonicalValue = (rawActual: unknown, rawExpected: unknown, label: string): void => {
    const actual = normalizeCanonicalEmptyMap(rawActual, label);
    const expected = normalizeCanonicalEmptyMap(rawExpected, label);
    if (typeof actual === 'number' || typeof expected === 'number') {
        expectNearlyEqual(actual, expected, label);
        return;
    }
    if (Array.isArray(actual) || Array.isArray(expected)) {
        expect(Array.isArray(actual), `${label}: core array type`).toBe(true);
        expect(Array.isArray(expected), `${label}: ref array type`).toBe(true);
        const actualArray = actual as unknown[];
        const expectedArray = expected as unknown[];
        expect(actualArray.length, `${label}: array length`).toBe(expectedArray.length);
        for (let index = 0; index < expectedArray.length; index += 1) {
            assertCanonicalValue(actualArray[index], expectedArray[index], `${label}[${index}]`);
        }
        return;
    }
    if (isRecord(actual) || isRecord(expected)) {
        expect(isRecord(actual), `${label}: core object type`).toBe(true);
        expect(isRecord(expected), `${label}: ref object type`).toBe(true);
        const actualObject = actual as Record<string, unknown>;
        const expectedObject = expected as Record<string, unknown>;
        const actualKeys = Object.keys(actualObject)
            .filter((key) => actualObject[key] !== undefined)
            .sort();
        const expectedKeys = Object.keys(expectedObject)
            .filter((key) => expectedObject[key] !== undefined)
            .sort();
        expect(actualKeys, `${label}: object keys`).toEqual(expectedKeys);
        for (const key of expectedKeys) {
            assertCanonicalValue(actualObject[key], expectedObject[key], `${label}.${key}`);
        }
        return;
    }
    expect(actual, label).toBe(expected);
};

const buildCapturedLogBuckets = (
    capture: CapturedCoreLogger | null | undefined,
    year: number,
    month: number
): ReferenceLogBuckets => {
    const buckets: ReferenceLogBuckets = {
        generalHistoryLog: [],
        generalActionLog: [],
        generalBattleResultLog: [],
        generalBattleDetailLog: [],
        nationalHistoryLog: [],
        globalHistoryLog: [],
        globalActionLog: [],
    };
    for (const entry of capture?.entries ?? []) {
        const text = formatLogText(entry.text, entry.format ?? LogFormat.RAWTEXT, year, month);
        if (entry.scope === LogScope.GENERAL) {
            switch (entry.category) {
                case LogCategory.HISTORY:
                    buckets.generalHistoryLog.push(text);
                    break;
                case LogCategory.ACTION:
                    buckets.generalActionLog.push(text);
                    break;
                case LogCategory.BATTLE_BRIEF:
                    buckets.generalBattleResultLog.push(text);
                    break;
                case LogCategory.BATTLE_DETAIL:
                    buckets.generalBattleDetailLog.push(text);
                    break;
                default:
                    break;
            }
        } else if (entry.scope === LogScope.NATION && entry.category === LogCategory.HISTORY) {
            buckets.nationalHistoryLog.push(text);
        } else if (entry.scope === LogScope.SYSTEM && entry.category === LogCategory.HISTORY) {
            buckets.globalHistoryLog.push(text);
        } else if (entry.scope === LogScope.SYSTEM && entry.category === LogCategory.SUMMARY) {
            buckets.globalActionLog.push(text);
        }
    }
    return buckets;
};

const assertAllLogBucketsParity = (
    capture: CoreLogCapture,
    reference: ReferenceTrace,
    fixture: BattleSimRequestPayload,
    label: string
): void => {
    assertCanonicalValue(
        buildCapturedLogBuckets(capture.byGeneralId.get(fixture.attackerGeneral.no), fixture.year, fixture.month),
        reference.logs.attacker,
        `${label}.logs.attacker`
    );
    for (const defender of fixture.defenderGenerals) {
        assertCanonicalValue(
            buildCapturedLogBuckets(capture.byGeneralId.get(defender.no), fixture.year, fixture.month),
            reference.logs.defenders[String(defender.no)] ?? {
                generalHistoryLog: [],
                generalActionLog: [],
                generalBattleResultLog: [],
                generalBattleDetailLog: [],
                nationalHistoryLog: [],
                globalHistoryLog: [],
                globalActionLog: [],
            },
            `${label}.logs.defenders.${defender.no}`
        );
    }
    assertCanonicalValue(
        buildCapturedLogBuckets(capture.city, fixture.year, fixture.month),
        reference.logs.city,
        `${label}.logs.city`
    );
};

const normalizeRandomArguments = (value: Record<string, unknown>): Record<string, unknown> =>
    Array.isArray(value) && value.length === 0 ? {} : value;

const describeTextDifference = (actual: string | undefined, expected: string): string => {
    const actualText = actual ?? '';
    let index = 0;
    while (index < actualText.length && index < expected.length && actualText[index] === expected[index]) {
        index += 1;
    }
    const start = Math.max(0, index - 80);
    const end = index + 160;
    return `offset=${index} core=${JSON.stringify(actualText.slice(start, end))} ref=${JSON.stringify(expected.slice(start, end))}`;
};

const normalizeCapturedDefenders = (
    fixtureLine: string,
    defenders: BattleSimGeneralPayload[] | Record<string, BattleSimGeneralPayload>
): BattleSimGeneralPayload[] => {
    if (Array.isArray(defenders)) {
        return defenders;
    }
    // JSON.parse enumerates integer-like object keys numerically, but PHP's
    // associative array preserves their source order. Recover that order for
    // old Ref corpus lines so stable sort ties replay the same defenders.
    const source = /"defenderGenerals":\{([\s\S]*?)\},"defenderCity":/u.exec(fixtureLine)?.[1];
    if (!source) {
        return Object.values(defenders);
    }
    const ids = [...source.matchAll(/"(\d+)":\{/gu)].map((match) => match[1]!);
    return ids.map((id) => defenders[id]).filter((general): general is BattleSimGeneralPayload => Boolean(general));
};

const assertRngParity = (reference: ReferenceTrace, coreRng: TracingRng | null): void => {
    const normalizedCoreRng =
        coreRng?.calls.map(({ seq, operation, arguments: args, result }) => ({
            seq,
            operation,
            arguments: normalizeRandomArguments(args),
            result,
        })) ?? [];
    const normalizedReferenceRng = reference.rng.map(({ seq, operation, arguments: args, result }) => ({
        seq,
        operation,
        arguments: normalizeRandomArguments(args),
        result,
    }));
    assertCanonicalValue(normalizedCoreRng, normalizedReferenceRng, 'rng');
    assertCanonicalValue(coreRng?.boolCalls ?? [], reference.boolRng, 'boolRng');
};

const assertTraceParity = (
    coreEvents: WarBattleTraceEvent[],
    reference: ReferenceTrace,
    coreRng: TracingRng | null,
    coreOutcome: WarBattleOutcome | null
): void => {
    const defenderOrderEvent = coreEvents[0]?.event === 'defender_order' ? coreEvents[0] : null;
    const comparableCoreEvents = (defenderOrderEvent ? coreEvents.slice(1) : coreEvents).map((event, seq) => ({
        ...event,
        // Core emits one comparison-only defender_order event before the Ref
        // processWar_NG sequence. Renumber only the canonical shared sequence.
        seq,
    }));
    if (reference.defenderOrder) {
        // Ref retains non-participating (order <= 0) defenders at the tail and
        // stops when it reaches them. Core discards them before sorting. The
        // effective ordered defender sequence is otherwise the same.
        const effectiveReferenceOrder = {
            before: reference.defenderOrder.before.filter(({ order }) => order > 0),
            after: reference.defenderOrder.after.filter(({ order }) => order > 0),
        };
        const coreOrder = defenderOrderEvent?.details as typeof effectiveReferenceOrder | undefined;
        expect(
            coreOrder?.before.map(({ id }) => id),
            'defender order before IDs'
        ).toEqual(effectiveReferenceOrder.before.map(({ id }) => id));
        expect(
            coreOrder?.after.map(({ id }) => id),
            'defender order after IDs'
        ).toEqual(effectiveReferenceOrder.after.map(({ id }) => id));
        for (const side of ['before', 'after'] as const) {
            for (let index = 0; index < effectiveReferenceOrder[side].length; index += 1) {
                expectNearlyEqual(
                    coreOrder?.[side][index]?.order,
                    effectiveReferenceOrder[side][index]?.order,
                    `defender order ${side}[${index}]`
                );
            }
        }
    }
    assertRngParity(reference, coreRng);
    assertCanonicalValue(comparableCoreEvents, reference.events, 'events');
    assertFinalOutcomeParity(coreOutcome, coreEvents, reference);
};

const outcomeMetaNumber = (general: WarBattleOutcome['attacker'], key: string): number => {
    const value = general.meta[key];
    return typeof value === 'number' ? value : 0;
};

const buildOutcomeGeneralSnapshot = (
    transient: WarBattleTraceUnitSnapshot,
    general: WarBattleOutcome['attacker'],
    report: WarBattleOutcome['reports'][number],
    activatedSkills: Record<string, number>
): WarBattleTraceUnitSnapshot => ({
    ...transient,
    kind: 'general',
    id: general.id,
    name: general.name,
    isAttacker: report.isAttacker,
    crewTypeId: general.crewTypeId,
    phase: report.phase ?? transient.phase,
    hp: general.crew,
    killed: report.killed,
    dead: report.dead,
    activatedSkills,
    general: {
        crew: general.crew,
        rice: general.rice,
        train: general.train,
        atmos: general.atmos,
        injury: general.injury,
        experience: general.experience,
        dedication: general.dedication,
        dex1: outcomeMetaNumber(general, 'dex1'),
        dex2: outcomeMetaNumber(general, 'dex2'),
        dex3: outcomeMetaNumber(general, 'dex3'),
        dex4: outcomeMetaNumber(general, 'dex4'),
        dex5: outcomeMetaNumber(general, 'dex5'),
    },
});

const assertFinalOutcomeParity = (
    coreOutcome: WarBattleOutcome | null,
    coreEvents: WarBattleTraceEvent[],
    reference: ReferenceTrace
): void => {
    expect(coreOutcome, 'comparison onBattleResolved callback').not.toBeNull();
    if (!coreOutcome) {
        return;
    }
    const finalEvent = coreEvents.at(-1);
    expect(finalEvent?.event, 'final battle trace event').toBe('battle_end');
    if (!finalEvent) {
        return;
    }

    const attackerReport = coreOutcome.reports.find(
        (report) => report.type === 'general' && report.id === coreOutcome.attacker.id && report.isAttacker
    );
    const cityReport = coreOutcome.reports.find(
        (report) => report.type === 'city' && report.id === coreOutcome.defenderCity.id
    );
    expect(attackerReport, 'final attacker report').toBeDefined();
    expect(cityReport, 'final city report').toBeDefined();
    if (!attackerReport || !cityReport) {
        return;
    }

    const latestDefenderSnapshots = new Map<number, WarBattleTraceUnitSnapshot>();
    for (const event of coreEvents) {
        if (event.defender?.kind === 'general') {
            latestDefenderSnapshots.set(event.defender.id, event.defender);
        }
    }
    const metrics = coreOutcome.metrics;
    const coreAttacker = buildOutcomeGeneralSnapshot(
        finalEvent.attacker,
        coreOutcome.attacker,
        attackerReport,
        metrics?.attackerActivatedSkills ?? {}
    );
    const coreCity: WarBattleTraceUnitSnapshot = {
        ...finalEvent.city,
        kind: 'city',
        id: coreOutcome.defenderCity.id,
        name: coreOutcome.defenderCity.name,
        isAttacker: cityReport.isAttacker,
        phase: cityReport.phase ?? finalEvent.city.phase,
        killed: cityReport.killed,
        dead: cityReport.dead,
        cityState: {
            defence: coreOutcome.defenderCity.defence,
            wall: coreOutcome.defenderCity.wall,
            population: coreOutcome.defenderCity.population,
        },
    };
    const coreFinishedDefenders = reference.finishedDefenders.map((expectedSnapshot) => {
        if (expectedSnapshot.kind === 'city') {
            return coreCity;
        }
        const defenderIndex = coreOutcome.defenders.findIndex((general) => general.id === expectedSnapshot.id);
        expect(defenderIndex, `final defender ${expectedSnapshot.id} exists`).toBeGreaterThanOrEqual(0);
        const general = coreOutcome.defenders[defenderIndex];
        const orderedDefenderReports = coreOutcome.reports.filter(
            (candidate) => candidate.type === 'general' && !candidate.isAttacker
        );
        const metricIndex = orderedDefenderReports.findIndex((candidate) => candidate.id === expectedSnapshot.id);
        const report = metricIndex >= 0 ? orderedDefenderReports[metricIndex] : undefined;
        const transient = latestDefenderSnapshots.get(expectedSnapshot.id);
        expect(general, `final defender ${expectedSnapshot.id} state`).toBeDefined();
        expect(report, `final defender ${expectedSnapshot.id} report`).toBeDefined();
        expect(transient, `final defender ${expectedSnapshot.id} transient snapshot`).toBeDefined();
        if (!general || !report || !transient) {
            return expectedSnapshot;
        }
        return buildOutcomeGeneralSnapshot(
            transient,
            general,
            report,
            metrics?.defenderActivatedSkills[metricIndex] ?? {}
        );
    });

    assertCanonicalValue(
        {
            conquered: coreOutcome.conquered,
            attacker: coreAttacker,
            city: coreCity,
            finishedDefenders: coreFinishedDefenders,
        },
        {
            conquered: reference.conquered,
            attacker: reference.attacker,
            city: reference.city,
            finishedDefenders: reference.finishedDefenders,
        },
        'finalOutcome'
    );
};

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findWorkspaceRoot(process.cwd());
if (process.env.TURN_DIFFERENTIAL_REFERENCE === '1' && !workspaceRoot) {
    throw new Error(
        'TURN_DIFFERENTIAL_REFERENCE=1 requires TURN_DIFFERENTIAL_WORKSPACE_ROOT when running outside the workspace tree.'
    );
}
const describeWithReference = workspaceRoot ? describe : describe.skip;

const battleCorpusPath = process.env.BATTLE_CORPUS_PATH;
const itWithBattleCorpus = battleCorpusPath ? it : it.skip;

describeWithReference('ref ↔ core2026 battle differential', () => {
    it('rejects battle fixtures whose general current-city contract is missing or inconsistent', () => {
        const fixture = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        const missingCity = structuredClone(fixture) as BattleSimRequestPayload & {
            attackerGeneral: BattleSimGeneralPayload & { city?: number };
        };
        delete missingCity.attackerGeneral.city;
        expect(() => assertFixtureGeneralCityContract(JSON.stringify(missingCity), 'missing-city')).toThrow(
            'attackerGeneral.city must be an explicit positive integer'
        );

        const wrongDefenderCity = structuredClone(fixture);
        wrongDefenderCity.defenderGenerals[0]!.city = fixture.attackerCity.city;
        expect(() => assertFixtureGeneralCityContract(JSON.stringify(wrongDefenderCity), 'wrong-city')).toThrow(
            'defenderGeneral[0].city=1 must equal current city 2'
        );
    });

    itWithBattleCorpus(
        'replays a captured battle corpus with matching trace, RNG, full outcome, and all log buckets [conditional: BATTLE_CORPUS_PATH]',
        { timeout: 600_000 },
        () => {
            const requestedLimit = Number.parseInt(process.env.BATTLE_CORPUS_LIMIT ?? '', 10);
            const fixtureLines = fs
                .readFileSync(path.resolve(battleCorpusPath!), 'utf8')
                .split(/\r?\n/u)
                .filter(Boolean)
                .slice(0, Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined);
            expect(fixtureLines.length, 'captured fixture count').toBeGreaterThan(0);

            const referenceTraces = runReferenceTraceBatch(workspaceRoot!, fixtureLines);
            const unitSet = readJson<UnitSetDefinition>(
                path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
            );
            const config: WarEngineConfig = {
                armPerPhase: 500,
                maxTrainByCommand: 100,
                maxAtmosByCommand: 100,
                maxTrainByWar: 110,
                maxAtmosByWar: 150,
                castleCrewTypeId: 1000,
                armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
            };
            const failures: string[] = [];
            const categoryCounts = new Map<string, number>();
            const recordFailure = (
                category: string,
                index: number,
                fixture: BattleSimRequestPayload,
                detail: string
            ) => {
                categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
                if (failures.length < 40) {
                    failures.push(
                        `${category} fixture=${index + 1} ${fixture.year}-${String(fixture.month).padStart(2, '0')} attacker=${fixture.attackerGeneral.no} city=${fixture.defenderCity.city}: ${detail}`
                    );
                }
            };

            for (let index = 0; index < fixtureLines.length; index += 1) {
                const capturedFixture = JSON.parse(fixtureLines[index]!) as Omit<
                    BattleSimRequestPayload,
                    'defenderGenerals'
                > & {
                    defenderGenerals: BattleSimGeneralPayload[] | Record<string, BattleSimGeneralPayload>;
                    startYear: number;
                    scenarioEffect?: string | null;
                };
                // Older captured Ref lines preserved numeric general IDs as
                // JSON object keys. New captures are arrays, but normalize the
                // historical corpus without changing its iteration order.
                const fixture: BattleSimRequestPayload & {
                    startYear: number;
                    scenarioEffect?: string | null;
                } = {
                    ...capturedFixture,
                    defenderGenerals: normalizeCapturedDefenders(
                        fixtureLines[index]!,
                        capturedFixture.defenderGenerals
                    ),
                };
                const reference = referenceTraces[index]!;
                const coreEvents: WarBattleTraceEvent[] = [];
                const coreLogs = createCoreLogCapture();
                let coreRng: TracingRng | null = null;
                let coreOutcome: WarBattleOutcome | null = null;
                const coreResult = processBattleSimJob(
                    {
                        ...fixture,
                        unitSet,
                        config,
                        time: { year: fixture.year, month: fixture.month, startYear: fixture.startYear },
                        scenarioEffect: fixture.scenarioEffect,
                    },
                    {
                        trace: (event) => coreEvents.push(event),
                        loggerFactory: coreLogs.loggerFactory,
                        onBattleResolved: (outcome) => {
                            coreOutcome = outcome;
                        },
                        rngFactory: (seed) => {
                            coreRng = new TracingRng(LiteHashDRBG.build(seed));
                            return coreRng.createRandUtil();
                        },
                    }
                );

                try {
                    assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
                } catch (error) {
                    recordFailure('trace', index, fixture, error instanceof Error ? error.message : String(error));
                }

                try {
                    assertAllLogBucketsParity(coreLogs, reference, fixture, `fixture[${index}]`);
                } catch (error) {
                    recordFailure('logs', index, fixture, error instanceof Error ? error.message : String(error));
                }

                const expectedBrief = convertLog(reference.logs.attacker.generalBattleResultLog.join('<br>'));
                const expectedDetail = convertLog(reference.logs.attacker.generalBattleDetailLog.join('<br>'));
                if (coreResult.lastWarLog?.generalBattleResultLog !== expectedBrief) {
                    recordFailure(
                        'brief-log',
                        index,
                        fixture,
                        describeTextDifference(coreResult.lastWarLog?.generalBattleResultLog, expectedBrief)
                    );
                }
                if (coreResult.lastWarLog?.generalBattleDetailLog !== expectedDetail) {
                    recordFailure(
                        'detail-log',
                        index,
                        fixture,
                        describeTextDifference(coreResult.lastWarLog?.generalBattleDetailLog, expectedDetail)
                    );
                }
            }

            const summary = {
                fixtures: fixtureLines.length,
                failuresByCategory: Object.fromEntries([...categoryCounts.entries()].sort()),
                sampledFailures: failures,
            };
            process.stdout.write(`BATTLE_CORPUS_SUMMARY ${JSON.stringify(summary)}\n`);
            expect(failures, JSON.stringify(summary, null, 2)).toEqual([]);
        }
    );

    it('matches all scenario effects across general, direct-city, and fresh-defender combat', () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const cases: Array<{
            name: string;
            effect: string;
            directCity?: boolean;
            multipleDefenders?: boolean;
        }> = [
            { name: 'unlimited-general', effect: 'event_UnlimitedDefenceThresholdChange' },
            { name: 'strong-general', effect: 'event_StrongAttacker' },
            { name: 'more-general', effect: 'event_MoreEffect' },
            { name: 'strong-city', effect: 'event_StrongAttacker', directCity: true },
            { name: 'more-city', effect: 'event_MoreEffect', directCity: true },
            { name: 'strong-fresh-defender', effect: 'event_StrongAttacker', multipleDefenders: true },
        ];

        for (const entry of cases) {
            const base = readJson<BattleSimRequestPayload & { startYear: number; scenarioEffect?: string }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-scenario-${entry.name}`;
            base.scenarioEffect = entry.effect;
            base.attackerGeneral.crew = entry.multipleDefenders ? 5000 : 3000;
            if (entry.directCity) {
                base.defenderGenerals = [];
            }
            if (entry.multipleDefenders) {
                base.defenderGenerals[0]!.crew = 1;
            }
            if (entry.multipleDefenders) {
                base.defenderGenerals.push({
                    ...base.defenderGenerals[0]!,
                    no: 3,
                    name: '새 수비자',
                    crew: 1200,
                    leadership: 1,
                    strength: 1,
                    intel: 1,
                });
            }

            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            const coreResult = processBattleSimJob(
                {
                    ...base,
                    unitSet,
                    config,
                    time: { year: base.year, month: base.month, startYear: base.startYear },
                    scenarioEffect: entry.effect,
                },
                {
                    trace: (event) => coreEvents.push(event),
                    onBattleResolved: (outcome) => {
                        coreOutcome = outcome;
                    },
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return coreRng.createRandUtil();
                    },
                }
            );

            try {
                const reference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
                assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
                const opponentSwitches = coreEvents.filter((event) => event.event === 'opponent_switched');
                if (entry.directCity) {
                    expect(
                        coreEvents.some(
                            (event) => event.event === 'opponent_initialized' && event.defender?.kind === 'city'
                        ),
                        `${entry.name}: must execute direct city combat`
                    ).toBe(true);
                }
                if (entry.multipleDefenders) {
                    expect(
                        opponentSwitches.some((event) => event.defender?.kind === 'general' && event.defender.id === 3),
                        `${entry.name}: must transition to the fresh defender`
                    ).toBe(true);
                    const switchedIndex = coreEvents.findIndex(
                        (event) =>
                            event.event === 'opponent_switched' &&
                            event.defender?.kind === 'general' &&
                            event.defender.id === 3
                    );
                    const maxPhaseBeforeAdvance = coreEvents[switchedIndex]!.attacker.maxPhase;
                    expect(
                        coreEvents
                            .slice(switchedIndex + 1)
                            .some(
                                (event) =>
                                    event.event === 'phase_triggered' &&
                                    event.attacker.maxPhase === maxPhaseBeforeAdvance + 1
                            ),
                        `${entry.name}: advance trigger must extend attacker phases after the switch`
                    ).toBe(true);
                    expect(reference.logs.attacker.generalBattleDetailLog).toContain(
                        '<C>●</>적군의 전멸에 <C>진격</>이 이어집니다!'
                    );
                    expect(reference.logs.defenders['3']?.generalBattleDetailLog).toContain(
                        '<C>●</>아군의 전멸에 상대의 <R>진격</>이 이어집니다!'
                    );
                    expect(coreResult.lastWarLog?.generalBattleDetailLog).toContain(
                        '적군의 전멸에 <span style="color: cyan;">진격</span>이 이어집니다!'
                    );
                }
            } catch (error) {
                throw new Error(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`, {
                    cause: error,
                });
            }
        }
    });

    it('matches every legacy trait name and description', async () => {
        const reference = runReferenceTraitCatalog(workspaceRoot!);
        const [nation, domestic, war, personality] = await Promise.all([
            loadNationTraitModules([...NATION_TRAIT_KEYS]),
            loadDomesticTraitModules([...DOMESTIC_TRAIT_KEYS]),
            loadWarTraitModules([...WAR_TRAIT_KEYS]),
            loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS]),
        ]);
        const groups = { nation, domestic, war, personality };
        const failures: string[] = [];
        for (const [kind, modules] of Object.entries(groups) as Array<
            [keyof ReferenceTraitCatalog, Array<{ key: string; name: string; info: string }>]
        >) {
            expect(modules.map((module) => module.key).sort()).toEqual(Object.keys(reference[kind]).sort());
            for (const module of modules) {
                const actual = { name: module.name, info: module.info };
                if (JSON.stringify(actual) !== JSON.stringify(reference[kind][module.key])) {
                    failures.push(
                        `${kind}/${module.key}: core=${JSON.stringify(actual)} ref=${JSON.stringify(reference[kind][module.key])}`
                    );
                }
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('matches every event-domestic, war, personality, and nation trait in battle', { timeout: 180_000 }, () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const cases = [
            ...EVENT_DOMESTIC_TRAIT_KEYS.map((key) => ({
                kind: 'eventDomestic' as const,
                key,
            })),
            ...WAR_TRAIT_KEYS.map((key) => ({ kind: 'war' as const, key })),
            ...PERSONALITY_TRAIT_KEYS.map((key) => ({ kind: 'personality' as const, key })),
            ...NATION_TRAIT_KEYS.map((key) => ({ kind: 'nation' as const, key })),
            {
                kind: 'dualSlot' as const,
                key: 'che_event_무쌍+che_무쌍',
                special: 'che_event_무쌍',
                special2: 'che_무쌍',
            },
            {
                kind: 'dualSlot' as const,
                key: 'che_event_견고+che_견고',
                special: 'che_event_견고',
                special2: 'che_견고',
            },
        ];

        const executions: Array<{
            entry: (typeof cases)[number];
            base: BattleSimRequestPayload & { startYear: number };
            coreEvents: WarBattleTraceEvent[];
            coreRng: TracingRng | null;
            coreOutcome: WarBattleOutcome | null;
        }> = [];
        for (const entry of cases) {
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-trait-${entry.kind}-${entry.key}`;
            base.attackerGeneral.crew = 5000;
            base.attackerGeneral.leadership = 90;
            base.attackerGeneral.strength = 85;
            base.attackerGeneral.intel = 80;
            base.attackerGeneral.special =
                entry.kind === 'dualSlot' ? entry.special : entry.kind === 'eventDomestic' ? entry.key : 'None';
            base.attackerGeneral.special2 =
                entry.kind === 'dualSlot' ? entry.special2 : entry.kind === 'war' ? entry.key : 'None';
            base.attackerGeneral.personal = entry.kind === 'personality' ? entry.key : 'None';
            if (entry.kind === 'nation') {
                base.attackerNation.type = entry.key;
            }

            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            processBattleSimJob(
                {
                    ...base,
                    unitSet,
                    config,
                    time: { year: base.year, month: base.month, startYear: base.startYear },
                },
                {
                    trace: (event) => coreEvents.push(event),
                    onBattleResolved: (outcome) => {
                        coreOutcome = outcome;
                    },
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return coreRng.createRandUtil();
                    },
                }
            );
            executions.push({ entry, base, coreEvents, coreRng, coreOutcome });
        }

        const references = runReferenceTraceBatch(
            workspaceRoot!,
            executions.map(({ base }) => JSON.stringify(base))
        );
        executions.forEach(({ entry, coreEvents, coreRng, coreOutcome }, index) => {
            try {
                assertTraceParity(coreEvents, references[index]!, coreRng, coreOutcome);
            } catch (error) {
                throw new Error(
                    `${entry.kind}/${entry.key}: ${error instanceof Error ? error.message : String(error)}`,
                    {
                        cause: error,
                    }
                );
            }
        });
    });

    it('loads every scenario item with the scenario slot', async () => {
        const scenarioDir = path.resolve(process.cwd(), '../../resources/scenario');
        const itemSlots = new Map<string, 'horse' | 'weapon' | 'book' | 'item'>();
        for (const filename of fs.readdirSync(scenarioDir).filter((entry) => entry.endsWith('.json'))) {
            const scenario = readJson<{
                const?: {
                    allItems?: Partial<Record<'horse' | 'weapon' | 'book' | 'item', Record<string, number>>>;
                };
            }>(path.join(scenarioDir, filename));
            for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
                for (const itemKey of Object.keys(scenario.const?.allItems?.[slot] ?? {})) {
                    itemSlots.set(itemKey, slot);
                }
            }
        }

        const modules = await loadItemModules([...ITEM_KEYS]);
        const reference = runReferenceItemCatalog(workspaceRoot!, [...ITEM_KEYS]);
        expect(modules).toHaveLength(145);
        const failures: string[] = [];
        for (const module of modules) {
            const actual = {
                rawName: module.rawName,
                name: module.name,
                info: module.info,
                cost: module.cost,
                buyable: module.buyable,
                consumable: module.consumable,
                reqSecu: module.reqSecu,
            };
            if (
                module.slot !== itemSlots.get(module.key) ||
                module.unique !== !reference[module.key]?.buyable ||
                JSON.stringify(actual) !== JSON.stringify(reference[module.key])
            ) {
                failures.push(
                    `${module.key}: slot=${module.slot}/${String(itemSlots.get(module.key))} unique=${String(module.unique)}/${String(!reference[module.key]?.buyable)} core=${JSON.stringify(actual)} ref=${JSON.stringify(reference[module.key])}`
                );
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('matches the legacy non-stacking rule for the 무쌍 trait item', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-duplicate-musang';
        base.attackerGeneral.personal = 'None';
        base.attackerGeneral.special2 = 'che_무쌍';
        base.attackerGeneral.item = 'event_전투특기_무쌍';
        base.attackerGeneral.crew = 5000;
        base.attackerGeneral.leadership = 90;
        base.attackerGeneral.strength = 90;
        base.attackerGeneral.intel = 90;
        base.attackerGeneral.dex1 = 12000;
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        const coreLogs = createCoreLogCapture();
        let coreRng: TracingRng | null = null;
        let coreOutcome: WarBattleOutcome | null = null;
        processBattleSimJob(
            {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            },
            {
                trace: (event) => coreEvents.push(event),
                loggerFactory: coreLogs.loggerFactory,
                onBattleResolved: (outcome) => {
                    coreOutcome = outcome;
                },
                rngFactory: (seed) => {
                    coreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return coreRng.createRandUtil();
                },
            }
        );
        const reference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
        assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
        assertAllLogBucketsParity(coreLogs, reference, base, 'trait-item.non-stacking-musang');

        const runFirstPhasePower = (fixture: BattleSimRequestPayload & { startYear: number }): number => {
            const events: WarBattleTraceEvent[] = [];
            processBattleSimJob(
                {
                    ...fixture,
                    unitSet,
                    config,
                    time: { year: fixture.year, month: fixture.month, startYear: fixture.startYear },
                },
                { trace: (event) => events.push(event) }
            );
            const firstPhase = events.find((event) => event.event === 'phase_power');
            expect(firstPhase, '무쌍 first phase power').toBeDefined();
            return firstPhase!.attacker.rawWarPower;
        };
        const combinedPower = coreEvents.find((event) => event.event === 'phase_power')!.attacker.rawWarPower;
        const traitOnly = structuredClone(base);
        traitOnly.attackerGeneral.item = 'None';
        const itemOnly = structuredClone(base);
        itemOnly.attackerGeneral.special2 = 'None';
        const control = structuredClone(itemOnly);
        control.attackerGeneral.item = 'None';
        expect(combinedPower, 'duplicate 무쌍 does not stack over trait').toBe(runFirstPhasePower(traitOnly));
        expect(combinedPower, 'duplicate 무쌍 does not stack over item').toBe(runFirstPhasePower(itemOnly));
        expect(combinedPower, '무쌍 has a real battle effect').not.toBe(runFirstPhasePower(control));
    });

    it('matches 척사 items against region-restricted troops', () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };

        for (const itemKey of ['che_척사_오악진형도', 'event_전투특기_척사']) {
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-region-item-${itemKey}`;
            base.attackerGeneral.personal = 'None';
            base.attackerGeneral.special2 = 'None';
            base.attackerGeneral.item = itemKey;
            base.attackerGeneral.crew = 5000;
            base.defenderGenerals[0]!.crewtype = 1101;
            const coreEvents: WarBattleTraceEvent[] = [];
            const coreLogs = createCoreLogCapture();
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            processBattleSimJob(
                {
                    ...base,
                    unitSet,
                    config,
                    time: { year: base.year, month: base.month, startYear: base.startYear },
                },
                {
                    trace: (event) => coreEvents.push(event),
                    loggerFactory: coreLogs.loggerFactory,
                    onBattleResolved: (outcome) => {
                        coreOutcome = outcome;
                    },
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return coreRng.createRandUtil();
                    },
                }
            );
            const reference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
            assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
            assertAllLogBucketsParity(coreLogs, reference, base, `item.${itemKey}.region-opponent`);

            const control = structuredClone(base);
            control.attackerGeneral.item = 'None';
            const controlEvents: WarBattleTraceEvent[] = [];
            processBattleSimJob(
                {
                    ...control,
                    unitSet,
                    config,
                    time: { year: control.year, month: control.month, startYear: control.startYear },
                },
                { trace: (event) => controlEvents.push(event) }
            );
            const itemPower = coreEvents.find((event) => event.event === 'phase_power')?.attacker.rawWarPower;
            const controlPower = controlEvents.find((event) => event.event === 'phase_power')?.attacker.rawWarPower;
            expect(itemPower, `${itemKey}: region troop effect is observed`).not.toBe(controlPower);
        }
    });

    it('matches the complete canonical event, RNG, state, and logger snapshots', () => {
        const fixturePath = path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json');
        const fixtureJson = fs.readFileSync(fixturePath, 'utf8');
        const request = JSON.parse(fixtureJson) as BattleSimRequestPayload & { startYear: number };
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const castleCrewTypeId = 1000;
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId,
            armTypes: {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
                siege: 5,
                misc: 6,
                castle: unitSet.crewTypes?.find((crewType) => crewType.id === castleCrewTypeId)?.armType ?? 0,
            },
        };
        const payload: BattleSimJobPayload = {
            ...request,
            unitSet,
            config,
            time: { year: request.year, month: request.month, startYear: request.startYear },
        };

        const coreEvents: WarBattleTraceEvent[] = [];
        const coreLogs = createCoreLogCapture();
        let coreRng: TracingRng | null = null;
        let coreOutcome: WarBattleOutcome | null = null;
        const coreResult = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            loggerFactory: coreLogs.loggerFactory,
            onBattleResolved: (outcome) => {
                coreOutcome = outcome;
            },
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return coreRng.createRandUtil();
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(coreResult.result).toBe(true);
        assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
        assertAllLogBucketsParity(coreLogs, reference, request, 'basic-infantry');
    });

    it('matches officer levels 1-4 in assigned and off-city battles on both sides', () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const cases: Array<{
            role: 'attacker' | 'defender';
            level: number;
            assigned: boolean;
            fixture: BattleSimRequestPayload & { startYear: number };
        }> = [];
        for (const role of ['attacker', 'defender'] as const) {
            for (const level of [1, 2, 3, 4]) {
                for (const assigned of [true, false]) {
                    const fixture = readJson<BattleSimRequestPayload & { startYear: number }>(
                        path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
                    );
                    fixture.seed = `battle-differential-officer-${role}-${level}-${assigned ? 'assigned' : 'off-city'}`;
                    const general = role === 'attacker' ? fixture.attackerGeneral : fixture.defenderGenerals[0]!;
                    const counterpart = role === 'attacker' ? fixture.defenderGenerals[0]! : fixture.attackerGeneral;
                    const currentCity = role === 'attacker' ? fixture.attackerCity.city : fixture.defenderCity.city;
                    const counterpartCity = role === 'attacker' ? fixture.defenderCity.city : fixture.attackerCity.city;
                    general.officer_level = level;
                    general.officer_city = assigned ? currentCity : currentCity + 1000;
                    // Keep the opposite unit neutral so the subject officer's attack/defence
                    // multiplier is observable without the counterpart's level-3 5% modifier.
                    counterpart.officer_level = 1;
                    counterpart.officer_city = counterpartCity;
                    cases.push({ role, level, assigned, fixture });
                }
            }
        }

        const fixtureLines = cases.map(({ fixture }) => JSON.stringify(fixture));
        const references = runReferenceTraceBatch(workspaceRoot!, fixtureLines);
        const officerSignatures = new Map<string, string>();
        cases.forEach(({ role, level, assigned, fixture }, index) => {
            const coreEvents: WarBattleTraceEvent[] = [];
            const coreLogs = createCoreLogCapture();
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            processBattleSimJob(
                {
                    ...fixture,
                    unitSet,
                    config,
                    time: { year: fixture.year, month: fixture.month, startYear: fixture.startYear },
                },
                {
                    trace: (event) => coreEvents.push(event),
                    loggerFactory: coreLogs.loggerFactory,
                    onBattleResolved: (outcome) => {
                        coreOutcome = outcome;
                    },
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return coreRng.createRandUtil();
                    },
                }
            );
            const reference = references[index]!;
            const label = `officer.${role}.level${level}.${assigned ? 'assigned' : 'off-city'}`;
            assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
            assertAllLogBucketsParity(coreLogs, reference, fixture, label);
            const phasePower = coreEvents.find((event) => event.event === 'phase_power');
            const snapshot = role === 'attacker' ? phasePower?.attacker : phasePower?.defender;
            const counterpartSnapshot = role === 'attacker' ? phasePower?.defender : phasePower?.attacker;
            expect(snapshot?.kind, `${label}: participating general`).toBe('general');
            expect(counterpartSnapshot?.kind, `${label}: counterpart general`).toBe('general');
            officerSignatures.set(
                `${role}-${level}-${assigned}`,
                JSON.stringify({
                    subjectRawWarPower: snapshot!.rawWarPower,
                    counterpartWarPowerMultiplier: counterpartSnapshot!.warPowerMultiplier,
                })
            );
        });

        for (const role of ['attacker', 'defender'] as const) {
            expect(officerSignatures.get(`${role}-1-true`), `${role}: level 1 ignores assignment`).toBe(
                officerSignatures.get(`${role}-1-false`)
            );
            for (const level of [2, 3, 4]) {
                expect(
                    officerSignatures.get(`${role}-${level}-false`),
                    `${role}: off-city level ${level} falls back`
                ).toBe(officerSignatures.get(`${role}-1-true`));
                expect(
                    officerSignatures.get(`${role}-${level}-true`),
                    `${role}: assigned level ${level} keeps the officer battle signature`
                ).not.toBe(officerSignatures.get(`${role}-${level}-false`));
            }
        }
    });

    it('matches every distinct CHE crew battle signature on attacker and defender paths', { timeout: 180_000 }, () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const crewTypes = unitSet.crewTypes ?? [];
        const signatures = crewTypes.map((crewType) =>
            JSON.stringify({
                armType: crewType.armType,
                attack: crewType.attack,
                defence: crewType.defence,
                speed: crewType.speed,
                avoid: crewType.avoid,
                magicCoef: crewType.magicCoef,
                rice: crewType.rice,
                attackCoef: crewType.attackCoef,
                defenceCoef: crewType.defenceCoef,
                iActionList: crewType.iActionList,
                initSkillTrigger: crewType.initSkillTrigger,
                phaseSkillTrigger: crewType.phaseSkillTrigger,
            })
        );
        expect(new Set(signatures).size, 'unitset_che distinct battle signatures').toBe(crewTypes.length);

        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const cases: Array<{
            role: 'attacker' | 'defender';
            crewTypeId: number;
            fixture: BattleSimRequestPayload & { startYear: number };
        }> = [];
        const crewFilter = process.env.CREW_PARITY_FILTER;
        const crewRoleFilter = process.env.CREW_PARITY_ROLE;
        for (const crewType of crewTypes.filter((entry) => entry.id !== config.castleCrewTypeId)) {
            if (crewFilter && String(crewType.id) !== crewFilter) {
                continue;
            }
            for (const role of ['attacker', 'defender'] as const) {
                if (crewRoleFilter && role !== crewRoleFilter) {
                    continue;
                }
                // In the official assertion-enabled Ref image, attacker-side
                // 정란/벽력거 routes the castle first and then the castle's
                // general-only phase trigger aborts. Their distinct phase skill
                // remains covered on the defender path; the Ref runtime defect is
                // documented as an explicit remaining boundary.
                if (role === 'attacker' && (crewType.id === 1500 || crewType.id === 1502)) {
                    continue;
                }
                const fixture = readJson<BattleSimRequestPayload & { startYear: number }>(
                    path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
                );
                fixture.seed = `battle-differential-crew-${role}-${crewType.id}`;
                // Keep every synthetic pairing in general-vs-general combat for the
                // whole phase budget. City combat is covered separately and the Ref
                // castle unit intentionally carries a general-only phase assertion.
                fixture.attackerGeneral.crew = 50000;
                fixture.attackerGeneral.rice = 1000000;
                fixture.attackerGeneral.leadership = 90;
                fixture.attackerGeneral.strength = 90;
                fixture.attackerGeneral.intel = 90;
                fixture.defenderGenerals[0]!.crew = 50000;
                fixture.defenderGenerals[0]!.rice = 1000000;
                fixture.defenderGenerals[0]!.leadership = 85;
                fixture.defenderGenerals[0]!.strength = 85;
                fixture.defenderGenerals[0]!.intel = 85;
                fixture.defenderCity.def = 400;
                fixture.defenderCity.wall = 400;
                fixture.defenderCity.def_max = 400;
                fixture.defenderCity.wall_max = 400;
                const general = role === 'attacker' ? fixture.attackerGeneral : fixture.defenderGenerals[0]!;
                general.crewtype = crewType.id;
                general.dex1 = 12000;
                general.dex2 = 12000;
                general.dex3 = 12000;
                general.dex4 = 12000;
                general.dex5 = 12000;
                cases.push({ role, crewTypeId: crewType.id, fixture });
            }
        }

        const fixtureLines = cases.map(({ fixture }) => JSON.stringify(fixture));
        const references = runReferenceTraceBatch(workspaceRoot!, fixtureLines);
        cases.forEach(({ role, crewTypeId, fixture }, index) => {
            const coreEvents: WarBattleTraceEvent[] = [];
            const coreLogs = createCoreLogCapture();
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            processBattleSimJob(
                {
                    ...fixture,
                    unitSet,
                    config,
                    time: { year: fixture.year, month: fixture.month, startYear: fixture.startYear },
                },
                {
                    trace: (event) => coreEvents.push(event),
                    loggerFactory: coreLogs.loggerFactory,
                    onBattleResolved: (outcome) => {
                        coreOutcome = outcome;
                    },
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return coreRng.createRandUtil();
                    },
                }
            );
            const reference = references[index]!;
            const label = `crew.${role}.${crewTypeId}`;
            try {
                assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
                assertAllLogBucketsParity(coreLogs, reference, fixture, label);
            } catch (error) {
                const debug =
                    process.env.CREW_PARITY_DEBUG === '1'
                        ? ` coreEvents=${JSON.stringify(coreEvents.map((event) => [event.seq, event.event, event.attacker.phase, event.defender?.phase, event.defender?.activatedSkills]))} refEvents=${JSON.stringify(reference.events.map((event) => [event.seq, event.event, event.attacker.phase, event.defender?.phase, event.defender?.activatedSkills]))}`
                        : '';
                throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}${debug}`, {
                    cause: error,
                });
            }

            if (role === 'defender' && (crewTypeId === 1500 || crewTypeId === 1502)) {
                expect(
                    coreEvents.some((event) => (event.defender?.activatedSkills['선제'] ?? 0) > 0),
                    `${label}: 정란/벽력거 선제사격 must activate`
                ).toBe(true);
            }
            if (role === 'defender' && crewTypeId === 1503) {
                expect(
                    coreEvents.some((event) => (event.defender?.activatedSkills['저지'] ?? 0) > 0),
                    `${label}: 목우 저지 must activate for the fixed seed`
                ).toBe(true);
            }
        });
    });

    it(
        'matches the five basic arm-type matrix and wizard probabilities with Ref defaults',
        { timeout: 180_000 },
        () => {
            const unitSet = readJson<UnitSetDefinition>(
                path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
            );
            const config: WarEngineConfig = {
                armPerPhase: 500,
                maxTrainByCommand: 100,
                maxAtmosByCommand: 100,
                maxTrainByWar: 110,
                maxAtmosByWar: 150,
                castleCrewTypeId: 1000,
                armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
            };
            const basicCrews = [
                { id: 1100, armType: 1, label: 'footman' },
                { id: 1200, armType: 2, label: 'archer' },
                { id: 1300, armType: 3, label: 'cavalry' },
                { id: 1400, armType: 4, label: 'wizard' },
                { id: 1501, armType: 5, label: 'siege' },
            ] as const;
            for (const expected of basicCrews) {
                expect(
                    unitSet.crewTypes?.find(({ id }) => id === expected.id)?.armType,
                    `${expected.label} arm type`
                ).toBe(expected.armType);
            }

            const cases: Array<{
                attacker: (typeof basicCrews)[number];
                defender: (typeof basicCrews)[number];
                fixture: BattleSimRequestPayload & { startYear: number };
            }> = [];
            for (const attacker of basicCrews) {
                for (const defender of basicCrews) {
                    const fixture = readJson<BattleSimRequestPayload & { startYear: number }>(
                        path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
                    );
                    fixture.seed = `battle-differential-basic-matrix-${attacker.armType}-${defender.armType}`;
                    fixture.attackerGeneral.crewtype = attacker.id;
                    fixture.attackerGeneral.crew = 50000;
                    fixture.attackerGeneral.rice = 1000000;
                    fixture.attackerGeneral.leadership = 90;
                    fixture.attackerGeneral.strength = 90;
                    fixture.attackerGeneral.intel = 90;
                    fixture.attackerGeneral.personal = 'None';
                    fixture.attackerGeneral.special = 'None';
                    fixture.attackerGeneral.special2 = 'None';
                    fixture.attackerGeneral.dex1 = 12000;
                    fixture.attackerGeneral.dex2 = 12000;
                    fixture.attackerGeneral.dex3 = 12000;
                    fixture.attackerGeneral.dex4 = 12000;
                    fixture.attackerGeneral.dex5 = 12000;

                    const defenderGeneral = fixture.defenderGenerals[0]!;
                    defenderGeneral.crewtype = defender.id;
                    defenderGeneral.crew = 50000;
                    defenderGeneral.rice = 1000000;
                    defenderGeneral.leadership = 85;
                    defenderGeneral.strength = 85;
                    defenderGeneral.intel = 85;
                    defenderGeneral.personal = 'None';
                    defenderGeneral.special = 'None';
                    defenderGeneral.special2 = 'None';
                    defenderGeneral.dex1 = 12000;
                    defenderGeneral.dex2 = 12000;
                    defenderGeneral.dex3 = 12000;
                    defenderGeneral.dex4 = 12000;
                    defenderGeneral.dex5 = 12000;
                    cases.push({ attacker, defender, fixture });
                }
            }

            expect(cases).toHaveLength(25);
            const references = runReferenceTraceBatch(
                workspaceRoot!,
                cases.map(({ fixture }) => JSON.stringify(fixture))
            );
            cases.forEach(({ attacker, defender, fixture }, index) => {
                const coreEvents: WarBattleTraceEvent[] = [];
                const coreLogs = createCoreLogCapture();
                let coreRng: TracingRng | null = null;
                let coreOutcome: WarBattleOutcome | null = null;
                processBattleSimJob(
                    {
                        ...fixture,
                        unitSet,
                        config,
                        time: { year: fixture.year, month: fixture.month, startYear: fixture.startYear },
                    },
                    {
                        trace: (event) => coreEvents.push(event),
                        loggerFactory: coreLogs.loggerFactory,
                        onBattleResolved: (outcome) => {
                            coreOutcome = outcome;
                        },
                        rngFactory: (seed) => {
                            coreRng = new TracingRng(LiteHashDRBG.build(seed));
                            return coreRng.createRandUtil();
                        },
                    }
                );

                const reference = references[index]!;
                const label = `basic-matrix.${attacker.label}.${defender.label}`;
                try {
                    assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
                    assertAllLogBucketsParity(coreLogs, reference, fixture, label);
                } catch (error) {
                    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, {
                        cause: error,
                    });
                }
            });
        }
    );

    it('matches wizard strategy attempts, outcomes, and RNG consumption', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-magic-v1';
        base.attackerGeneral.crew = 4000;
        base.attackerGeneral.crewtype = 1400;
        base.attackerGeneral.leadership = 60;
        base.attackerGeneral.strength = 30;
        base.attackerGeneral.intel = 95;
        base.attackerGeneral.special2 = 'che_신산';
        base.attackerGeneral.personal = 'che_재간';
        base.attackerGeneral.dex4 = 12000;
        base.defenderGenerals[0]!.crew = 4000;
        base.defenderGenerals[0]!.crewtype = 1100;
        base.defenderGenerals[0]!.leadership = 65;
        base.defenderGenerals[0]!.strength = 75;
        base.defenderGenerals[0]!.intel = 35;
        base.defenderGenerals[0]!.special2 = 'che_견고';
        base.defenderGenerals[0]!.personal = 'che_유지';

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        let coreOutcome: WarBattleOutcome | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            onBattleResolved: (outcome) => {
                coreOutcome = outcome;
            },
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return coreRng.createRandUtil();
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(
            reference.events.some((event) =>
                Object.keys(event.attacker.activatedSkills).some((skill) => ['계략', '계략실패'].includes(skill))
            )
        ).toBe(true);
        assertTraceParity(coreEvents, reference, coreRng, coreOutcome);

        // Ref keeps the injury-adjusted intelligence fraction here:
        // (((81 * 0.63) + round((58 * 0.63) / 4)) / 100) * 0.5 + 0.2
        // = 0.50015. Truncating the computed stat first turns this into 0.5
        // and switches RandUtil from nextFloat1() to nextBits().
        base.seed = 'battle-differential-magic-fractional-stat-v1';
        base.attackerGeneral.leadership = 120;
        base.attackerGeneral.strength = 58;
        base.attackerGeneral.intel = 81;
        base.attackerGeneral.injury = 37;
        base.attackerGeneral.personal = 'None';
        let fractionalCoreRng: TracingRng | null = null;
        processBattleSimJob(
            {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            },
            {
                rngFactory: (seed) => {
                    fractionalCoreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return fractionalCoreRng.createRandUtil();
                },
            }
        );
        const fractionalReference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
        assertRngParity(fractionalReference, fractionalCoreRng);
    });

    it('matches cavalry, item, inherit-buff, and multiple-defender handling', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-cavalry-items-v1';
        base.attackerGeneral.crew = 7000;
        base.attackerGeneral.crewtype = 1300;
        base.attackerGeneral.leadership = 88;
        base.attackerGeneral.strength = 92;
        base.attackerGeneral.intel = 55;
        base.attackerGeneral.special2 = 'che_기병';
        base.attackerGeneral.personal = 'che_패권';
        base.attackerGeneral.horse = 'che_명마_07_백상';
        base.attackerGeneral.dex3 = 18000;
        base.attackerGeneral.inheritBuff = {
            warAvoidRatio: 2,
            warCriticalRatio: 3,
            warCriticalRatioOppose: 2,
        };

        const firstDefender = base.defenderGenerals[0]!;
        firstDefender.crew = 900;
        firstDefender.crewtype = 1200;
        firstDefender.leadership = 58;
        firstDefender.strength = 55;
        firstDefender.intel = 62;
        firstDefender.dex2 = 6000;
        firstDefender.inheritBuff = { warAvoidRatioOppose: 2 };
        base.defenderGenerals.push({
            ...firstDefender,
            no: 3,
            name: '수비자2',
            crew: 1100,
            crewtype: 1300,
            leadership: 64,
            strength: 72,
            intel: 48,
            dex2: 0,
            dex3: 8000,
            special2: 'che_기병',
            personal: 'che_패권',
            horse: 'che_명마_07_백상',
            inheritBuff: {
                warAvoidRatio: 1,
                warCriticalRatioOppose: 1,
            },
        });

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        let coreOutcome: WarBattleOutcome | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            onBattleResolved: (outcome) => {
                coreOutcome = outcome;
            },
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return coreRng.createRandUtil();
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(reference.events.filter((event) => event.event === 'opponent_switched')).toHaveLength(2);
        assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
    });

    it('matches siege dexterity and castle damage handling', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-siege-v1';
        base.attackerGeneral.crew = 5000;
        base.attackerGeneral.crewtype = 1501;
        base.attackerGeneral.leadership = 90;
        base.attackerGeneral.strength = 65;
        base.attackerGeneral.intel = 55;
        base.attackerGeneral.dex5 = 16000;
        base.defenderGenerals[0]!.crew = 300;
        base.defenderGenerals[0]!.crewtype = 1200;
        base.defenderGenerals[0]!.leadership = 65;
        base.defenderGenerals[0]!.strength = 72;
        base.defenderGenerals[0]!.intel = 50;
        base.defenderGenerals[0]!.dex2 = 10000;

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        let coreOutcome: WarBattleOutcome | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            onBattleResolved: (outcome) => {
                coreOutcome = outcome;
            },
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return coreRng.createRandUtil();
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(reference.events.some((event) => event.defender?.kind === 'city')).toBe(true);
        assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
    });

    it('matches the no-defender supply-retreat branch without consuming RNG', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-supply-v1';
        base.defenderGenerals = [];
        base.defenderNation.rice = 0;

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        let coreOutcome: WarBattleOutcome | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            onBattleResolved: (outcome) => {
                coreOutcome = outcome;
            },
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return coreRng.createRandUtil();
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(reference.events.map((event) => event.event)).toEqual(['battle_start', 'supply_retreat', 'battle_end']);
        assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
    });

    it('matches every scenario item in an attacker battle simulation', { timeout: 180_000 }, () => {
        const scenarioDir = path.resolve(process.cwd(), '../../resources/scenario');
        const itemSlots = new Map<string, 'horse' | 'weapon' | 'book' | 'item'>();
        for (const filename of fs.readdirSync(scenarioDir).filter((entry) => entry.endsWith('.json'))) {
            const scenario = readJson<{
                const?: {
                    allItems?: Partial<Record<'horse' | 'weapon' | 'book' | 'item', Record<string, number>>>;
                };
            }>(path.join(scenarioDir, filename));
            for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
                for (const itemKey of Object.keys(scenario.const?.allItems?.[slot] ?? {})) {
                    itemSlots.set(itemKey, slot);
                }
            }
        }
        expect(itemSlots.size).toBe(145);
        expect([...ITEM_KEYS].sort()).toEqual([...itemSlots.keys()].sort());

        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
                siege: 5,
                misc: 6,
                castle: 0,
            },
        };
        const failures: string[] = [];
        const cases: Array<{
            itemKey: string;
            base: BattleSimRequestPayload & { startYear: number };
            coreEvents: WarBattleTraceEvent[];
            coreLogs: CoreLogCapture;
            coreRng: TracingRng | null;
            coreOutcome: WarBattleOutcome | null;
        }> = [];

        const itemFilter = process.env['ITEM_PARITY_FILTER'];
        for (const [itemKey, slot] of [...itemSlots].sort(([lhs], [rhs]) => lhs.localeCompare(rhs))) {
            if (itemFilter && itemKey !== itemFilter) {
                continue;
            }
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-item-${itemKey}`;
            base.attackerGeneral.personal = 'None';
            base.attackerGeneral.special2 = 'None';
            base.attackerGeneral.crew = 5000;
            base.attackerGeneral.leadership = 90;
            base.attackerGeneral.strength = 90;
            base.attackerGeneral.intel = 90;
            base.attackerGeneral.dex1 = 12000;
            base.attackerGeneral.dex2 = 12000;
            base.attackerGeneral.dex3 = 12000;
            base.attackerGeneral.dex4 = 12000;
            base.attackerGeneral.dex5 = 12000;
            base.attackerGeneral[slot] = itemKey;
            const defender = base.defenderGenerals[0]!;
            defender.personal = 'None';
            defender.special2 = 'None';
            defender.crew = 1500;
            defender.leadership = 75;
            defender.strength = 75;
            defender.intel = 75;
            base.defenderCity.wall = 3000;
            base.defenderCity.wall_max = 3000;

            const payload: BattleSimJobPayload = {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            };
            const coreEvents: WarBattleTraceEvent[] = [];
            const coreLogs = createCoreLogCapture();
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            processBattleSimJob(payload, {
                trace: (event) => coreEvents.push(event),
                loggerFactory: coreLogs.loggerFactory,
                onBattleResolved: (outcome) => {
                    coreOutcome = outcome;
                },
                rngFactory: (seed) => {
                    coreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return coreRng.createRandUtil();
                },
            });
            cases.push({ itemKey, base, coreEvents, coreLogs, coreRng, coreOutcome });
        }

        const references = runReferenceTraceBatch(
            workspaceRoot!,
            cases.map(({ base }) => JSON.stringify(base))
        );
        for (let index = 0; index < cases.length; index += 1) {
            const { itemKey, base, coreEvents, coreLogs, coreRng, coreOutcome } = cases[index]!;
            const reference = references[index]!;
            try {
                assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
                assertAllLogBucketsParity(coreLogs, reference, base, `item.attacker.${itemKey}`);
            } catch (error) {
                const debug =
                    process.env['ITEM_PARITY_DEBUG'] === '1'
                        ? `\ncore=${JSON.stringify(
                              coreEvents
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}\nref=${JSON.stringify(
                              reference.events
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}`
                        : '';
                failures.push(`${itemKey}: ${error instanceof Error ? error.message : String(error)}${debug}`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('matches every scenario item in a defender battle simulation', { timeout: 180_000 }, () => {
        const scenarioDir = path.resolve(process.cwd(), '../../resources/scenario');
        const itemSlots = new Map<string, 'horse' | 'weapon' | 'book' | 'item'>();
        for (const filename of fs.readdirSync(scenarioDir).filter((entry) => entry.endsWith('.json'))) {
            const scenario = readJson<{
                const?: {
                    allItems?: Partial<Record<'horse' | 'weapon' | 'book' | 'item', Record<string, number>>>;
                };
            }>(path.join(scenarioDir, filename));
            for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
                for (const itemKey of Object.keys(scenario.const?.allItems?.[slot] ?? {})) {
                    itemSlots.set(itemKey, slot);
                }
            }
        }

        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
                siege: 5,
                misc: 6,
                castle: 0,
            },
        };
        const failures: string[] = [];
        const cases: Array<{
            itemKey: string;
            base: BattleSimRequestPayload & { startYear: number };
            coreEvents: WarBattleTraceEvent[];
            coreLogs: CoreLogCapture;
            coreRng: TracingRng | null;
            coreOutcome: WarBattleOutcome | null;
        }> = [];

        const itemFilter = process.env['ITEM_PARITY_FILTER'];
        for (const [itemKey, slot] of [...itemSlots].sort(([lhs], [rhs]) => lhs.localeCompare(rhs))) {
            if (itemFilter && itemKey !== itemFilter) {
                continue;
            }
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-defender-item-${itemKey}`;
            base.attackerGeneral.personal = 'None';
            base.attackerGeneral.special2 = 'None';
            base.attackerGeneral.crew = 1500;
            base.attackerGeneral.leadership = 75;
            base.attackerGeneral.strength = 75;
            base.attackerGeneral.intel = 75;
            const defender = base.defenderGenerals[0]!;
            defender.personal = 'None';
            defender.special2 = 'None';
            defender.crew = 5000;
            defender.leadership = 90;
            defender.strength = 90;
            defender.intel = 90;
            defender.dex1 = 12000;
            defender.dex2 = 12000;
            defender.dex3 = 12000;
            defender.dex4 = 12000;
            defender.dex5 = 12000;
            defender[slot] = itemKey;

            const payload: BattleSimJobPayload = {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            };
            const coreEvents: WarBattleTraceEvent[] = [];
            const coreLogs = createCoreLogCapture();
            let coreRng: TracingRng | null = null;
            let coreOutcome: WarBattleOutcome | null = null;
            processBattleSimJob(payload, {
                trace: (event) => coreEvents.push(event),
                loggerFactory: coreLogs.loggerFactory,
                onBattleResolved: (outcome) => {
                    coreOutcome = outcome;
                },
                rngFactory: (seed) => {
                    coreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return coreRng.createRandUtil();
                },
            });
            cases.push({ itemKey, base, coreEvents, coreLogs, coreRng, coreOutcome });
        }

        const references = runReferenceTraceBatch(
            workspaceRoot!,
            cases.map(({ base }) => JSON.stringify(base))
        );
        for (let index = 0; index < cases.length; index += 1) {
            const { itemKey, base, coreEvents, coreLogs, coreRng, coreOutcome } = cases[index]!;
            const reference = references[index]!;
            try {
                assertTraceParity(coreEvents, reference, coreRng, coreOutcome);
                assertAllLogBucketsParity(coreLogs, reference, base, `item.defender.${itemKey}`);
            } catch (error) {
                const debug =
                    process.env['ITEM_PARITY_DEBUG'] === '1'
                        ? `\ncore=${JSON.stringify(
                              coreEvents
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}\nref=${JSON.stringify(
                              reference.events
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}`
                        : '';
                failures.push(`${itemKey}: ${error instanceof Error ? error.message : String(error)}${debug}`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });
});
