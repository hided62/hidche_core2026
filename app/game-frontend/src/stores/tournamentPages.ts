import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { PublicRealtimeEvent, TournamentViewInvalidation } from '@sammo-ts/common';

import { createBroadcastTabCoordinator, type BroadcastTabCoordinator } from '../utils/broadcastTabCoordinator';
import { createRateLimitedRefreshQueue } from '../utils/rateLimitedRefreshQueue';
import { createRealtimeRequestOptions } from '../utils/realtimeAccessGrant';
import { structurallyShare } from '../utils/structuralShare';
import { trpc } from '../utils/trpc';
import { useSessionStore } from './session';
import { gameFrontendRuntimeConfig } from '../config/runtimeConfig';

type Snapshot = Awaited<ReturnType<typeof trpc.tournament.getSnapshot.query>>;
type BettingSummary = Awaited<ReturnType<typeof trpc.tournament.getBettingSummary.query>>;
type Rankings = Awaited<ReturnType<typeof trpc.tournament.getRankings.query>>;

type TournamentPatch = {
    snapshot?: Snapshot;
    betting?: BettingSummary;
    rankings?: Rankings;
};

type TournamentTabMessage =
    { kind: 'patch'; patch: TournamentPatch } | { kind: 'status'; status: 'idle' | 'connected' };

const EMPTY_INVALIDATION = (): TournamentViewInvalidation => ({ snapshot: false, betting: false, rankings: false });
const FULL_INVALIDATION = (): TournamentViewInvalidation => ({ snapshot: true, betting: true, rankings: true });
const hasInvalidation = (value: TournamentViewInvalidation): boolean =>
    value.snapshot || value.betting || value.rankings;
const mergeInvalidation = (
    left: TournamentViewInvalidation,
    right: TournamentViewInvalidation
): TournamentViewInvalidation => ({
    snapshot: left.snapshot || right.snapshot,
    betting: left.betting || right.betting,
    rankings: left.rankings || right.rankings,
});

const resolveErrorMessage = (value: unknown): string => (value instanceof Error ? value.message : String(value));

export const useTournamentPagesStore = defineStore('tournamentPages', () => {
    const session = useSessionStore();
    const snapshot = ref<Snapshot | null>(null);
    const betting = ref<BettingSummary | null>(null);
    const rankings = ref<Rankings>([]);
    const loading = ref(false);
    const refreshing = ref(false);
    const error = ref<string | null>(null);
    const realtimeStatus = ref<'idle' | 'connected'>('idle');

    let activeConsumers = 0;
    let realtimeSource: EventSource | null = null;
    let realtimeToken: string | null = null;
    let realtimeCoordinator: BroadcastTabCoordinator<TournamentTabMessage> | null = null;
    let realtimeCoordinatorScope: string | null = null;
    let visibilityListenerInstalled = false;
    let needsRecovery = false;
    let pendingInvalidation = EMPTY_INVALIDATION();
    let pendingRefreshGrant: string | null = null;

    const applyPatch = (patch: TournamentPatch): void => {
        if (patch.snapshot !== undefined) {
            snapshot.value =
                snapshot.value === null ? patch.snapshot : structurallyShare(snapshot.value, patch.snapshot);
        }
        if (patch.betting !== undefined) {
            betting.value = betting.value === null ? patch.betting : structurallyShare(betting.value, patch.betting);
        }
        if (patch.rankings !== undefined) {
            rankings.value = structurallyShare(rankings.value, patch.rankings);
        }
    };

    const refreshProjection = async (
        invalidation: TournamentViewInvalidation,
        refreshGrant?: string | null,
        foreground = false
    ): Promise<TournamentPatch> => {
        if (!hasInvalidation(invalidation)) return {};
        if (foreground) {
            loading.value = true;
            error.value = null;
        } else {
            refreshing.value = true;
        }
        const queryOptions = createRealtimeRequestOptions(refreshGrant);
        try {
            const [nextSnapshot, nextBetting, nextRankings] = await Promise.all([
                invalidation.snapshot ? trpc.tournament.getSnapshot.query(undefined, queryOptions) : undefined,
                invalidation.betting ? trpc.tournament.getBettingSummary.query(undefined, queryOptions) : undefined,
                invalidation.rankings ? trpc.tournament.getRankings.query(undefined, queryOptions) : undefined,
            ]);
            const patch: TournamentPatch = {};
            if (nextSnapshot !== undefined) patch.snapshot = nextSnapshot;
            if (nextBetting !== undefined) patch.betting = nextBetting;
            if (nextRankings !== undefined) patch.rankings = nextRankings;
            applyPatch(patch);
            return patch;
        } catch (value) {
            if (foreground) error.value = resolveErrorMessage(value);
            return {};
        } finally {
            if (foreground) loading.value = false;
            else refreshing.value = false;
        }
    };

    const backgroundRefreshQueue = createRateLimitedRefreshQueue(
        async () => {
            const invalidation = pendingInvalidation;
            const refreshGrant = pendingRefreshGrant;
            pendingInvalidation = EMPTY_INVALIDATION();
            pendingRefreshGrant = null;
            const patch = await refreshProjection(invalidation, refreshGrant);
            if (Object.keys(patch).length > 0) {
                realtimeCoordinator?.postFromLeader({ kind: 'patch', patch });
            }
        },
        { minIntervalMs: 5_000 }
    );

    const requestBackgroundRefresh = (invalidation: TournamentViewInvalidation, refreshGrant?: string | null): void => {
        pendingInvalidation = mergeInvalidation(pendingInvalidation, invalidation);
        if (refreshGrant) pendingRefreshGrant = refreshGrant;
        backgroundRefreshQueue.request();
    };

    const loadTournamentPage = (): Promise<TournamentPatch> =>
        refreshProjection({ snapshot: true, betting: true, rankings: false }, null, true);
    const loadBettingPage = (): Promise<TournamentPatch> => refreshProjection(FULL_INVALIDATION(), null, true);

    const isAccessToken = (token: string | null): boolean => Boolean(token?.startsWith('ga_'));
    const ensureAccessToken = async (): Promise<string | null> => {
        if (!session.gameToken) return null;
        if (isAccessToken(session.gameToken)) return session.gameToken;
        if (!(await session.exchangeGatewayToken())) return null;
        return session.gameToken && isAccessToken(session.gameToken) ? session.gameToken : null;
    };
    const buildRealtimeUrl = (token: string): string => {
        const base = gameFrontendRuntimeConfig.gameSseUrl;
        const url = new URL(base, window.location.origin);
        url.searchParams.set('token', token);
        url.searchParams.set('scope', 'tournament');
        return url.toString();
    };
    const parseRealtimePayload = (raw: MessageEvent): PublicRealtimeEvent | null => {
        if (!raw.data || typeof raw.data !== 'string') return null;
        try {
            const parsed = JSON.parse(raw.data) as PublicRealtimeEvent;
            return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null;
        } catch {
            return null;
        }
    };
    const closeRealtimeSource = (): void => {
        realtimeSource?.close();
        realtimeSource = null;
        realtimeToken = null;
    };
    const isRealtimeParticipant = (): boolean =>
        activeConsumers > 0 && document.visibilityState !== 'hidden' && session.isReady && session.hasGeneral;
    const closeRealtimeCoordinator = (): void => {
        const coordinator = realtimeCoordinator;
        realtimeCoordinator = null;
        realtimeCoordinatorScope = null;
        coordinator?.stop();
        closeRealtimeSource();
    };

    const connectRealtime = async (): Promise<void> => {
        if (
            typeof window === 'undefined' ||
            !isRealtimeParticipant() ||
            (realtimeCoordinator !== null && !realtimeCoordinator.isLeader())
        ) {
            return;
        }
        const token = await ensureAccessToken();
        if (!token || !isRealtimeParticipant()) return;
        if (realtimeCoordinator !== null && !realtimeCoordinator.isLeader()) return;
        if (realtimeSource && realtimeToken === token) return;
        closeRealtimeSource();
        realtimeToken = token;
        const source = new EventSource(buildRealtimeUrl(token));
        realtimeSource = source;
        source.addEventListener('open', () => {
            realtimeStatus.value = 'connected';
            realtimeCoordinator?.postFromLeader({ kind: 'status', status: 'connected' });
            if (needsRecovery) {
                needsRecovery = false;
                backgroundRefreshQueue.beginCooldown();
                void refreshProjection(FULL_INVALIDATION()).then((patch) => {
                    if (Object.keys(patch).length > 0) {
                        realtimeCoordinator?.postFromLeader({ kind: 'patch', patch });
                    }
                });
            }
        });
        source.addEventListener('error', () => {
            needsRecovery = true;
            realtimeStatus.value = 'idle';
            realtimeCoordinator?.postFromLeader({ kind: 'status', status: 'idle' });
        });
        source.addEventListener('tournamentViewInvalidated', (event) => {
            if (realtimeCoordinator !== null && !realtimeCoordinator.isLeader()) return;
            const payload = parseRealtimePayload(event);
            if (!payload || payload.type !== 'tournamentViewInvalidated') return;
            requestBackgroundRefresh(payload.invalidation, payload.refreshGrant);
        });
        source.addEventListener('ping', () => {
            realtimeStatus.value = 'connected';
            realtimeCoordinator?.postFromLeader({ kind: 'status', status: 'connected' });
        });
    };

    const reconcileRealtimeCoordinator = (): void => {
        if (typeof window === 'undefined') return;
        if (!isRealtimeParticipant()) {
            closeRealtimeCoordinator();
            return;
        }
        if (typeof BroadcastChannel === 'undefined') {
            void connectRealtime();
            return;
        }
        const profile = session.profile ?? 'game';
        const account = session.user?.id ?? 'general';
        const scope = `${encodeURIComponent(profile)}:${encodeURIComponent(account)}`;
        if (realtimeCoordinator && realtimeCoordinatorScope === scope) return;
        closeRealtimeCoordinator();
        realtimeCoordinatorScope = scope;
        realtimeCoordinator = createBroadcastTabCoordinator<TournamentTabMessage>(`sammo:tournament-pages:${scope}`, {
            onLeadershipChange: (leader) => {
                if (leader) void connectRealtime();
                else closeRealtimeSource();
            },
            onPayload: (message) => {
                if (!isRealtimeParticipant()) return;
                if (message.kind === 'patch') applyPatch(message.patch);
                else realtimeStatus.value = message.status;
            },
        });
        realtimeCoordinator.start();
    };

    const handleVisibilityChange = (): void => {
        if (activeConsumers === 0) return;
        if (document.visibilityState === 'hidden') {
            backgroundRefreshQueue.cancelPending();
            pendingInvalidation = EMPTY_INVALIDATION();
            pendingRefreshGrant = null;
            closeRealtimeCoordinator();
            realtimeStatus.value = 'idle';
            return;
        }
        backgroundRefreshQueue.beginCooldown();
        needsRecovery = true;
        reconcileRealtimeCoordinator();
    };

    const startRealtime = (): void => {
        if (typeof window === 'undefined') return;
        activeConsumers += 1;
        if (activeConsumers > 1) return;
        backgroundRefreshQueue.beginCooldown();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        visibilityListenerInstalled = true;
        reconcileRealtimeCoordinator();
    };
    const stopRealtime = (): void => {
        activeConsumers = Math.max(0, activeConsumers - 1);
        if (activeConsumers > 0) return;
        backgroundRefreshQueue.cancelPending();
        pendingInvalidation = EMPTY_INVALIDATION();
        pendingRefreshGrant = null;
        closeRealtimeCoordinator();
        if (visibilityListenerInstalled) {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            visibilityListenerInstalled = false;
        }
        realtimeStatus.value = 'idle';
    };

    watch(
        () => [session.isReady, session.hasGeneral, session.gameToken, session.profile, session.user?.id],
        () => reconcileRealtimeCoordinator()
    );

    return {
        snapshot,
        betting,
        rankings,
        loading,
        refreshing,
        error,
        realtimeStatus,
        loadTournamentPage,
        loadBettingPage,
        startRealtime,
        stopRealtime,
    };
});
