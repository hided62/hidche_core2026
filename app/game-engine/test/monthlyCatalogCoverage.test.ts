import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MONTHLY_EVENT_ACTION_CATALOG, type MonthlyEventActionName } from '../src/turn/monthlyEventHandler.js';
import { hasRefSourceRoot, resolveRefSourceRoot } from './refSourceRoot.js';

interface CatalogSegment {
    name: string;
    kind: 'single-boundary' | 'multi-month' | 'no-op' | 'expected-failure';
    actions: readonly MonthlyEventActionName[];
    coreEvidence: readonly string[];
    refEvidence: readonly string[];
}

const segments = [
    {
        name: 'aggregate-core-boundary',
        kind: 'single-boundary',
        actions: [
            'ProcessIncome',
            'NoticeToHistoryLog',
            'NewYear',
            'ResetOfficerLock',
            'RandomizeCityTradeRate',
            'ChangeCity',
            'DeleteEvent',
        ],
        coreEvidence: ['monthlyCatalogBoundaryPersistence.integration.test.ts'],
        refEvidence: ['monthly_boundary_core_catalog.json'],
    },
    {
        name: 'city-economy-boundaries',
        kind: 'single-boundary',
        actions: ['RaiseDisaster', 'UpdateCitySupply', 'UpdateNationLevel', 'ProcessSemiAnnual', 'ProcessWarIncome'],
        coreEvidence: [
            'monthlyDisasterPersistence.integration.test.ts',
            'monthlyCitySupplyPersistence.integration.test.ts',
            'monthlyNationLevelPersistence.integration.test.ts',
            'monthlySemiAnnualPersistence.integration.test.ts',
            'monthlyWarIncomePersistence.integration.test.ts',
        ],
        refEvidence: [
            'raise_disaster fixed-seed trace',
            'monthly_update_city_supply.json',
            'monthly_update_nation_level.json',
            'monthly_process_semi_annual.json',
            'monthly_process_war_income.json',
        ],
    },
    {
        name: 'legacy-admin-npc-no-op',
        kind: 'no-op',
        actions: ['CreateAdminNPC'],
        coreEvidence: ['monthlyCreateAdminNpcAction.test.ts'],
        refEvidence: ['monthly_create_admin_npc.json'],
    },
    {
        name: 'npc-registration-boundaries',
        kind: 'single-boundary',
        actions: ['CreateManyNPC', 'RegNPC', 'RegNeutralNPC', 'RaiseNPCNation'],
        coreEvidence: [
            'monthlyCreateManyNpcPersistence.integration.test.ts',
            'monthlyRegisterNpcPersistence.integration.test.ts',
            'monthlyRaiseNpcNationPersistence.integration.test.ts',
        ],
        refEvidence: [
            'monthly_create_many_npc.json',
            'monthly_reg_npc.json',
            'monthly_reg_neutral_npc.json',
            'monthly_raise_npc_nation.json',
        ],
    },
    {
        name: 'invader-lifecycle',
        kind: 'multi-month',
        actions: ['RaiseInvader', 'AutoDeleteInvader', 'InvaderEnding'],
        coreEvidence: ['monthlyInvaderPersistence.integration.test.ts'],
        refEvidence: ['monthly_raise_invader.json', 'monthly_auto_delete_invader.json', 'monthly_invader_ending.json'],
    },
    {
        name: 'npc-troop-support',
        kind: 'single-boundary',
        actions: ['ProvideNPCTroopLeader'],
        coreEvidence: ['monthlyNpcSupportPersistence.integration.test.ts'],
        refEvidence: ['ProvideNPCTroopLeader fixed-seed trace'],
    },
    {
        name: 'nation-betting-lifecycle',
        kind: 'multi-month',
        actions: ['OpenNationBetting', 'FinishNationBetting'],
        coreEvidence: ['monthlyNationBettingPersistence.integration.test.ts'],
        refEvidence: [
            'monthly_open_nation_betting.json',
            'monthly_finish_nation_betting.json',
            'monthly_nation_betting_lifecycle.json',
        ],
    },
    {
        name: 'scout-block-boundaries',
        kind: 'single-boundary',
        actions: ['BlockScoutAction'],
        coreEvidence: ['monthlyScoutBlockPersistence.integration.test.ts'],
        refEvidence: ['monthly_block_scout.json'],
    },
    {
        name: 'legacy-unblock-scout-error',
        kind: 'expected-failure',
        actions: ['UnblockScoutAction'],
        coreEvidence: ['monthlyScoutBlockAction.test.ts'],
        refEvidence: ['monthly_unblock_scout.json'],
    },
    {
        name: 'speciality-betray-chain',
        kind: 'single-boundary',
        actions: ['AssignGeneralSpeciality', 'AddGlobalBetray'],
        coreEvidence: ['monthlySpecialityBetrayPersistence.integration.test.ts'],
        refEvidence: ['monthly_assign_general_speciality.json', 'monthly_add_global_betray.json'],
    },
    {
        name: 'unique-inherit-chain',
        kind: 'single-boundary',
        actions: ['LostUniqueItem', 'MergeInheritPointRank'],
        coreEvidence: ['monthlyUniqueInheritPersistence.integration.test.ts'],
        refEvidence: ['monthly_lost_unique_item.json', 'monthly_merge_inherit_point_rank.json'],
    },
    {
        name: 'centennial-all-star-growth',
        kind: 'multi-month',
        actions: ['AdvanceCentennialAllStar'],
        coreEvidence: ['monthlyCentennialAllStarAction.test.ts'],
        refEvidence: ['CentennialAllStarGrowthTest.php', 'AdvanceCentennialAllStar.php'],
    },
] as const satisfies readonly CatalogSegment[];

const KNOWN_MISSING_MONTHLY_ACTIONS = [] as const;

const listBasenames = async (directory: string, pattern: RegExp): Promise<string[]> =>
    (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && pattern.test(entry.name))
        .map((entry) => entry.name)
        .sort();

const difference = (left: readonly string[], right: readonly string[]): string[] => {
    const rightSet = new Set(right);
    return left.filter((value) => !rightSet.has(value)).sort();
};

const refSourceIt = hasRefSourceRoot() ? it : it.skip;

describe('monthly event catalog coverage', () => {
    it('assigns every Core monthly action to exactly one dependency-safe segment', () => {
        const covered = segments.flatMap((segment) => segment.actions);

        expect(new Set(covered).size).toBe(covered.length);
        expect(new Set(MONTHLY_EVENT_ACTION_CATALOG).size).toBe(MONTHLY_EVENT_ACTION_CATALOG.length);
        expect([...covered].sort()).toEqual([...MONTHLY_EVENT_ACTION_CATALOG].sort());
    });

    refSourceIt('keeps the Core and Ref monthly action catalogs complete', async () => {
        const refActionDirectory = path.join(resolveRefSourceRoot(), 'hwe', 'sammo', 'Event', 'Action');
        const refActions = (await listBasenames(refActionDirectory, /\.php$/)).map((fileName) =>
            fileName.replace(/\.php$/, '')
        );

        expect(difference(refActions, MONTHLY_EVENT_ACTION_CATALOG)).toEqual([...KNOWN_MISSING_MONTHLY_ACTIONS]);
        expect(difference(MONTHLY_EVENT_ACTION_CATALOG, refActions)).toEqual([]);
    });

    it('keeps every core evidence file executable in this suite', () => {
        const testDirectory = fileURLToPath(new URL('.', import.meta.url));
        const evidenceFiles = new Set(segments.flatMap((segment) => segment.coreEvidence));

        for (const evidenceFile of evidenceFiles) {
            expect(existsSync(`${testDirectory}/${evidenceFile}`), evidenceFile).toBe(true);
        }
    });

    it('keeps lifecycle-only dispositions out of the aggregate single-boundary claim', () => {
        const multiMonthActions = segments
            .filter((segment) => segment.kind === 'multi-month')
            .flatMap((segment) => segment.actions);
        const specialDispositions = segments
            .filter((segment) => segment.kind === 'no-op' || segment.kind === 'expected-failure')
            .flatMap((segment) => segment.actions);

        expect(multiMonthActions).toEqual([
            'RaiseInvader',
            'AutoDeleteInvader',
            'InvaderEnding',
            'OpenNationBetting',
            'FinishNationBetting',
            'AdvanceCentennialAllStar',
        ]);
        expect(specialDispositions).toEqual(['CreateAdminNPC', 'UnblockScoutAction']);
        expect(segments.every((segment) => segment.refEvidence.length > 0)).toBe(true);
    });
});
