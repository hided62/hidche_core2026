import type { GamePrisma, GamePrismaClient } from './gamePrisma.js';

export interface ErrorLogQueryOptions {
    limit?: number;
    beforeId?: number;
    category?: string;
}

export interface ErrorLogCreateInput {
    category: string;
    message: string;
    source?: string;
    trace?: string;
    context?: GamePrisma.InputJsonValue;
}

export interface ErrorLogView {
    id: number;
    category: string;
    source: string | null;
    message: string;
    trace: string | null;
    context: GamePrisma.JsonValue;
    createdAt: Date;
}

const buildPaginationWhere = (
    base: GamePrisma.ErrorLogWhereInput,
    options: ErrorLogQueryOptions
): GamePrisma.ErrorLogWhereInput => {
    if (options.beforeId) {
        return {
            ...base,
            id: { lt: options.beforeId },
        };
    }
    return base;
};

const buildFindArgs = (
    where: GamePrisma.ErrorLogWhereInput,
    options: ErrorLogQueryOptions
): GamePrisma.ErrorLogFindManyArgs => ({
    where: buildPaginationWhere(where, options),
    orderBy: { id: 'desc' },
    take: options.limit ?? 50,
});

export class ErrorLogRepository {
    constructor(private readonly prisma: GamePrismaClient) {}

    async createErrorLog(input: ErrorLogCreateInput): Promise<ErrorLogView> {
        return this.prisma.errorLog.create({
            data: {
                category: input.category,
                source: input.source ?? null,
                message: input.message,
                trace: input.trace ?? null,
                context: input.context ?? {},
            },
        });
    }

    async listErrorLogs(options: ErrorLogQueryOptions = {}): Promise<ErrorLogView[]> {
        const base: GamePrisma.ErrorLogWhereInput = options.category ? { category: options.category } : {};
        return this.prisma.errorLog.findMany(buildFindArgs(base, options));
    }
}
