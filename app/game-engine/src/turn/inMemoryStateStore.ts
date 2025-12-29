import type { TurnCheckpoint, TurnStateStore } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';

export class InMemoryTurnStateStore implements TurnStateStore {
    // 인메모리 월드의 턴 상태를 TurnDaemonLifecycle에 제공한다.
    private readonly world: InMemoryTurnWorld;
    private checkpoint?: TurnCheckpoint;

    constructor(world: InMemoryTurnWorld) {
        this.world = world;
    }

    async loadLastTurnTime(): Promise<Date> {
        return this.world.getState().lastTurnTime;
    }

    async loadNextGeneralTurnTime(): Promise<Date | null> {
        return this.world.getNextGeneralTurnTime(this.checkpoint);
    }

    async saveLastTurnTime(turnTime: Date): Promise<void> {
        this.world.setLastTurnTime(turnTime);
    }

    async loadCheckpoint(): Promise<TurnCheckpoint | undefined> {
        return this.checkpoint;
    }

    async saveCheckpoint(checkpoint?: TurnCheckpoint): Promise<void> {
        this.checkpoint = checkpoint;
        this.world.setCheckpoint(checkpoint);
    }
}
