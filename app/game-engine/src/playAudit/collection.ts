import { asRecord } from '@sammo-ts/common';
import type { InMemoryTurnWorld, TurnCalendarHandler } from '../turn/inMemoryWorld.js';
import { buildAuditSnapshot, type AuditSettlement } from './snapshot.js';

interface MonthlyFlows {
    year: number;
    month: number;
    complete: boolean;
    entries: Record<string, AuditSettlement>;
}

const readFlows = (world: InMemoryTurnWorld): MonthlyFlows => {
    const state = world.getState();
    const raw = asRecord(state.meta.playAuditFlows);
    const entries: Record<string, AuditSettlement> = {};
    const matches = raw.year === state.currentYear && raw.month === state.currentMonth;
    if (matches) {
        for (const [key, value] of Object.entries(asRecord(raw.entries))) {
            const row = asRecord(value);
            if (
                typeof row.nationId === 'number' &&
                (row.resource === 'gold' || row.resource === 'rice') &&
                typeof row.income === 'number' &&
                Number.isFinite(row.income) &&
                typeof row.paid === 'number' &&
                Number.isFinite(row.paid)
            ) {
                entries[key] = { nationId: row.nationId, resource: row.resource, income: row.income, paid: row.paid };
            }
        }
    }
    return { year: state.currentYear, month: state.currentMonth, complete: matches && raw.complete === true, entries };
};

export const recordAuditSettlement = (world: InMemoryTurnWorld, settlement: AuditSettlement): void => {
    if (typeof world.getState().meta.serverId !== 'string') return;
    const flows = readFlows(world);
    const key = `${settlement.nationId}:${settlement.resource}`;
    const previous = flows.entries[key];
    flows.entries[key] = {
        ...settlement,
        income: (previous?.income ?? 0) + settlement.income,
        paid: (previous?.paid ?? 0) + settlement.paid,
    };
    // 월내 flush/reload에도 누적값을 잃지 않도록 작은 국가별 합계만 world meta에 보존한다.
    world.updateWorldMeta({ playAuditFlows: flows });
};

export const queueAuditMonth = (world: InMemoryTurnWorld, kind: 'MONTH_END' | 'FINAL' = 'MONTH_END'): void => {
    const state = world.getState();
    const serverId = state.meta.serverId;
    // identity 없는 레거시 fixture/설치에서 profile명으로 가짜 기수를 만들지 않는다.
    if (typeof serverId !== 'string' || !serverId.trim()) return;
    const flows = readFlows(world);
    const snapshot = buildAuditSnapshot({
        nations: world.listNations(),
        cities: world.listCities(),
        generals: world.listGenerals(),
        settlements: Object.values(flows.entries),
        settlementsComplete: flows.complete,
    });
    world.queueAuditMonth({
        ...snapshot,
        serverId,
        year: state.currentYear,
        month: state.currentMonth,
        tick: state.lastTurnTick ?? null,
        kind,
        settlementsComplete: flows.complete,
    });
};

export const createPlayAuditHandler = (getWorld: () => InMemoryTurnWorld | null): TurnCalendarHandler => ({
    beforeMonthChanged: (context) => {
        const world = getWorld();
        if (!world) return;
        queueAuditMonth(world);
        // 다음 달의 정산보다 먼저 활성화한다. 도입 당월은 complete=false로 남긴다.
        world.updateWorldMeta({
            playAuditFlows: { year: context.currentYear, month: context.currentMonth, complete: true, entries: {} },
        });
    },
});
