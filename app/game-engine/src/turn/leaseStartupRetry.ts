import { setTimeout } from 'node:timers/promises';

import { TurnDaemonLeaseUnavailableError } from '../lifecycle/databaseTurnDaemonLease.js';

// 역방향 시계 보정 또는 기존 owner의 정상 종료를 기다리는 동안 PM2의
// 짧은 시작 실패 횟수를 소진하지 않는다. 매번 새 runtime/DB snapshot을 만든다.
export const retryTurnDaemonLeaseStartup = async <T>(
    create: () => Promise<T>,
    wait: () => Promise<void> = () => setTimeout(2000)
): Promise<T> => {
    let attempts = 0;
    for (;;) {
        try {
            return await create();
        } catch (error) {
            if (!(error instanceof TurnDaemonLeaseUnavailableError)) throw error;
            if (attempts++ % 15 === 0) {
                console.info('[turn-daemon] waiting for the active lease owner; startup will retry.');
            }
            await wait();
        }
    }
};
