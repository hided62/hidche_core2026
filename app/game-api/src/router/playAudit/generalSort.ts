import { TRPCError } from '@trpc/server';
import { GamePrisma } from '@sammo-ts/infra';
import { z } from 'zod';
import { generalSelect, projectCurrentGeneral, zAuditGeneralData } from './projection.js';

export const zGeneralSort = z.enum([
    'id',
    'gold',
    'rice',
    'crew',
    'train',
    'atmos',
    'leadership',
    'strength',
    'intelligence',
    'experience',
    'dedication',
    'dex1',
    'dex2',
    'dex3',
    'dex4',
    'dex5',
]);
export const zGeneralCursor = z.object({ id: z.number().int().nonnegative(), value: z.number().nullable() }).strict();
const columns: Record<z.infer<typeof zGeneralSort>, string> = {
    id: 'id',
    gold: 'gold',
    rice: 'rice',
    crew: 'crew',
    train: 'train',
    atmos: 'atmos',
    leadership: 'leadership',
    strength: 'strength',
    intelligence: 'intel',
    experience: 'experience',
    dedication: 'dedication',
    dex1: 'dex1',
    dex2: 'dex2',
    dex3: 'dex3',
    dex4: 'dex4',
    dex5: 'dex5',
};
export const readSortedGenerals = async (
    tx: GamePrisma.TransactionClient,
    input: {
        sort: z.infer<typeof zGeneralSort>;
        order: 'asc' | 'desc';
        limit: number;
        cursor?: number | z.infer<typeof zGeneralCursor>;
        nationId?: number;
        cityId?: number;
        population?: 'human' | 'npc' | 'troopNpc';
        name?: string;
    },
    sampleId?: string
) => {
    if (typeof input.cursor === 'number')
        throw new TRPCError({ code: 'BAD_REQUEST', message: '정렬 조건에 맞는 다음 페이지를 선택해 주세요.' });
    // SQL 식별자/JSON 경로는 서버 allowlist에서만 조립한다. 사용자 문자열은 parameter다.
    const id = GamePrisma.raw(sampleId ? 'general_id' : 'id');
    const path = ['leadership', 'strength', 'intelligence'].includes(input.sort)
        ? `stats,${input.sort}`
        : input.sort.startsWith('dex')
          ? `dex,${input.sort}`
          : input.sort;
    const metric = sampleId
        ? GamePrisma.raw(`(data #>> '{${path}}')::double precision`)
        : input.sort.startsWith('dex')
          ? GamePrisma.raw(
                `CASE WHEN jsonb_typeof(meta->'${input.sort}') = 'number' THEN (meta->>'${input.sort}')::double precision ELSE 0 END`
            )
          : GamePrisma.raw(columns[input.sort]);
    const filters: GamePrisma.Sql[] = [];
    if (sampleId) filters.push(GamePrisma.sql`sample_id = ${sampleId}`);
    if (input.nationId !== undefined) filters.push(GamePrisma.sql`nation_id = ${input.nationId}`);
    if (input.cityId !== undefined) filters.push(GamePrisma.sql`city_id = ${input.cityId}`);
    if (input.population === 'human') filters.push(GamePrisma.sql`npc_state < 2`);
    if (input.population === 'npc') filters.push(GamePrisma.sql`npc_state >= 2 AND npc_state <> 5`);
    if (input.population === 'troopNpc') filters.push(GamePrisma.sql`npc_state = 5`);
    if (input.name)
        filters.push(
            GamePrisma.sql`${GamePrisma.raw(sampleId ? "data->>'name'" : 'name')} LIKE ${`%${input.name.replace(/[\\%_]/g, '\\$&')}%`}`
        );
    if (input.cursor) {
        const { value, id: cursorId } = input.cursor;
        filters.push(
            value === null
                ? GamePrisma.sql`(${metric} IS NULL AND ${id} > ${cursorId})`
                : GamePrisma.sql`(${metric} ${GamePrisma.raw(input.order === 'asc' ? '>' : '<')} ${value} OR (${metric} = ${value} AND ${id} > ${cursorId}) OR ${metric} IS NULL)`
        );
    }
    const rows = await tx.$queryRaw<{ id: number; value: number | null; data: unknown }[]>(GamePrisma.sql`
        SELECT ${id} AS id, ${metric} AS value, ${sampleId ? GamePrisma.raw('data') : GamePrisma.sql`NULL`} AS data
        FROM ${GamePrisma.raw(sampleId ? 'play_audit_general' : 'general')}
        WHERE ${filters.length ? GamePrisma.join(filters, ' AND ') : GamePrisma.sql`TRUE`}
        ORDER BY ${metric} ${GamePrisma.raw(input.order.toUpperCase())} NULLS LAST, ${id} ASC LIMIT ${input.limit + 1}
    `);
    const page = rows.slice(0, input.limit);
    const current = sampleId
        ? []
        : await tx.general.findMany({ where: { id: { in: page.map((row) => row.id) } }, select: generalSelect });
    const byId = new Map(current.map((row) => [row.id, projectCurrentGeneral(row)]));
    return {
        items: page.map((row) => (sampleId ? zAuditGeneralData.parse(row.data) : byId.get(row.id)!)),
        nextCursor:
            rows.length > input.limit ? { id: page[page.length - 1]!.id, value: page[page.length - 1]!.value } : null,
    };
};
