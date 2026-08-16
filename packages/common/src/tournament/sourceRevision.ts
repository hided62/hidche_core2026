export interface TournamentSourceKeys {
    sourceRevisionKey: string;
    sourceRevisionChannel: string;
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
for index = 1, #KEYS - 1 do
    redis.call('SET', KEYS[index], ARGV[index])
end
local revision = redis.call('INCR', revision_key)
return tostring(revision)
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

    const result = await redis.eval(WRITE_TOURNAMENT_PROJECTION_SCRIPT, {
        keys: [...writes.map(({ key }) => key), keys.sourceRevisionKey],
        arguments: writes.map(({ value }) => JSON.stringify(value)),
    });
    const sourceRevision = parseTournamentSourceRevision(result);
    if (sourceRevision === null) {
        throw new Error('토너먼트 source revision 갱신 결과가 올바르지 않습니다.');
    }

    if (redis.publish) {
        try {
            await redis.publish(keys.sourceRevisionChannel, JSON.stringify({ sourceRevision }));
        } catch {
            // Payload and revision are committed; publication remains best effort.
        }
    }
    return sourceRevision;
};
