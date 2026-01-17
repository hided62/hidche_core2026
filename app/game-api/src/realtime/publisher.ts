import type { RedisConnector } from '@sammo-ts/infra';
import { buildGameEventChannel, type RealtimeEvent } from '@sammo-ts/common';

// 게임 서버의 실시간 이벤트를 Redis pub/sub 채널로 송신한다.
export const publishRealtimeEvent = async (
    redis: RedisConnector['client'],
    profileName: string,
    event: RealtimeEvent
): Promise<void> => {
    const channel = buildGameEventChannel(profileName);
    await redis.publish(channel, JSON.stringify(event));
};
