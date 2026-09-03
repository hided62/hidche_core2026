import type { TurnCheckpoint, TurnStateStore } from '../lifecycle/types.js';
import { asNumber, asRecord } from '@sammo-ts/common';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';

export class InMemoryTurnStateStore implements TurnStateStore {
    // 인메모리 월드의 턴 상태를 TurnDaemonLifecycle에 제공한다.
    private readonly world: InMemoryTurnWorld;

    constructor(world: InMemoryTurnWorld) {
        this.world = world;
    }

    async loadLastTurnTime(): Promise<Date> {
        return this.world.getState().lastTurnTime;
    }

    async loadNextGeneralTurnTime(): Promise<Date | null> {
        return this.world.getNextGeneralTurnTime(this.world.getCheckpoint());
    }

    async saveLastTurnTime(turnTime: Date): Promise<void> {
        this.world.setLastTurnTime(turnTime);
    }

    async loadCheckpoint(): Promise<TurnCheckpoint | undefined> {
        return this.world.getCheckpoint();
    }

    async saveCheckpoint(checkpoint?: TurnCheckpoint): Promise<void> {
        this.world.setCheckpoint(checkpoint);
    }

    async shouldHaltScheduledRuns(): Promise<boolean> {
        const meta = asRecord(this.world.getState().meta);
        return asNumber(meta.isunited ?? meta.isUnited, 0) >= 2;
    }

    async loadGameClock(wallNow = new Date(Date.now())): Promise<{
        mode: 'realtime' | 'manual';
        now: Date;
        phase: ReturnType<InMemoryTurnWorld['getGameClockState']>['phase'];
        revision: number;
        deadlineGeneration: number;
    }> {
        const state = this.world.getGameClockState();
        return {
            mode: state.mode,
            now: this.world.getGameNow(wallNow),
            phase: state.phase,
            revision: state.revision,
            deadlineGeneration: state.deadlineGeneration,
        };
    }

    async promotePreopenAtOpening(wallNow: Date): Promise<boolean> {
        return this.world.promotePreopenAtOpening(wallNow);
    }

    async rebaseRealtimeBacklog(wallNow: Date) {
        return this.world.rebaseRealtimeBacklog(wallNow);
    }

    async shouldRebaseRealtimeBacklog(wallNow: Date): Promise<boolean> {
        return this.world.shouldRebaseRealtimeBacklog(wallNow);
    }

    async advanceGameClockTo(target: Date, wallNow: Date): Promise<void> {
        this.world.advanceGameClockTo(target, wallNow);
    }
}
