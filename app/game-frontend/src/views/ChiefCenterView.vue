<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { addMinutes, format } from 'date-fns';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import ChiefTurnCard from '../components/chief/ChiefTurnCard.vue';
import { trpc } from '../utils/trpc';
import { formatOfficerLevelText } from '../utils/nationFormat';

type ChiefTurn = {
    index: number;
    action: string;
    args: unknown;
};

type ChiefEntry = {
    officerLevel: number;
    name: string | null;
    npcState: number | null;
    turnTime: string | null;
    revision: number;
    turns: ChiefTurn[];
};

type ChiefCenterResponse = {
    me: {
        id: number;
        officerLevel: number;
        nationId: number;
    };
    nation: {
        id: number;
        name: string;
        level: number;
    };
    currentYear: number;
    currentMonth: number;
    turnTermMinutes: number;
    maxTurns: number;
    chiefs: ChiefEntry[];
};

type CommandAvailability = {
    key: string;
    name: string;
    reqArg: boolean;
    status: 'available' | 'blocked' | 'needsInput' | 'unknown';
    possible: boolean;
    reason?: string;
    inputFields: Array<{
        key: string;
        label: string;
        kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
        required: boolean;
        min?: number;
        max?: number;
        step?: number;
        constValue?: string | number;
        options?: Array<{ value: string | number; label: string; color?: string }>;
        optionSource?:
            'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';
        tupleLabels?: string[];
    }>;
};

type CommandGroup = {
    category: string;
    values: CommandAvailability[];
};

type CommandTable = {
    general: CommandGroup[];
    nation: CommandGroup[];
    inputOptions: {
        cities: Array<{ value: string | number; label: string; color?: string }>;
        nations: Array<{ value: string | number; label: string; color?: string }>;
        generals: Array<{ value: string | number; label: string; color?: string }>;
        crewTypes: Array<{ value: string | number; label: string; color?: string }>;
        armTypes: Array<{ value: string | number; label: string; color?: string }>;
        nationTypes: Array<{ value: string | number; label: string; color?: string }>;
        colors: Array<{ value: string | number; label: string; color?: string }>;
        items: Record<string, Array<{ value: string | number; label: string; color?: string }>>;
    };
};

const chiefApi = trpc as unknown as {
    nation: {
        getChiefCenter: {
            query: () => Promise<ChiefCenterResponse>;
        };
    };
    turns: {
        getCommandTable: {
            query: (input: { generalId: number }) => Promise<CommandTable>;
        };
    };
};

type TurnRow = {
    index: number;
    time: string;
    action: string;
    isRest: boolean;
};

const loading = ref(false);
const commandLoading = ref(false);
const error = ref<string | null>(null);
const data = ref<ChiefCenterResponse | null>(null);
const commandTable = ref<CommandTable | null>(null);

const selectedChiefLevel = ref<number | null>(null);

const isMobile = useMediaQuery('(max-width: 1024px)');

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const loadChiefCenter = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;

    try {
        data.value = await chiefApi.nation.getChiefCenter.query();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const loadCommandTable = async (generalId: number) => {
    if (commandLoading.value) {
        return;
    }
    commandLoading.value = true;
    try {
        commandTable.value = await chiefApi.turns.getCommandTable.query({ generalId });
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        commandLoading.value = false;
    }
};

onMounted(() => {
    void loadChiefCenter();
});

watch(
    () => data.value?.me.id,
    (generalId) => {
        if (generalId && !commandTable.value) {
            void loadCommandTable(generalId);
        }
    }
);

watch(
    () => data.value,
    (snapshot) => {
        if (!snapshot) {
            return;
        }
        if (selectedChiefLevel.value !== null) {
            return;
        }
        const preferred =
            snapshot.me.officerLevel >= 5 ? snapshot.me.officerLevel : (snapshot.chiefs[0]?.officerLevel ?? null);
        selectedChiefLevel.value = preferred;
    }
);

const commandLabelMap = computed(() => {
    const map = new Map<string, string>();
    if (!commandTable.value) {
        return map;
    }
    for (const group of commandTable.value.general) {
        for (const entry of group.values) {
            map.set(entry.key, entry.name);
        }
    }
    for (const group of commandTable.value.nation) {
        for (const entry of group.values) {
            map.set(entry.key, entry.name);
        }
    }
    return map;
});

const selectedChief = computed<ChiefEntry | null>(() => {
    const snapshot = data.value;
    if (!snapshot) {
        return null;
    }
    const targetLevel = selectedChiefLevel.value ?? snapshot.me.officerLevel;
    let match: ChiefEntry | null = null;
    for (const chief of snapshot.chiefs) {
        if (chief.officerLevel === targetLevel) {
            match = chief;
            break;
        }
    }
    return match;
});

const isEditingAllowed = computed(() => {
    if (!data.value || !selectedChief.value) {
        return false;
    }
    return data.value.me.officerLevel >= 5 && data.value.me.officerLevel === selectedChief.value.officerLevel;
});

const buildTurnRows = (chief: ChiefEntry): TurnRow[] => {
    const turnTermMinutes = data.value?.turnTermMinutes ?? 0;
    const labelMap = commandLabelMap.value;
    const baseTime = chief.turnTime ? new Date(chief.turnTime) : null;

    return chief.turns.map((turn, idx) => {
        const timeLabel =
            baseTime && Number.isFinite(turnTermMinutes)
                ? format(addMinutes(baseTime, idx * turnTermMinutes), turnTermMinutes >= 5 ? 'HH:mm' : 'mm:ss')
                : '--:--';
        const actionLabel = labelMap.get(turn.action) ?? turn.action;
        return {
            index: turn.index,
            time: timeLabel,
            action: actionLabel,
            isRest: turn.action === '휴식',
        };
    });
};

const chiefViews = computed(() => {
    if (!data.value) {
        return [] as Array<ChiefEntry & { rows: TurnRow[]; officerLevelText: string }>;
    }
    return data.value.chiefs.map((chief) => ({
        ...chief,
        officerLevelText: formatOfficerLevelText(chief.officerLevel, data.value?.nation.level),
        rows: buildTurnRows(chief),
    }));
});

const selectedChiefRows = computed(() => {
    if (!selectedChief.value) {
        return [] as TurnRow[];
    }
    return buildTurnRows(selectedChief.value);
});

const updateMyTurns = (turns: ChiefEntry['turns'], revision: number) => {
    if (!data.value) {
        return;
    }
    const myLevel = data.value.me.officerLevel;
    const entry = data.value.chiefs.find((chief) => chief.officerLevel === myLevel);
    if (!entry) {
        return;
    }
    entry.turns = turns;
    entry.revision = revision;
};

const clearTurn = async (turnIndex: number) => {
    if (!data.value || !isEditingAllowed.value) {
        return;
    }
    try {
        const result = await trpc.turns.reserved.setNation.mutate({
            generalId: data.value.me.id,
            turnIndex,
            action: '휴식',
            args: {},
            expectedRevision: selectedChief.value?.revision ?? 0,
        });
        updateMyTurns(result.turns, result.revision);
    } catch (err) {
        await loadChiefCenter();
        error.value = resolveErrorMessage(err);
    }
};

const shiftTurns = async (amount: number) => {
    if (!data.value || !isEditingAllowed.value) {
        return;
    }
    try {
        const result = await trpc.turns.reserved.shiftNation.mutate({
            generalId: data.value.me.id,
            amount,
            expectedRevision: selectedChief.value?.revision ?? 0,
        });
        updateMyTurns(result.turns, result.revision);
    } catch (err) {
        await loadChiefCenter();
        error.value = resolveErrorMessage(err);
    }
};
</script>

<template>
    <main class="chief-page">
        <header class="chief-top legacy-bg0">
            <RouterLink class="chief-nav" to="/">돌아가기</RouterLink>
            <button class="chief-nav" @click="loadChiefCenter">갱신</button>
            <h1>사령부</h1>
            <div></div><div></div>
        </header>

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>

        <section v-if="loading && !data" class="loading-panel"><SkeletonLines :lines="5" /></section>

        <section v-else-if="data && isMobile" class="layout-mobile">
            <div class="mobile-editor">
                <aside class="mobile-controls legacy-bg1">
                    <strong>{{ selectedChief?.name ?? '-' }}</strong>
                    <span>{{ selectedChief ? formatOfficerLevelText(selectedChief.officerLevel, data.nation.level) : '-' }}</span>
                    <time>{{ selectedChiefRows[0]?.time ?? '--:--' }}</time>
                    <button>고급 모드</button><button>반복⌄</button>
                    <button @click="shiftTurns(-1)">당기기⌄</button><button @click="shiftTurns(1)">미루기⌄</button>
                </aside>
                <div class="mobile-turns">
                    <div v-for="row in selectedChiefRows" :key="row.index" class="mobile-turn-row">
                        <time>{{ row.time }}</time><strong>{{ row.action }}</strong>
                        <button :disabled="!isEditingAllowed" @click="clearTurn(row.index)">✎</button>
                    </div>
                </div>
            </div>
            <div class="chief-overview">
                <ChiefTurnCard v-for="chief in chiefViews" :key="chief.officerLevel"
                    :officer-level-text="chief.officerLevelText" :name="chief.name" :npc-state="chief.npcState"
                    :rows="chief.rows" :compact="true" :selected="chief.officerLevel === selectedChief?.officerLevel"
                    :is-me="chief.officerLevel === data.me.officerLevel" :clickable="true"
                    @select="selectedChiefLevel = chief.officerLevel" />
            </div>
        </section>

        <section v-else-if="data" class="layout-desktop">
            <div class="chief-grid">
                <ChiefTurnCard
                    v-for="chief in chiefViews"
                    :key="chief.officerLevel"
                    :officer-level-text="chief.officerLevelText"
                    :name="chief.name"
                    :npc-state="chief.npcState"
                    :rows="chief.rows"
                    :selected="chief.officerLevel === selectedChief?.officerLevel"
                    :is-me="chief.officerLevel === data.me.officerLevel"
                    :clickable="true"
                    @select="selectedChiefLevel = chief.officerLevel"
                />
            </div>
            <div v-if="isEditingAllowed" class="desktop-actions legacy-bg0">
                <button @click="shiftTurns(-1)">당기기</button><button @click="shiftTurns(1)">미루기</button>
            </div>
        </section>
        <footer class="chief-footer legacy-bg0"><RouterLink class="chief-nav" to="/">돌아가기</RouterLink></footer>
    </main>
</template>

<style scoped>
.layout-desktop {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(240px, 1fr);
    gap: 0;
}

.chief-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
}

.chief-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.layout-mobile {
    display: flex;
    flex-direction: column;
    gap: 0;
}

.chief-overview {
    display: grid;
    grid-template-columns: repeat(4, 125px);
    gap: 0;
}

.command-selected {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 8px;
    display: grid;
    gap: 6px;
    font-size: 0.75rem;
    margin-top: 12px;
}

.command-selected .label {
    color: rgba(232, 221, 196, 0.6);
}

.command-selected .meta {
    display: flex;
    gap: 8px;
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
}

.turn-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.turn-actions button {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 4px 8px;
    font-size: 0.75rem;
    background: rgba(12, 12, 12, 0.6);
    color: inherit;
    cursor: pointer;
}

.turn-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
}

.turn-item {
    border: 1px solid rgba(201, 164, 90, 0.25);
    padding: 8px;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.75rem;
}

.turn-info {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.turn-index {
    color: rgba(232, 221, 196, 0.6);
}

.turn-time {
    font-variant-numeric: tabular-nums;
}

.turn-action {
    font-weight: 600;
}

.turn-buttons {
    display: flex;
    gap: 6px;
}

.turn-buttons button {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 4px 8px;
    font-size: 0.7rem;
    background: rgba(12, 12, 12, 0.6);
    color: inherit;
    cursor: pointer;
}

.turn-buttons .ghost {
    background: rgba(16, 16, 16, 0.6);
}

.muted {
    color: rgba(232, 221, 196, 0.6);
}

@media (max-width: 1024px) {
    .chief-page {
        box-sizing: border-box;
        width: 500px;
        min-width: 500px;
        padding: 0;
        gap: 0;
    }

    .chief-overview {
        grid-template-columns: repeat(4, 125px);
    }

    .turn-list {
        gap: 0;
        margin-top: 4px;
    }

    .turn-item {
        min-height: 24px;
        flex-wrap: nowrap;
        align-items: center;
        gap: 2px;
        padding: 0 4px;
    }

    .turn-info {
        flex: 1;
        flex-wrap: nowrap;
        gap: 5px;
    }

    .turn-buttons {
        gap: 2px;
    }

    .turn-buttons button {
        min-height: 20px;
        padding: 1px 5px;
    }
}

@media (min-width: 1024.01px) {
    .chief-page {
        box-sizing: border-box;
        width: 1000px;
        max-width: 1000px;
        min-width: 1000px;
        margin: 0 auto;
        padding: 0;
        gap: 0;
    }
}

.chief-page {
    margin: 0 auto;
    color: #fff;
    font: 14px/21px var(--sammo-font-sans);
}
.chief-top {
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
}
.chief-top h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 400;
    line-height: 32px;
    text-align: center;
}
.chief-nav {
    box-sizing: border-box;
    height: 32px;
    margin-right: 2px;
    border: 0;
    border-radius: 3px;
    display: grid;
    place-items: center;
    background: #00582c;
    color: #fff;
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
}
.layout-desktop { display: block; }
.chief-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
}
.chief-grid :deep(.chief-header) { height: 24px; min-height: 24px; }
.chief-grid :deep(.chief-row) { box-sizing: border-box; min-height: 30px; }
.chief-grid :deep(.chief-card) { border-color: transparent; box-shadow: none; }
.desktop-actions { padding: 2px 24px; }
.desktop-actions button,
.mobile-controls button {
    min-height: 35px;
    border: 0;
    border-radius: 4px;
    background: #444;
    color: #fff;
    font-weight: 700;
}
.chief-footer { min-height: 56px; padding-top: 20px; }
.chief-footer .chief-nav { width: 70px; }
.mobile-editor {
    height: 371px;
    display: grid;
    grid-template-columns: 109px 1fr;
    background: #000;
}
.mobile-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-content: start;
    text-align: center;
}
.mobile-controls strong,
.mobile-controls span,
.mobile-controls time { grid-column: 1 / -1; min-height: 30px; line-height: 30px; }
.mobile-controls time { border-radius: 5px; background: #345c85; }
.mobile-controls button { grid-column: 1 / -1; margin-top: 5px; }
.mobile-turns { display: grid; grid-template-rows: repeat(12, 30px); padding-top: 10px; }
.mobile-turn-row {
    display: grid;
    grid-template-columns: 74px 1fr 53px;
    align-items: center;
    background: #071638;
    text-align: center;
}
.mobile-turn-row:nth-child(even) { background: #0d214e; }
.mobile-turn-row button { height: 30px; border: 0; background: #3d3d3d; color: #fff; }
.chief-overview {
    width: 445px;
    margin-top: 56px;
    display: grid;
    grid-template-columns: repeat(4, 111.25px);
}
.chief-overview :deep(.chief-card) { border-color: transparent; box-shadow: none; }
.chief-overview :deep(.chief-row) { height: 12px; line-height: 10px; }
.chief-overview :deep(.chief-header) { height: 28px; }

@media (max-width: 1024px) {
    .chief-page { width: 500px; min-width: 500px; }
    .chief-top { grid-template-columns: 89px 89px 1fr 0 0; }
    .chief-overview { grid-template-columns: repeat(4, 111.25px); }
}
</style>
