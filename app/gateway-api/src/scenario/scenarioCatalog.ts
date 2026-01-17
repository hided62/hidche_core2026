import fs from 'node:fs/promises';
import path from 'node:path';

import { loadScenarioDefinitionById, resolveScenarioDefaultsPath } from '@sammo-ts/game-engine';

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

let cachedPreviews: { loadedAt: number; data: ScenarioPreview[] } | null = null;

const resolveScenarioRoot = (): string => {
    const defaultsPath = resolveScenarioDefaultsPath();
    return path.dirname(defaultsPath);
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

export const listScenarioPreviews = async (): Promise<ScenarioPreview[]> => {
    if (cachedPreviews && Date.now() - cachedPreviews.loadedAt < CACHE_TTL_MS) {
        return cachedPreviews.data;
    }
    const ids = await listScenarioIds();
    const previews = await Promise.all(ids.map((id) => buildScenarioPreview(id)));
    cachedPreviews = {
        loadedAt: Date.now(),
        data: previews,
    };
    return previews;
};
