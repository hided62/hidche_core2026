import { describe, expect, it } from 'vitest';
import {
    summarizeNationPeriod,
    type AuditNationData,
    type NationMonthPoint,
} from '../src/router/playAudit/nationSeries.js';

const population = {
    count: 0,
    gold: 0,
    rice: 0,
    dex: { dex1: 0, dex2: 0, dex3: 0, dex4: 0, dex5: 0 },
    averageGold: null,
    averageRice: null,
    averageDex: { dex1: null, dex2: null, dex3: null, dex4: null, dex5: null },
};
const nation = (month: number): AuditNationData => ({
    id: 1,
    name: `국가${month}`,
    color: '#ffffff',
    gold: month * 100,
    rice: month * 200,
    tech: month * 10,
    appliedRate: 20,
    incomeGold: month,
    incomeRice: 0,
    paidGold: month / 2,
    paidRice: 0,
    populations: { human: population, npc: population, troopNpc: population },
});
const months: NationMonthPoint[] = Array.from({ length: 6 }, (_, index) => ({
    ordinal: 2400 + index,
    collected: true,
    settlementsComplete: true,
    data: nation(index + 1),
}));

describe('play audit half-year summary', () => {
    it('sums flows but takes stock, names and population denominators from the last month', () => {
        const summary = summarizeNationPeriod(2400, 6, months);
        expect(summary).toMatchObject({
            year: 200,
            month: 1,
            complete: true,
            stockAsOf: { year: 200, month: 6 },
            stock: {
                name: '국가6',
                gold: 600,
                rice: 1200,
                tech: 60,
                populations: { human: { count: 0, averageGold: null } },
            },
            flows: { incomeGold: 21, incomeRice: 0, paidGold: 10.5, paidRice: 0 },
        });
    });
    it('reports partial range independently from complete collection of the requested months', () => {
        expect(summarizeNationPeriod(2400, 6, months.slice(0, 2))).toMatchObject({
            complete: false,
            from: { year: 200, month: 1 },
            to: { year: 200, month: 2 },
            flows: { incomeGold: 3 },
        });
    });
    it('does not call a missing month or absent nation zero income', () => {
        const missing = months.map((point, index) =>
            index === 1 ? { ...point, collected: false, data: null } : point
        );
        expect(summarizeNationPeriod(2400, 6, missing)).toMatchObject({ complete: false, flows: { incomeGold: null } });
        expect(
            summarizeNationPeriod(
                2400,
                6,
                months.map((point) => ({ ...point, data: null }))
            )
        ).toMatchObject({
            complete: false,
            stock: null,
            stockAsOf: null,
            flows: { incomeRice: null },
        });
    });
    it('keeps incomplete settlement coverage unknown while preserving stock coverage', () => {
        const partial = months.map((point, index) => ({ ...point, settlementsComplete: index !== 0 }));
        expect(summarizeNationPeriod(2400, 6, partial)).toMatchObject({ complete: true, flows: { incomeGold: null } });
        expect(summarizeNationPeriod(2400, 6, [])).toMatchObject({
            complete: false,
            stock: null,
            flows: { incomeGold: null },
        });
    });
});
