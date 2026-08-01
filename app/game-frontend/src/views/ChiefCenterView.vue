<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { addMinutes, format } from 'date-fns';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import ChiefTurnCard from '../components/chief/ChiefTurnCard.vue';
import CommandArgumentForm from '../components/main/CommandArgumentForm.vue';
import CommandSelectForm from '../components/main/CommandSelectForm.vue';
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
const activeCategory = ref('');
const selectedCommandKey = ref<string | null>(null);
const commandArgs = ref<Record<string, unknown>>({});
const commandArgsValid = ref(false);

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

const statusLine = computed(() => {
    if (!data.value) {
        return '사령부 정보를 불러오는 중';
    }
    return `${data.value.currentYear}년 ${data.value.currentMonth}월 · 턴 ${data.value.turnTermMinutes}분`;
});

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

const chiefCommandTable = computed(() => {
    if (!commandTable.value) {
        return null;
    }
    return {
        general: [],
        nation: commandTable.value.nation,
    };
});

const selectedCommand = computed<CommandAvailability | null>(() => {
    if (!commandTable.value || !selectedCommandKey.value) {
        return null;
    }
    for (const group of commandTable.value.nation) {
        const match = group.values.find((entry) => entry.key === selectedCommandKey.value);
        if (match) {
            return match;
        }
    }
    return null;
});

watch(selectedCommand, (command) => {
    commandArgs.value = {};
    commandArgsValid.value = Boolean(command && !command.reqArg);
});

const canReserveSelected = computed(() => {
    if (!selectedCommand.value) {
        return false;
    }
    if (!selectedCommand.value.possible) {
        return false;
    }
    if (!['available', 'needsInput'].includes(selectedCommand.value.status)) {
        return false;
    }
    return commandArgsValid.value;
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

const overviewChiefViews = computed(() =>
    chiefViews.value.filter((chief) => chief.officerLevel !== selectedChief.value?.officerLevel)
);

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

const reserveTurn = async (turnIndex: number) => {
    if (!data.value || !selectedCommand.value || !isEditingAllowed.value) {
        return;
    }
    if (!canReserveSelected.value) {
        return;
    }
    try {
        const result = await trpc.turns.reserved.setNation.mutate({
            generalId: data.value.me.id,
            turnIndex,
            action: selectedCommand.value.key,
            args: commandArgs.value,
            expectedRevision: selectedChief.value?.revision ?? 0,
        });
        updateMyTurns(result.turns, result.revision);
    } catch (err) {
        await loadChiefCenter();
        error.value = resolveErrorMessage(err);
    }
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
    <main class="game-shell chief-page">
        <header class="game-shell__header">
            <div>
                <h1 class="game-shell__title">사령부</h1>
                <p class="game-shell__subtitle">{{ statusLine }}</p>
            </div>
            <div class="game-shell__actions">
                <RouterLink class="game-shell__action" to="/">메인</RouterLink>
                <button class="game-shell__action" @click="loadChiefCenter">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>

        <section v-if="loading && !data" class="loading-panel">
            <PanelCard title="사령부 로딩">
                <SkeletonLines :lines="5" />
            </PanelCard>
        </section>

        <section v-else-if="data && isMobile" class="layout-mobile">
            <PanelCard v-if="isEditingAllowed" title="사령부 편집" subtitle="선택 명령을 배치하세요">
                <CommandSelectForm
                    :command-table="chiefCommandTable"
                    :loading="commandLoading || loading"
                    :active-category="activeCategory"
                    @update:active-category="activeCategory = $event"
                    @select="selectedCommandKey = $event"
                />
                <div class="command-selected">
                    <div class="label">선택 명령</div>
                    <div v-if="selectedCommand" class="value">
                        <div class="name">{{ selectedCommand.name }}</div>
                        <div class="meta">
                            <span>{{ selectedCommand.status === 'available' ? '가능' : '제한' }}</span>
                            <span v-if="selectedCommand.reqArg">추가 입력 필요</span>
                        </div>
                    </div>
                    <div v-else class="value muted">명령을 선택하세요.</div>
                </div>
                <CommandArgumentForm
                    v-if="selectedCommand?.reqArg && commandTable"
                    :command-key="selectedCommand.key"
                    :fields="selectedCommand.inputFields"
                    :options="commandTable.inputOptions"
                    @update:args="commandArgs = $event"
                    @update:valid="commandArgsValid = $event"
                />
                <div class="turn-actions">
                    <button @click="shiftTurns(-1)">앞당김</button>
                    <button @click="shiftTurns(1)">미루기</button>
                </div>
                <div class="turn-list">
                    <div v-for="row in selectedChiefRows" :key="row.index" class="turn-item">
                        <div class="turn-info">
                            <span class="turn-index">#{{ row.index + 1 }}</span>
                            <span class="turn-time">{{ row.time }}</span>
                            <span class="turn-action">{{ row.action }}</span>
                        </div>
                        <div class="turn-buttons">
                            <button :disabled="!canReserveSelected" @click="reserveTurn(row.index)">배치</button>
                            <button class="ghost" @click="clearTurn(row.index)">휴식</button>
                        </div>
                    </div>
                </div>
            </PanelCard>

            <PanelCard title="전체 사령부" subtitle="8자리 전체 보기">
                <div class="chief-overview">
                    <ChiefTurnCard
                        v-for="chief in overviewChiefViews"
                        :key="chief.officerLevel"
                        :officer-level-text="chief.officerLevelText"
                        :name="chief.name"
                        :npc-state="chief.npcState"
                        :rows="chief.rows"
                        :compact="true"
                        :selected="chief.officerLevel === selectedChief?.officerLevel"
                        :is-me="chief.officerLevel === data.me.officerLevel"
                        :clickable="true"
                        @select="selectedChiefLevel = chief.officerLevel"
                    />
                </div>
            </PanelCard>
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
            <div class="chief-side">
                <PanelCard title="사령부 편집" subtitle="선택 명령을 배치하세요">
                    <div v-if="!isEditingAllowed" class="muted">사령부 편집은 본인 관직에서만 가능합니다.</div>
                    <div v-else>
                        <CommandSelectForm
                            :command-table="chiefCommandTable"
                            :loading="commandLoading || loading"
                            :active-category="activeCategory"
                            @update:active-category="activeCategory = $event"
                            @select="selectedCommandKey = $event"
                        />
                        <div class="command-selected">
                            <div class="label">선택 명령</div>
                            <div v-if="selectedCommand" class="value">
                                <div class="name">{{ selectedCommand.name }}</div>
                                <div class="meta">
                                    <span>{{ selectedCommand.status === 'available' ? '가능' : '제한' }}</span>
                                    <span v-if="selectedCommand.reqArg">추가 입력 필요</span>
                                </div>
                            </div>
                            <div v-else class="value muted">명령을 선택하세요.</div>
                        </div>
                        <CommandArgumentForm
                            v-if="selectedCommand?.reqArg && commandTable"
                            :command-key="selectedCommand.key"
                            :fields="selectedCommand.inputFields"
                            :options="commandTable.inputOptions"
                            @update:args="commandArgs = $event"
                            @update:valid="commandArgsValid = $event"
                        />
                        <div class="turn-actions">
                            <button @click="shiftTurns(-1)">앞당김</button>
                            <button @click="shiftTurns(1)">미루기</button>
                        </div>
                        <div class="turn-list">
                            <div v-for="row in selectedChiefRows" :key="row.index" class="turn-item">
                                <div class="turn-info">
                                    <span class="turn-index">#{{ row.index + 1 }}</span>
                                    <span class="turn-time">{{ row.time }}</span>
                                    <span class="turn-action">{{ row.action }}</span>
                                </div>
                                <div class="turn-buttons">
                                    <button :disabled="!canReserveSelected" @click="reserveTurn(row.index)">
                                        배치
                                    </button>
                                    <button class="ghost" @click="clearTurn(row.index)">휴식</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </PanelCard>
            </div>
        </section>
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
</style>
