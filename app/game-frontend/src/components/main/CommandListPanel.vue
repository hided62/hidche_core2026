<script setup lang="ts">
import { ref } from 'vue';
import CommandArgumentForm from './CommandArgumentForm.vue';
import CommandSelectForm from './CommandSelectForm.vue';

interface TurnCommandOption {
    value: string | number;
    label: string;
    color?: string;
}
interface TurnCommandInputField {
    key: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
    required: boolean;
    min?: number;
    max?: number;
    step?: number;
    constValue?: string | number;
    options?: TurnCommandOption[];
    optionSource?: 'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';
    tupleLabels?: string[];
}
interface TurnCommandAvailability {
    key: string;
    name: string;
    reqArg: boolean;
    status: 'available' | 'blocked' | 'needsInput' | 'unknown';
    possible: boolean;
    reason?: string;
    inputFields: TurnCommandInputField[];
}

interface TurnCommandGroup {
    category: string;
    values: TurnCommandAvailability[];
}

interface TurnCommandTable {
    general: TurnCommandGroup[];
    nation: TurnCommandGroup[];
    inputOptions: {
        cities: TurnCommandOption[];
        nations: TurnCommandOption[];
        generals: TurnCommandOption[];
        crewTypes: TurnCommandOption[];
        armTypes: TurnCommandOption[];
        nationTypes: TurnCommandOption[];
        colors: TurnCommandOption[];
        items: Record<string, TurnCommandOption[]>;
    };
}

interface SelectedCityInfo {
    id: number;
    name: string;
    nationName: string;
    regionName: string;
}

interface ReservedTurnEntry {
    index: number;
    action: string;
    args: unknown;
}

interface GeneralInfo {
    id: number;
    nationId: number;
    officerLevel: number;
}

const props = defineProps<{
    commandTable: TurnCommandTable | null;
    loading: boolean;
    selectedCity: SelectedCityInfo | null;
    reservedGeneralTurns: ReservedTurnEntry[] | null;
    reservedNationTurns: ReservedTurnEntry[] | null;
    general: GeneralInfo | null;
}>();

const emit = defineEmits<{
    (event: 'set-general-turn', payload: { index: number; action: string; args: Record<string, unknown> }): void;
    (event: 'shift-general-turns', amount: number): void;
    (event: 'set-nation-turn', payload: { index: number; action: string; args: Record<string, unknown> }): void;
    (event: 'shift-nation-turns', amount: number): void;
}>();

const activeCategory = ref('');
const selectedCommand = ref<TurnCommandAvailability | null>(null);
const selectedScope = ref<'general' | 'nation' | null>(null);
const commandArgs = ref<Record<string, unknown>>({});
const commandArgsValid = ref(false);

const handleSelect = (commandKey: string) => {
    if (!props.commandTable) {
        selectedCommand.value = null;
        selectedScope.value = null;
        return;
    }
    for (const scope of ['general', 'nation'] as const) {
        for (const group of props.commandTable[scope]) {
            const match = group.values.find((entry) => entry.key === commandKey);
            if (match) {
                selectedCommand.value = match;
                selectedScope.value = scope;
                commandArgs.value = {};
                commandArgsValid.value = !match.reqArg;
                return;
            }
        }
    }
    selectedCommand.value = null;
    selectedScope.value = null;
};

const canReserveSelected = (scope: 'general' | 'nation') => {
    if (!selectedCommand.value) {
        return false;
    }
    if (selectedScope.value !== scope) return false;
    if (!selectedCommand.value.possible) {
        return false;
    }
    if (!['available', 'needsInput'].includes(selectedCommand.value.status)) {
        return false;
    }
    return commandArgsValid.value;
};

const reserveGeneralTurn = (index: number) => {
    if (!selectedCommand.value) {
        return;
    }
    emit('set-general-turn', { index, action: selectedCommand.value.key, args: commandArgs.value });
};

const reserveNationTurn = (index: number) => {
    if (!selectedCommand.value) {
        return;
    }
    emit('set-nation-turn', { index, action: selectedCommand.value.key, args: commandArgs.value });
};

const clearGeneralTurn = (index: number) => {
    emit('set-general-turn', { index, action: '휴식', args: {} });
};

const clearNationTurn = (index: number) => {
    emit('set-nation-turn', { index, action: '휴식', args: {} });
};

const canNationReserve = () => Boolean(props.general && props.general.nationId > 0 && props.general.officerLevel >= 5);
</script>

<template>
    <div class="command-panel">
        <div class="command-selection">
            <div class="label">선택 도시</div>
            <div class="value">
                <span v-if="props.selectedCity">
                    {{ props.selectedCity.name }} · {{ props.selectedCity.nationName }} ·
                    {{ props.selectedCity.regionName }}
                </span>
                <span v-else>선택된 도시 없음</span>
            </div>
        </div>
        <details class="command-editor">
            <summary>고급 모드로</summary>
            <CommandSelectForm
                :command-table="props.commandTable"
                :loading="props.loading"
                :active-category="activeCategory"
                @update:active-category="activeCategory = $event"
                @select="handleSelect"
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
                v-if="selectedCommand?.reqArg && props.commandTable"
                :command-key="selectedCommand.key"
                :fields="selectedCommand.inputFields"
                :options="props.commandTable.inputOptions"
                @update:args="commandArgs = $event"
                @update:valid="commandArgsValid = $event"
            />
        </details>
        <div class="reserved-section general-reserved">
            <div class="reserved-header">
                <span>일반 예턴</span>
                <div class="reserved-actions">
                    <button @click="emit('shift-general-turns', -1)">앞당김</button>
                    <button @click="emit('shift-general-turns', 1)">밀기</button>
                </div>
            </div>
            <div v-if="!props.reservedGeneralTurns" class="muted">예턴을 불러오지 못했습니다.</div>
            <div v-else class="reserved-list">
                <div v-for="turn in props.reservedGeneralTurns" :key="turn.index" class="reserved-item">
                    <div class="turn-label">#{{ turn.index + 1 }}</div>
                    <div class="turn-action">{{ turn.action }}</div>
                    <div class="turn-buttons">
                        <button :disabled="!canReserveSelected('general')" @click="reserveGeneralTurn(turn.index)">
                            배치
                        </button>
                        <button class="ghost" @click="clearGeneralTurn(turn.index)">휴식</button>
                    </div>
                </div>
            </div>
        </div>
        <details class="reserved-section nation-reserved">
            <summary>국가 예턴</summary>
            <div class="reserved-header">
                <span>국가 예턴 편집</span>
                <div class="reserved-actions">
                    <button :disabled="!canNationReserve()" @click="emit('shift-nation-turns', -1)">앞당김</button>
                    <button :disabled="!canNationReserve()" @click="emit('shift-nation-turns', 1)">밀기</button>
                </div>
            </div>
            <div v-if="!canNationReserve()" class="muted">국가 예턴은 최고위 관직부터 가능합니다.</div>
            <div v-else-if="!props.reservedNationTurns" class="muted">예턴을 불러오지 못했습니다.</div>
            <div v-else class="reserved-list">
                <div v-for="turn in props.reservedNationTurns" :key="turn.index" class="reserved-item">
                    <div class="turn-label">#{{ turn.index + 1 }}</div>
                    <div class="turn-action">{{ turn.action }}</div>
                    <div class="turn-buttons">
                        <button :disabled="!canReserveSelected('nation')" @click="reserveNationTurn(turn.index)">
                            배치
                        </button>
                        <button class="ghost" @click="clearNationTurn(turn.index)">휴식</button>
                    </div>
                </div>
            </div>
        </details>
    </div>
</template>

<style scoped>
.command-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.command-editor > summary {
    min-height: 28px;
    padding: 4px 8px;
    background: #444;
    color: #fff;
    cursor: pointer;
    text-align: center;
}

.command-selection {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    min-height: 24px;
    border: 1px solid #666;
    font-size: 12px;
}

.command-selection .label {
    padding: 2px 5px;
    background: #173d27;
    color: #fff;
    text-align: center;
}
.command-selection .value {
    overflow: hidden;
    padding: 2px 5px;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.command-selected {
    border: 1px solid #666;
    padding: 3px 5px;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    font-size: 12px;
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

.reserved-section {
    display: flex;
    flex-direction: column;
    gap: 0;
}

.reserved-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.75rem;
    font-weight: 600;
}

.reserved-actions {
    display: flex;
    gap: 6px;
}

.reserved-actions button {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 4px 6px;
    font-size: 0.7rem;
}

.reserved-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 420px;
    overflow-y: auto;
}

.nation-reserved > summary {
    min-height: 28px;
    padding: 4px 8px;
    background: #444;
    cursor: pointer;
}

.reserved-item {
    border: 1px solid rgba(201, 164, 90, 0.2);
    min-height: 30px;
    padding: 2px 4px;
    display: grid;
    grid-template-columns: 50px 1fr auto;
    gap: 6px;
    align-items: center;
    font-size: 0.75rem;
}

.turn-label {
    color: rgba(232, 221, 196, 0.6);
}

.turn-buttons {
    display: flex;
    gap: 4px;
}

.turn-buttons button {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 4px 6px;
    font-size: 0.7rem;
}

.ghost {
    background: transparent;
}

.muted {
    color: rgba(232, 221, 196, 0.6);
    font-size: 0.75rem;
}
</style>
