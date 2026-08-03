import mariadb, { type Pool as MariaPool } from 'mariadb';
import pg, { type PoolClient } from 'pg';

export type SourceRow = Record<string, unknown>;
export type TargetRow = Record<string, unknown>;

class JsonParameter {
    readonly value: unknown;

    constructor(value: unknown) {
        this.value = value;
    }
}

export const jsonParameter = (value: unknown): JsonParameter => new JsonParameter(value);

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MARIA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoteIdentifier = (value: string): string => {
    if (!IDENTIFIER.test(value)) {
        throw new Error(`Unsafe SQL identifier: ${value}`);
    }
    return `"${value}"`;
};

export const createMariaPool = (uri: string): MariaPool => mariadb.createPool(uri);

export const createPostgresPool = (connectionString: string): pg.Pool => {
    const url = new URL(connectionString);
    const schema = url.searchParams.get('schema');
    if (schema && !IDENTIFIER.test(schema)) {
        throw new Error(`Unsafe PostgreSQL schema: ${schema}`);
    }
    url.searchParams.delete('schema');
    return new pg.Pool({
        connectionString: url.toString(),
        max: 2,
        application_name: 'sammo-legacy-db-migration',
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
};

const isSourceRow = (value: unknown): value is SourceRow =>
    value !== null && !Array.isArray(value) && typeof value === 'object';

export const querySource = async (
    pool: MariaPool,
    sql: string,
    parameters: readonly unknown[] = []
): Promise<SourceRow[]> => {
    const result: unknown = await pool.query(sql, [...parameters]);
    if (!Array.isArray(result)) {
        throw new Error('MariaDB query did not return rows');
    }
    return result.filter(isSourceRow);
};

export const paginateSource = async function* (
    pool: MariaPool,
    table: string,
    idColumn: string,
    batchSize: number
): AsyncGenerator<SourceRow[]> {
    if (!MARIA_IDENTIFIER.test(table) || !MARIA_IDENTIFIER.test(idColumn)) {
        throw new Error('Unsafe MariaDB table or ID column');
    }
    let lastId = -1n;
    for (;;) {
        const rows = await querySource(
            pool,
            `SELECT * FROM \`${table}\` WHERE \`${idColumn}\` > ? ORDER BY \`${idColumn}\` ASC LIMIT ?`,
            [lastId.toString(), batchSize]
        );
        if (rows.length === 0) {
            return;
        }
        yield rows;
        lastId = toBigInt(rows.at(-1)?.[idColumn], `${table}.${idColumn}`);
    }
};

const targetValue = (value: unknown): unknown => {
    if (value instanceof JsonParameter) {
        return JSON.stringify(value.value);
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        return JSON.stringify(value);
    }
    return value;
};

export const upsertRows = async (
    client: PoolClient,
    table: string,
    rows: readonly TargetRow[],
    conflictColumns: readonly string[]
): Promise<void> => {
    if (rows.length === 0) {
        return;
    }
    const columns = Object.keys(rows[0]!);
    if (
        columns.length === 0 ||
        rows.some((row) => columns.some((column) => !(column in row))) ||
        conflictColumns.some((column) => !columns.includes(column))
    ) {
        throw new Error(`Inconsistent row shape for ${table}`);
    }

    const values: unknown[] = [];
    const tuples = rows.map((row, rowIndex) => {
        const placeholders = columns.map((column, columnIndex) => {
            values.push(targetValue(row[column]));
            return `$${rowIndex * columns.length + columnIndex + 1}`;
        });
        return `(${placeholders.join(', ')})`;
    });
    const updates = columns
        .filter((column) => !conflictColumns.includes(column))
        .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`);
    const conflictAction = updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';
    await client.query(
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')})
         VALUES ${tuples.join(', ')}
         ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(', ')}) ${conflictAction}`,
        values
    );
};

export const withMigrationLock = async <T>(
    client: PoolClient,
    lockName: string,
    operation: () => Promise<T>
): Promise<T> => {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
    try {
        return await operation();
    } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
    }
};

export const toNumber = (value: unknown, context: string): number => {
    const number = typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : Number(value);
    if (!Number.isSafeInteger(number)) {
        throw new Error(`${context}: expected a safe integer`);
    }
    return number;
};

export const toBigInt = (value: unknown, context: string): bigint => {
    try {
        return BigInt(String(value));
    } catch (error) {
        throw new Error(`${context}: expected an integer`, { cause: error });
    }
};

export const toFloat = (value: unknown, context: string): number => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new Error(`${context}: expected a finite number`);
    }
    return number;
};

export const toStringValue = (value: unknown, context: string): string => {
    if (typeof value !== 'string') {
        throw new Error(`${context}: expected text`);
    }
    return value;
};

export const toNullableString = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

export const toDate = (value: unknown, context: string): Date => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    const text = String(value);
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
        ? `${text.replace(' ', 'T')}Z`
        : text;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`${context}: invalid date`);
    }
    return date;
};

export const toNullableDate = (value: unknown, context: string): Date | null =>
    value === null || value === undefined ? null : toDate(value, context);
