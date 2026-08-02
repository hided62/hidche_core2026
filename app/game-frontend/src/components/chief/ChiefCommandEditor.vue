<script setup lang="ts">
import { computed, ref } from 'vue';
import CommandArgumentForm from '../main/CommandArgumentForm.vue';
import CommandSelectForm from '../main/CommandSelectForm.vue';
import { getNpcColor } from '../../utils/npcColor';

type CommandOption = { value: string | number; label: string; color?: string };
type CommandInputField = {
    key: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
    required: boolean;
    min?: number;
    max?: number;
    step?: number;
    constValue?: string | number;
    options?: CommandOption[];
    optionSource?: 'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';
    tupleLabels?: string[];
};
type CommandAvailability = {
    key: string;
    name: string;
    reqArg: boolean;
    status: 'available' | 'blocked' | 'needsInput' | 'unknown';
    possible: boolean;
    reason?: string;
    inputFields: CommandInputField[];
};
type CommandTable = {
    general: Array<{ category: string; values: CommandAvailability[] }>;
    nation: Array<{ category: string; values: CommandAvailability[] }>;
    inputOptions: {
        cities: CommandOption[];
        nations: CommandOption[];
        generals: CommandOption[];
        crewTypes: CommandOption[];
        armTypes: CommandOption[];
        nationTypes: CommandOption[];
        colors: CommandOption[];
        items: Record<string, CommandOption[]>;
    };
};
type TurnRow = { index: number; time: string; action: string; isRest: boolean };

const props = defineProps<{
    officerLevelText: string;
    name: string | null;
    npcState: number | null;
    rows: TurnRow[];
    commandTable: CommandTable | null;
    loading: boolean;
    mobile?: boolean;
}>();

const emit = defineEmits<{
    (event: 'reserve', payload: { index: number; action: string; args: Record<string, unknown> }): void;
    (event: 'shift', amount: number): void;
    (event: 'repeat', amount: number): void;
}>();

const pickerTurnIndex = ref<number | null>(null);
const selectedCommand = ref<CommandAvailability | null>(null);
const commandArgs = ref<Record<string, unknown>>({});
const commandArgsValid = ref(false);
const editMode = ref(false);
const repeatAmount = ref(0);

const nationCategoryOrder = ['휴식', '인사', '외교', '특수', '전략', '국가'];
const nationOnlyTable = computed(() => {
    if (!props.commandTable) return null;
    const groupByCategory = new Map(props.commandTable.nation.map((group) => [group.category, group]));
    const orderedGroups = nationCategoryOrder.map(
        (category) => groupByCategory.get(category) ?? { category, values: [] }
    );
    const extraGroups = props.commandTable.nation.filter((group) => !nationCategoryOrder.includes(group.category));
    return { ...props.commandTable, general: [], nation: [...orderedGroups, ...extraGroups] };
});
const nameColor = computed(() => (props.npcState !== null ? getNpcColor(props.npcState) : undefined));

const closePicker = () => {
    pickerTurnIndex.value = null;
    selectedCommand.value = null;
    commandArgs.value = {};
    commandArgsValid.value = false;
};

const openPicker = (turnIndex: number) => {
    pickerTurnIndex.value = turnIndex;
    selectedCommand.value = null;
    commandArgs.value = {};
    commandArgsValid.value = false;
};

const selectCommand = (commandKey: string) => {
    const command =
        props.commandTable?.nation.flatMap((group) => group.values).find((entry) => entry.key === commandKey) ?? null;
    if (!command || pickerTurnIndex.value === null) return;
    selectedCommand.value = command;
    commandArgs.value = {};
    commandArgsValid.value = !command.reqArg;
    if (!command.reqArg) reserveSelected();
};

const reserveSelected = () => {
    if (pickerTurnIndex.value === null || !selectedCommand.value || !commandArgsValid.value) return;
    emit('reserve', {
        index: pickerTurnIndex.value,
        action: selectedCommand.value.key,
        args: commandArgs.value,
    });
    closePicker();
};
</script>

<template>
    <article class="chief-editor" :class="{ mobile: props.mobile }" data-testid="chief-command-editor">
        <header v-if="!props.mobile" class="editor-header legacy-bg1">
            <span>{{ props.officerLevelText }} :</span>
            <strong :style="{ color: nameColor }">{{ props.name ?? '-' }}</strong>
        </header>

        <div class="editor-body">
            <aside class="editor-controls">
                <div v-if="props.mobile" class="mobile-identity legacy-bg1">
                    <strong :style="{ color: nameColor }">{{ props.name ?? '-' }}</strong>
                    <span>{{ props.officerLevelText }}</span>
                </div>
                <time>{{ props.rows[0]?.time ?? '--:--' }}</time>
                <button type="button" @click="editMode = !editMode">{{ editMode ? '일반 모드' : '고급 모드' }}</button>
                <select
                    v-model.number="repeatAmount"
                    class="repeat-control"
                    aria-label="반복 턴 수"
                    @change="repeatAmount > 0 && emit('repeat', repeatAmount)"
                >
                    <option :value="0" disabled>반복⌄</option>
                    <option v-for="amount in 6" :key="amount" :value="amount">{{ amount }}턴</option>
                </select>
                <button type="button" @click="emit('shift', -1)">당기기⌄</button>
                <button type="button" @click="emit('shift', 1)">미루기⌄</button>
            </aside>

            <div class="editor-turns">
                <div v-for="row in props.rows" :key="row.index" class="editor-turn-row">
                    <time>{{ row.time }}</time>
                    <strong>{{ row.action }}</strong>
                    <button
                        type="button"
                        class="edit-turn"
                        :aria-label="`${row.index + 1}턴 명령 입력`"
                        @click="openPicker(row.index)"
                    >
                        ✎
                    </button>
                </div>
            </div>
        </div>

        <div
            v-if="pickerTurnIndex !== null"
            :class="['command-picker', { 'has-command': selectedCommand }]"
            data-testid="chief-command-picker"
        >
            <header>
                <strong>{{ pickerTurnIndex + 1 }}턴 명령 입력</strong>
                <button type="button" aria-label="명령 입력 닫기" @click="closePicker">×</button>
            </header>
            <CommandSelectForm
                v-if="!selectedCommand"
                :command-table="nationOnlyTable"
                :loading="props.loading"
                scope="nation"
                @select="selectCommand"
            />
            <button v-if="!selectedCommand" type="button" class="picker-close" @click="closePicker">닫기</button>
            <template v-else>
                <div class="selected-command">{{ selectedCommand.name }}</div>
                <CommandArgumentForm
                    v-if="selectedCommand.reqArg && props.commandTable"
                    :command-key="selectedCommand.key"
                    :fields="selectedCommand.inputFields"
                    :options="props.commandTable.inputOptions"
                    @update:args="commandArgs = $event"
                    @update:valid="commandArgsValid = $event"
                />
                <div class="picker-actions">
                    <button type="button" @click="selectedCommand = null">명령 다시 선택</button>
                    <button type="button" :disabled="!commandArgsValid" @click="reserveSelected">입력</button>
                </div>
            </template>
        </div>
    </article>
</template>

<style scoped>
.chief-editor {
    position: relative;
    min-width: 0;
    color: #fff;
    background: #000;
}
.editor-header {
    box-sizing: border-box;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 16.8px;
    font-weight: 400;
}
.editor-body {
    display: flex;
    flex-direction: column;
}
.editor-controls {
    order: 2;
    min-height: 85px;
    padding: 2px 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    align-items: stretch;
}
.editor-controls > time {
    display: grid;
    place-items: center;
    border-radius: 4px;
    background: #345c85;
    font-variant-numeric: tabular-nums;
}
.editor-controls button,
.repeat-control {
    min-height: 36px;
    border: 0;
    border-radius: 4px;
    background: #444;
    color: #fff;
    font: inherit;
    font-weight: 700;
}
.editor-controls button {
    cursor: pointer;
}
.repeat-control {
    padding: 0 8px;
    text-align: center;
}
.editor-turns {
    order: 1;
    display: grid;
    grid-template-rows: repeat(12, 30px);
}
.editor-turn-row {
    display: grid;
    grid-template-columns: 55px minmax(0, 1fr) 36px;
    align-items: center;
    min-width: 0;
}
.editor-turn-row > time {
    height: 30px;
    display: grid;
    place-items: center;
    background: #000;
    font-variant-numeric: tabular-nums;
}
.editor-turn-row > strong {
    height: 30px;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #0d204d;
    font-weight: 400;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.editor-turn-row:nth-child(odd) > strong {
    background: #12295d;
}
.edit-turn {
    align-self: stretch;
    border: 0;
    background: #444;
    color: #fff;
    cursor: pointer;
}
.command-picker {
    position: absolute;
    z-index: 20;
    top: 54px;
    left: 0;
    box-sizing: border-box;
    width: 100%;
    height: 344px;
    overflow: auto;
    border: 0;
    padding: 0;
    background: #303030;
}
.command-picker > header {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.command-picker.has-command {
    padding: 8px;
}
.command-picker.has-command > header {
    position: static;
    width: auto;
    height: auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    clip: auto;
    margin-bottom: 8px;
}
.command-picker.has-command > header button {
    width: 32px;
    height: 28px;
}
.command-picker :deep(.command-form) {
    gap: 4px;
    padding-top: 0;
}
.command-picker :deep(.category-list) {
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 2px;
}
.command-picker :deep(.category-btn) {
    min-width: 0;
    height: 35px;
    border: 0;
    border-radius: 4px;
    padding: 4px;
    background: #00a879;
    color: #fff;
    font-size: 16px;
    font-weight: 700;
}
.command-picker :deep(.category-btn.active) {
    background: #00bf91;
}
.command-picker :deep(.command-grid) {
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    margin-top: 4px;
}
.command-picker :deep(.command-item) {
    min-height: 39px;
    border: 1px solid #888;
    border-radius: 5px;
    padding: 5px;
    display: grid;
    place-items: center;
    background: transparent;
    color: #fff;
    text-align: center;
    font-size: 16px;
}
.command-picker :deep(.command-status) {
    display: none;
}
.picker-close {
    position: absolute;
    right: 0;
    bottom: 7px;
    width: 65px;
    height: 35px;
    border: 0;
    border-radius: 4px;
    background: #444;
    color: #fff;
    font: inherit;
    font-weight: 700;
}
.selected-command {
    margin-bottom: 6px;
    padding: 6px 8px;
    background: #0d204d;
    font-weight: 700;
}
.picker-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
}
.picker-actions button {
    min-height: 34px;
}
.mobile-identity {
    display: grid;
    grid-column: 1 / -1;
    min-height: 60px;
    place-items: center;
}

.chief-editor.mobile .editor-header {
    display: none;
}
.chief-editor.mobile {
    margin-top: 10px;
}
.chief-editor.mobile .editor-body {
    height: 360px;
    display: grid;
    grid-template-columns: 109px 391px;
}
.chief-editor.mobile .editor-controls {
    order: initial;
    min-height: 0;
    padding: 0;
    grid-template-columns: 1fr;
    align-content: start;
}
.chief-editor.mobile .editor-controls > time {
    min-height: 36px;
}
.chief-editor.mobile .editor-controls > button {
    min-height: 36px;
    margin-top: 5px;
}
.chief-editor.mobile .repeat-control {
    min-height: 36px;
    margin-top: 5px;
}
.chief-editor.mobile .editor-turns {
    order: initial;
    padding-top: 10px;
}
.chief-editor.mobile .editor-turn-row {
    grid-template-columns: 74px minmax(0, 1fr) 53px;
}
.chief-editor.mobile .command-picker {
    position: absolute;
    top: 30px;
    left: 130px;
    width: 370px;
    height: 327px;
}
</style>
