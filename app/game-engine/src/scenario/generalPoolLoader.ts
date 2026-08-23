import fs from 'node:fs/promises';
import path from 'node:path';

import { isRecord } from '@sammo-ts/common';
import { isEventDomesticTraitKey } from '@sammo-ts/logic';

import { resolveWorkspaceRoot } from '../paths.js';

const DEFAULT_GENERAL_POOL_ROOT = path.resolve(resolveWorkspaceRoot(), 'resources', 'general-pool');
const SUPPORTED_POOLS = new Set(['SPoolUnderU30', 'SPoolUnderU100']);
const BASE_COLUMNS = [
    'generalName',
    'leadership',
    'strength',
    'intel',
    'specialDomestic',
    'dex',
    'imgsvr',
    'picture',
] as const;
const CENTENNIAL_COLUMNS = [
    ...BASE_COLUMNS,
    'sourcePhase',
    'sourceServerId',
    'sourceGeneralNo',
    'selectionReasons',
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

const normalizePoolRow = (
    poolName: string,
    columns: readonly string[],
    row: unknown,
    index: number
): GeneralPoolSeedEntry => {
    if (!Array.isArray(row) || row.length !== columns.length) {
        throw new Error(`General pool row ${index} does not match the expected ${columns.length} columns.`);
    }
    const info = Object.fromEntries(columns.map((column, columnIndex) => [column, row[columnIndex]]));
    const generalName = info.generalName;
    if (typeof generalName !== 'string' || generalName.length === 0) {
        throw new Error(`General pool row ${index} has no generalName.`);
    }
    const uniqueName = poolName === 'SPoolUnderU100' ? `A100${String(index + 1).padStart(4, '0')}` : generalName;
    if (uniqueName.length > 20) {
        throw new Error(`General pool row ${index} has a generalName longer than the select_pool key.`);
    }
    const isCentennial = poolName === 'SPoolUnderU100';
    const specialDomesticIsValid =
        (isCentennial && info.specialDomestic === null) ||
        (typeof info.specialDomestic === 'string' && isEventDomesticTraitKey(info.specialDomestic));
    if (
        !Number.isInteger(info.leadership) ||
        !Number.isInteger(info.strength) ||
        !Number.isInteger(info.intel) ||
        !specialDomesticIsValid ||
        !Array.isArray(info.dex) ||
        info.dex.length !== 5 ||
        info.dex.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0) ||
        (!isCentennial && info.dex.reduce((sum, value) => sum + Number(value), 0) <= 0) ||
        (info.imgsvr !== 0 && info.imgsvr !== 1) ||
        typeof info.picture !== 'string'
    ) {
        throw new Error(`General pool row ${index} contains invalid candidate data.`);
    }
    if (
        isCentennial &&
        (!Number.isInteger(info.sourcePhase) ||
            typeof info.sourceServerId !== 'string' ||
            !Number.isInteger(info.sourceGeneralNo) ||
            !Array.isArray(info.selectionReasons) ||
            info.selectionReasons.some((reason) => typeof reason !== 'string'))
    ) {
        throw new Error(`General pool row ${index} contains invalid source metadata.`);
    }
    return {
        uniqueName,
        info: {
            ...info,
            uniqueName,
            ...(isCentennial ? { event100Growth: true } : {}),
        },
    };
};

export const loadGeneralPoolEntries = async (
    poolName: string,
    options?: GeneralPoolLoaderOptions
): Promise<GeneralPoolSeedEntry[]> => {
    if (!SUPPORTED_POOLS.has(poolName)) {
        throw new Error(`Unsupported general pool: ${poolName}.`);
    }
    const root = path.resolve(options?.generalPoolRoot ?? DEFAULT_GENERAL_POOL_ROOT);
    const raw = await readPoolResource(path.resolve(root, `${poolName}.json`));
    if (!isRecord(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.data)) {
        throw new Error(`General pool ${poolName} is not a valid resource.`);
    }
    const expectedColumns = poolName === 'SPoolUnderU100' ? CENTENNIAL_COLUMNS : BASE_COLUMNS;
    if (
        raw.columns.length !== expectedColumns.length ||
        raw.columns.some((column, index) => column !== expectedColumns[index])
    ) {
        throw new Error(`General pool ${poolName} has an unexpected column contract.`);
    }
    const entries = raw.data.map((row, index) => normalizePoolRow(poolName, expectedColumns, row, index));
    if (new Set(entries.map((entry) => entry.uniqueName)).size !== entries.length) {
        throw new Error(`General pool ${poolName} contains duplicate unique names.`);
    }
    return entries;
};
