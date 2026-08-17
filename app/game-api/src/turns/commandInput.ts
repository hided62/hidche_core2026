import {
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
    type GeneralTurnCommandSpec,
    type NationTurnCommandSpec,
} from '@sammo-ts/logic';
import { asRecord, isRecord } from '@sammo-ts/common';
import { z } from 'zod';

import { loadTurnCommandProfile } from '@sammo-ts/game-engine/turn/turnCommandProfile.js';

export type TurnCommandOptionValue = string | number;

export interface TurnCommandOption {
    value: TurnCommandOptionValue;
    label: string;
    color?: string;
    description?: string;
}

export interface TurnCommandRecruitmentCrewType {
    id: number;
    armType: number;
    name: string;
    available: boolean;
    special: boolean;
    attack: number;
    defence: number;
    speed: number;
    avoid: number;
    baseCost: number;
    baseRice: number;
    info: string[];
}

export interface TurnCommandRecruitmentGroup {
    armType: number;
    armName: string;
    values: TurnCommandRecruitmentCrewType[];
}

export interface TurnCommandRecruitmentInfo {
    techLevel: number;
    leadership: number;
    fullLeadership: number;
    currentCrewTypeId: number;
    currentCrewTypeName: string;
    crew: number;
    gold: number;
    groups: TurnCommandRecruitmentGroup[];
}

export type TurnCommandOptionSource =
    'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';

export interface TurnCommandInputField {
    key: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
    required: boolean;
    min?: number;
    max?: number;
    step?: number;
    constValue?: TurnCommandOptionValue;
    options?: TurnCommandOption[];
    optionSource?: TurnCommandOptionSource;
    tupleLabels?: string[];
}

export interface TurnCommandInputOptions {
    cities: TurnCommandOption[];
    nations: TurnCommandOption[];
    generals: TurnCommandOption[];
    generalTargets?: Record<string, TurnCommandOption[]>;
    crewTypes: TurnCommandOption[];
    armTypes: TurnCommandOption[];
    nationTypes: TurnCommandOption[];
    colors: TurnCommandOption[];
    items: Record<string, TurnCommandOption[]>;
    recruitment: TurnCommandRecruitmentInfo | null;
    context?: {
        actorGold: number;
        actorRice: number;
        citySecurity?: number;
        nationGold?: number;
        nationRice?: number;
        nationLevel?: number;
    };
}

// 레거시 및 명령 실행 모듈의 인덱스 순서와 동일해야 한다.
export const TURN_COMMAND_NATION_COLORS = [
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#FFA500',
    '#FFDAB9',
    '#FFD700',
    '#FFFF00',
    '#7CFC00',
    '#00FF00',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#20B2AA',
    '#6495ED',
    '#7FFFD4',
    '#AFEEEE',
    '#87CEEB',
    '#00FFFF',
    '#00BFFF',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#BA55D3',
    '#800080',
    '#FF00FF',
    '#FFC0CB',
    '#F5F5DC',
    '#E0FFFF',
    '#FFFFFF',
    '#A9A9A9',
] as const;

const FIELD_LABELS: Record<string, string> = {
    destCityId: '대상 도시',
    destCityID: '대상 도시',
    destGeneralId: '대상 장수',
    destGeneralID: '대상 장수',
    destNationId: '대상 국가',
    nationName: '국가명',
    nationType: '국가 성향',
    colorType: '국기 색상',
    srcArmType: '기존 병과',
    destArmType: '변경 병과',
    itemType: '장비 종류',
    itemCode: '장비',
    crewType: '병종',
    amount: '수량',
    buyRice: '거래',
    isGold: '물자',
    optionText: '행동',
    year: '기간(년)',
    month: '기간(월)',
    commandType: '대응 명령',
    amountList: '지원 물자',
};

const OPTION_SOURCES: Record<string, TurnCommandOptionSource> = {
    destCityId: 'cities',
    destCityID: 'cities',
    destGeneralId: 'generals',
    destGeneralID: 'generals',
    destNationId: 'nations',
    nationType: 'nationTypes',
    colorType: 'colors',
    srcArmType: 'armTypes',
    destArmType: 'armTypes',
    itemCode: 'items',
    crewType: 'crewTypes',
};

const STATIC_LABELS: Record<string, Record<string, string>> = {
    itemType: {
        horse: '명마',
        weapon: '무기',
        book: '서적',
        item: '도구',
    },
    commandType: {
        che_선전포고: '선전포고',
        che_불가침제의: '불가침 제의',
        che_불가침파기제의: '불가침 파기 제의',
        che_종전제의: '종전 제의',
    },
};

type JsonSchema = Record<string, unknown>;

const collectObjectSchema = (schema: JsonSchema): JsonSchema => {
    const branches = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(branches)) {
        const objectBranches = branches.filter(isRecord).map((branch) => collectObjectSchema(branch));
        const properties = Object.assign({}, ...objectBranches.map((branch) => asRecord(branch.properties)));
        const required = Array.from(
            new Set(
                objectBranches.flatMap((branch) =>
                    Array.isArray(branch.required)
                        ? branch.required.filter((entry): entry is string => typeof entry === 'string')
                        : []
                )
            )
        );
        return { ...schema, properties, required };
    }
    return schema;
};

const enumOptions = (fieldKey: string, values: unknown[]): TurnCommandOption[] =>
    values
        .filter((value): value is TurnCommandOptionValue => typeof value === 'string' || typeof value === 'number')
        .filter((value) => fieldKey !== 'commandType' || value !== 'che_피장파장')
        .map((value) => ({
            value,
            label: STATIC_LABELS[fieldKey]?.[String(value)] ?? String(value),
        }));

const buildField = (key: string, rawSchema: unknown, required: boolean): TurnCommandInputField => {
    const schema = asRecord(rawSchema);
    const label = FIELD_LABELS[key] ?? key;
    const constValue = schema.const;
    if (typeof constValue === 'string' || typeof constValue === 'number') {
        return { key, label, kind: 'hidden', required, constValue };
    }

    if (key === 'amountList') {
        return {
            key,
            label,
            kind: 'numberTuple',
            required,
            tupleLabels: ['금', '쌀'],
            min: 0,
            step: 1,
        };
    }

    const optionSource = OPTION_SOURCES[key];
    const enumValues = Array.isArray(schema.enum) ? enumOptions(key, schema.enum) : undefined;
    if (optionSource || enumValues) {
        return {
            key,
            label,
            kind: 'select',
            required,
            optionSource,
            options: enumValues,
        };
    }

    if (schema.type === 'boolean') {
        return { key, label, kind: 'boolean', required };
    }
    if (schema.type === 'number' || schema.type === 'integer') {
        return {
            key,
            label,
            kind: 'number',
            required,
            min: typeof schema.minimum === 'number' ? schema.minimum : undefined,
            max: typeof schema.maximum === 'number' ? schema.maximum : undefined,
            step: schema.type === 'integer' ? 1 : undefined,
        };
    }
    if (schema.type === 'string') {
        return {
            key,
            label,
            kind: 'text',
            required,
            min: typeof schema.minLength === 'number' ? schema.minLength : undefined,
            max: typeof schema.maxLength === 'number' ? schema.maxLength : undefined,
        };
    }

    throw new Error(`Unsupported turn command argument schema: ${key}`);
};

export const buildTurnCommandInputFields = (
    spec: GeneralTurnCommandSpec | NationTurnCommandSpec
): TurnCommandInputField[] => {
    if (!spec.reqArg) {
        return [];
    }
    const jsonSchema = collectObjectSchema(asRecord(z.toJSONSchema(spec.argsSchema)));
    const properties = asRecord(jsonSchema.properties);
    const required = new Set(
        Array.isArray(jsonSchema.required)
            ? jsonSchema.required.filter((entry): entry is string => typeof entry === 'string')
            : []
    );
    return Object.entries(properties).map(([key, schema]) => buildField(key, schema, required.has(key)));
};

export const loadTurnCommandSpecs = async () => {
    const profile = await loadTurnCommandProfile();
    const [general, nation] = await Promise.all([
        loadGeneralTurnCommandSpecs(profile.general),
        loadNationTurnCommandSpecs(profile.nation),
    ]);
    return { general, nation };
};

export const parseReservedTurnArgs = async (
    scope: 'general' | 'nation',
    action: string,
    rawArgs: unknown
): Promise<Record<string, unknown>> => {
    const specs = await loadTurnCommandSpecs();
    const spec = specs[scope].find((entry) => entry.key === action);
    if (!spec) {
        throw new Error(`Unknown ${scope} turn command: ${action}`);
    }
    if (!spec.reqArg) {
        return {};
    }
    return spec.argsSchema.parse(rawArgs);
};
