import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEGACY_MAP_ROOT = path.resolve(__dirname, '..', 'legacy', 'hwe', 'scenario', 'map');
const LEGACY_BASE_FILE = path.resolve(__dirname, '..', 'legacy', 'hwe', 'sammo', 'CityConstBase.php');
const OUTPUT_ROOT = path.resolve(__dirname, '..', 'app', 'game-engine', 'resources', 'map');

const MAP_NAMES = ['che', 'miniche', 'miniche_b', 'miniche_clean', 'cr', 'chess', 'ludo_rathowm', 'pokemon_v1'];

const LEVEL_MAP = {
    수: 1,
    진: 2,
    관: 3,
    이: 4,
    소: 5,
    중: 6,
    대: 7,
    특: 8,
};

const LEVEL_LABELS = Object.entries(LEVEL_MAP).reduce((acc, [label, value]) => {
    acc[value] = label;
    return acc;
}, {});

const DEFAULT_REGION_MAP = {
    하북: 1,
    중원: 2,
    서북: 3,
    서촉: 4,
    남중: 5,
    초: 6,
    오월: 7,
    동이: 8,
};

const BUILD_INIT_COMMON = {
    trust: 50,
    trade: 100,
};

const BUILD_INIT = {
    수: {
        population: 5000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 500,
        wall: 500,
    },
    진: {
        population: 5000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 500,
        wall: 500,
    },
    관: {
        population: 10000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 1000,
        wall: 1000,
    },
    이: {
        population: 50000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 1000,
        wall: 1000,
    },
    소: {
        population: 100000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 2000,
        wall: 2000,
    },
    중: {
        population: 100000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 3000,
        wall: 3000,
    },
    대: {
        population: 150000,
        agriculture: 1000,
        commerce: 1000,
        security: 1000,
        defence: 4000,
        wall: 4000,
    },
    특: {
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

const readFileOrNull = async (filePath) => {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
};

const extractPhpArray = (source, marker) => {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) {
        return null;
    }
    const start = source.indexOf('[', markerIndex);
    if (start < 0) {
        return null;
    }

    let depth = 0;
    let inString = null;

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

const stripPhpComments = (source) =>
    source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/#.*$/gm, '');

const normalizePhpArray = (source) =>
    stripPhpComments(source)
        .replace(/\bNULL\b/gi, 'null')
        .replace(/'/g, '"')
        .replace(/,(\s*[\]\}])/g, '$1');

const parseLegacyCityRows = (value) => {
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

        const connectionNames = Array.isArray(connections)
            ? connections.filter((value) => typeof value === 'string')
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

const resolveLevelLabel = (level) => {
    if (typeof level === 'string') {
        return level;
    }
    const label = LEVEL_LABELS[level];
    if (!label) {
        throw new Error(`Unknown level value: ${level}`);
    }
    return label;
};

const resolveLevelValue = (level) => {
    if (typeof level === 'number') {
        return level;
    }
    const value = LEVEL_MAP[level];
    if (!value) {
        throw new Error(`Unknown level label: ${level}`);
    }
    return value;
};

const resolveRegionValue = (region, regionMap) => {
    if (typeof region === 'number') {
        return region;
    }
    const value = regionMap[region];
    if (!value) {
        throw new Error(`Unknown region label: ${region}`);
    }
    return value;
};

const buildCityDefinition = (row, nameToId, regionMap) => {
    const levelLabel = resolveLevelLabel(row.level);
    const initial = BUILD_INIT[levelLabel];
    if (!initial) {
        throw new Error(`Missing build init for level ${levelLabel}.`);
    }

    const connections = row.connectionNames
        .map((name) => nameToId.get(name))
        .filter((value) => typeof value === 'number');

    return {
        id: row.id,
        name: row.name,
        level: resolveLevelValue(row.level),
        region: resolveRegionValue(row.region, regionMap),
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

const parseRegionMap = (source) => {
    const raw = extractPhpArray(source, 'public static $regionMap');
    if (!raw) {
        return null;
    }
    const normalized = normalizePhpArray(raw);
    const regex = /"([^"]+)"\s*=>\s*(\d+)/g;
    const regionMap = {};
    let match = regex.exec(normalized);
    while (match) {
        const [, key, value] = match;
        regionMap[key] = Number(value);
        match = regex.exec(normalized);
    }
    return Object.keys(regionMap).length > 0 ? regionMap : null;
};

const loadLegacyMapRows = async (mapName) => {
    const mapFilePath = path.resolve(LEGACY_MAP_ROOT, `${mapName}.php`);
    const [mapSource, baseSource] = await Promise.all([readFileOrNull(mapFilePath), readFileOrNull(LEGACY_BASE_FILE)]);

    if (!baseSource) {
        throw new Error(`Legacy base map file is missing: ${LEGACY_BASE_FILE}`);
    }

    const initCitySource =
        (mapSource ? extractPhpArray(mapSource, 'protected static $initCity') : null) ??
        extractPhpArray(baseSource, 'protected static $initCity');

    if (!initCitySource) {
        throw new Error(`Legacy map data not found for ${mapName}.`);
    }

    const parsed = JSON.parse(normalizePhpArray(initCitySource));
    const rows = parseLegacyCityRows(parsed);
    const baseRegionMap = parseRegionMap(baseSource) ?? DEFAULT_REGION_MAP;
    const regionMap = mapSource ? (parseRegionMap(mapSource) ?? baseRegionMap) : baseRegionMap;
    return { rows, regionMap };
};

const buildMapDefinition = (mapName, rows, regionMap) => {
    const nameToId = new Map(rows.map((row) => [row.name, row.id]));

    return {
        id: mapName,
        name: mapName,
        cities: rows.map((row) => buildCityDefinition(row, nameToId, regionMap)),
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

const ensureOutputRoot = async () => {
    await fs.mkdir(OUTPUT_ROOT, { recursive: true });
};

const writeMapDefinition = async (mapName, definition) => {
    const filePath = path.resolve(OUTPUT_ROOT, `map_${mapName}.json`);
    const payload = `${JSON.stringify(definition, null, 4)}\n`;
    await fs.writeFile(filePath, payload, 'utf8');
};

const main = async () => {
    await ensureOutputRoot();

    for (const mapName of MAP_NAMES) {
        const { rows, regionMap } = await loadLegacyMapRows(mapName);
        const definition = buildMapDefinition(mapName, rows, regionMap);
        await writeMapDefinition(mapName, definition);
        console.log(`Generated map_${mapName}.json (${rows.length} cities)`);
    }
};

await main();
