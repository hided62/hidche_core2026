import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
    MapCityDefinition,
    MapCityStats,
    MapDefinition,
} from '@sammo-ts/logic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LEGACY_MAP_ROOT = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'legacy',
    'hwe',
    'scenario',
    'map'
);
const DEFAULT_LEGACY_BASE_FILE = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'legacy',
    'hwe',
    'sammo',
    'CityConstBase.php'
);

const LEVEL_MAP: Record<string, number> = {
    '수': 1,
    '진': 2,
    '관': 3,
    '이': 4,
    '소': 5,
    '중': 6,
    '대': 7,
    '특': 8,
};

const LEVEL_LABELS: Record<number, string> = Object.entries(LEVEL_MAP)
    .reduce<Record<number, string>>((acc, [label, value]) => {
        acc[value] = label;
        return acc;
    }, {});

const REGION_MAP: Record<string, number> = {
    '하북': 1,
    '중원': 2,
    '서북': 3,
    '서촉': 4,
    '남중': 5,
    '초': 6,
    '오월': 7,
    '동이': 8,
};

const BUILD_INIT_COMMON = {
    trust: 50,
    trade: 100,
};

const BUILD_INIT: Record<string, MapCityStats> = {
    '수': {
        population: 5000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 500,
        wall: 500,
    },
    '진': {
        population: 5000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 500,
        wall: 500,
    },
    '관': {
        population: 10000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 1000,
        wall: 1000,
    },
    '이': {
        population: 50000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 1000,
        wall: 1000,
    },
    '소': {
        population: 100000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 2000,
        wall: 2000,
    },
    '중': {
        population: 100000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 3000,
        wall: 3000,
    },
    '대': {
        population: 150000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 4000,
        wall: 4000,
    },
    '특': {
        population: 150000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 5000,
        wall: 5000,
    },
};

const DEFAULT_SUPPLY_STATE = 1;
const DEFAULT_FRONT_STATE = 0;

interface LegacyCityRow {
    id: number;
    name: string;
    level: string | number;
    population: number;
    agriculture: number;
    commerce: number;
    security: number;
    defence: number;
    wall: number;
    region: string | number;
    positionX: number;
    positionY: number;
    connectionNames: string[];
}

export interface LegacyMapLoaderOptions {
    mapRoot?: string;
    baseFilePath?: string;
}

const readFileOrNull = async (filePath: string): Promise<string | null> => {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
};

const extractPhpArray = (source: string, marker: string): string | null => {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) {
        return null;
    }
    const start = source.indexOf('[', markerIndex);
    if (start < 0) {
        return null;
    }

    let depth = 0;
    let inString: '"' | "'" | null = null;

    for (let i = start; i < source.length; i += 1) {
        const char = source[i];
        if (inString) {
            if (char === '\\') {
                i += 1;
                continue;
            }
            if (char === inString) {
                inString = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = char;
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

const stripPhpComments = (source: string): string =>
    source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/#.*$/gm, '');

const normalizePhpArray = (source: string): string =>
    stripPhpComments(source)
        .replace(/\bNULL\b/gi, 'null')
        .replace(/'/g, '"')
        .replace(/,(\s*[\]\}])/g, '$1');

const parseLegacyCityRows = (value: unknown): LegacyCityRow[] => {
    if (!Array.isArray(value)) {
        throw new Error('Legacy map data is not an array.');
    }

    return value.map((row, index) => {
        if (!Array.isArray(row)) {
            throw new Error(`Legacy map row ${index} is not an array.`);
        }
        const [
            id,
            name,
            level,
            population,
            agriculture,
            commerce,
            security,
            defence,
            wall,
            region,
            positionX,
            positionY,
            connections,
        ] = row;

        if (typeof id !== 'number' || typeof name !== 'string') {
            throw new Error(`Legacy map row ${index} has invalid id/name.`);
        }
        if (
            typeof level !== 'string' &&
            typeof level !== 'number'
        ) {
            throw new Error(`Legacy map row ${index} has invalid level.`);
        }
        const stats = [
            population,
            agriculture,
            commerce,
            security,
            defence,
            wall,
        ];
        if (stats.some((value) => typeof value !== 'number')) {
            throw new Error(`Legacy map row ${index} has invalid stats.`);
        }
        if (
            typeof region !== 'string' &&
            typeof region !== 'number'
        ) {
            throw new Error(`Legacy map row ${index} has invalid region.`);
        }
        if (
            typeof positionX !== 'number' ||
            typeof positionY !== 'number'
        ) {
            throw new Error(`Legacy map row ${index} has invalid position.`);
        }

        const connectionNames = Array.isArray(connections)
            ? connections.filter(
                (value): value is string => typeof value === 'string'
            )
            : [];

        return {
            id,
            name,
            level,
            population,
            agriculture,
            commerce,
            security,
            defence,
            wall,
            region,
            positionX,
            positionY,
            connectionNames,
        };
    });
};

const resolveLevelLabel = (level: string | number): string => {
    if (typeof level === 'string') {
        return level;
    }
    const label = LEVEL_LABELS[level];
    if (!label) {
        throw new Error(`Unknown level value: ${level}`);
    }
    return label;
};

const resolveLevelValue = (level: string | number): number => {
    if (typeof level === 'number') {
        return level;
    }
    const value = LEVEL_MAP[level];
    if (!value) {
        throw new Error(`Unknown level label: ${level}`);
    }
    return value;
};

const resolveRegionValue = (region: string | number): number => {
    if (typeof region === 'number') {
        return region;
    }
    const value = REGION_MAP[region];
    if (!value) {
        throw new Error(`Unknown region label: ${region}`);
    }
    return value;
};

const buildCityDefinition = (
    row: LegacyCityRow,
    nameToId: Map<string, number>
): MapCityDefinition => {
    const levelLabel = resolveLevelLabel(row.level);
    const initial = BUILD_INIT[levelLabel];
    if (!initial) {
        throw new Error(`Missing build init for level ${levelLabel}.`);
    }

    const connections = row.connectionNames
        .map((name) => nameToId.get(name))
        .filter((value): value is number => typeof value === 'number');

    return {
        id: row.id,
        name: row.name,
        level: resolveLevelValue(row.level),
        region: resolveRegionValue(row.region),
        position: {
            x: row.positionX,
            y: row.positionY,
        },
        connections,
        max: {
            population: row.population * 100,
            agriculture: row.agriculture * 100,
            commerce: row.commerce * 100,
            security: row.security * 100,
            defence: row.defence * 100,
            wall: row.wall * 100,
        },
        initial,
        meta: {
            source: 'legacy',
            connectionNames: row.connectionNames,
        },
    };
};

export const loadLegacyMapDefinition = async (
    mapName: string,
    options?: LegacyMapLoaderOptions
): Promise<MapDefinition> => {
    const mapRoot = options?.mapRoot ?? DEFAULT_LEGACY_MAP_ROOT;
    const baseFilePath = options?.baseFilePath ?? DEFAULT_LEGACY_BASE_FILE;
    const mapFilePath = path.resolve(mapRoot, `${mapName}.php`);

    const [mapSource, baseSource] = await Promise.all([
        readFileOrNull(mapFilePath),
        readFileOrNull(baseFilePath),
    ]);

    if (!baseSource) {
        throw new Error(`Legacy base map file is missing: ${baseFilePath}`);
    }

    const mapInitCity =
        (mapSource
            ? extractPhpArray(mapSource, 'protected static $initCity')
            : null) ??
        extractPhpArray(baseSource, 'protected static $initCity');

    if (!mapInitCity) {
        throw new Error(`Legacy map data not found for ${mapName}.`);
    }

    const parsed = JSON.parse(normalizePhpArray(mapInitCity)) as unknown;
    const rows = parseLegacyCityRows(parsed);
    const nameToId = new Map(rows.map((row) => [row.name, row.id]));

    return {
        id: mapName,
        name: mapName,
        cities: rows.map((row) => buildCityDefinition(row, nameToId)),
        defaults: {
            trust: BUILD_INIT_COMMON.trust,
            trade: BUILD_INIT_COMMON.trade,
            supplyState: DEFAULT_SUPPLY_STATE,
            frontState: DEFAULT_FRONT_STATE,
        },
        meta: {
            source: 'legacy',
            mapName,
        },
    };
};
