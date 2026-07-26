import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { MESSAGE_MAILBOX_NATIONAL_BASE, MESSAGE_MAILBOX_PUBLIC, type MessageType } from '@sammo-ts/logic';
import type { RealtimeEvent } from '@sammo-ts/common';
import { trpc } from '../utils/trpc';
import { useMapViewerStore } from './mapViewer';
import { useSessionStore } from './session';

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
    type LobbyInfo = Awaited<ReturnType<typeof trpc.lobby.info.query>>;
    type WorldMapResult = Awaited<ReturnType<typeof trpc.world.getMap.query>>;
    type MapLayout = Awaited<ReturnType<typeof trpc.world.getMapLayout.query>>;
    type CommandTable = Awaited<ReturnType<typeof trpc.turns.getCommandTable.query>>;
    type MessageBundle = Awaited<ReturnType<typeof trpc.messages.getRecent.query>>;
    type MessageContacts = Awaited<ReturnType<typeof trpc.messages.getContacts.query>>;
    type FrontRecords = Awaited<ReturnType<typeof trpc.general.getFrontRecords.query>>;
    type BoardAccess = Awaited<ReturnType<typeof trpc.board.getAccess.query>>;
    type ReservedTurnView = Awaited<ReturnType<typeof trpc.turns.reserved.getGeneral.query>>[number];

    const loading = ref(false);
    const error = ref<string | null>(null);
    const frontRecordsError = ref<string | null>(null);
    const realtimeEnabled = ref(true);
    const realtimeStatus = ref<'idle' | 'connected' | 'paused'>('idle');

    const generalContext = ref<GeneralContext | null>(null);
    const lobbyInfo = ref<LobbyInfo | null>(null);
    const worldMap = ref<WorldMapResult | null>(null);
    const mapLayout = ref<MapLayout | null>(null);
    const commandTable = ref<CommandTable | null>(null);
    const messages = ref<MessageBundle | null>(null);
    const messageContacts = ref<MessageContacts | null>(null);
    const frontRecords = ref<FrontRecords | null>(null);
    const boardAccess = ref<BoardAccess | null>(null);
    const reservedGeneralTurns = ref<ReservedTurnView[] | null>(null);
    const reservedNationTurns = ref<ReservedTurnView[] | null>(null);

    const messageDraftText = ref('');
    const targetMailbox = ref<number>(MESSAGE_MAILBOX_PUBLIC);
    let initializedMailboxGeneralId: number | null = null;

    const general = computed(() => generalContext.value?.general ?? null);
    const city = computed(() => generalContext.value?.city ?? null);
    const nation = computed(() => generalContext.value?.nation ?? null);
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
        const [, , state, nationIdValue, region, supplyFlag] = mapEntry;
        const nationEntry = map.nationList.find((nationEntry) => nationEntry[0] === nationIdValue);
        const regionName = layout.regionMap[region] ?? '-';
        const levelName = layout.levelMap[layoutCity.level] ?? '-';

        return {
            id: layoutCity.id,
            name: layoutCity.name,
            level: layoutCity.level,
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

        const ownNationId = general.value?.nationId ?? 0;
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
        realtimeEnabled.value = enabled;
        if (!enabled) {
            realtimeStatus.value = 'paused';
        }
    };

    const loadMainData = async () => {
        if (loading.value) {
            return;
        }
        loading.value = true;
        error.value = null;
        frontRecordsError.value = null;

        try {
            const context = await trpc.general.me.query();
            generalContext.value = context;

            if (!context) {
                reservedGeneralTurns.value = null;
                reservedNationTurns.value = null;
                boardAccess.value = null;
                loading.value = false;
                return;
            }

            const id = context.general.id;
            const layoutPromise = mapLayout.value ? Promise.resolve(mapLayout.value) : trpc.world.getMapLayout.query();
            const generalTurnsPromise = trpc.turns.reserved.getGeneral.query({ generalId: id });
            const nationTurnsPromise =
                context.general.nationId > 0 && context.general.officerLevel >= 5
                    ? trpc.turns.reserved.getNation.query({ generalId: id })
                    : Promise.resolve(null);
            const frontRecordsPromise = trpc.general.getFrontRecords.query().catch((err: unknown) => {
                frontRecordsError.value = resolveErrorMessage(err);
                return null;
            });
            const [layout, lobby, map, commands, messageData, contacts, access, records, generalTurns, nationTurns] =
                await Promise.all([
                    layoutPromise,
                    trpc.lobby.info.query(),
                    trpc.world.getMap.query({ generalId: id, showMe: true, useCache: true }),
                    trpc.turns.getCommandTable.query({ generalId: id }),
                    trpc.messages.getRecent.query({ generalId: id }),
                    trpc.messages.getContacts.query({ generalId: id }),
                    trpc.board.getAccess.query(),
                    frontRecordsPromise,
                    generalTurnsPromise,
                    nationTurnsPromise,
                ]);

            mapLayout.value = layout;
            lobbyInfo.value = lobby;
            worldMap.value = map;
            commandTable.value = commands;
            messages.value = messageData;
            messageContacts.value = contacts;
            boardAccess.value = access;
            frontRecords.value = records;
            reservedGeneralTurns.value = generalTurns;
            reservedNationTurns.value = nationTurns;
            if (initializedMailboxGeneralId !== id) {
                targetMailbox.value = MESSAGE_MAILBOX_NATIONAL_BASE + context.general.nationId;
                initializedMailboxGeneralId = id;
            }
        } catch (err) {
            error.value = resolveErrorMessage(err);
        } finally {
            loading.value = false;
        }
    };

    const refreshMessages = async () => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            messages.value = await trpc.messages.getRecent.query({ generalId: id });
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

    const setGeneralTurn = async (turnIndex: number, action: string) => {
        const id = generalId.value;
        if (!id) {
            return;
        }
        try {
            const result = await trpc.turns.reserved.setGeneral.mutate({
                generalId: id,
                turnIndex,
                action,
                args: {},
            });
            reservedGeneralTurns.value = result.turns;
        } catch (err) {
            error.value = resolveErrorMessage(err);
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
            });
            reservedGeneralTurns.value = result.turns;
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const setNationTurn = async (turnIndex: number, action: string) => {
        const id = generalId.value;
        const currentGeneral = general.value;
        if (!id || !currentGeneral) {
            return;
        }
        if (currentGeneral.nationId <= 0 || currentGeneral.officerLevel < 5) {
            return;
        }
        try {
            const result = await trpc.turns.reserved.setNation.mutate({
                generalId: id,
                turnIndex,
                action,
                args: {},
            });
            reservedNationTurns.value = result.turns;
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    const shiftNationTurns = async (amount: number) => {
        const id = generalId.value;
        const currentGeneral = general.value;
        if (!id || !currentGeneral) {
            return;
        }
        if (currentGeneral.nationId <= 0 || currentGeneral.officerLevel < 5) {
            return;
        }
        try {
            const result = await trpc.turns.reserved.shiftNation.mutate({
                generalId: id,
                amount,
            });
            reservedNationTurns.value = result.turns;
        } catch (err) {
            error.value = resolveErrorMessage(err);
        }
    };

    let realtimeSource: EventSource | null = null;
    let realtimeToken: string | null = null;

    const isAccessToken = (token: string | null): boolean => Boolean(token?.startsWith('ga_'));

    const buildRealtimeUrl = (token: string): string => {
        const base = import.meta.env.VITE_GAME_SSE_URL ?? '/events';
        const url = new URL(base, window.location.origin);
        url.searchParams.set('token', token);
        return url.toString();
    };

    const parseRealtimePayload = (raw: MessageEvent): RealtimeEvent | null => {
        if (!raw.data || typeof raw.data !== 'string') {
            return null;
        }
        try {
            const parsed = JSON.parse(raw.data) as RealtimeEvent;
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

    const isMailboxRelevant = (mailbox: number): boolean => {
        if (mailbox === MESSAGE_MAILBOX_PUBLIC) {
            return true;
        }
        const currentGeneralId = generalId.value;
        if (currentGeneralId && mailbox === currentGeneralId) {
            return true;
        }
        const currentNationId = nationId.value;
        if (currentNationId && mailbox === MESSAGE_MAILBOX_NATIONAL_BASE + currentNationId) {
            return true;
        }
        return false;
    };

    const closeRealtimeSource = () => {
        if (!realtimeSource) {
            return;
        }
        realtimeSource.close();
        realtimeSource = null;
        realtimeToken = null;
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
        if (!realtimeEnabled.value || !session.isReady || !session.hasGeneral) {
            return;
        }
        const token = await ensureAccessToken();
        if (!token) {
            realtimeStatus.value = 'idle';
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
        });
        source.addEventListener('error', () => {
            realtimeStatus.value = realtimeEnabled.value ? 'idle' : 'paused';
        });
        source.addEventListener('turnCompleted', () => {
            void loadMainData();
        });
        source.addEventListener('messageCreated', (event) => {
            const payload = parseRealtimePayload(event);
            if (!payload || payload.type !== 'messageCreated') {
                return;
            }
            if (isMailboxRelevant(payload.mailbox)) {
                void refreshMessages();
            }
        });
        source.addEventListener('ping', () => {
            if (realtimeEnabled.value) {
                realtimeStatus.value = 'connected';
            }
        });
    };

    watch(
        () => [realtimeEnabled.value, session.isReady, session.hasGeneral, session.gameToken],
        ([enabled, ready, hasGeneral]) => {
            if (!enabled) {
                closeRealtimeSource();
                realtimeStatus.value = 'paused';
                return;
            }
            if (!ready || !hasGeneral) {
                closeRealtimeSource();
                realtimeStatus.value = 'idle';
                return;
            }
            void connectRealtime();
        },
        { immediate: true }
    );

    return {
        loading,
        error,
        frontRecordsError,
        realtimeEnabled,
        realtimeStatus,
        generalContext,
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
        frontRecords,
        boardAccess,
        reservedGeneralTurns,
        reservedNationTurns,
        messageDraftText,
        targetMailbox,
        mailboxGroups,
        statusLine,
        realtimeLabel,
        setRealtimeEnabled,
        loadMainData,
        refreshMessages,
        sendMessage,
        loadOlderMessages,
        respondToMessage,
        readLatestMessage,
        deleteMessage,
        setGeneralTurn,
        shiftGeneralTurns,
        setNationTurn,
        shiftNationTurns,
    };
});
