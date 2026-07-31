import { asNumber, asRecord } from '@sammo-ts/common';

const DEFAULT_MIN_TURNS = 2;

export const readPrestartDeleteAfter = (meta: Record<string, unknown>): Date | null => {
    const value = meta.prestart_delete_after;
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const buildPrestartDeleteAfter = (base: Date, tickSeconds: number, config: Record<string, unknown>): Date => {
    const configConst = asRecord(config.const);
    const minTurns = Math.max(0, Math.floor(asNumber(configConst.minTurnDieOnPrestart, DEFAULT_MIN_TURNS)));
    return new Date(base.getTime() + Math.max(1, Math.floor(tickSeconds)) * minTurns * 1_000);
};

export const formatPrestartDeleteAfter = (value: Date): string => {
    const seoul = new Date(value.getTime() + 9 * 60 * 60 * 1_000);
    const pad = (part: number): string => String(part).padStart(2, '0');
    return [
        `${seoul.getUTCFullYear()}-${pad(seoul.getUTCMonth() + 1)}-${pad(seoul.getUTCDate())}`,
        `${pad(seoul.getUTCHours())}:${pad(seoul.getUTCMinutes())}:${pad(seoul.getUTCSeconds())}`,
    ].join(' ');
};
