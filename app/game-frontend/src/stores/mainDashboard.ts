import { computed, ref, toRaw, watch } from 'vue';
import { defineStore } from 'pinia';
import { MESSAGE_MAILBOX_NATIONAL_BASE, MESSAGE_MAILBOX_PUBLIC, type MessageType } from '@sammo-ts/logic';
import {
    applyReadModelDelta,
    cloneReadModelJson,
    type PublicRealtimeEvent,
    type RealtimeReadModelInvalidation,
} from '@sammo-ts/common';
import { trpc } from '../utils/trpc';
import { useMapViewerStore } from './mapViewer';
import { useSessionStore } from './session';
import { createLatestRefreshQueue } from '../utils/latestRefreshQueue';
import { createRateLimitedRefreshQueue } from '../utils/rateLimitedRefreshQueue';
import { structurallyShare } from '../utils/structuralShare';
import { createMergedReadModelRefreshQueue } from '../utils/dashboardReadModel';
import { createBroadcastTabCoordinator, type BroadcastTabCoordinator } from '../utils/broadcastTabCoordinator';
import { resolveWithReadModelSnapshotFallback } from '../utils/readModelDeltaRecovery';

const REALTIME_FULL_REFRESH_MIN_INTERVAL_MS = 5_000;

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

export const useMainDashboardStore = defineStore('mainDashboard', () => {
    type GeneralContext = Awaited<ReturnType<typeof trpc.general.me.query>>;
    type PresentGeneralContext = NonNullable<GeneralContext>;
    type LobbyInfo = Awaited<ReturnType<typeof trpc.lobby.info.query>>;
    type WorldMapResult = Awaited<ReturnType<typeof trpc.world.getMap.query>>;
    type MapLayout = Awaited<ReturnType<typeof trpc.world.getMapLayout.query>>;
    type CommandTable = Awaited<ReturnType<typeof trpc.turns.getCommandTable.query>>;
    type MessageBundle = Awaited<ReturnType<typeof trpc.messages.getRecent.query>>;
    type MessageContacts = Awaited<ReturnType<typeof trpc.messages.getContacts.query>>;
    type BoardAccess = Awaited<ReturnType<typeof trpc.board.getAccess.query>>;
    type ReservedTurnView = Awaited<ReturnType<typeof trpc.turns.reserved.getGeneral.query>>['turns'][number];
    type RecentRecord = Awaited<ReturnType<typeof trpc.general.getRecentRecords.query>>['global'][number];
    type FrontStatus = Awaited<ReturnType<typeof trpc.general.getFrontStatus.query>>;
    type ContextBundleDelta = Awaited<ReturnType<typeof trpc.dashboard.getContextBundleDelta.query>>;
    type ContextBundleInclude = {
        context: boolean;
        commandTable: boolean;
        boardAccess: boolean;
    };
    type DashboardReadModelPatch = {
        contextSnapshot?: GeneralContext;
        contextRevision?: string | null;
        commandTableRevision?: string | null;
        boardAccessRevision?: string | null;
        general?: PresentGeneralContext['general'] | null;
        city?: PresentGeneralContext['city'] | null;
        nation?: PresentGeneralContext['nation'] | null;
        lobbyInfo?: LobbyInfo | null;
        worldMap?: WorldMapResult | null;
        mapLayout?: MapLayout | null;
        commandTable?: CommandTable | null;
        messages?: MessageBundle | null;
        messageContacts?: MessageContacts | null;
        boardAccess?: BoardAccess | null;
        reservedGeneralTurns?: ReservedTurnView[] | null;
        reservedGeneralRevision?: number;
        reservedGeneralAutorunLimit?: number | null;
        globalRecords?: RecentRecord[];
        generalRecords?: RecentRecord[];
        worldHistory?: RecentRecord[];
        frontStatus?: FrontStatus | null;
    };
    type DashboardTabMessage =
        { kind: 'patch'; patch: DashboardReadModelPatch } | { kind: 'status'; status: 'idle' | 'connected' };

    const loading = ref(false);
    const refreshing = ref(false);
    const error = ref<string | null>(null);
    const recordsError = ref<string | null>(null);
    const frontStatusError = ref<string | null>(null);
    const realtimeEnabled = ref(true);
    const realtimeStatus = ref<'idle' | 'connected' | 'paused'>('idle');
    const realtimeActive = ref(false);

    const general = ref<PresentGeneralContext['general'] | null>(null);
    const city = ref<PresentGeneralContext['city'] | null>(null);
    const nation = ref<PresentGeneralContext['nation'] | null>(null);
    const lobbyInfo = ref<LobbyInfo | null>(null);
    const worldMap = ref<WorldMapResult | null>(null);
    const mapLayout = ref<MapLayout | null>(null);
    const commandTable = ref<CommandTable | null>(null);
    const messages = ref<MessageBundle | null>(null);
    const messageContacts = ref<MessageContacts | null>(null);
    const boardAccess = ref<BoardAccess | null>(null);
    const reservedGeneralTurns = ref<ReservedTurnView[] | null>(null);
    const reservedGeneralRevision = ref(0);
    const reservedGeneralAutorunLimit = ref<number | null>(null);
    const globalRecords = ref<RecentRecord[]>([]);
    const generalRecords = ref<RecentRecord[]>([]);
    const worldHistory = ref<RecentRecord[]>([]);
    const frontStatus = ref<FrontStatus | null>(null);
    const surveyNotice = ref<NonNullable<FrontStatus['latestVote']> | null>(null);
    let lastGeneralRecordId = 0;
    let lastWorldHistoryId = 0;
    let recordGeneralId: number | null = null;
    let initialized = false;
    let contextSnapshot: GeneralContext | undefined;
    let commandTableSnapshot: CommandTable | undefined;
    let boardAccessSnapshot: BoardAccess | undefined;
    let contextRevision: string | null = null;
    let commandTableRevision: string | null = null;
    let boardAccessRevision: string | null = null;

    const messageDraftText = ref('');
    const targetMailbox = ref<number>(MESSAGE_MAILBOX_PUBLIC);
    let initializedMailboxGeneralId: number | null = null;

    const generalId = computed(() => general.value?.id ?? null);
    const nationId = computed(() => nation.value?.id ?? null);
    const mapViewer = useMapViewerStore();
    const session = useSessionStore();

    const selectedCity = computed(() => {
        const layout = mapLayout.value;
        const map = worldMap.value;
        const selectedId = mapViewer.selectedCityId;
        if (!layout || !map || !selectedId) {
            return null;
        }
        const layoutCity = layout.cityList.find((city) => city.id === selectedId);
        const mapEntry = map.cityList.find((entry) => entry[0] === selectedId);
        if (!layoutCity || !mapEntry) {
            return null;
        }
        const [, level, state, nationIdValue, region, supplyFlag] = mapEntry;
        const nationEntry = map.nationList.find((nationEntry) => nationEntry[0] === nationIdValue);
        const regionName = layout.regionMap[region] ?? '-';
        const levelName = layout.levelMap[level] ?? '-';

        return {
            id: layoutCity.id,
            name: layoutCity.name,
            level,
            levelName,
            region,
            regionName,
            nationId: nationIdValue,
            nationName: nationEntry?.[1] ?? '무주',
            nationColor: nationEntry?.[2] ?? '#444444',
            state,
            supply: supplyFlag > 0,
            isCapital: nationEntry?.[3] === layoutCity.id,
            isMyCity: map.myCity === layoutCity.id,
        } as const;
    });

    const mailboxGroups = computed(() => {
        type MailboxOption = {
            label: string;
            value: number;
            disabled?: boolean;
            color?: string;
        };
        type MailboxGroup = {
            label: string;
            color?: string;
            options: MailboxOption[];
        };

        const ownNationId = nationId.value ?? 0;
        const ownMailbox = MESSAGE_MAILBOX_NATIONAL_BASE + ownNationId;
        const permission = messages.value?.permission ?? -1;
        const contacts = messageContacts.value?.nation ?? [];
        const ownNation = contacts.find((nation) => nation.mailbox === ownMailbox);
        const groups: MailboxGroup[] = [
            {
                label: '즐겨찾기',
                color: '#000000',
                options: [
                    {
                        label: '【 아국 메세지 】',
                        value: ownMailbox,
                        color: ownNation?.color ?? '#000000',
                    },
                    {
                        label: '【 전체 메세지 】',
                        value: MESSAGE_MAILBOX_PUBLIC,
                        color: '#000000',
                    },
                ],
            },
        ];

        if (permission >= 4) {
            groups.push({
                label: '외교메시지',
                color: '#000000',
                options: contacts
                    .filter((nation) => nation.mailbox !== ownMailbox && nation.nationId > 0)
                    .map((nation) => ({
                        label: nation.name,
                        value: nation.mailbox,
                        color: nation.color,
                    })),
            });
        }

        const sortedContacts = [...contacts].sort((left, right) => {
            if (left.mailbox === ownMailbox) return -1;
            if (right.mailbox === ownMailbox) return 1;
            return left.mailbox - right.mailbox;
        });
        for (const nation of sortedContacts) {
            const options = [...nation.general]
                .filter(([id]) => id !== generalId.value)
                .sort((left, right) => left[1].localeCompare(right[1], 'ko'))
                .map(([id, name, flags]) => {
                    const ruler = Boolean(flags & 1);
                    const ambassador = Boolean(flags & 4);
                    return {
                        label: ruler ? `*${name}*` : ambassador ? `#${name}#` : name,
                        value: id,
                        disabled: permission === 4 && ambassador && nation.mailbox !== ownMailbox,
                        color: nation.color,
                    };
                });
            if (options.length > 0) {
                groups.push({
                    label: nation.name,
                    color: nation.color,
                    options,
                });
            }
        }
        return groups;
    });

    const statusLine = computed(() => {
        if (!lobbyInfo.value) {
            return '상태 정보를 불러오는 중';
        }
        return `${lobbyInfo.value.year}년 ${lobbyInfo.value.month}월 · 턴 ${lobbyInfo.value.turnTerm}분`;
    });

    const realtimeLabel = computed(() => {
        if (!realtimeEnabled.value) {
            return '끔';
        }
        return realtimeStatus.value === 'connected' ? '연결됨' : '대기중';
    });

    const setRealtimeEnabled = (enabled: boolean) => {
        const wasEnabled = realtimeEnabled.value;
        realtimeEnabled.value = enabled;
        if (!enabled) {
            realtimeStatus.value = 'paused';
            reconcileRealtimeCoordinator();
            return;
        }
        if (!wasEnabled) {
            void refreshQueue.request().finally(() => reconcileRealtimeCoordinator());
        }
    };

    const updateFrontStatus = (nextStatus: FrontStatus) => {
        frontStatus.value = structurallyShare(frontStatus.value, nextStatus);
        const latestVote = nextStatus.latestVote;
        if (!latestVote || latestVote.hasVoted || typeof window === 'undefined') {
            surveyNotice.value = null;
            return;
        }
        const serverId = session.profile?.split(':', 1)[0] ?? 'game';
        const storageKey = `state.${serverId}.lastVote`;
        const lastSeenVoteId = Number.parseInt(window.localStorage.getItem(storageKey) ?? '0', 10);
        if (latestVote.id <= (Number.isFinite(lastSeenVoteId) ? lastSeenVoteId : 0)) {
            surveyNotice.value = null;
            return;
        }
        window.localStorage.setItem(storageKey, latestVote.id.toString());
        surveyNotice.value = latestVote;
    };

    const dismissSurveyNotice = () => {
        surveyNotice.value = null;
    };

    const mergeRecentRecords = (current: RecentRecord[], incoming: RecentRecord[]): RecentRecord[] => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        for (const entry of incoming) {
            merged.set(entry.id, entry);
        }
        return [...merged.values()].sort((left, right) => right.id - left.id).slice(0, 15);
    };

    const resetRecentRecords = (id: number | null) => {
        globalRecords.value = [];
        generalRecords.value = [];
        worldHistory.value = [];
        lastGeneralRecordId = 0;
        lastWorldHistoryId = 0;
        recordGeneralId = id;
        frontStatus.value = null;
        surveyNotice.value = null;
    };

    const applyRecentRecords = (records: Awaited<ReturnType<typeof trpc.general.getRecentRecords.query>>) => {
        globalRecords.value = structurallyShare(
            globalRecords.value,
            mergeRecentRecords(globalRecords.value, records.global)
        );
        generalRecords.value = structurallyShare(
            generalRecords.value,
            mergeRecentRecords(generalRecords.value, records.general)
        );
        worldHistory.value = structurallyShare(
            worldHistory.value,
            mergeRecentRecords(worldHistory.value, records.history)
        );
        lastGeneralRecordId = Math.max(lastGeneralRecordId, records.global[0]?.id ?? 0, records.general[0]?.id ?? 0);
        lastWorldHistoryId = Math.max(lastWorldHistoryId, records.history[0]?.id ?? 0);
    };

    const applyDashboardPatch = (patch: DashboardReadModelPatch) => {
        if (patch.contextSnapshot === null) {
            contextSnapshot = null;
            commandTableSnapshot = undefined;
            boardAccessSnapshot = undefined;
            general.value = null;
            city.value = null;
            nation.value = null;
            commandTable.value = null;
            boardAccess.value = null;
            reservedGeneralTurns.value = null;
            reservedGeneralRevision.value = 0;
            reservedGeneralAutorunLimit.value = null;
            resetRecentRecords(null);
            commandTableRevision = null;
            boardAccessRevision = null;
        } else if (patch.contextSnapshot !== undefined) {
            contextSnapshot = patch.contextSnapshot;
            general.value = structurallyShare(general.value, patch.contextSnapshot.general);
            city.value = structurallyShare(city.value, patch.contextSnapshot.city);
            nation.value = structurallyShare(nation.value, patch.contextSnapshot.nation);
        }
        if (patch.general === null) {
            contextSnapshot = null;
            commandTableSnapshot = undefined;
            boardAccessSnapshot = undefined;
            general.value = null;
            city.value = null;
            nation.value = null;
            commandTable.value = null;
            boardAccess.value = null;
            reservedGeneralTurns.value = null;
            reservedGeneralRevision.value = 0;
            reservedGeneralAutorunLimit.value = null;
            resetRecentRecords(null);
            contextRevision = null;
            commandTableRevision = null;
            boardAccessRevision = null;
        } else if (patch.general !== undefined) {
            general.value = structurallyShare(general.value, patch.general);
        }
        if (patch.city !== undefined) city.value = structurallyShare(city.value, patch.city);
        if (patch.nation !== undefined) nation.value = structurallyShare(nation.value, patch.nation);
        if (patch.lobbyInfo !== undefined) lobbyInfo.value = structurallyShare(lobbyInfo.value, patch.lobbyInfo);
        if (patch.worldMap !== undefined) worldMap.value = structurallyShare(worldMap.value, patch.worldMap);
        if (patch.mapLayout !== undefined) mapLayout.value = structurallyShare(mapLayout.value, patch.mapLayout);
        if (patch.commandTable !== undefined) {
            commandTableSnapshot = patch.commandTable ?? undefined;
            commandTable.value = structurallyShare(commandTable.value, patch.commandTable);
        }
        if (patch.messages !== undefined) messages.value = structurallyShare(messages.value, patch.messages);
        if (patch.messageContacts !== undefined) {
            messageContacts.value = structurallyShare(messageContacts.value, patch.messageContacts);
        }
        if (patch.boardAccess !== undefined) {
            boardAccessSnapshot = patch.boardAccess ?? undefined;
            boardAccess.value = structurallyShare(boardAccess.value, patch.boardAccess);
        }
        if (patch.reservedGeneralTurns !== undefined) {
            reservedGeneralTurns.value = structurallyShare<unknown>(
                reservedGeneralTurns.value,
                patch.reservedGeneralTurns
            ) as ReservedTurnView[] | null;
        }
        if (patch.reservedGeneralRevision !== undefined) {
            reservedGeneralRevision.value = patch.reservedGeneralRevision;
        }
        if (patch.reservedGeneralAutorunLimit !== undefined) {
            reservedGeneralAutorunLimit.value = patch.reservedGeneralAutorunLimit;
        }
        if (patch.globalRecords !== undefined) {
            globalRecords.value = structurallyShare(globalRecords.value, patch.globalRecords);
            lastGeneralRecordId = Math.max(lastGeneralRecordId, patch.globalRecords[0]?.id ?? 0);
        }
        if (patch.generalRecords !== undefined) {
            generalRecords.value = structurallyShare(generalRecords.value, patch.generalRecords);
            lastGeneralRecordId = Math.max(lastGeneralRecordId, patch.generalRecords[0]?.id ?? 0);
        }
        if (patch.worldHistory !== undefined) {
            worldHistory.value = structurallyShare(worldHistory.value, patch.worldHistory);
            lastWorldHistoryId = Math.max(lastWorldHistoryId, patch.worldHistory[0]?.id ?? 0);
        }
        if (patch.frontStatus === null) {
            frontStatus.value = null;
            surveyNotice.value = null;
        } else if (patch.frontStatus !== undefined) {
            updateFrontStatus(patch.frontStatus);
        }
        if (patch.contextRevision !== undefined) contextRevision = patch.contextRevision;
        if (patch.commandTableRevision !== undefined) commandTableRevision = patch.commandTableRevision;
        if (patch.boardAccessRevision !== undefined) boardAccessRevision = patch.boardAccessRevision;
    };

    const currentDashboardPatch = (): DashboardReadModelPatch => {
        const patch: DashboardReadModelPatch = {};
        patch.contextSnapshot = toRaw(contextSnapshot);
        patch.contextRevision = contextRevision;
        patch.commandTableRevision = commandTableRevision;
        patch.boardAccessRevision = boardAccessRevision;
        patch.general = toRaw(general.value);
        patch.city = toRaw(city.value);
        patch.nation = toRaw(nation.value);
        patch.lobbyInfo = toRaw(lobbyInfo.value);
        patch.worldMap = toRaw(worldMap.value);
        patch.mapLayout = toRaw(mapLayout.value);
        patch.commandTable = commandTableSnapshot ?? null;
        patch.messages = toRaw(messages.value);
        patch.messageContacts = toRaw(messageContacts.value);
        patch.boardAccess = boardAccessSnapshot ?? null;
        patch.reservedGeneralTurns = toRaw(reservedGeneralTurns.value as unknown) as ReservedTurnView[] | null;
        patch.reservedGeneralRevision = reservedGeneralRevision.value;
        patch.reservedGeneralAutorunLimit = reservedGeneralAutorunLimit.value;
        patch.globalRecords = toRaw(globalRecords.value);
        patch.generalRecords = toRaw(generalRecords.value);
        patch.worldHistory = toRaw(worldHistory.value);
        patch.frontStatus = toRaw(frontStatus.value);
        return patch;
    };

    const resolveContextBundlePatch = (bundle: ContextBundleDelta): DashboardReadModelPatch => {
        const patch: DashboardReadModelPatch = {};

        if (bundle.context) {
            const applied = applyReadModelDelta(contextSnapshot, contextRevision, bundle.context);
            patch.contextRevision = applied.revision;
            if (bundle.context.kind !== 'unchanged') {
                patch.contextSnapshot = applied.data;
            }
        }
        if (bundle.commandTable) {
            const applied = applyReadModelDelta(commandTableSnapshot, commandTableRevision, bundle.commandTable);
            patch.commandTableRevision = applied.revision;
            if (bundle.commandTable.kind !== 'unchanged') {
                patch.commandTable = applied.data;
            }
        }
        if (bundle.boardAccess) {
            const applied = applyReadModelDelta(boardAccessSnapshot, boardAccessRevision, bundle.boardAccess);
            patch.boardAccessRevision = applied.revision;
            if (bundle.boardAccess.kind !== 'unchanged') {
                patch.boardAccess = applied.data;
            }
        }

        return patch;
    };

    const fetchContextBundlePatch = async (
        include: ContextBundleInclude,
        forceSnapshot = false
    ): Promise<DashboardReadModelPatch> => {
        const request = (force: boolean) =>
            trpc.dashboard.getContextBundleDelta.query({
                include,
                known: force
                    ? undefined
                    : {
                          ...(contextRevision ? { context: contextRevision } : {}),
                          ...(commandTableRevision ? { commandTable: commandTableRevision } : {}),
                          ...(boardAccessRevision ? { boardAccess: boardAccessRevision } : {}),
                      },
                forceSnapshot: force || undefined,
            });

        return resolveWithReadModelSnapshotFallback({
            request,
            resolve: resolveContextBundlePatch,
            forceSnapshot,
        });
    };

    const refreshMainData = async () => {
        const isInitialLoad = !initialized;
        if (isInitialLoad) {
            loading.value = true;
        } else {
            refreshing.value = true;
        }
        error.value = null;
        recordsError.value = null;
        frontStatusError.value = null;

        try {
            const contextPatch = await fetchContextBundlePatch(
                { context: true, commandTable: true, boardAccess: true },
                true
            );
            applyDashboardPatch(contextPatch);
            const context = contextSnapshot;

            if (!context) {
                initialized = true;
                return;
            }

            const id = context.general.id;
            if (recordGeneralId !== id) {
                resetRecentRecords(id);
            }
            const layoutPromise = mapLayout.value ? Promise.resolve(mapLayout.value) : trpc.world.getMapLayout.query();
            const generalTurnsPromise = trpc.turns.reserved.getGeneral.query({ generalId: id });
            const recordsPromise = trpc.general.getRecentRecords
                .query({
                    lastGeneralRecordId,
                    lastWorldHistoryId,
                })
                .catch((err: unknown) => {
                    recordsError.value = resolveErrorMessage(err);
                    return null;
                });
            const frontStatusPromise = trpc.general.getFrontStatus.query().catch((err: unknown) => {
                frontStatusError.value = resolveErrorMessage(err);
                return null;
            });
            const [layout, lobby, map, messageData, contacts, generalTurns, records, nextFrontStatus] =
                await Promise.all([
                    layoutPromise,
                    trpc.lobby.info.query(),
                    trpc.world.getMap.query({ generalId: id, showMe: true, useCache: true }),
                    trpc.messages.getRecent.query({ generalId: id }),
                    trpc.messages.getContacts.query({ generalId: id }),
                    generalTurnsPromise,
                    recordsPromise,
                    frontStatusPromise,
                ]);

            general.value = structurallyShare(general.value, context.general);
            city.value = structurallyShare(city.value, context.city);
            nation.value = structurallyShare(nation.value, context.nation);
            mapLayout.value = structurallyShare(mapLayout.value, layout);
            lobbyInfo.value = structurallyShare(lobbyInfo.value, lobby);
            worldMap.value = structurallyShare(worldMap.value, map);
            messages.value = structurallyShare(messages.value, messageData);
            messageContacts.value = structurallyShare(messageContacts.value, contacts);
            reservedGeneralTurns.value = structurallyShare<unknown>(
                reservedGeneralTurns.value,
                generalTurns.turns
            ) as ReservedTurnView[];
            reservedGeneralRevision.value = generalTurns.revision;
            reservedGeneralAutorunLimit.value = generalTurns.autorunLimit ?? null;
            if (records) {
                applyRecentRecords(records);
            }
            if (nextFrontStatus) {
                updateFrontStatus(nextFrontStatus);
            }
            if (initializedMailboxGeneralId !== id) {
                targetMailbox.value = MESSAGE_MAILBOX_NATIONAL_BASE + context.general.nationId;
                initializedMailboxGeneralId = id;
            }
            initialized = true;
        } catch (err) {
            error.value = resolveErrorMessage(err);
        } finally {
            if (isInitialLoad) {
                loading.value = false;
            } else {
                refreshing.value = false;
            }
        }
    };

    const refreshQueue = createLatestRefreshQueue(refreshMainData);
    const loadMainData = () => refreshQueue.request();
    let realtimeCoordinator: BroadcastTabCoordinator<DashboardTabMessage> | null = null;
    let realtimeCoordinatorScope: string | null = null;

    const publishDashboardPatch = (patch: DashboardReadModelPatch) => {
        if (!realtimeCoordinator) {
            return;
        }
        // BroadcastChannel uses the structured-clone algorithm. Normalize the
        // full payload so nested Vue proxies never reach that browser boundary.
        try {
            realtimeCoordinator.postFromLeader({ kind: 'patch', patch: cloneReadModelJson(patch) });
        } catch {
            // Same-account fan-out is best effort; the leader's local refresh
            // and the next visibility/full-snapshot recovery remain valid.
        }
    };

    const realtimeRefreshQueue = createRateLimitedRefreshQueue(
        async () => {
            await refreshQueue.request();
            publishDashboardPatch(currentDashboardPatch());
        },
        {
            minIntervalMs: REALTIME_FULL_REFRESH_MIN_INTERVAL_MS,
        }
    );

    const refreshChangedReadModels = async (plan: RealtimeReadModelInvalidation) => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        if (!Object.values(plan).some(Boolean)) {
            return;
        }

        refreshing.value = true;
        error.value = null;
        if (plan.records) recordsError.value = null;
        if (plan.frontStatus) frontStatusError.value = null;
        try {
            const contextBundlePromise =
                plan.context || plan.commands || plan.boardAccess
                    ? fetchContextBundlePatch({
                          context: plan.context,
                          commandTable: plan.commands,
                          boardAccess: plan.boardAccess,
                      })
                    : Promise.resolve(undefined);
            const lobbyPromise = plan.lobby ? trpc.lobby.info.query() : Promise.resolve(undefined);
            const mapPromise = plan.map
                ? trpc.world.getMap.query({ generalId: id, showMe: true, useCache: true })
                : Promise.resolve(undefined);
            const contactsPromise = plan.contacts
                ? trpc.messages.getContacts.query({ generalId: id })
                : Promise.resolve(undefined);
            const reservedPromise = plan.reservedTurns
                ? trpc.turns.reserved.getGeneral.query({ generalId: id })
                : Promise.resolve(undefined);
            const recordsPromise = plan.records
                ? trpc.general.getRecentRecords
                      .query({ lastGeneralRecordId, lastWorldHistoryId })
                      .catch((err: unknown) => {
                          recordsError.value = resolveErrorMessage(err);
                          return null;
                      })
                : Promise.resolve(undefined);
            const frontPromise = plan.frontStatus
                ? trpc.general.getFrontStatus.query().catch((err: unknown) => {
                      frontStatusError.value = resolveErrorMessage(err);
                      return null;
                  })
                : Promise.resolve(undefined);

            const [contextPatch, lobby, map, contacts, generalTurns, records, nextFrontStatus] = await Promise.all([
                contextBundlePromise,
                lobbyPromise,
                mapPromise,
                contactsPromise,
                reservedPromise,
                recordsPromise,
                frontPromise,
            ]);

            const patch: DashboardReadModelPatch = contextPatch ? { ...contextPatch } : {};
            if (lobby !== undefined) patch.lobbyInfo = lobby;
            if (map !== undefined) patch.worldMap = map;
            if (contacts !== undefined) patch.messageContacts = contacts;
            if (generalTurns !== undefined) {
                patch.reservedGeneralTurns = generalTurns.turns;
                patch.reservedGeneralRevision = generalTurns.revision;
                patch.reservedGeneralAutorunLimit = generalTurns.autorunLimit ?? null;
            }
            if (records) {
                const nextGlobalRecords = mergeRecentRecords(globalRecords.value, records.global);
                const nextGeneralRecords = mergeRecentRecords(generalRecords.value, records.general);
                const nextWorldHistory = mergeRecentRecords(worldHistory.value, records.history);
                patch.globalRecords = nextGlobalRecords;
                patch.generalRecords = nextGeneralRecords;
                patch.worldHistory = nextWorldHistory;
            }
            if (nextFrontStatus) patch.frontStatus = nextFrontStatus;
            applyDashboardPatch(patch);
            publishDashboardPatch(patch);
        } catch (err) {
            error.value = resolveErrorMessage(err);
        } finally {
            refreshing.value = false;
        }
    };

    const readModelRefreshQueue = createMergedReadModelRefreshQueue(refreshChangedReadModels);

    const refreshMessages = async () => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            const nextMessages = await trpc.messages.getRecent.query({ generalId: id });
            const patch = { messages: nextMessages } satisfies DashboardReadModelPatch;
            applyDashboardPatch(patch);
            publishDashboardPatch(patch);
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const sendMessage = async () => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        const mailbox = targetMailbox.value;
        const text = messageDraftText.value.trim();
        if (!text) {
            return;
        }
        if (mailbox <= 0) {
            return;
        }

        try {
            messageDraftText.value = '';
            await trpc.messages.send.mutate({
                generalId: id,
                mailbox,
                text,
            });
            await refreshMessages();
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const loadOlderMessages = async (type: MessageType) => {
        const id = generalId.value;
        if (!id || !messages.value) {
            return;
        }

        const bucket = messages.value[type] ?? [];
        const oldest = bucket[bucket.length - 1];
        if (!oldest) {
            return;
        }

        try {
            const older = await trpc.messages.getOld.query({
                generalId: id,
                type,
                to: oldest.id,
            });
            const merged = {
                ...messages.value,
                [type]: [...bucket, ...older[type]],
            } as MessageBundle;
            messages.value = merged;
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const respondToMessage = async (messageId: number, response: boolean) => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            const result = await trpc.messages.respond.mutate({
                generalId: id,
                messageId,
                response,
            });
            if (!result.result) {
                error.value = result.reason;
            }
            await refreshMessages();
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const readLatestMessage = async (type: 'private' | 'diplomacy', messageId: number) => {
        const id = generalId.value;
        if (!id || messageId <= 0) {
            return;
        }
        try {
            await trpc.messages.readLatest.mutate({
                generalId: id,
                type,
                messageId,
            });
            if (messages.value) {
                messages.value = {
                    ...messages.value,
                    latestRead: {
                        ...messages.value.latestRead,
                        [type]: Math.max(messages.value.latestRead[type], messageId),
                    },
                };
            }
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const deleteMessage = async (messageId: number) => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            await trpc.messages.delete.mutate({ generalId: id, messageId });
            await refreshMessages();
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const setGeneralTurn = async (turnIndex: number, action: string, args: Record<string, unknown> = {}) => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            const result = await trpc.turns.reserved.setGeneral.mutate({
                generalId: id,
                turnIndex,
                action,
                args,
                expectedRevision: reservedGeneralRevision.value,
            });
            reservedGeneralTurns.value = result.turns;
            reservedGeneralRevision.value = result.revision;
            reservedGeneralAutorunLimit.value = result.autorunLimit ?? null;
        } catch (err) {
            error.value = resolveErrorMessage(err);
            const snapshot = await trpc.turns.reserved.getGeneral.query({ generalId: id }).catch(() => null);
            if (snapshot) {
                reservedGeneralTurns.value = snapshot.turns;
                reservedGeneralRevision.value = snapshot.revision;
                reservedGeneralAutorunLimit.value = snapshot.autorunLimit ?? null;
            }
        }
    };

    const shiftGeneralTurns = async (amount: number) => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            const result = await trpc.turns.reserved.shiftGeneral.mutate({
                generalId: id,
                amount,
                expectedRevision: reservedGeneralRevision.value,
            });
            reservedGeneralTurns.value = result.turns;
            reservedGeneralRevision.value = result.revision;
            reservedGeneralAutorunLimit.value = result.autorunLimit ?? null;
        } catch (err) {
            error.value = resolveErrorMessage(err);
            const snapshot = await trpc.turns.reserved.getGeneral.query({ generalId: id }).catch(() => null);
            if (snapshot) {
                reservedGeneralTurns.value = snapshot.turns;
                reservedGeneralRevision.value = snapshot.revision;
                reservedGeneralAutorunLimit.value = snapshot.autorunLimit ?? null;
            }
        }
    };

    const setGeneralTurns = async (
        entries: Array<{ turnList: number[]; action: string; args: Record<string, unknown> }>
    ) => {
        const id = generalId.value;
        if (!id || !entries.length) return;
        try {
            const result = await trpc.turns.reserved.setGeneralBulk.mutate({
                generalId: id,
                entries,
                expectedRevision: reservedGeneralRevision.value,
            });
            reservedGeneralTurns.value = result.turns;
            reservedGeneralRevision.value = result.revision;
            reservedGeneralAutorunLimit.value = result.autorunLimit ?? null;
        } catch (err) {
            error.value = resolveErrorMessage(err);
            const snapshot = await trpc.turns.reserved.getGeneral.query({ generalId: id }).catch(() => null);
            if (snapshot) {
                reservedGeneralTurns.value = snapshot.turns;
                reservedGeneralRevision.value = snapshot.revision;
                reservedGeneralAutorunLimit.value = snapshot.autorunLimit ?? null;
            }
        }
    };

    const repeatGeneralTurns = async (amount: number) => {
        const id = generalId.value;
        if (!id) return;
        try {
            const result = await trpc.turns.reserved.repeatGeneral.mutate({
                generalId: id,
                amount,
                expectedRevision: reservedGeneralRevision.value,
            });
            reservedGeneralTurns.value = result.turns;
            reservedGeneralRevision.value = result.revision;
            reservedGeneralAutorunLimit.value = result.autorunLimit ?? null;
        } catch (err) {
            error.value = resolveErrorMessage(err);
            const snapshot = await trpc.turns.reserved.getGeneral.query({ generalId: id }).catch(() => null);
            if (snapshot) {
                reservedGeneralTurns.value = snapshot.turns;
                reservedGeneralRevision.value = snapshot.revision;
                reservedGeneralAutorunLimit.value = snapshot.autorunLimit ?? null;
            }
        }
    };

    let realtimeSource: EventSource | null = null;
    let realtimeToken: string | null = null;
    let visibilityListenerInstalled = false;

    const isAccessToken = (token: string | null): boolean => Boolean(token?.startsWith('ga_'));

    const buildRealtimeUrl = (token: string): string => {
        const base = import.meta.env.VITE_GAME_SSE_URL ?? '/events';
        const url = new URL(base, window.location.origin);
        url.searchParams.set('token', token);
        return url.toString();
    };

    const parseRealtimePayload = (raw: MessageEvent): PublicRealtimeEvent | null => {
        if (!raw.data || typeof raw.data !== 'string') {
            return null;
        }
        try {
            const parsed = JSON.parse(raw.data) as PublicRealtimeEvent;
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            if (typeof parsed.type !== 'string') {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    };

    const closeRealtimeSource = () => {
        if (!realtimeSource) {
            return;
        }
        realtimeSource.close();
        realtimeSource = null;
        realtimeToken = null;
    };

    const isRealtimeParticipant = (): boolean =>
        realtimeActive.value &&
        document.visibilityState !== 'hidden' &&
        realtimeEnabled.value &&
        session.isReady &&
        session.hasGeneral &&
        generalId.value !== null;

    const closeRealtimeCoordinator = () => {
        const coordinator = realtimeCoordinator;
        realtimeCoordinator = null;
        realtimeCoordinatorScope = null;
        coordinator?.stop();
        closeRealtimeSource();
    };

    const reconcileRealtimeCoordinator = () => {
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
        const account = session.user?.id ?? `general-${generalId.value}`;
        const scope = `${encodeURIComponent(profile)}:${encodeURIComponent(account)}`;
        if (realtimeCoordinator && realtimeCoordinatorScope === scope) return;

        closeRealtimeCoordinator();
        realtimeCoordinatorScope = scope;
        realtimeCoordinator = createBroadcastTabCoordinator<DashboardTabMessage>(`sammo-main-dashboard:${scope}`, {
            onLeadershipChange: (leader) => {
                if (leader) {
                    void connectRealtime();
                } else {
                    closeRealtimeSource();
                    if (realtimeEnabled.value) realtimeStatus.value = 'idle';
                }
            },
            onPayload: (message) => {
                if (!isRealtimeParticipant()) return;
                if (message.kind === 'patch') {
                    applyDashboardPatch(message.patch);
                    return;
                }
                realtimeStatus.value = message.status;
            },
        });
        realtimeCoordinator.start();
    };

    const ensureAccessToken = async (): Promise<string | null> => {
        if (!session.gameToken) {
            return null;
        }
        if (isAccessToken(session.gameToken)) {
            return session.gameToken;
        }
        const exchanged = await session.exchangeGatewayToken();
        if (!exchanged) {
            return null;
        }
        return session.gameToken && isAccessToken(session.gameToken) ? session.gameToken : null;
    };

    const connectRealtime = async () => {
        if (typeof window === 'undefined') {
            return;
        }
        if (
            !realtimeActive.value ||
            document.visibilityState === 'hidden' ||
            !realtimeEnabled.value ||
            !session.isReady ||
            !session.hasGeneral ||
            (realtimeCoordinator !== null && !realtimeCoordinator.isLeader())
        ) {
            return;
        }
        const token = await ensureAccessToken();
        if (!token) {
            realtimeStatus.value = 'idle';
            return;
        }
        if (!isRealtimeParticipant() || (realtimeCoordinator !== null && !realtimeCoordinator.isLeader())) {
            return;
        }
        if (realtimeSource && realtimeToken === token) {
            return;
        }
        closeRealtimeSource();
        realtimeToken = token;
        realtimeStatus.value = 'idle';

        const source = new EventSource(buildRealtimeUrl(token));
        realtimeSource = source;

        source.addEventListener('open', () => {
            realtimeStatus.value = 'connected';
            realtimeCoordinator?.postFromLeader({ kind: 'status', status: 'connected' });
        });
        source.addEventListener('error', () => {
            realtimeStatus.value = realtimeEnabled.value ? 'idle' : 'paused';
            realtimeCoordinator?.postFromLeader({ kind: 'status', status: 'idle' });
        });
        source.addEventListener('readModelInvalidated', (event) => {
            if (realtimeCoordinator !== null && !realtimeCoordinator.isLeader()) return;
            const payload = parseRealtimePayload(event);
            if (!payload || payload.type !== 'readModelInvalidated') {
                return;
            }
            readModelRefreshQueue.request(payload.invalidation);
        });
        source.addEventListener('messagesInvalidated', (event) => {
            if (realtimeCoordinator !== null && !realtimeCoordinator.isLeader()) return;
            const payload = parseRealtimePayload(event);
            if (!payload || payload.type !== 'messagesInvalidated') {
                return;
            }
            void refreshMessages();
        });

        // Rolling deployment fallback: an older API may still expose internal
        // events. Do not inspect their payload; use the bounded full refresh.
        for (const legacyEventType of ['turnCompleted', 'readModelChanged'] as const) {
            source.addEventListener(legacyEventType, () => {
                if (realtimeCoordinator !== null && !realtimeCoordinator.isLeader()) return;
                realtimeRefreshQueue.request();
            });
        }
        source.addEventListener('messageCreated', () => {
            if (realtimeCoordinator !== null && !realtimeCoordinator.isLeader()) return;
            void refreshMessages();
        });
        source.addEventListener('ping', () => {
            if (realtimeEnabled.value) {
                realtimeStatus.value = 'connected';
                realtimeCoordinator?.postFromLeader({ kind: 'status', status: 'connected' });
            }
        });
    };

    const handleVisibilityChange = () => {
        if (!realtimeActive.value) return;
        if (document.visibilityState === 'hidden') {
            realtimeRefreshQueue.cancelPending();
            readModelRefreshQueue.cancelPending();
            closeRealtimeCoordinator();
            realtimeStatus.value = 'idle';
            return;
        }
        realtimeRefreshQueue.beginCooldown();
        void refreshQueue.request().finally(() => reconcileRealtimeCoordinator());
    };

    const startRealtime = () => {
        if (typeof window === 'undefined' || realtimeActive.value) return;
        realtimeActive.value = true;
        realtimeRefreshQueue.beginCooldown();
        if (!visibilityListenerInstalled) {
            document.addEventListener('visibilitychange', handleVisibilityChange);
            visibilityListenerInstalled = true;
        }
        reconcileRealtimeCoordinator();
    };

    const stopRealtime = () => {
        realtimeActive.value = false;
        realtimeRefreshQueue.cancelPending();
        readModelRefreshQueue.cancelPending();
        closeRealtimeCoordinator();
        if (visibilityListenerInstalled) {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            visibilityListenerInstalled = false;
        }
        realtimeStatus.value = realtimeEnabled.value ? 'idle' : 'paused';
    };

    watch(
        () => [
            realtimeActive.value,
            realtimeEnabled.value,
            session.isReady,
            session.hasGeneral,
            session.gameToken,
            session.profile,
            session.user?.id,
            generalId.value,
        ],
        ([active, enabled, ready, hasGeneral]) => {
            realtimeStatus.value = !enabled ? 'paused' : realtimeStatus.value;
            if (!active || !ready || !hasGeneral) {
                realtimeStatus.value = enabled ? 'idle' : 'paused';
            }
            reconcileRealtimeCoordinator();
        }
    );

    return {
        loading,
        refreshing,
        error,
        recordsError,
        frontStatusError,
        realtimeEnabled,
        realtimeStatus,
        general,
        city,
        nation,
        lobbyInfo,
        worldMap,
        mapLayout,
        selectedCity,
        commandTable,
        messages,
        messageContacts,
        boardAccess,
        reservedGeneralTurns,
        reservedGeneralAutorunLimit,
        globalRecords,
        generalRecords,
        worldHistory,
        frontStatus,
        surveyNotice,
        messageDraftText,
        targetMailbox,
        mailboxGroups,
        statusLine,
        realtimeLabel,
        setRealtimeEnabled,
        startRealtime,
        stopRealtime,
        dismissSurveyNotice,
        loadMainData,
        refreshMessages,
        sendMessage,
        loadOlderMessages,
        respondToMessage,
        readLatestMessage,
        deleteMessage,
        setGeneralTurn,
        setGeneralTurns,
        shiftGeneralTurns,
        repeatGeneralTurns,
    };
});
