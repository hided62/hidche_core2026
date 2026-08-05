<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { addMinutes } from 'date-fns';
import { useRouter } from 'vue-router';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import ChiefTurnCard from '../components/chief/ChiefTurnCard.vue';
import ChiefCommandEditor from '../components/chief/ChiefCommandEditor.vue';
import { trpc } from '../utils/trpc';
import { formatOfficerLevelText } from '../utils/nationFormat';
import type { CommandPatternEntry } from '../components/command/types';

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
    args: unknown;
    label: string;
    actionCode: string;
};

const loading = ref(false);
const commandLoading = ref(false);
const error = ref<string | null>(null);
const data = ref<ChiefCenterResponse | null>(null);
const commandTable = ref<CommandTable | null>(null);

const selectedChiefLevel = ref<number | null>(null);
const router = useRouter();

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
        const turnDate =
            baseTime && Number.isFinite(turnTermMinutes) ? addMinutes(baseTime, idx * turnTermMinutes) : null;
        const timeLabel = turnDate
            ? turnTermMinutes >= 5
                ? `${String(turnDate.getUTCHours()).padStart(2, '0')}:${String(turnDate.getUTCMinutes()).padStart(2, '0')}`
                : `${String(turnDate.getUTCMinutes()).padStart(2, '0')}:${String(turnDate.getUTCSeconds()).padStart(2, '0')}`
            : '--:--';
        const actionLabel = labelMap.get(turn.action) ?? turn.action;
        return {
            index: turn.index,
            time: timeLabel,
            action: actionLabel,
            label: actionLabel,
            actionCode: turn.action,
            args: turn.args,
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

const updateMyTurns = (turns: Array<{ index: number; action: string; args?: unknown }>, revision: number) => {
    if (!data.value) {
        return;
    }
    const myLevel = data.value.me.officerLevel;
    const entry = data.value.chiefs.find((chief) => chief.officerLevel === myLevel);
    if (!entry) {
        return;
    }
    entry.turns = turns.map((turn) => ({ ...turn, args: turn.args ?? {} }));
    entry.revision = revision;
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

const reserveTurns = async (entries: CommandPatternEntry[]) => {
    if (!data.value || !isEditingAllowed.value) return;
    try {
        const result = await trpc.turns.reserved.setNationBulk.mutate({
            generalId: data.value.me.id,
            entries,
            expectedRevision: selectedChief.value?.revision ?? 0,
        });
        updateMyTurns(result.turns, result.revision);
    } catch (err) {
        await loadChiefCenter();
        error.value = resolveErrorMessage(err);
    }
};

const repeatTurns = async (amount: number) => {
    if (!data.value || !isEditingAllowed.value) return;
    try {
        const result = await trpc.turns.reserved.repeatNation.mutate({
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
            <button class="chief-nav" type="button" @click="router.push('/')">돌아가기</button>
            <button class="chief-nav" @click="loadChiefCenter">갱신</button>
            <h1>사령부</h1>
            <div></div>
            <div></div>
        </header>

        <div v-if="error" class="game-feedback game-feedback--error" role="alert">{{ error }}</div>

        <section v-if="loading && !data" class="loading-panel"><SkeletonLines :lines="5" /></section>

        <section v-else-if="data && isMobile" class="layout-mobile">
            <ChiefCommandEditor
                v-if="isEditingAllowed && selectedChief"
                :officer-level-text="formatOfficerLevelText(selectedChief.officerLevel, data.nation.level)"
                :name="selectedChief.name"
                :npc-state="selectedChief.npcState"
                :rows="selectedChiefRows"
                :command-table="commandTable"
                :loading="commandLoading"
                :general-id="data.me.id"
                :officer-level="selectedChief.officerLevel"
                :mobile="true"
                @reserve-bulk="reserveTurns"
                @shift="shiftTurns"
                @repeat="repeatTurns"
            />
            <div v-else-if="selectedChief" class="mobile-readonly">
                <div class="mobile-turn-index legacy-bg0">
                    <span></span><span v-for="idx in data.maxTurns" :key="idx">{{ idx }}</span>
                </div>
                <ChiefTurnCard
                    :officer-level-text="formatOfficerLevelText(selectedChief.officerLevel, data.nation.level)"
                    :name="selectedChief.name"
                    :npc-state="selectedChief.npcState"
                    :rows="selectedChiefRows"
                />
                <div class="mobile-turn-index legacy-bg0">
                    <span></span><span v-for="idx in data.maxTurns" :key="idx">{{ idx }}</span>
                </div>
            </div>
            <div class="chief-overview-frame">
                <div class="chief-overview">
                    <template v-for="chief in chiefViews" :key="chief.officerLevel">
                        <ChiefTurnCard
                            v-if="chief.name"
                            :officer-level-text="chief.officerLevelText"
                            :name="chief.name"
                            :npc-state="chief.npcState"
                            :rows="chief.rows"
                            :compact="true"
                            :selected="chief.officerLevel === selectedChief?.officerLevel"
                            :is-me="chief.officerLevel === data.me.officerLevel"
                            :clickable="true"
                            :turn-time-label="chief.rows[0]?.time"
                            @select="selectedChiefLevel = chief.officerLevel"
                        />
                        <div v-else class="empty-chief-slot" aria-hidden="true"></div>
                    </template>
                </div>
            </div>
        </section>

        <section v-else-if="data" class="layout-desktop">
            <div
                v-for="(rowChiefs, rowIndex) in [chiefViews.slice(0, 4), chiefViews.slice(4, 8)]"
                :key="rowIndex"
                class="chief-grid-row"
            >
                <div class="turn-index-gutter legacy-bg0">
                    <span></span><span v-for="idx in data.maxTurns" :key="idx">{{ idx }}</span>
                </div>
                <template v-for="chief in rowChiefs" :key="chief.officerLevel">
                    <ChiefCommandEditor
                        v-if="chief.officerLevel === data.me.officerLevel && data.me.officerLevel >= 5"
                        :officer-level-text="chief.officerLevelText"
                        :name="chief.name"
                        :npc-state="chief.npcState"
                        :rows="chief.rows"
                        :command-table="commandTable"
                        :loading="commandLoading"
                        :general-id="data.me.id"
                        :officer-level="chief.officerLevel"
                        @reserve-bulk="reserveTurns"
                        @shift="shiftTurns"
                        @repeat="repeatTurns"
                    />
                    <ChiefTurnCard
                        v-else-if="chief.name"
                        :officer-level-text="chief.officerLevelText"
                        :name="chief.name"
                        :npc-state="chief.npcState"
                        :rows="chief.rows"
                    />
                    <div v-else class="empty-chief-slot" aria-hidden="true"></div>
                </template>
                <div class="turn-index-gutter legacy-bg0">
                    <span></span><span v-for="idx in data.maxTurns" :key="idx">{{ idx }}</span>
                </div>
            </div>
        </section>
        <div class="legacy-copy-helpers" aria-hidden="true">
            <template v-for="idx in 8" :key="idx">
                <button type="button" tabindex="-1">복사하기</button>
                <button type="button" tabindex="-1">텍스트 복사</button>
            </template>
        </div>
        <footer class="chief-footer legacy-bg0">
            <button class="chief-nav" type="button" @click="router.push('/')">돌아가기</button>
        </footer>
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
    background-color: transparent;
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
.layout-desktop {
    display: block;
}
.chief-footer {
    min-height: 56px;
    padding-top: 20px;
}
.chief-footer .chief-nav {
    width: 70px;
}

@media (max-width: 1024px) {
    .chief-page {
        width: 500px;
        min-width: 500px;
    }
    .chief-top {
        grid-template-columns: 89px 89px 1fr 0 0;
    }
}

/* Ref PageChiefCenter의 24 + 4×238 + 24 행렬과 500px 축소 overview 계약입니다. */
.layout-desktop {
    display: block;
}
.chief-grid-row {
    display: grid;
    grid-template-columns: 24px repeat(4, 238px) 24px;
    align-items: start;
}
.turn-index-gutter {
    display: grid;
    grid-template-rows: 24px repeat(12, 30px);
    text-align: center;
}
.turn-index-gutter span {
    display: grid;
    place-items: center;
}
.chief-grid-row :deep(.chief-card) {
    border: 0;
    box-shadow: none;
}
.chief-grid-row :deep(.chief-header) {
    box-sizing: border-box;
    height: 24px;
    min-height: 24px;
    justify-content: center;
    padding: 0;
    background-color: transparent;
    font-size: 16.8px;
    line-height: 14.7px;
}
.chief-grid-row :deep(.chief-title) {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 5px;
}
.chief-grid-row :deep(.chief-level),
.chief-grid-row :deep(.chief-name) {
    font-size: 16.8px;
    font-weight: 400;
    line-height: 14.7px;
    color: inherit;
}
.chief-grid-row :deep(.chief-level)::after {
    content: ':';
}
.chief-grid-row :deep(.chief-row) {
    box-sizing: border-box;
    min-height: 30px;
    height: 30px;
    grid-template-columns: 40px 198px;
    gap: 0;
    padding: 0;
    border: 0;
    font-size: 14px;
    line-height: 14.7px;
    color: #fff;
    text-align: center;
}
.chief-grid-row :deep(.row-index) {
    display: none;
}
.chief-grid-row :deep(.row-time),
.chief-grid-row :deep(.row-action) {
    height: 30px;
    display: grid;
    place-items: center;
    line-height: 30px;
}
.chief-grid-row :deep(.row-time) {
    background: #000;
}
.chief-grid-row :deep(.chief-row:nth-child(odd)) {
    background-color: rgb(12 26 65);
}
.chief-grid-row :deep(.chief-row:nth-child(even)) {
    background-color: rgb(7 22 56);
}
.chief-grid-row :deep(.chief-row:nth-child(odd) .row-action) {
    background-color: rgb(12 26 65);
}
.chief-grid-row :deep(.chief-row:nth-child(even) .row-action) {
    background-color: rgb(7 22 56);
}

.layout-mobile {
    display: flex;
    flex-direction: column;
    gap: 0;
}
.chief-overview-frame {
    width: 500px;
    height: 310px;
    margin-top: -3px;
    margin-bottom: 11px;
    overflow: hidden;
}
.chief-overview {
    width: 445px;
    height: 310px;
    margin-top: 0;
    display: grid;
    grid-template-columns: repeat(4, 111.25px);
    grid-auto-rows: 155px;
}
.chief-overview :deep(.chief-card) {
    width: 111.25px;
    height: 155px;
    border: 0;
    border-left: 1px solid #fff;
    box-shadow: none;
    box-sizing: border-box;
}
.chief-overview :deep(.row-index) {
    display: none;
}
.chief-overview :deep(.chief-card.compact .chief-row) {
    grid-template-columns: 38px minmax(0, 1fr);
    height: 11.25px !important;
    min-height: 0;
    padding: 0;
    gap: 0;
    text-align: center;
    font-size: 0.55rem;
    line-height: 11.25px !important;
}
.chief-overview :deep(.chief-card.compact .chief-header) {
    box-sizing: border-box;
    height: 20px !important;
    min-height: 20px !important;
    grid-template-rows: none;
}
.chief-overview :deep(.row-time),
.chief-overview :deep(.row-action) {
    display: grid;
    place-items: center;
}
.mobile-readonly {
    width: 404px;
    height: 420px;
    margin: 10px 0 0 96px;
    display: grid;
    grid-template-columns: 24px 260px 24px 96px;
    overflow: hidden;
}
.mobile-readonly :deep(.chief-card) {
    width: 260px;
}
.mobile-readonly :deep(.chief-header) {
    height: 24px;
    min-height: 24px;
    justify-content: center;
    padding: 0;
    background-color: transparent;
    font-size: 16.8px;
    line-height: 14.7px;
}
.mobile-readonly :deep(.chief-title) {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 5px;
}
.mobile-readonly :deep(.chief-level),
.mobile-readonly :deep(.chief-name) {
    font-size: 16.8px;
    font-weight: 400;
    line-height: 14.7px;
    color: inherit;
}
.mobile-readonly :deep(.chief-level)::after {
    content: ':';
}
.mobile-readonly :deep(.chief-row) {
    height: 30px;
    grid-template-columns: 43.33px 216.67px;
    padding: 0;
    font-size: 14px;
    line-height: 14.7px;
    color: #fff;
}
.mobile-readonly :deep(.chief-row:nth-child(odd)) {
    background-color: rgb(12 26 65);
}
.mobile-readonly :deep(.chief-row:nth-child(even)) {
    background-color: rgb(7 22 56);
}
.mobile-readonly :deep(.row-time),
.mobile-readonly :deep(.row-action) {
    height: 30px;
    display: grid;
    place-items: center;
    line-height: 30px;
}
.mobile-readonly :deep(.row-time) {
    background-color: #000;
}
.mobile-readonly :deep(.chief-row:nth-child(odd) .row-action) {
    background-color: rgb(12 26 65);
}
.mobile-readonly :deep(.chief-row:nth-child(even) .row-action) {
    background-color: rgb(7 22 56);
}
.mobile-readonly :deep(.row-index) {
    display: none;
}
.mobile-turn-index {
    display: grid;
    grid-template-rows: 24px repeat(12, 30px);
    text-align: center;
}
.mobile-turn-index span {
    display: grid;
    place-items: center;
}

.legacy-copy-helpers {
    display: none;
}

@media (max-width: 1024px) {
    .chief-overview {
        grid-template-columns: repeat(4, 111.25px);
    }
}

.empty-chief-slot {
    min-width: 0;
    background-color: #071638;
    background-image: var(--sammo-texture-blue);
}
.chief-grid-row > .empty-chief-slot {
    height: 384px;
}
.chief-overview > .empty-chief-slot {
    width: 111.25px;
    height: 155px;
}
</style>
