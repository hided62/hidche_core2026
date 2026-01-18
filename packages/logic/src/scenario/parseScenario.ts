import { z } from 'zod';
import { asNullableNumber, asNullableString, asNumber, asString, asStringArray, isRecord } from '@sammo-ts/common';

import { ScenarioDefaultsInputSchema, ScenarioDefinitionInputSchema } from '../resources/scenarioSchema.js';

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

const zUnknownArray = z.array(z.unknown());

const parseScenarioStatBlock = (value: unknown, fallback: ScenarioStatBlock): ScenarioStatBlock => {
    const data = isRecord(value) ? value : {};
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

const parseScenarioEnvironment = (mapConfig: UnknownRecord, constConfig: UnknownRecord): ScenarioEnvironment => {
    const merged = { ...mapConfig, ...constConfig };
    const mapName = asString(merged.mapName, 'che');
    const unitSet = asString(merged.unitSet, 'che');
    const scenarioEffect =
        typeof merged.scenarioEffect === 'string' || merged.scenarioEffect === null ? merged.scenarioEffect : undefined;

    const result: ScenarioEnvironment = { mapName, unitSet };
    if (scenarioEffect !== undefined) {
        result.scenarioEffect = scenarioEffect;
    }
    return result;
};

const parseNationRow = (row: unknown, index: number): ScenarioNation => {
    const parsed = zUnknownArray.safeParse(row);
    if (!parsed.success) {
        throw new Error(`Scenario nation row ${index} is not an array.`);
    }
    const [name, color, gold, rice, infoText, tech, type, level, cities] = parsed.data;

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
    const parsed = zUnknownArray.safeParse(row);
    if (!parsed.success) {
        throw new Error(`Scenario diplomacy row ${index} is not an array.`);
    }
    const [fromNationId, toNationId, state, durationMonths] = parsed.data;
    return {
        fromNationId: asNumber(fromNationId, 0),
        toNationId: asNumber(toNationId, 0),
        state: asNumber(state, 0),
        durationMonths: asNumber(durationMonths, 0),
    };
};

const parseGeneralRow = (row: unknown, index: number, label: string): ScenarioGeneral => {
    const parsed = zUnknownArray.safeParse(row);
    if (!parsed.success) {
        throw new Error(`Scenario ${label} row ${index} is not an array.`);
    }
    const values = [...parsed.data];
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
        specialWar,
        horse,
        weapon,
        book,
        item,
    ] = values;

    if (typeof name !== 'string') {
        throw new Error(`Scenario ${label} row ${index} has no name.`);
    }

    return {
        affinity: asNullableNumber(affinity),
        name,
        picture: typeof picture === 'number' || typeof picture === 'string' ? picture : null,
        nation: typeof nation === 'number' || typeof nation === 'string' ? nation : null,
        city: asNullableString(city),
        leadership: asNumber(leadership, 0),
        strength: asNumber(strength, 0),
        intelligence: asNumber(intelligence, 0),
        officerLevel: asNumber(officerLevel, 0),
        birthYear: asNumber(birthYear, 0),
        deathYear: asNumber(deathYear, 0),
        personality: asNullableString(personality),
        special: asNullableString(special),
        specialWar: asNullableString(specialWar),
        horse: asNullableString(horse),
        weapon: asNullableString(weapon),
        book: asNullableString(book),
        item: asNullableString(item),
        text: asNullableString(text),
    };
};

const parseGeneralRows = (rows: unknown[], label: string): ScenarioGeneral[] =>
    rows.map((row, index) => parseGeneralRow(row, index, label));

const parseNationRows = (rows: unknown[]): ScenarioNation[] => rows.map((row, index) => parseNationRow(row, index));

const parseDiplomacyRows = (rows: unknown[]): ScenarioDiplomacy[] =>
    rows.map((row, index) => parseDiplomacyRow(row, index));

export const parseScenarioDefaults = (raw: unknown): ScenarioDefaults => {
    // 기본 시나리오 설정값을 안전하게 읽는다.
    const data = ScenarioDefaultsInputSchema.parse(raw);
    const stat = parseScenarioStatBlock(data.stat, FALLBACK_STAT);
    const iconPath = asString(data.iconPath, '.');
    return { stat, iconPath };
};

export const parseScenarioDefinition = (raw: unknown, defaults: ScenarioDefaults): ScenarioDefinition => {
    // 시나리오 JSON을 런타임에서 쓰는 구조로 정규화한다.
    const data = ScenarioDefinitionInputSchema.parse(raw);
    const stat = parseScenarioStatBlock(data.stat, defaults.stat);
    const mapConfig = data.map ?? {};
    const constConfig = data.const ?? {};
    const config: ScenarioConfig = {
        stat,
        iconPath: asString(data.iconPath, defaults.iconPath),
        map: mapConfig,
        const: constConfig,
        environment: parseScenarioEnvironment(mapConfig, constConfig),
    };

    const title = data.title;
    const startYear = typeof data.startYear === 'number' ? data.startYear : null;
    const life = typeof data.life === 'number' ? data.life : null;
    const fiction = typeof data.fiction === 'number' ? data.fiction : null;
    const history = asStringArray(data.history);
    const ignoreDefaultEvents = Boolean(data.ignoreDefaultEvents);
    const nations = parseNationRows(data.nation ?? []);
    const diplomacy = parseDiplomacyRows(data.diplomacy ?? []);
    const generals = parseGeneralRows(data.general ?? [], 'general');
    const generalsEx = parseGeneralRows(data.general_ex ?? [], 'general_ex');
    const generalsNeutral = parseGeneralRows(data.general_neutral ?? [], 'general_neutral');
    const events = data.events ?? [];
    const initialEvents = data.initialEvents ?? data.initialActions ?? [];

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
        cities: data.cities ?? [],
        events,
        initialEvents,
        ignoreDefaultEvents,
    };
};
