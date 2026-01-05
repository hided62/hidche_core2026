const MINUTES_TO_MS = 60_000;

const getCutTurnBase = (time: Date): Date =>
    new Date(time.getFullYear(), time.getMonth(), time.getDate() - 1, 1, 0, 0, 0);

export const getNextTickTime = (lastTurnTime: Date, turnTermMinutes: number): Date => {
    if (turnTermMinutes <= 0) {
        throw new Error('turnTermMinutes must be positive');
    }

    // 월 기준 턴 그리드에 맞춰 다음 틱 경계를 계산한다.
    const base = getCutTurnBase(lastTurnTime);
    const elapsedMinutes = Math.floor((lastTurnTime.getTime() - base.getTime()) / MINUTES_TO_MS);
    const alignedMinutes = elapsedMinutes - (elapsedMinutes % turnTermMinutes);
    return new Date(base.getTime() + (alignedMinutes + turnTermMinutes) * MINUTES_TO_MS);
};
