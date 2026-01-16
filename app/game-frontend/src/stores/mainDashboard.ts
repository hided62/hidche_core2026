import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { MESSAGE_MAILBOX_NATIONAL_BASE, MESSAGE_MAILBOX_PUBLIC, type MessageType } from '@sammo-ts/logic';
import { trpc } from '../utils/trpc';

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
    type CommandTable = Awaited<ReturnType<typeof trpc.turns.getCommandTable.query>>;
    type MessageBundle = Awaited<ReturnType<typeof trpc.messages.getRecent.query>>;

    const loading = ref(false);
    const error = ref<string | null>(null);
    const realtimeEnabled = ref(true);
    const realtimeStatus = ref<'idle' | 'connected' | 'paused'>('connected');

    const generalContext = ref<GeneralContext | null>(null);
    const lobbyInfo = ref<LobbyInfo | null>(null);
    const worldMap = ref<WorldMapResult | null>(null);
    const commandTable = ref<CommandTable | null>(null);
    const messages = ref<MessageBundle | null>(null);

    const messageDraftText = ref('');
    const targetMailbox = ref<number>(MESSAGE_MAILBOX_PUBLIC);

    const general = computed(() => generalContext.value?.general ?? null);
    const city = computed(() => generalContext.value?.city ?? null);
    const nation = computed(() => generalContext.value?.nation ?? null);
    const generalId = computed(() => general.value?.id ?? null);
    const nationId = computed(() => nation.value?.id ?? null);

    const mailboxOptions = computed(() => {
        const options: Array<{ label: string; value: number; disabled?: boolean }> = [
            { label: '공공', value: MESSAGE_MAILBOX_PUBLIC },
        ];
        if (nationId.value) {
            options.push({ label: '국가', value: MESSAGE_MAILBOX_NATIONAL_BASE + nationId.value });
        } else {
            options.push({ label: '국가', value: -1, disabled: true });
        }
        options.push({ label: '외교', value: -2, disabled: true });
        options.push({ label: '개인', value: -3, disabled: true });
        return options;
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
        realtimeStatus.value = enabled ? 'connected' : 'paused';
    };

    const loadMainData = async () => {
        if (loading.value) {
            return;
        }
        loading.value = true;
        error.value = null;

        try {
            const context = await trpc.general.me.query();
            generalContext.value = context;

            if (!context) {
                loading.value = false;
                return;
            }

            const id = context.general.id;
            const [lobby, map, commands, messageData] = await Promise.all([
                trpc.lobby.info.query(),
                trpc.world.getMap.query({ generalId: id, showMe: true, useCache: true }),
                trpc.turns.getCommandTable.query({ generalId: id }),
                trpc.messages.getRecent.query({ generalId: id }),
            ]);

            lobbyInfo.value = lobby;
            worldMap.value = map;
            commandTable.value = commands;
            messages.value = messageData;
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
            await trpc.messages.send.mutate({
                generalId: id,
                mailbox,
                text,
            });
            messageDraftText.value = '';
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

    return {
        loading,
        error,
        realtimeEnabled,
        realtimeStatus,
        generalContext,
        general,
        city,
        nation,
        lobbyInfo,
        worldMap,
        commandTable,
        messages,
        messageDraftText,
        targetMailbox,
        mailboxOptions,
        statusLine,
        realtimeLabel,
        setRealtimeEnabled,
        loadMainData,
        refreshMessages,
        sendMessage,
        loadOlderMessages,
    };
});
