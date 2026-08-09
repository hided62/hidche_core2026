import {
    createEmptyRealtimeReadModelChanges,
    mergeRealtimeReadModelChanges,
    type RealtimeReadModelChanges,
} from '@sammo-ts/common';

export interface DashboardReadModelIdentity {
    generalId: number | null;
    cityId: number | null;
    nationId: number | null;
}

export interface DashboardRefreshPlan {
    context: boolean;
    lobby: boolean;
    map: boolean;
    commands: boolean;
    contacts: boolean;
    boardAccess: boolean;
    reservedTurns: boolean;
    records: boolean;
    frontStatus: boolean;
}

const contains = (ids: readonly number[], id: number | null): boolean => id !== null && ids.includes(id);

export const resolveDashboardRefreshPlan = (
    changes: RealtimeReadModelChanges,
    identity: DashboardReadModelIdentity
): DashboardRefreshPlan => {
    const ownGeneralChanged = contains(changes.generalIds, identity.generalId);
    const ownCityChanged = contains(changes.cityIds, identity.cityId);
    const ownNationChanged = contains(changes.nationIds, identity.nationId);
    const ownFrontStatusNationChanged = contains(
        changes.frontStatusNationIds ?? changes.nationIds,
        identity.nationId
    );
    const ownGeneralMapChanged = contains(changes.mapGeneralIds ?? changes.generalIds, identity.generalId);
    const frontStatusGeneralChanged =
        changes.frontStatusGeneralIds !== undefined
            ? changes.frontStatusGeneralIds.length > 0
            : changes.contactsChanged;
    const ownFrontStatusActorChanged = contains(changes.frontStatusActorIds ?? [], identity.generalId);
    const ownLobbyGeneralChanged = contains(changes.lobbyGeneralIds ?? changes.generalIds, identity.generalId);
    const lobbyChanged = changes.lobbyChanged ?? changes.contactsChanged;
    const entityContextChanged = ownGeneralChanged || ownCityChanged || ownNationChanged;
    const mapEntitiesChanged =
        (changes.mapCityIds ?? changes.cityIds).length > 0 ||
        (changes.mapNationIds ?? changes.nationIds).length > 0;
    const commandEntitiesChanged = changes.cityIds.length > 0 || changes.nationIds.length > 0;

    return {
        context: entityContextChanged,
        lobby: changes.worldChanged || lobbyChanged || ownLobbyGeneralChanged,
        map: changes.worldChanged || mapEntitiesChanged || ownGeneralMapChanged,
        commands: changes.worldChanged || commandEntitiesChanged || ownGeneralChanged,
        contacts: changes.contactsChanged,
        boardAccess: ownGeneralChanged || ownNationChanged,
        reservedTurns: contains(changes.reservedGeneralIds, identity.generalId),
        records:
            changes.globalRecordsChanged ||
            changes.worldHistoryChanged ||
            contains(changes.recordGeneralIds, identity.generalId),
        // lastTurnTime is intentionally excluded. This slice contains the
        // nation notice/vote/presence model and only follows related changes.
        frontStatus:
            Boolean(changes.frontStatusChanged) ||
            frontStatusGeneralChanged ||
            ownFrontStatusNationChanged ||
            ownFrontStatusActorChanged,
    };
};

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MergedReadModelRefreshQueue {
    request(changes: RealtimeReadModelChanges): void;
    cancelPending(): void;
}

export const createMergedReadModelRefreshQueue = (
    refresh: (changes: RealtimeReadModelChanges) => Promise<void>,
    options: {
        minIntervalMs?: number;
        now?: () => number;
        setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
        clearTimer?: (handle: TimerHandle) => void;
    } = {}
): MergedReadModelRefreshQueue => {
    const minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_000);
    const now = options.now ?? Date.now;
    const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    let pending = createEmptyRealtimeReadModelChanges();
    let hasPending = false;
    let running = false;
    let timer: TimerHandle | null = null;
    let lastStartedAt = Number.NEGATIVE_INFINITY;

    const schedule = () => {
        if (!hasPending || running || timer !== null) {
            return;
        }
        const delayMs = Math.max(0, lastStartedAt + minIntervalMs - now());
        timer = setTimer(() => {
            timer = null;
            if (!hasPending || running) {
                return;
            }
            const next = pending;
            pending = createEmptyRealtimeReadModelChanges();
            hasPending = false;
            running = true;
            lastStartedAt = now();
            void refresh(next).finally(() => {
                running = false;
                schedule();
            });
        }, delayMs);
    };

    return {
        request: (changes) => {
            pending = hasPending ? mergeRealtimeReadModelChanges(pending, changes) : changes;
            hasPending = true;
            schedule();
        },
        cancelPending: () => {
            hasPending = false;
            pending = createEmptyRealtimeReadModelChanges();
            if (timer !== null) {
                clearTimer(timer);
                timer = null;
            }
        },
    };
};
