import type { CurrentGameTime } from './gameClock.js';
import type { GameClockPhase } from '@sammo-ts/common';

interface ClockFenceRedis {
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const BOOTSTRAP_CLOCK_FENCE_SCRIPT = `
local revision = redis.call('GET', KEYS[1])
local generation = redis.call('GET', KEYS[2])
local phase = redis.call('GET', KEYS[3])
if not revision and not generation and not phase then
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SET', KEYS[2], ARGV[2])
    redis.call('SET', KEYS[3], ARGV[3])
    return 1
end
if revision == ARGV[1] and generation == ARGV[2] and phase == ARGV[3] then
    return 2
end
return 0
`;

export interface ActiveRedisClockFence {
    activeRevisionKey: string;
    deadlineGenerationKey: string;
    phaseKey: string;
    revision: number;
    generation: number;
    phase: 'RUNNING' | 'MANUAL' | 'SUSPENDED';
}

type MutableProjectionPhase = ActiveRedisClockFence['phase'];

const ensureRedisClockFence = async (
    redis: ClockFenceRedis,
    profileName: string,
    gameTime: CurrentGameTime,
    allowedPhases: readonly GameClockPhase[]
): Promise<ActiveRedisClockFence | null> => {
    if (
        !gameTime.phase ||
        !allowedPhases.includes(gameTime.phase) ||
        (gameTime.phase !== 'RUNNING' && gameTime.phase !== 'MANUAL' && gameTime.phase !== 'SUSPENDED') ||
        !Number.isSafeInteger(gameTime.revision) ||
        !Number.isSafeInteger(gameTime.deadlineGeneration)
    ) {
        return null;
    }
    const phase: MutableProjectionPhase = gameTime.phase;
    const fence: ActiveRedisClockFence = {
        activeRevisionKey: `sammo:${profileName}:clock:active-revision`,
        deadlineGenerationKey: `sammo:${profileName}:clock:deadline-generation`,
        phaseKey: `sammo:${profileName}:clock:phase`,
        revision: gameTime.revision!,
        generation: gameTime.deadlineGeneration!,
        phase,
    };
    const result = await redis.eval(BOOTSTRAP_CLOCK_FENCE_SCRIPT, {
        keys: [fence.activeRevisionKey, fence.deadlineGenerationKey, fence.phaseKey],
        arguments: [String(fence.revision), String(fence.generation), phase],
    });
    return Number(result) === 1 || Number(result) === 2 ? fence : null;
};

export const ensureActiveRedisClockFence = async (
    redis: ClockFenceRedis,
    profileName: string,
    gameTime: CurrentGameTime
): Promise<ActiveRedisClockFence | null> => {
    return ensureRedisClockFence(redis, profileName, gameTime, ['RUNNING']);
};

/**
 * User betting is allowed against a frozen tournament deadline while the game
 * clock is suspended. Stage progression and settlement continue to use the
 * RUNNING-only helper above.
 */
export const ensureBettingRedisClockFence = async (
    redis: ClockFenceRedis,
    profileName: string,
    gameTime: CurrentGameTime
): Promise<ActiveRedisClockFence | null> =>
    ensureRedisClockFence(redis, profileName, gameTime, ['RUNNING', 'MANUAL', 'SUSPENDED']);
