import { LogCategory, LogScope, type GamePrisma, type GamePrismaClient } from './gamePrisma.js';

export interface LogQueryOptions {
    limit?: number;
    beforeId?: number;
}

export interface LogEntryView {
    id: number;
    scope: LogScope;
    category: LogCategory;
    subType: string | null;
    text: string;
    year: number;
    month: number;
    createdAt: Date;
    generalId: number | null;
    nationId: number | null;
    userId: number | null;
}

const buildPaginationWhere = (
    base: GamePrisma.LogEntryWhereInput,
    options: LogQueryOptions
): GamePrisma.LogEntryWhereInput => {
    if (options.beforeId) {
        return {
            ...base,
            id: { lt: options.beforeId },
        };
    }
    return base;
};

const buildFindArgs = (
    where: GamePrisma.LogEntryWhereInput,
    options: LogQueryOptions
): GamePrisma.LogEntryFindManyArgs => ({
    where: buildPaginationWhere(where, options),
    orderBy: { id: 'desc' },
    take: options.limit ?? 50,
});

export class LogRepository {
    constructor(private readonly prisma: GamePrismaClient) {}

    // 전역(시스템) 로그 조회
    async listSystemLogs(category: LogCategory, options: LogQueryOptions = {}): Promise<LogEntryView[]> {
        return this.prisma.logEntry.findMany(
            buildFindArgs(
                {
                    scope: LogScope.SYSTEM,
                    category,
                },
                options
            )
        );
    }

    // 국가 로그 조회
    async listNationLogs(
        nationId: number,
        category: LogCategory,
        options: LogQueryOptions = {}
    ): Promise<LogEntryView[]> {
        return this.prisma.logEntry.findMany(
            buildFindArgs(
                {
                    scope: LogScope.NATION,
                    category,
                    nationId,
                },
                options
            )
        );
    }

    // 장수 로그 조회
    async listGeneralLogs(
        generalId: number,
        category: LogCategory,
        options: LogQueryOptions = {}
    ): Promise<LogEntryView[]> {
        return this.prisma.logEntry.findMany(
            buildFindArgs(
                {
                    scope: LogScope.GENERAL,
                    category,
                    generalId,
                },
                options
            )
        );
    }

    // 유저 로그 조회
    async listUserLogs(userId: number, options: LogQueryOptions & { subType?: string } = {}): Promise<LogEntryView[]> {
        return this.prisma.logEntry.findMany(
            buildFindArgs(
                {
                    scope: LogScope.USER,
                    category: LogCategory.USER,
                    userId,
                    subType: options.subType,
                },
                options
            )
        );
    }
}
