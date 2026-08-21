import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';

const MIN_DIPLOMACY_MESSAGE_VALID_MINUTES = 30;
const DIPLOMACY_MESSAGE_VALID_TURNS = 3;

export const resolveDiplomacyMessageValidMinutes = (tickSeconds: number): number =>
    Math.max(MIN_DIPLOMACY_MESSAGE_VALID_MINUTES, Math.floor((tickSeconds / 60) * DIPLOMACY_MESSAGE_VALID_TURNS));

export const resolveDiplomacyMessageValidUntilTick = (turnTick: number, tickSeconds: number): number | null => {
    if (!Number.isFinite(turnTick) || !Number.isInteger(tickSeconds) || tickSeconds <= 0) {
        return null;
    }
    const ticksPerSecond = GAME_TICKS_PER_TURN / tickSeconds;
    if (!Number.isInteger(ticksPerSecond)) {
        return null;
    }
    return turnTick + resolveDiplomacyMessageValidMinutes(tickSeconds) * 60 * ticksPerSecond;
};
