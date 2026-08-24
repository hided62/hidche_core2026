import { listBattleResultSeasons, type BattleResultSeasonManifest } from './battleResultSource.js';
import { migrateBattleResults, type BattleResultMigrationSummary } from './battleResults.js';
import { createMariaPool, createPostgresPool, querySource } from './db.js';
import { migrateGame } from './game.js';
import { migrateGateway, type MigrationSummary } from './gateway.js';
import type { MigrationMode } from './incremental.js';
import type { ResolvedMigrationPlan, ResolvedMigrationStage } from './config.js';
import { migrationInventoryForStage } from './inventory.js';
import { prepareLegacyUserIcons } from './legacyUserIcons.js';

export interface PlanRunSummary {
    command: 'run-plan';
    sourceSet: string;
    mode: MigrationMode;
    apply: boolean;
    stages: Array<{
        name: string;
        status: 'COMPLETED';
        summary: MigrationSummary;
        battleResults?: BattleResultMigrationSummary;
    }>;
}

interface StagePreflight {
    battleResults?: { seasons: number; files: number; bytes: number };
    battleResultManifests?: readonly BattleResultSeasonManifest[];
    userIcons?: { custom: number; legacyFiles: number; existingUploads: number; rejected: number };
}

const preflightStage = async (stage: ResolvedMigrationStage): Promise<StagePreflight> => {
    const source = createMariaPool(stage.sourceUrl);
    const target = createPostgresPool(stage.targetUrl);
    try {
        const sourceDatabase = await querySource(source, 'SELECT DATABASE() AS database_name');
        if (typeof sourceDatabase[0]?.database_name !== 'string') {
            throw new Error(`Source preflight did not select a database for ${stage.name}`);
        }
        const requiredSourceTables =
            stage.kind === 'gateway'
                ? ['member', 'member_log', 'banned_member', 'storage', 'system']
                : [
                      'ng_games',
                      'hall',
                      'ng_old_generals',
                      'ng_old_nations',
                      'emperior',
                      'inheritance_result',
                      'user_record',
                      'storage',
                      'ng_history',
                  ];
        const sourceTables = await querySource(
            source,
            `SELECT table_name AS source_table_name
             FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name IN (${requiredSourceTables.map(() => '?').join(', ')})`,
            requiredSourceTables
        );
        const availableSourceTables = new Set(sourceTables.map((row) => String(row.source_table_name)));
        const missingSourceTables = requiredSourceTables.filter((table) => !availableSourceTables.has(table));
        if (missingSourceTables.length) {
            throw new Error(`Source ${stage.name} is missing required tables: ${missingSourceTables.join(', ')}`);
        }
        await target.query('SELECT 1');
        const checkpointTable =
            stage.kind === 'gateway' ? 'public.legacy_import_checkpoint' : 'legacy_archive.import_checkpoint';
        const migrationReady = await target.query<{ table_name: string | null }>(
            'SELECT to_regclass($1) AS table_name',
            [checkpointTable]
        );
        if (!migrationReady.rows[0]?.table_name) {
            throw new Error(`Target migrations are not current for ${stage.name}; missing ${checkpointTable}`);
        }
        const targetDataTable = stage.kind === 'gateway' ? 'public.app_user' : 'inheritance_result';
        const targetReady = await target.query<{ table_name: string | null }>('SELECT to_regclass($1) AS table_name', [
            targetDataTable,
        ]);
        if (!targetReady.rows[0]?.table_name) {
            throw new Error(`Target migrations are not current for ${stage.name}; missing ${targetDataTable}`);
        }
        if (stage.kind === 'gateway') {
            const iconRows = await querySource(
                source,
                `SELECT NO, PICTURE, IMGSVR, REG_DATE
                 FROM member WHERE PICTURE <> 'default.jpg' ORDER BY NO`
            );
            const prepared = await prepareLegacyUserIcons(iconRows, stage.userIcons, false);
            return {
                userIcons: {
                    custom: prepared.counts.custom,
                    legacyFiles: prepared.counts.legacyFiles,
                    existingUploads: prepared.counts.existingUploads,
                    rejected: prepared.counts.rejected,
                },
            };
        }
        if (stage.battleResults) {
            const battleResultReady = await target.query<{ table_name: string | null }>(
                'SELECT to_regclass($1) AS table_name',
                ['legacy_archive.general_battle_result']
            );
            if (!battleResultReady.rows[0]?.table_name) {
                throw new Error(
                    `Target migrations are not current for ${stage.name}; missing legacy_archive.general_battle_result`
                );
            }
            const seasons = await listBattleResultSeasons(stage.battleResults, stage.profile!);
            return {
                battleResults: {
                    seasons: seasons.length,
                    files: seasons.reduce((sum, season) => sum + season.fileCount, 0),
                    bytes: seasons.reduce((sum, season) => sum + season.totalBytes, 0),
                },
                battleResultManifests: seasons,
            };
        }
        return {};
    } finally {
        await source.end();
        await target.end();
    }
};

export const checkMigrationPlan = async (plan: ResolvedMigrationPlan): Promise<Record<string, unknown>> => {
    const stages = [];
    for (const stage of plan.stages) {
        const preflight = await preflightStage(stage);
        stages.push({
            name: stage.name,
            kind: stage.kind,
            status: 'READY',
            inventory: migrationInventoryForStage(stage),
            ...(preflight.battleResults ? { battleResults: preflight.battleResults } : {}),
            ...(preflight.userIcons ? { userIcons: preflight.userIcons } : {}),
        });
    }
    return {
        command: 'check-plan',
        sourceSet: plan.sourceSet,
        stages,
    };
};

export const runMigrationPlan = async (
    plan: ResolvedMigrationPlan,
    mode: MigrationMode,
    apply: boolean,
    migratedAt = new Date()
): Promise<PlanRunSummary> => {
    const preflights = new Map<string, StagePreflight>();
    for (const stage of plan.stages) {
        preflights.set(stage.name, await preflightStage(stage));
    }
    const stages: PlanRunSummary['stages'] = [];
    for (const stage of plan.stages) {
        const source = createMariaPool(stage.sourceUrl);
        const target = createPostgresPool(stage.targetUrl);
        try {
            const execution = { mode, source: stage.sourceIdentity } as const;
            const summary =
                stage.kind === 'gateway'
                    ? await migrateGateway(source, target, apply, migratedAt, execution, stage.userIcons)
                    : await migrateGame(source, target, apply, stage.profile!, execution);
            const battleResults =
                stage.kind === 'game' && stage.battleResults
                    ? await migrateBattleResults(
                          target,
                          stage.battleResults,
                          apply,
                          stage.profile!,
                          {
                              mode,
                              source: stage.battleResults.identity,
                          },
                          preflights.get(stage.name)?.battleResultManifests
                      )
                    : undefined;
            stages.push({
                name: stage.name,
                status: 'COMPLETED',
                summary,
                ...(battleResults ? { battleResults } : {}),
            });
        } finally {
            await source.end();
            await target.end();
        }
    }
    return { command: 'run-plan', sourceSet: plan.sourceSet, mode, apply, stages };
};
