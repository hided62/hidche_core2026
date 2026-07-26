<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

type OptionValue = string | number;
interface CommandOption {
    value: OptionValue;
    label: string;
    color?: string;
}
interface CommandInputField {
    key: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'select' | 'numberTuple' | 'hidden';
    required: boolean;
    min?: number;
    max?: number;
    step?: number;
    constValue?: OptionValue;
    options?: CommandOption[];
    optionSource?: 'cities' | 'nations' | 'generals' | 'crewTypes' | 'armTypes' | 'nationTypes' | 'colors' | 'items';
    tupleLabels?: string[];
}
interface CommandInputOptions {
    cities: CommandOption[];
    nations: CommandOption[];
    generals: CommandOption[];
    crewTypes: CommandOption[];
    armTypes: CommandOption[];
    nationTypes: CommandOption[];
    colors: CommandOption[];
    items: Record<string, CommandOption[]>;
}

const props = defineProps<{
    commandKey: string;
    fields: CommandInputField[];
    options: CommandInputOptions;
}>();

const emit = defineEmits<{
    (event: 'update:args', args: Record<string, unknown>): void;
    (event: 'update:valid', valid: boolean): void;
}>();

const values = reactive<Record<string, unknown>>({});

const optionsFor = (field: CommandInputField): CommandOption[] => {
    if (field.options) return field.options;
    if (!field.optionSource) return [];
    if (field.optionSource === 'items') {
        return props.options.items[String(values.itemType ?? '')] ?? [];
    }
    return props.options[field.optionSource];
};

const defaultValue = (field: CommandInputField): unknown => {
    if (field.kind === 'hidden') return field.constValue;
    if (field.kind === 'boolean') return true;
    if (field.kind === 'numberTuple') return [field.min ?? 0, field.min ?? 0];
    if (field.kind === 'number') return field.min ?? 0;
    if (field.kind === 'select') return optionsFor(field)[0]?.value ?? '';
    return '';
};

const initialize = () => {
    for (const key of Object.keys(values)) delete values[key];
    for (const field of props.fields) values[field.key] = defaultValue(field);
    const itemCodeField = props.fields.find((field) => field.key === 'itemCode');
    if (itemCodeField) values.itemCode = defaultValue(itemCodeField);
};

const setSelectValue = (field: CommandInputField, rawValue: string) => {
    const option = optionsFor(field).find((entry) => String(entry.value) === rawValue);
    values[field.key] = option?.value ?? rawValue;
    if (field.key === 'itemType') {
        const itemField = props.fields.find((entry) => entry.key === 'itemCode');
        if (itemField) values.itemCode = defaultValue(itemField);
    }
};

const setTupleValue = (field: CommandInputField, index: number, rawValue: string) => {
    const tuple = Array.isArray(values[field.key]) ? [...(values[field.key] as unknown[])] : [0, 0];
    tuple[index] = Number(rawValue);
    values[field.key] = tuple;
};

const isValid = computed(() =>
    props.fields.every((field) => {
        const value = values[field.key];
        if (field.kind === 'text') {
            const length = typeof value === 'string' ? value.trim().length : 0;
            return (!field.required || length > 0) && (field.min === undefined || length >= field.min) &&
                (field.max === undefined || length <= field.max);
        }
        if (field.kind === 'number') {
            return typeof value === 'number' && Number.isFinite(value) &&
                (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
        }
        if (field.kind === 'numberTuple') {
            return Array.isArray(value) && value.length === 2 &&
                value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) &&
                    (field.min === undefined || entry >= field.min) && (field.max === undefined || entry <= field.max));
        }
        if (field.kind === 'select') return optionsFor(field).some((option) => option.value === value);
        return value !== undefined;
    })
);

watch(() => [props.commandKey, props.fields, props.options] as const, initialize, { immediate: true, deep: true });
watch(
    () => ({ ...values }),
    () => {
        emit('update:args', { ...values });
        emit('update:valid', isValid.value);
    },
    { immediate: true, deep: true }
);
</script>

<template>
    <div v-if="props.fields.length" class="command-argument-form" data-testid="command-argument-form">
        <div
            v-for="field in props.fields.filter((entry) => entry.kind !== 'hidden')"
            :key="field.key"
            class="argument-row"
        >
            <label :for="`command-arg-${field.key}`">{{ field.label }}</label>
            <input
                v-if="field.kind === 'text'"
                :id="`command-arg-${field.key}`"
                :value="String(values[field.key] ?? '')"
                :minlength="field.min"
                :maxlength="field.max"
                @input="values[field.key] = ($event.target as HTMLInputElement).value"
            />
            <input
                v-else-if="field.kind === 'number'"
                :id="`command-arg-${field.key}`"
                type="number"
                :value="Number(values[field.key] ?? 0)"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                @input="values[field.key] = Number(($event.target as HTMLInputElement).value)"
            />
            <select
                v-else-if="field.kind === 'select'"
                :id="`command-arg-${field.key}`"
                :value="String(values[field.key] ?? '')"
                @change="setSelectValue(field, ($event.target as HTMLSelectElement).value)"
            >
                <option v-for="option in optionsFor(field)" :key="String(option.value)" :value="String(option.value)">
                    {{ option.label }}
                </option>
            </select>
            <div v-else-if="field.kind === 'boolean'" class="boolean-options">
                <button
                    type="button"
                    :class="{ selected: values[field.key] === true }"
                    @click="values[field.key] = true"
                >
                    {{ field.key === 'buyRice' ? '쌀 구매' : field.key === 'isGold' ? '금' : '예' }}
                </button>
                <button
                    type="button"
                    :class="{ selected: values[field.key] === false }"
                    @click="values[field.key] = false"
                >
                    {{ field.key === 'buyRice' ? '쌀 판매' : field.key === 'isGold' ? '쌀' : '아니오' }}
                </button>
            </div>
            <div v-else-if="field.kind === 'numberTuple'" class="tuple-options">
                <label v-for="(tupleLabel, index) in field.tupleLabels ?? ['1', '2']" :key="tupleLabel">
                    <span>{{ tupleLabel }}</span>
                    <input
                        type="number"
                        :value="(values[field.key] as number[] | undefined)?.[index] ?? 0"
                        :min="field.min"
                        :max="field.max"
                        :step="field.step"
                        @input="setTupleValue(field, index, ($event.target as HTMLInputElement).value)"
                    />
                </label>
            </div>
        </div>
        <div v-if="!isValid" class="argument-error" role="alert">필수 입력을 확인하세요.</div>
    </div>
</template>

<style scoped>
.command-argument-form {
    border: 1px solid rgba(201, 164, 90, 0.35);
    font-size: 0.75rem;
}

.argument-row {
    display: grid;
    grid-template-columns: minmax(76px, 0.36fr) 1fr;
    min-height: 34px;
    align-items: center;
}

.argument-row:nth-child(odd) {
    background: rgba(255, 255, 255, 0.035);
}

.argument-row > label {
    padding: 6px 8px;
    color: rgba(232, 221, 196, 0.72);
}

input,
select {
    min-width: 0;
    margin: 4px 6px 4px 0;
    border: 1px solid rgba(201, 164, 90, 0.45);
    background: rgba(7, 9, 12, 0.82);
    color: #e8ddc4;
    padding: 5px 6px;
    font: inherit;
}

.boolean-options,
.tuple-options {
    display: flex;
    gap: 5px;
    padding: 4px 6px 4px 0;
}

.boolean-options button {
    flex: 1;
    border: 1px solid rgba(201, 164, 90, 0.35);
    padding: 5px;
}

.boolean-options button.selected {
    border-color: #c9a45a;
    background: rgba(201, 164, 90, 0.18);
    color: #f5e4bd;
}

.tuple-options label {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
}

.tuple-options input {
    width: 80px;
    margin: 0;
}

.argument-error {
    padding: 5px 8px;
    color: #ff9a8f;
    border-top: 1px solid rgba(201, 164, 90, 0.2);
}
</style>
