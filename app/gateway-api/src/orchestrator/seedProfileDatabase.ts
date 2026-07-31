import { seedScenarioToDatabase, type ScenarioInstallOptions } from '@sammo-ts/game-engine';
import type { GamePrisma } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';

export interface AdminSeedUser {
    id: string;
    username: string;
    displayName?: string | null;
}

export interface SeedProfileDatabaseOptions {
    databaseUrl: string;
    scenarioId: number;
    tickSeconds?: number;
    now?: Date;
    installOptions?: ScenarioInstallOptions;
    scenarioOptions?: Parameters<typeof seedScenarioToDatabase>[0]['scenarioOptions'];
    mapOptions?: Parameters<typeof seedScenarioToDatabase>[0]['mapOptions'];
    unitSetOptions?: Parameters<typeof seedScenarioToDatabase>[0]['unitSetOptions'];
    adminUser?: AdminSeedUser | null;
}

const DEFAULT_STAT_TOTAL = 165;
const DEFAULT_STAT_MIN = 15;
const DEFAULT_STAT_MAX = 80;

const hashString = (value: string): number => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
};

const resolveAdminStats = (config: Record<string, unknown>) => {
    const stat = asRecord(config.stat);
    const total = typeof stat.total === 'number' && Number.isFinite(stat.total) ? stat.total : DEFAULT_STAT_TOTAL;
    const min = typeof stat.min === 'number' && Number.isFinite(stat.min) ? stat.min : DEFAULT_STAT_MIN;
    const max = typeof stat.max === 'number' && Number.isFinite(stat.max) ? stat.max : DEFAULT_STAT_MAX;

    const stats = [min, min, min];
    let remaining = Math.max(0, total - min * 3);
    let guard = 0;
    while (remaining > 0 && guard < 1000) {
        let progressed = false;
        for (let i = 0; i < stats.length && remaining > 0; i += 1) {
            if (stats[i] >= max) {
                continue;
            }
            stats[i] += 1;
            remaining -= 1;
            progressed = true;
        }
        if (!progressed) {
            break;
        }
        guard += 1;
    }

    return {
        leadership: stats[0],
        strength: stats[1],
        intelligence: stats[2],
    };
};

const resolveAdminName = async (prisma: GamePrisma.TransactionClient, adminUser: AdminSeedUser): Promise<string> => {
    const base = (adminUser.displayName ?? adminUser.username ?? '').trim() || '관리자';
    const existing = await prisma.general.findFirst({ where: { name: base } });
    if (!existing) {
        return base;
    }
    const suffix = adminUser.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'admin';
    for (let i = 1; ; i += 1) {
        const candidate = `${base}_${suffix}${i}`;
        const found = await prisma.general.findFirst({ where: { name: candidate } });
        if (!found) {
            return candidate;
        }
    }
};

// 초기 설치/통합 테스트에서 관리자 장수를 자동 생성한다.
const ensureAdminGeneral = async (prisma: GamePrisma.TransactionClient, adminUser: AdminSeedUser): Promise<void> => {
    const existing = await prisma.general.findFirst({ where: { userId: adminUser.id } });
    if (existing) {
        return;
    }

    const worldState = await prisma.worldState.findFirst();
    if (!worldState) {
        throw new Error('Seeded world state is missing before admin general creation.');
    }

    const cityRows = await prisma.city.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
    });
    const cityId = cityRows.length > 0 ? cityRows[hashString(adminUser.id) % cityRows.length]!.id : 0;

    const maxId = await prisma.general.aggregate({ _max: { id: true } });
    const nextId = (maxId._max.id ?? 0) + 1;
    const stats = resolveAdminStats(asRecord(worldState.config));
    const name = await resolveAdminName(prisma, adminUser);
    const meta = asRecord(worldState.meta);
    const rawTurnTime = typeof meta.turntime === 'string' ? new Date(meta.turntime) : null;
    const turnTime = rawTurnTime && !Number.isNaN(rawTurnTime.getTime()) ? rawTurnTime : new Date();

    await prisma.general.create({
        data: {
            id: nextId,
            userId: adminUser.id,
            name,
            nationId: 0,
            cityId,
            troopId: 0,
            npcState: 0,
            leadership: stats.leadership,
            strength: stats.strength,
            intel: stats.intelligence,
            personalCode: 'None',
            specialCode: 'None',
            special2Code: 'None',
            turnTime,
            meta: {
                createdBy: 'admin-seed',
                killturn: 24,
            },
        },
    });
};

// 시나리오 시드 후 관리자 장수를 포함한 초기 데이터를 준비한다.
export const seedProfileDatabase = async (options: SeedProfileDatabaseOptions) => {
    const adminUser = options.adminUser;
    const result = await seedScenarioToDatabase({
        scenarioId: options.scenarioId,
        databaseUrl: options.databaseUrl,
        tickSeconds: options.tickSeconds,
        now: options.now,
        installOptions: options.installOptions,
        scenarioOptions: options.scenarioOptions,
        mapOptions: options.mapOptions,
        unitSetOptions: options.unitSetOptions,
        onBeforeCommit: adminUser ? async (transaction) => ensureAdminGeneral(transaction, adminUser) : undefined,
    });

    return result;
};
