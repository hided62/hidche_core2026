import { asRecord } from '@sammo-ts/common';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

/** A bounded, sticky notice: later successful writes cannot make history complete again. */
export const markAuditGap = (world: InMemoryTurnWorld, stage: string): void => {
    const state = world.getState();
    const previous = asRecord(state.meta.playAuditGap);
    world.updateWorldMeta({
        playAuditGap: {
            serverId: state.meta.serverId ?? null,
            firstYear:
                previous.serverId === state.meta.serverId
                    ? (previous.firstYear ?? state.currentYear)
                    : state.currentYear,
            firstMonth:
                previous.serverId === state.meta.serverId
                    ? (previous.firstMonth ?? state.currentMonth)
                    : state.currentMonth,
            lastYear: state.currentYear,
            lastMonth: state.currentMonth,
            stage,
        },
    });
    console.warn(`[play-audit] ${stage}: history gap recorded; gameplay continues.`);
};

export const collectPlayAudit = <T>(world: InMemoryTurnWorld, stage: string, collect: () => T, fallback: T): T => {
    try {
        return collect();
    } catch {
        markAuditGap(world, stage);
        return fallback;
    }
};
