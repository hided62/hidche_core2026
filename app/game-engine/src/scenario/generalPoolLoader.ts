import fs from 'node:fs/promises';
import path from 'node:path';

import { isRecord } from '@sammo-ts/common';
import { isEventDomesticTraitKey } from '@sammo-ts/logic';

import { resolveWorkspaceRoot } from '../paths.js';

const DEFAULT_GENERAL_POOL_ROOT = path.resolve(resolveWorkspaceRoot(), 'resources', 'general-pool');
const SUPPORTED_POOL = 'SPoolUnderU30';
const EXPECTED_COLUMNS = [
    'generalName',
    'leadership',
    'strength',
    'intel',
    'specialDomestic',
    'dex',
    'imgsvr',
    'picture',
] as const;

export interface GeneralPoolSeedEntry {
    uniqueName: string;
    info: Record<string, unknown>;
}

export interface GeneralPoolLoaderOptions {
    generalPoolRoot?: string;
}

const readPoolResource = async (filePath: string): Promise<unknown> =>
    JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;

const normalizePoolRow = (row: unknown, index: number): GeneralPoolSeedEntry => {
    if (!Array.isArray(row) || row.length !== EXPECTED_COLUMNS.length) {
        throw new Error(`General pool row ${index} does not match the expected ${EXPECTED_COLUMNS.length} columns.`);
    }
    const info = Object.fromEntries(EXPECTED_COLUMNS.map((column, columnIndex) => [column, row[columnIndex]]));
    const uniqueName = info.generalName;
    if (typeof uniqueName !== 'string' || uniqueName.length === 0) {
        throw new Error(`General pool row ${index} has no generalName.`);
    }
    if (uniqueName.length > 20) {
        throw new Error(`General pool row ${index} has a generalName longer than the select_pool key.`);
    }
    if (
        !Number.isInteger(info.leadership) ||
        !Number.isInteger(info.strength) ||
        !Number.isInteger(info.intel) ||
        typeof info.specialDomestic !== 'string' ||
        !isEventDomesticTraitKey(info.specialDomestic) ||
        !Array.isArray(info.dex) ||
        info.dex.length !== 5 ||
        info.dex.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0) ||
        info.dex.reduce((sum, value) => sum + Number(value), 0) <= 0 ||
        (info.imgsvr !== 0 && info.imgsvr !== 1) ||
        typeof info.picture !== 'string'
    ) {
        throw new Error(`General pool row ${index} contains invalid candidate data.`);
    }
    return {
        uniqueName,
        info: {
            ...info,
            uniqueName,
        },
    };
};

export const loadGeneralPoolEntries = async (
    poolName: string,
    options?: GeneralPoolLoaderOptions
): Promise<GeneralPoolSeedEntry[]> => {
    if (poolName !== SUPPORTED_POOL) {
        throw new Error(`Unsupported general pool: ${poolName}.`);
    }
    const root = path.resolve(options?.generalPoolRoot ?? DEFAULT_GENERAL_POOL_ROOT);
    const raw = await readPoolResource(path.resolve(root, `${poolName}.json`));
    if (!isRecord(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.data)) {
        throw new Error(`General pool ${poolName} is not a valid resource.`);
    }
    if (
        raw.columns.length !== EXPECTED_COLUMNS.length ||
        raw.columns.some((column, index) => column !== EXPECTED_COLUMNS[index])
    ) {
        throw new Error(`General pool ${poolName} has an unexpected column contract.`);
    }
    const entries = raw.data.map(normalizePoolRow);
    if (new Set(entries.map((entry) => entry.uniqueName)).size !== entries.length) {
        throw new Error(`General pool ${poolName} contains duplicate unique names.`);
    }
    return entries;
};
