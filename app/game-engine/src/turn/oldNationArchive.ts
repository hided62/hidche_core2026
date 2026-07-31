import { asRecord } from '@sammo-ts/common';
import type { Nation } from '@sammo-ts/logic';

const readNumber = (value: unknown): number => {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
};

const readTextArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export const buildOldNationArchiveData = (options: {
    nation: Nation;
    generalIds: readonly number[];
    history: readonly string[];
}): Record<string, unknown> => {
    const { nation } = options;
    const meta = asRecord(nation.meta);
    const maxPower = asRecord(meta.max_power);
    const aux = {
        ...asRecord(meta.aux),
        ...maxPower,
    };
    const maxCities = readTextArray(maxPower.maxCities);

    return {
        ...nation,
        nation: nation.id,
        type: nation.typeCode,
        tech: readNumber(meta.tech),
        maxPower: readNumber(maxPower.maxPower),
        maxCrew: readNumber(maxPower.maxCrew),
        maxCities,
        aux,
        generals: [...options.generalIds],
        history: [...options.history],
    };
};
