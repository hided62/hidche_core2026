export interface DatabaseClient<
    WorldStateRow = unknown,
    GeneralRow = unknown,
    CityRow = unknown,
    NationRow = unknown,
    GeneralTurnRow = unknown,
    NationTurnRow = unknown
> {
    $queryRaw<T = unknown>(
        query: TemplateStringsArray,
        ...values: unknown[]
    ): Promise<T>;
    worldState: {
        findFirst(args?: unknown): Promise<WorldStateRow | null>;
    };
    general: {
        findUnique(args: { where: { id: number } }): Promise<GeneralRow | null>;
        findFirst(args: {
            where: { userId?: string; npcState?: number | { gt: number } };
            select?: { name?: boolean; picture?: boolean };
        }): Promise<GeneralRow | null>;
        count(args?: {
            where?: { npcState?: number | { gt: number } };
        }): Promise<number>;
    };
    city: {
        findUnique(args: { where: { id: number } }): Promise<CityRow | null>;
    };
    nation: {
        findUnique(args: { where: { id: number } }): Promise<NationRow | null>;
        count(args?: { where?: { level?: { gt: number } } }): Promise<number>;
    };
    generalTurn: {
        findMany(args: {
            where: { generalId: number };
            orderBy?: { turnIdx: 'asc' | 'desc' }[];
        }): Promise<GeneralTurnRow[]>;
        deleteMany(args: { where: { generalId: number } }): Promise<unknown>;
        createMany(args: {
            data: Array<{
                generalId: number;
                turnIdx: number;
                actionCode: string;
                arg: unknown;
            }>;
        }): Promise<unknown>;
    };
    nationTurn: {
        findMany(args: {
            where: { nationId: number; officerLevel: number };
            orderBy?: { turnIdx: 'asc' | 'desc' }[];
        }): Promise<NationTurnRow[]>;
        deleteMany(args: {
            where: { nationId: number; officerLevel: number };
        }): Promise<unknown>;
        createMany(args: {
            data: Array<{
                nationId: number;
                officerLevel: number;
                turnIdx: number;
                actionCode: string;
                arg: unknown;
            }>;
        }): Promise<unknown>;
    };
}
