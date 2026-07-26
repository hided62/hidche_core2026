import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    MONTHLY_EVENT_ACTION_CATALOG,
    type MonthlyEventActionName,
} from '../src/turn/monthlyEventHandler.js';

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
        actions: [
            'RaiseDisaster',
            'UpdateCitySupply',
            'UpdateNationLevel',
            'ProcessSemiAnnual',
            'ProcessWarIncome',
        ],
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
        refEvidence: [
            'monthly_raise_invader.json',
            'monthly_auto_delete_invader.json',
            'monthly_invader_ending.json',
        ],
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
        refEvidence: ['monthly_open_nation_betting.json', 'monthly_finish_nation_betting.json'],
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
] as const satisfies readonly CatalogSegment[];

describe('monthly event catalog coverage', () => {
    it('assigns every legacy action to exactly one dependency-safe segment', () => {
        const covered = segments.flatMap((segment) => segment.actions);

        expect(covered).toHaveLength(29);
        expect(new Set(covered).size).toBe(29);
        expect([...covered].sort()).toEqual([...MONTHLY_EVENT_ACTION_CATALOG].sort());
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
        ]);
        expect(specialDispositions).toEqual(['CreateAdminNPC', 'UnblockScoutAction']);
        expect(segments.every((segment) => segment.refEvidence.length > 0)).toBe(true);
    });
});
