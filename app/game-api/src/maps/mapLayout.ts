import fs from 'node:fs/promises';
import path from 'node:path';

export interface MapLayoutCity {
    id: number;
    name: string;
    level: number;
    region: number;
    x: number;
    y: number;
    path: number[];
}

export interface MapLayout {
    mapName: string;
    cityList: MapLayoutCity[];
    regionMap: Record<number, string>;
    levelMap: Record<number, string>;
}

interface ParsedCityConst {
    initCity?: unknown[];
    regionMap?: Record<string, unknown>;
    levelMap?: Record<string, unknown>;
}

const LEGACY_SCENARIO_ROOT = path.resolve(process.cwd(), 'legacy/hwe/scenario');
const LEGACY_MAP_ROOT = path.resolve(LEGACY_SCENARIO_ROOT, 'map');
const LEGACY_CITY_CONST = path.resolve(process.cwd(), 'legacy/hwe/sammo/CityConstBase.php');

const layoutCache = new Map<string, MapLayout>();

const stripComments = (value: string): string =>
    value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const extractPhpArray = (source: string, marker: string): string | null => {
    const idx = source.indexOf(marker);
    if (idx < 0) {
        return null;
    }
    const start = source.indexOf('[', idx);
    if (start < 0) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = start; i < source.length; i += 1) {
        const char = source[i];
        if (inString) {
            if (char === stringChar && source[i - 1] !== '\\') {
                inString = false;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
            continue;
        }
        if (char === '[') {
            depth += 1;
            continue;
        }
        if (char === ']') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }

    return null;
};

const parsePhpArray = (input: string): unknown => {
    let index = 0;

    const skipWhitespace = () => {
        while (index < input.length && /\s/.test(input[index] ?? '')) {
            index += 1;
        }
    };

    const parseString = () => {
        const quote = input[index];
        index += 1;
        let value = '';
        while (index < input.length) {
            const char = input[index];
            if (char === quote && input[index - 1] !== '\\') {
                index += 1;
                return value;
            }
            value += char;
            index += 1;
        }
        return value;
    };

    const parseNumber = () => {
        let raw = '';
        while (index < input.length && /[0-9.+\-]/.test(input[index] ?? '')) {
            raw += input[index];
            index += 1;
        }
        return Number(raw);
    };

    const parseValue = (): unknown => {
        skipWhitespace();
        const char = input[index];
        if (!char) {
            return null;
        }
        if (char === '[') {
            return parseArray();
        }
        if (char === '"' || char === "'") {
            return parseString();
        }
        if (/[0-9.+\-]/.test(char)) {
            return parseNumber();
        }
        if (input.startsWith('true', index)) {
            index += 4;
            return true;
        }
        if (input.startsWith('false', index)) {
            index += 5;
            return false;
        }
        if (input.startsWith('null', index)) {
            index += 4;
            return null;
        }
        return null;
    };

    const parseArray = (): unknown => {
        const output: unknown[] = [];
        const objectOutput: Record<string, unknown> = {};
        let hasKeyed = false;
        index += 1;

        while (index < input.length) {
            skipWhitespace();
            if (input[index] === ']') {
                index += 1;
                break;
            }
            const keyOrValue = parseValue();
            skipWhitespace();
            if (input.slice(index, index + 2) === '=>') {
                hasKeyed = true;
                index += 2;
                const value = parseValue();
                objectOutput[String(keyOrValue)] = value;
            } else if (keyOrValue !== null) {
                output.push(keyOrValue);
            }
            skipWhitespace();
            if (input[index] === ',') {
                index += 1;
            }
        }

        if (hasKeyed) {
            return objectOutput;
        }
        return output;
    };

    return parseValue();
};

const parseCityConstFile = async (filePath: string): Promise<ParsedCityConst> => {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const source = stripComments(raw);
        const initCityRaw = extractPhpArray(source, '$initCity');
        const regionMapRaw = extractPhpArray(source, '$regionMap');
        const levelMapRaw = extractPhpArray(source, '$levelMap');

        return {
            initCity: initCityRaw ? (parsePhpArray(initCityRaw) as unknown[]) : undefined,
            regionMap: regionMapRaw ? (parsePhpArray(regionMapRaw) as Record<string, unknown>) : undefined,
            levelMap: levelMapRaw ? (parsePhpArray(levelMapRaw) as Record<string, unknown>) : undefined,
        };
    } catch {
        return {};
    }
};

const resolveScenarioFile = async (scenario: string): Promise<string> => {
    const normalized = scenario.replace(/\.json$/i, '');
    const candidates = [
        `${normalized}.json`,
        `scenario_${normalized}.json`,
        'default.json',
    ];

    for (const candidate of candidates) {
        const fullPath = path.join(LEGACY_SCENARIO_ROOT, candidate);
        try {
            await fs.access(fullPath);
            return fullPath;
        } catch {
            continue;
        }
    }

    return path.join(LEGACY_SCENARIO_ROOT, 'default.json');
};

const resolveMapName = async (scenario: string): Promise<string> => {
    const scenarioPath = await resolveScenarioFile(scenario);
    try {
        const raw = await fs.readFile(scenarioPath, 'utf-8');
        const parsed = JSON.parse(raw) as { map?: { mapName?: string } };
        return parsed.map?.mapName ?? 'che';
    } catch {
        return 'che';
    }
};

const buildLookupMap = (raw: Record<string, unknown> | undefined) => {
    const idToName: Record<number, string> = {};
    const nameToId: Record<string, number> = {};
    if (!raw) {
        return { idToName, nameToId };
    }

    for (const [key, value] of Object.entries(raw)) {
        const numericKey = Number(key);
        if (typeof value === 'string' && Number.isFinite(numericKey)) {
            idToName[numericKey] = value;
            continue;
        }
        if (typeof value === 'number') {
            nameToId[key] = value;
        }
    }

    return { idToName, nameToId };
};

const normalizeInitCity = (
    initCity: unknown[],
    levelMap: ReturnType<typeof buildLookupMap>,
    regionMap: ReturnType<typeof buildLookupMap>
): MapLayoutCity[] => {
    const rows = initCity.filter(Array.isArray) as unknown[][];
    const nameToId = new Map<string, number>();

    for (const row of rows) {
        if (typeof row[0] === 'number' && typeof row[1] === 'string') {
            nameToId.set(row[1], row[0]);
        }
    }

    return rows
        .map((row) => {
            const [id, name, levelLabel, _pop, _agri, _comm, _secu, _def, _wall, regionLabel, x, y, path] = row;
            if (typeof id !== 'number' || typeof name !== 'string') {
                return null;
            }

            const levelValue =
                typeof levelLabel === 'number'
                    ? levelLabel
                    : typeof levelLabel === 'string'
                    ? levelMap.nameToId[levelLabel] ?? Number(levelLabel)
                    : 0;

            const regionValue =
                typeof regionLabel === 'number'
                    ? regionLabel
                    : typeof regionLabel === 'string'
                    ? regionMap.nameToId[regionLabel] ?? Number(regionLabel)
                    : 0;

            const pathNames = Array.isArray(path) ? (path as string[]) : [];
            const pathIds = pathNames
                .map((pathName) => nameToId.get(pathName))
                .filter((value): value is number => typeof value === 'number');

            return {
                id,
                name,
                level: Number.isFinite(levelValue) ? levelValue : 0,
                region: Number.isFinite(regionValue) ? regionValue : 0,
                x: typeof x === 'number' ? x : 0,
                y: typeof y === 'number' ? y : 0,
                path: pathIds,
            } satisfies MapLayoutCity;
        })
        .filter((value): value is MapLayoutCity => value !== null);
};

export const loadMapLayout = async (scenario: string): Promise<MapLayout> => {
    const mapName = await resolveMapName(scenario);
    const cached = layoutCache.get(mapName);
    if (cached) {
        return cached;
    }

    const base = await parseCityConstFile(LEGACY_CITY_CONST);
    const mapPath = path.join(LEGACY_MAP_ROOT, `${mapName}.php`);
    const map = await parseCityConstFile(mapPath);

    const regionMapRaw = {
        ...(base.regionMap ?? {}),
        ...(map.regionMap ?? {}),
    };
    const levelMapRaw = {
        ...(base.levelMap ?? {}),
        ...(map.levelMap ?? {}),
    };

    const regionMap = buildLookupMap(regionMapRaw);
    const levelMap = buildLookupMap(levelMapRaw);

    const initCity = map.initCity ?? base.initCity ?? [];
    const cityList = normalizeInitCity(initCity, levelMap, regionMap);

    const layout: MapLayout = {
        mapName,
        cityList,
        regionMap: regionMap.idToName,
        levelMap: levelMap.idToName,
    };

    layoutCache.set(mapName, layout);
    return layout;
};
