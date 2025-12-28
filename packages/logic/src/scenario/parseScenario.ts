import type {
    ScenarioConfig,
    ScenarioDefaults,
    ScenarioDefinition,
    ScenarioDiplomacy,
    ScenarioEnvironment,
    ScenarioGeneral,
    ScenarioNation,
    ScenarioStatBlock,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const FALLBACK_STAT: ScenarioStatBlock = {
    total: 0,
    min: 0,
    max: 0,
    npcTotal: 0,
    npcMax: 0,
    npcMin: 0,
    chiefMin: 0,
};

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : [];

const asRecord = (value: unknown): UnknownRecord =>
    isRecord(value) ? value : {};

const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' ? value : fallback;

const asString = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;

const asNullableNumber = (value: unknown): number | null =>
    typeof value === 'number' ? value : null;

const asNullableString = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

const asStringArray = (value: unknown): string[] =>
    asArray(value).filter((item): item is string => typeof item === 'string');

const parseScenarioStatBlock = (
    value: unknown,
    fallback: ScenarioStatBlock
): ScenarioStatBlock => {
    const data = asRecord(value);
    return {
        total: asNumber(data.total, fallback.total),
        min: asNumber(data.min, fallback.min),
        max: asNumber(data.max, fallback.max),
        npcTotal: asNumber(data.npcTotal, fallback.npcTotal),
        npcMax: asNumber(data.npcMax, fallback.npcMax),
        npcMin: asNumber(data.npcMin, fallback.npcMin),
        chiefMin: asNumber(data.chiefMin, fallback.chiefMin),
    };
};

const parseScenarioEnvironment = (
    mapConfig: UnknownRecord,
    constConfig: UnknownRecord
): ScenarioEnvironment => {
    const merged = { ...mapConfig, ...constConfig };
    const mapName = asString(merged.mapName, 'che');
    const unitSet = asString(merged.unitSet, 'che');
    const scenarioEffect =
        typeof merged.scenarioEffect === 'string' || merged.scenarioEffect === null
            ? merged.scenarioEffect
            : undefined;

    return { mapName, unitSet, scenarioEffect };
};

const ensureTitle = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new Error('Scenario title must be a string.');
    }
    return value;
};

const parseNationRow = (row: unknown, index: number): ScenarioNation => {
    if (!Array.isArray(row)) {
        throw new Error(`Scenario nation row ${index} is not an array.`);
    }
    const [
        name,
        color,
        gold,
        rice,
        infoText,
        tech,
        type,
        level,
        cities,
    ] = row;

    const nationName = asString(name, '');
    if (!nationName) {
        throw new Error(`Scenario nation row ${index} has no name.`);
    }

    return {
        id: index + 1,
        name: nationName,
        color: asString(color, '#000000'),
        gold: asNumber(gold, 0),
        rice: asNumber(rice, 0),
        infoText: asNullableString(infoText),
        tech: asNumber(tech, 0),
        type: asString(type, ''),
        level: asNumber(level, 0),
        cities: asStringArray(cities),
    };
};

const parseDiplomacyRow = (row: unknown, index: number): ScenarioDiplomacy => {
    if (!Array.isArray(row)) {
        throw new Error(`Scenario diplomacy row ${index} is not an array.`);
    }
    const [fromNationId, toNationId, state, durationMonths] = row;
    return {
        fromNationId: asNumber(fromNationId, 0),
        toNationId: asNumber(toNationId, 0),
        state: asNumber(state, 0),
        durationMonths: asNumber(durationMonths, 0),
    };
};

const parseGeneralRow = (
    row: unknown,
    index: number,
    label: string
): ScenarioGeneral => {
    if (!Array.isArray(row)) {
        throw new Error(`Scenario ${label} row ${index} is not an array.`);
    }
    const values = [...row];
    while (values.length < 14) {
        values.push(null);
    }

    const [
        affinity,
        name,
        picture,
        nation,
        city,
        leadership,
        strength,
        intelligence,
        officerLevel,
        birthYear,
        deathYear,
        personality,
        special,
        text,
    ] = values;

    if (typeof name !== 'string') {
        throw new Error(`Scenario ${label} row ${index} has no name.`);
    }

    return {
        affinity: asNullableNumber(affinity),
        name,
        picture:
            typeof picture === 'number' || typeof picture === 'string'
                ? picture
                : null,
        nation:
            typeof nation === 'number' || typeof nation === 'string'
                ? nation
                : null,
        city: asNullableString(city),
        leadership: asNumber(leadership, 0),
        strength: asNumber(strength, 0),
        intelligence: asNumber(intelligence, 0),
        officerLevel: asNumber(officerLevel, 0),
        birthYear: asNumber(birthYear, 0),
        deathYear: asNumber(deathYear, 0),
        personality: asNullableString(personality),
        special: asNullableString(special),
        text: asNullableString(text),
    };
};

const parseGeneralRows = (rows: unknown[], label: string): ScenarioGeneral[] =>
    rows.map((row, index) => parseGeneralRow(row, index, label));

const parseNationRows = (rows: unknown[]): ScenarioNation[] =>
    rows.map((row, index) => parseNationRow(row, index));

const parseDiplomacyRows = (rows: unknown[]): ScenarioDiplomacy[] =>
    rows.map((row, index) => parseDiplomacyRow(row, index));

export const parseScenarioDefaults = (raw: unknown): ScenarioDefaults => {
    // 기본 시나리오 설정값을 안전하게 읽는다.
    const data = asRecord(raw);
    const stat = parseScenarioStatBlock(data.stat, FALLBACK_STAT);
    const iconPath = asString(data.iconPath, '.');
    return { stat, iconPath };
};

export const parseScenarioDefinition = (
    raw: unknown,
    defaults: ScenarioDefaults
): ScenarioDefinition => {
    // 시나리오 JSON을 런타임에서 쓰는 구조로 정규화한다.
    const data = asRecord(raw);
    const stat = parseScenarioStatBlock(data.stat, defaults.stat);
    const mapConfig = asRecord(data.map);
    const constConfig = asRecord(data.const);
    const config: ScenarioConfig = {
        stat,
        iconPath: asString(data.iconPath, defaults.iconPath),
        map: mapConfig,
        const: constConfig,
        environment: parseScenarioEnvironment(mapConfig, constConfig),
    };

    const title = ensureTitle(data.title);
    const startYear =
        typeof data.startYear === 'number' ? data.startYear : null;
    const life = typeof data.life === 'number' ? data.life : null;
    const fiction = typeof data.fiction === 'number' ? data.fiction : null;
    const history = asStringArray(data.history);
    const ignoreDefaultEvents = Boolean(data.ignoreDefaultEvents);
    const nations = parseNationRows(asArray(data.nation));
    const diplomacy = parseDiplomacyRows(asArray(data.diplomacy));
    const generals = parseGeneralRows(asArray(data.general), 'general');
    const generalsEx = parseGeneralRows(asArray(data.general_ex), 'general_ex');
    const generalsNeutral = parseGeneralRows(
        asArray(data.general_neutral),
        'general_neutral'
    );
    const events = asArray(data.events);
    const initialEvents = asArray(
        data.initialEvents ?? data.initialActions ?? []
    );

    return {
        title,
        startYear,
        life,
        fiction,
        history,
        config,
        nations,
        diplomacy,
        generals,
        generalsEx,
        generalsNeutral,
        cities: asArray(data.cities),
        events,
        initialEvents,
        ignoreDefaultEvents,
    };
};
