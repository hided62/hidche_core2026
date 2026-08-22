export interface TournamentSourceKeys {
    stateKey: string;
    participantsKey: string;
    matchesKey: string;
    bettingKey: string;
    sourceRevisionKey: string;
    sourceRevisionChannel: string;
    realtimeEventChannel: string;
}

export interface TournamentProjectionRedis {
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    publish?(channel: string, message: string): Promise<unknown>;
}

export interface TournamentProjectionWrite {
    key: string;
    value: unknown;
}

const WRITE_TOURNAMENT_PROJECTION_SCRIPT = `
local revision_key = KEYS[#KEYS]
local current = redis.call('GET', revision_key)
if current then
    if not string.match(current, '^%d+$') then
        return redis.error_reply('invalid tournament source revision')
    end
    if string.len(current) > 18 then
        return redis.error_reply('tournament source revision exhausted')
    end
end
local stage_changed = false
local rankings_changed = false
for index = 1, #KEYS - 1 do
    local next_ok, next_value = pcall(cjson.decode, ARGV[index])
    if next_ok and type(next_value) == 'table' and next_value['stage'] ~= nil then
        local previous = redis.call('GET', KEYS[index])
        local previous_stage = nil
        local previous_value = nil
        if previous then
            local previous_ok
            previous_ok, previous_value = pcall(cjson.decode, previous)
            if previous_ok and type(previous_value) == 'table' then
                previous_stage = previous_value['stage']
            end
        end
        local next_stage = next_value['stage']
        stage_changed = (not previous) or previous_stage ~= next_stage
        local previous_reward_settled = previous_value and previous_value['rewardSettled'] or false
        rankings_changed = next_value['rewardSettled'] == true and previous_reward_settled ~= true
    end
    redis.call('SET', KEYS[index], ARGV[index])
end
local revision = redis.call('INCR', revision_key)
return tostring(revision) .. ':' .. (stage_changed and '1' or '0') .. ':' .. (rankings_changed and '1' or '0')
`;

export const parseTournamentSourceRevision = (value: unknown): string | null => {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }
    if (typeof value === 'bigint') {
        return value >= 0n ? value.toString() : null;
    }
    return typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value) ? value : null;
};

/** Atomically stores one or more tournament payloads and advances one profile head. */
export const writeTournamentProjection = async (
    redis: TournamentProjectionRedis,
    keys: TournamentSourceKeys,
    writes: readonly TournamentProjectionWrite[]
): Promise<string> => {
    if (writes.length === 0) {
        throw new Error('Tournament projection write must contain at least one payload.');
    }
    if (new Set(writes.map(({ key }) => key)).size !== writes.length) {
        throw new Error('Tournament projection write keys must be unique.');
    }

    const writesState = writes.some(({ key }) => key === keys.stateKey);
    const writesSnapshot = writes.some(
        ({ key }) => key === keys.stateKey || key === keys.participantsKey || key === keys.matchesKey
    );
    const writesBetting = writes.some(({ key }) => key === keys.bettingKey);
    const writesSettledRankings = writes.some(
        ({ key, value }) =>
            key === keys.stateKey &&
            typeof value === 'object' &&
            value !== null &&
            (value as { rewardSettled?: unknown }).rewardSettled === true
    );
    const result = await redis.eval(WRITE_TOURNAMENT_PROJECTION_SCRIPT, {
        keys: [...writes.map(({ key }) => key), keys.sourceRevisionKey],
        arguments: writes.map(({ value }) => JSON.stringify(value)),
    });
    const scriptResult = typeof result === 'string' ? /^(\d+):([01])(?::([01]))?$/u.exec(result) : null;
    const sourceRevision = parseTournamentSourceRevision(scriptResult?.[1] ?? result);
    // Plain revision results remain accepted for rolling deployments and small
    // Redis fakes; only the current Lua contract can suppress same-stage writes.
    const stageChanged = writesState && (scriptResult ? scriptResult[2] === '1' : true);
    const rankingsChanged = scriptResult?.[3] === undefined ? writesSettledRankings : scriptResult[3] === '1';
    if (sourceRevision === null) {
        throw new Error('토너먼트 source revision 갱신 결과가 올바르지 않습니다.');
    }

    if (redis.publish) {
        try {
            await redis.publish(keys.sourceRevisionChannel, JSON.stringify({ sourceRevision }));
        } catch {
            // Payload and revision are committed; publication remains best effort.
        }
        try {
            await redis.publish(
                keys.realtimeEventChannel,
                JSON.stringify({
                    type: 'tournamentProjectionChanged',
                    invalidation: {
                        snapshot: writesSnapshot,
                        betting: writesBetting || stageChanged,
                        rankings: rankingsChanged,
                    },
                })
            );
        } catch {
            // Tournament-page wake-up is a best-effort projection signal.
        }
        if (stageChanged) {
            try {
                await redis.publish(keys.realtimeEventChannel, JSON.stringify({ type: 'tournamentChanged' }));
            } catch {
                // The source-revision wake-up and main SSE wake-up are independent best-effort fan-out.
            }
        }
    }
    return sourceRevision;
};
