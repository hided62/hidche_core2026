import type { CurrentGameTime } from './gameClock.js';

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
}

export const ensureActiveRedisClockFence = async (
    redis: ClockFenceRedis,
    profileName: string,
    gameTime: CurrentGameTime
): Promise<ActiveRedisClockFence | null> => {
    if (
        gameTime.phase !== 'RUNNING' ||
        !Number.isSafeInteger(gameTime.revision) ||
        !Number.isSafeInteger(gameTime.deadlineGeneration)
    ) {
        return null;
    }
    const fence: ActiveRedisClockFence = {
        activeRevisionKey: `sammo:${profileName}:clock:active-revision`,
        deadlineGenerationKey: `sammo:${profileName}:clock:deadline-generation`,
        phaseKey: `sammo:${profileName}:clock:phase`,
        revision: gameTime.revision!,
        generation: gameTime.deadlineGeneration!,
    };
    const result = await redis.eval(BOOTSTRAP_CLOCK_FENCE_SCRIPT, {
        keys: [fence.activeRevisionKey, fence.deadlineGenerationKey, fence.phaseKey],
        arguments: [String(fence.revision), String(fence.generation), 'RUNNING'],
    });
    return Number(result) === 1 || Number(result) === 2 ? fence : null;
};
