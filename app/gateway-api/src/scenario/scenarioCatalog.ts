import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadScenarioDefinitionById, resolveScenarioDefaultsPath } from '@sammo-ts/game-engine';
import { parseScenarioDefaults, parseScenarioDefinition, type ScenarioDefaults } from '@sammo-ts/logic';

export interface ScenarioNationPreview {
    id: number;
    name: string;
    color: string;
    cities: string[];
    generals: number;
    generalsEx: number;
    generalsNeutral: number;
}

export interface ScenarioPreview {
    id: number;
    title: string;
    year: number | null;
    npcCount: number;
    npcExCount: number;
    npcNeutralCount: number;
    nations: ScenarioNationPreview[];
}

const SCENARIO_FILE_PATTERN = /^scenario_(\d+)\.json$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_KEY = 'local';
const GIT_REF_PATTERN = /^[0-9A-Za-z._/-]+$/;
const SCENARIO_ROOT = path.join('resources', 'scenario');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const previewCache = new Map<string, { loadedAt: number; data: ScenarioPreview[] }>();
const defaultsCache = new Map<string, ScenarioDefaults>();

const resolveScenarioRoot = (): string => {
    const defaultsPath = resolveScenarioDefaultsPath();
    return path.dirname(defaultsPath);
};

const runGit = (args: string[]): Promise<{ ok: boolean; output: string }> =>
    new Promise((resolve) => {
        const child = spawn('git', args, {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('close', (code) => {
            resolve({ ok: code === 0, output });
        });
    });

const normalizeGitRef = (value?: string | null): string | null => {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.startsWith('-') || trimmed.includes('..') || !GIT_REF_PATTERN.test(trimmed)) {
        return null;
    }
    return trimmed;
};

export const resolveGitCommitSha = async (gitRef: string): Promise<string> => {
    const normalized = normalizeGitRef(gitRef);
    if (!normalized) {
        throw new Error('git ref is invalid.');
    }
    const resolveCommit = async (): Promise<{ ok: boolean; output: string }> =>
        runGit(['rev-parse', '--verify', `${normalized}^{commit}`]);
    let result = await resolveCommit();
    if (!result.ok) {
        await runGit(['fetch', '--all', '--tags']);
        result = await resolveCommit();
    }
    if (!result.ok) {
        throw new Error('git ref not found.');
    }
    const commit = result.output.trim().split('\n')[0];
    if (!commit) {
        throw new Error('git ref did not resolve to a commit.');
    }
    return commit;
};

const readGitFile = async (commitSha: string, relativePath: string): Promise<string> => {
    const result = await runGit(['show', `${commitSha}:${relativePath}`]);
    if (!result.ok) {
        throw new Error(`Failed to read ${relativePath} from ${commitSha}.`);
    }
    return result.output;
};

const readGitJson = async (commitSha: string, relativePath: string): Promise<unknown> => {
    const raw = await readGitFile(commitSha, relativePath);
    return JSON.parse(raw) as unknown;
};

const listScenarioIds = async (): Promise<number[]> => {
    const root = resolveScenarioRoot();
    const entries = await fs.readdir(root, { withFileTypes: true });
    const ids: number[] = [];
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        const match = SCENARIO_FILE_PATTERN.exec(entry.name);
        if (!match) {
            continue;
        }
        const id = Number(match[1]);
        if (Number.isFinite(id)) {
            ids.push(id);
        }
    }
    return ids.sort((a, b) => a - b);
};

const listScenarioIdsFromGit = async (commitSha: string): Promise<number[]> => {
    const result = await runGit(['ls-tree', '-r', '--name-only', commitSha, SCENARIO_ROOT]);
    if (!result.ok) {
        throw new Error('Failed to list scenarios from git.');
    }
    const ids: number[] = [];
    result.output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((entry) => {
            const fileName = path.basename(entry);
            const match = SCENARIO_FILE_PATTERN.exec(fileName);
            if (!match) {
                return;
            }
            const id = Number(match[1]);
            if (Number.isFinite(id)) {
                ids.push(id);
            }
        });
    return ids.sort((a, b) => a - b);
};

const buildNationIdResolver = (nations: Array<{ id: number; name: string }>): ((value: number | string | null) => number | null) => {
    const byName = new Map(nations.map((nation) => [nation.name, nation.id]));
    return (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.floor(value);
        }
        if (typeof value === 'string') {
            return byName.get(value) ?? null;
        }
        return null;
    };
};

const countGeneralsByNation = (
    rows: Array<{ nation: number | string | null }>,
    resolveNationId: (value: number | string | null) => number | null
): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const row of rows) {
        const nationId = resolveNationId(row.nation);
        if (nationId === null) {
            continue;
        }
        counts.set(nationId, (counts.get(nationId) ?? 0) + 1);
    }
    return counts;
};

const buildScenarioPreview = async (scenarioId: number): Promise<ScenarioPreview> => {
    const scenario = await loadScenarioDefinitionById(scenarioId);
    const resolveNationId = buildNationIdResolver(scenario.nations);

    const baseCounts = new Map(scenario.nations.map((nation) => [nation.id, 0]));
    const generalCounts = countGeneralsByNation(scenario.generals, resolveNationId);
    const generalExCounts = countGeneralsByNation(scenario.generalsEx, resolveNationId);
    const generalNeutralCounts = countGeneralsByNation(scenario.generalsNeutral, resolveNationId);

    const nations = scenario.nations.map((nation) => ({
        id: nation.id,
        name: nation.name,
        color: nation.color,
        cities: nation.cities,
        generals: generalCounts.get(nation.id) ?? baseCounts.get(nation.id) ?? 0,
        generalsEx: generalExCounts.get(nation.id) ?? baseCounts.get(nation.id) ?? 0,
        generalsNeutral: generalNeutralCounts.get(nation.id) ?? baseCounts.get(nation.id) ?? 0,
    }));

    return {
        id: scenarioId,
        title: scenario.title,
        year: scenario.startYear ?? null,
        npcCount: scenario.generals.length,
        npcExCount: scenario.generalsEx.length,
        npcNeutralCount: scenario.generalsNeutral.length,
        nations,
    };
};

const loadScenarioDefaultsFromGit = async (commitSha: string): Promise<ScenarioDefaults> => {
    const cached = defaultsCache.get(commitSha);
    if (cached) {
        return cached;
    }
    const rawDefaults = await readGitJson(commitSha, path.join(SCENARIO_ROOT, 'default.json'));
    const parsed = parseScenarioDefaults(rawDefaults);
    defaultsCache.set(commitSha, parsed);
    return parsed;
};

const buildScenarioPreviewFromGit = async (commitSha: string, scenarioId: number): Promise<ScenarioPreview> => {
    const defaults = await loadScenarioDefaultsFromGit(commitSha);
    const rawScenario = await readGitJson(commitSha, path.join(SCENARIO_ROOT, `scenario_${scenarioId}.json`));
    const scenario = parseScenarioDefinition(rawScenario, defaults);
    const resolveNationId = buildNationIdResolver(scenario.nations);

    const baseCounts = new Map(scenario.nations.map((nation) => [nation.id, 0]));
    const generalCounts = countGeneralsByNation(scenario.generals, resolveNationId);
    const generalExCounts = countGeneralsByNation(scenario.generalsEx, resolveNationId);
    const generalNeutralCounts = countGeneralsByNation(scenario.generalsNeutral, resolveNationId);

    const nations = scenario.nations.map((nation) => ({
        id: nation.id,
        name: nation.name,
        color: nation.color,
        cities: nation.cities,
        generals: generalCounts.get(nation.id) ?? baseCounts.get(nation.id) ?? 0,
        generalsEx: generalExCounts.get(nation.id) ?? baseCounts.get(nation.id) ?? 0,
        generalsNeutral: generalNeutralCounts.get(nation.id) ?? baseCounts.get(nation.id) ?? 0,
    }));

    return {
        id: scenarioId,
        title: scenario.title,
        year: scenario.startYear ?? null,
        npcCount: scenario.generals.length,
        npcExCount: scenario.generalsEx.length,
        npcNeutralCount: scenario.generalsNeutral.length,
        nations,
    };
};

export const listScenarioPreviews = async (options?: { gitRef?: string | null }): Promise<ScenarioPreview[]> => {
    const rawGitRef = options?.gitRef ?? null;
    const gitRef = normalizeGitRef(rawGitRef);
    if (typeof rawGitRef === 'string' && rawGitRef.trim() && !gitRef) {
        throw new Error('git ref is invalid.');
    }
    if (!gitRef) {
        const cached = previewCache.get(DEFAULT_CACHE_KEY);
        if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
            return cached.data;
        }
        const ids = await listScenarioIds();
        const previews = await Promise.all(ids.map((id) => buildScenarioPreview(id)));
        previewCache.set(DEFAULT_CACHE_KEY, {
            loadedAt: Date.now(),
            data: previews,
        });
        return previews;
    }

    const commitSha = await resolveGitCommitSha(gitRef);
    const cacheKey = commitSha;
    const cached = previewCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
        return cached.data;
    }
    const ids = await listScenarioIdsFromGit(commitSha);
    const previews = await Promise.all(ids.map((id) => buildScenarioPreviewFromGit(commitSha, id)));
    previewCache.set(cacheKey, {
        loadedAt: Date.now(),
        data: previews,
    });
    return previews;
};
