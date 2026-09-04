import type { RedisConnector } from '@sammo-ts/infra';
import {
    buildGameEventChannel,
    buildGameReadModelRevisionKey,
    type RealtimeEvent,
    type RealtimeReadModelChanges,
} from '@sammo-ts/common';

// 게임 서버의 실시간 이벤트를 Redis pub/sub 채널로 송신한다.
export const publishRealtimeEvent = async (
    redis: RedisConnector['client'],
    profileName: string,
    event: RealtimeEvent
): Promise<void> => {
    const channel = buildGameEventChannel(profileName);
    await redis.publish(channel, JSON.stringify(event));
};

export const publishRealtimeReadModelChanges = async (
    redis: RedisConnector['client'],
    profileName: string,
    changes: RealtimeReadModelChanges
): Promise<number> => {
    const revision = await redis.incr(buildGameReadModelRevisionKey(profileName));
    await publishRealtimeEvent(redis, profileName, {
        type: 'readModelChanged',
        at: new Date().toISOString(),
        changes,
        revision,
    });
    return revision;
};

export const publishRealtimeMessageChanges = async (
    redis: RedisConnector['client'],
    profileName: string,
    mailboxes: readonly number[],
    diplomacyMailboxes: readonly number[] = []
): Promise<void> => {
    if (mailboxes.length === 0 && diplomacyMailboxes.length === 0) return;
    await publishRealtimeEvent(redis, profileName, {
        type: 'messagesChanged',
        mailboxes: [...new Set(mailboxes)].sort((left, right) => left - right),
        ...(diplomacyMailboxes.length > 0
            ? { diplomacyMailboxes: [...new Set(diplomacyMailboxes)].sort((left, right) => left - right) }
            : {}),
    });
};
