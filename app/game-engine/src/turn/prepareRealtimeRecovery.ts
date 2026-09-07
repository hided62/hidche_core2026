import { randomUUID } from 'node:crypto';
import { immediateRecoveryLimitSeconds } from '@sammo-ts/common';
import type { GamePrismaClient } from '@sammo-ts/infra';
import {
    readClockDatabaseWall,
    reconcileClockSuspension,
    startClockSuspension,
    type ClockOperationAuthority,
} from './clockReconciliation.js';

/** lease를 획득했지만 clock_ready를 공개하기 전, 중단된 복구 또는 새 정전을 처리한다. */
export const prepareRealtimeRecovery = async (
    db: GamePrismaClient,
    authority: Extract<ClockOperationAuthority, { kind: 'DAEMON' }>,
    options: { paused?: boolean } = {}
): Promise<void> => {
    const world = await db.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
    if (world.clockMode !== 'realtime') return;
    if (world.clockPhase === 'SUSPENDED') {
        if (options.paused) return;
        const pending = await db.clockSuspension.findFirst({
            where: { worldStateId: world.id, source: 'RECOVERY', policy: 'RECOVER_TURNS', status: 'SUSPENDED' },
            orderBy: { sourceRevision: 'desc' },
        });
        if (pending) await reconcileClockSuspension({ db, suspensionId: pending.id, authority });
        return;
    }
    if (world.clockPhase !== 'RUNNING' || !world.clockWallAnchor || world.clockTick === null) return;
    const now = await readClockDatabaseWall(db);
    // 가속 중 정상적인 프로세스 교체는 기존 창을 그대로 재사용한다.
    // 짧은 중단만 즉시 처리한다. 기준값과 같으면 대기 후 복구한다.
    if (
        !options.paused &&
        now.getTime() - world.clockWallAnchor.getTime() < immediateRecoveryLimitSeconds(world.tickSeconds) * 1_000
    )
        return;
    const suspensionId = `recovery-${randomUUID()}`;
    await startClockSuspension({
        db,
        suspensionId,
        source: 'RECOVERY',
        policy: 'RECOVER_TURNS',
        authority,
        recoverDurableObservation: true,
    });
    // 이전 버전의 profile 상태만 PAUSED였던 경우에도 명시적 재개 전에는 실행하지 않는다.
    if (!options.paused) await reconcileClockSuspension({ db, suspensionId, authority });
};
