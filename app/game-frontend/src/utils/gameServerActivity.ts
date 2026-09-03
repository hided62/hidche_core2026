import { readonly, ref, type Ref } from 'vue';

export const GAME_SERVER_ACTIVITY_FRESHNESS_MS = 45_000;

export type GameServerActivityTracker = {
    lastContactAt: Readonly<Ref<number | null>>;
    markContact: (contactAt?: number) => void;
};

export const createGameServerActivityTracker = (): GameServerActivityTracker => {
    const lastContactAt = ref<number | null>(null);

    return {
        lastContactAt: readonly(lastContactAt),
        markContact(contactAt = performance.now()) {
            if (!Number.isFinite(contactAt)) return;
            lastContactAt.value = contactAt;
        },
    };
};

export const isRecentGameServerActivity = (
    lastContactAt: number | null,
    now = performance.now(),
    freshnessMs = GAME_SERVER_ACTIVITY_FRESHNESS_MS
): boolean =>
    lastContactAt !== null &&
    Number.isFinite(lastContactAt) &&
    Number.isFinite(now) &&
    Math.max(0, now - lastContactAt) <= freshnessMs;

export const gameServerActivity = createGameServerActivityTracker();

export const markGameServerContact = (contactAt = performance.now()) => gameServerActivity.markContact(contactAt);
