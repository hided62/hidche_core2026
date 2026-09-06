export const GAME_TICKS_PER_TURN = 36_000_000;

declare const gameTickBrand: unique symbol;
export type GameTick = number & { readonly [gameTickBrand]: 'GameTick' };

export const asGameTick = (tick: number): GameTick => {
    if (!Number.isSafeInteger(tick)) throw new Error(`Game tick must be a safe integer: ${tick}`);
    return tick as GameTick;
};
