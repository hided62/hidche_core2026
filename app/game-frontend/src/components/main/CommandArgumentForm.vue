<script setup lang="ts">
import { computed, reactive, watch, type CSSProperties } from 'vue';
import MapViewer from './MapViewer.vue';
import NationColorSelect from './NationColorSelect.vue';
import { commandArgumentPresentation, resolveCommandArgumentMapTarget } from '../command/commandArgumentPresentation';
import { commandCityOptions } from '../command/commandArgumentOptions';
import {
    commandArgumentFieldContract,
    shouldPreserveCommandArgumentValue,
    type CommandArgumentFieldContract,
} from '../command/commandArgumentDraft';
import { legacyNationTextColor } from '../../utils/legacyNationColor';
import { getNpcColor } from '../../utils/npcColor';
import type {
    CommandInputContext,
    CommandInputField,
    CommandMapData,
    CommandMapLayout,
    CommandOption,
    CommandTable,
} from '../command/types';

type CommandInputOptions = CommandTable['inputOptions'];

const props = defineProps<{
    commandKey: string;
    fields: CommandInputField[];
    options: CommandInputOptions;
    mapData?: CommandMapData | null;
    mapLayout?: CommandMapLayout | null;
}>();

const emit = defineEmits<{
    (event: 'update:args', args: Record<string, unknown>): void;
    (event: 'update:valid', valid: boolean): void;
}>();

const values = reactive<Record<string, unknown>>({});
const previousFieldContracts = new Map<string, CommandArgumentFieldContract>();
let initializedCommandKey: string | null = null;
const presentation = computed(() => commandArgumentPresentation(props.commandKey));
const visibleFields = computed(() => props.fields.filter((entry) => entry.kind !== 'hidden'));

const amountPreset = computed(() => props.options.amountPresets?.[props.commandKey]);

const sortGeneralOptions = (options: CommandOption[]): CommandOption[] => {
    const result = [...options];
    const resourceKey = values.isGold === false ? 'rice' : 'gold';
    if (props.commandKey === 'che_포상') {
        return result.sort((left, right) => (left[resourceKey] ?? 0) - (right[resourceKey] ?? 0));
    }
    if (props.commandKey === 'che_몰수') {
        return result.sort((left, right) => (right[resourceKey] ?? 0) - (left[resourceKey] ?? 0));
    }
    if (props.commandKey === 'che_부대탈퇴지시') {
        return result.sort((left, right) => Number(right.availableNow) - Number(left.availableNow));
    }
    return result;
};

const optionsFor = (field: CommandInputField): CommandOption[] => {
    if (field.options) return field.options;
    if (!field.optionSource) return [];
    if (field.optionSource === 'generals') {
        return sortGeneralOptions(props.options.generalTargets?.[props.commandKey] ?? props.options.generals);
    }
    if (field.optionSource === 'nations') {
        return props.options.nationTargets?.[props.commandKey] ?? props.options.nations;
    }
    if (field.optionSource === 'cities') {
        return commandCityOptions(props.commandKey, props.options.cities, props.mapData);
    }
    if (field.optionSource === 'items') {
        return props.options.items[String(values.itemType ?? '')] ?? [];
    }
    return props.options[field.optionSource];
};

const defaultValue = (field: CommandInputField): unknown => {
    if (field.kind === 'hidden') return field.constValue;
    if (field.defaultValue !== undefined) return field.defaultValue;
    if (field.kind === 'boolean') return true;
    if (field.kind === 'numberTuple') {
        const value = amountPreset.value?.defaultValue ?? field.min ?? 0;
        return [value, value];
    }
    if (field.kind === 'number') return amountPreset.value?.defaultValue ?? field.min ?? 0;
    if (field.kind === 'select') {
        const options = optionsFor(field);
        const commandSpecificNationTargets =
            field.optionSource === 'nations' ? props.options.nationTargets?.[props.commandKey] : undefined;
        if (commandSpecificNationTargets?.length) return commandSpecificNationTargets[0]?.value ?? '';
        const mapDefault =
            field.optionSource === 'cities' && (field.key === 'destCityId' || field.key === 'destCityID')
                ? props.mapData?.myCity
                : field.optionSource === 'nations' && field.key === 'destNationId'
                  ? props.mapData?.myNation
                  : null;
        return options.find((option) => option.value === mapDefault)?.value ?? options[0]?.value ?? '';
    }
    return '';
};

const synchronizeValues = () => {
    const commandChanged = initializedCommandKey !== props.commandKey;
    initializedCommandKey = props.commandKey;
    const activeKeys = new Set(props.fields.map((field) => field.key));
    for (const key of Object.keys(values)) {
        if (!activeKeys.has(key)) delete values[key];
    }
    for (const field of props.fields) {
        const preserve =
            !commandChanged &&
            shouldPreserveCommandArgumentValue(field, previousFieldContracts.get(field.key), values, optionsFor(field));
        if (!preserve) values[field.key] = defaultValue(field);
    }
    const itemCodeField = props.fields.find((field) => field.key === 'itemCode');
    if (
        itemCodeField &&
        (commandChanged ||
            !shouldPreserveCommandArgumentValue(
                itemCodeField,
                previousFieldContracts.get(itemCodeField.key),
                values,
                optionsFor(itemCodeField)
            ))
    ) {
        values.itemCode = defaultValue(itemCodeField);
    }
    previousFieldContracts.clear();
    for (const field of props.fields) previousFieldContracts.set(field.key, commandArgumentFieldContract(field));
};

const setSelectValue = (field: CommandInputField, rawValue: string) => {
    const option = optionsFor(field).find((entry) => String(entry.value) === rawValue);
    values[field.key] = option?.value ?? rawValue;
    if (field.key === 'itemType') {
        const itemField = props.fields.find((entry) => entry.key === 'itemCode');
        if (itemField) values.itemCode = defaultValue(itemField);
    }
};

const selectedOptionFor = (field: CommandInputField): CommandOption | undefined =>
    optionsFor(field).find((entry) => entry.value === values[field.key]);

const selectedValueFor = (field: CommandInputField): string | number => {
    const value = values[field.key];
    return typeof value === 'string' || typeof value === 'number' ? value : '';
};

const colorOptionStyle = (field: CommandInputField, option?: CommandOption): CSSProperties | undefined => {
    if (field.optionSource === 'colors' && option?.color) {
        return {
            backgroundColor: option.color,
            color: legacyNationTextColor(option.color),
        };
    }
    if (field.optionSource === 'generals' && option?.npcState !== undefined) {
        return { color: getNpcColor(option.npcState) };
    }
    return undefined;
};

const cityTargetField = computed(() =>
    props.fields.find(
        (field) =>
            field.kind === 'select' &&
            field.optionSource === 'cities' &&
            (field.key === 'destCityId' || field.key === 'destCityID')
    )
);
const nationTargetField = computed(() =>
    props.fields.find(
        (field) => field.kind === 'select' && field.optionSource === 'nations' && field.key === 'destNationId'
    )
);
const mapTarget = computed(() => resolveCommandArgumentMapTarget(props.commandKey, props.fields));
const showMap = computed(() => Boolean(props.mapData && props.mapLayout && mapTarget.value));
const mapSelectedCityId = computed<number | null>(() => {
    if (!props.mapData) return null;
    if (mapTarget.value === 'city' && cityTargetField.value) {
        const value = values[cityTargetField.value.key];
        return typeof value === 'number' ? value : null;
    }
    if (mapTarget.value === 'nation' && nationTargetField.value) {
        const value = values[nationTargetField.value.key];
        if (typeof value !== 'number') return null;
        return (
            props.mapData.nationList.find((entry) => entry[0] === value)?.[3] ??
            props.mapData.cityList.find((entry) => entry[3] === value)?.[0] ??
            null
        );
    }
    return null;
});

const currentCityName = computed(() => {
    const cityId = props.mapData?.myCity;
    if (!cityId) return '-';
    return props.mapLayout?.cityList.find((city) => city.id === cityId)?.name ?? '-';
});

const selectedMapTargetName = computed(() => {
    if (mapTarget.value === 'city') {
        const cityId = mapSelectedCityId.value;
        if (!cityId) return '-';
        return props.mapLayout?.cityList.find((city) => city.id === cityId)?.name ?? '-';
    }
    if (mapTarget.value === 'nation' && nationTargetField.value) {
        const nationId = values[nationTargetField.value.key];
        if (typeof nationId !== 'number') return '-';
        return props.mapData?.nationList.find((nation) => nation[0] === nationId)?.[1] ?? '-';
    }
    return '-';
});

const distanceFromMyCity = (destination: number): number | null => {
    const start = props.mapData?.myCity;
    if (!start || !props.mapLayout) return null;
    if (start === destination) return 0;
    const paths = new Map(props.mapLayout.cityList.map((city) => [city.id, city.path]));
    const visited = new Set<number>([start]);
    let frontier = [start];
    for (let distance = 1; frontier.length; distance += 1) {
        const next: number[] = [];
        for (const cityId of frontier) {
            for (const adjacentId of paths.get(cityId) ?? []) {
                if (visited.has(adjacentId)) continue;
                if (adjacentId === destination) return distance;
                visited.add(adjacentId);
                next.push(adjacentId);
            }
        }
        frontier = next;
    }
    return null;
};

const mapTargetSummary = computed(() => {
    if (!props.mapData || !props.mapLayout) return '';
    if (mapTarget.value === 'city' && mapSelectedCityId.value) {
        const city = props.mapLayout.cityList.find((entry) => entry.id === mapSelectedCityId.value);
        const dynamic = props.mapData.cityList.find((entry) => entry[0] === mapSelectedCityId.value);
        if (!city) return '';
        const nation = props.mapData.nationList.find((entry) => entry[0] === dynamic?.[3]);
        const distance = distanceFromMyCity(city.id);
        return [
            city.name,
            nation?.[1] ?? '무주',
            props.mapLayout.regionMap[dynamic?.[4] ?? city.region],
            props.mapLayout.levelMap[dynamic?.[1] ?? city.level],
            distance === null ? null : `현재 도시에서 ${distance}칸`,
        ]
            .filter(Boolean)
            .join(' · ');
    }
    if (mapTarget.value === 'nation' && nationTargetField.value) {
        const value = values[nationTargetField.value.key];
        if (typeof value !== 'number') return '';
        const nation = props.mapData.nationList.find((entry) => entry[0] === value);
        if (!nation) return '';
        const capital = props.mapLayout.cityList.find((entry) => entry.id === nation[3]);
        const cityCount = props.mapData.cityList.filter((entry) => entry[3] === value).length;
        return `${nation[1]} · 수도 ${capital?.name ?? '-'} · 도시 ${cityCount.toLocaleString()}개`;
    }
    return '';
});

const selectMapCity = (cityId: number) => {
    if (!props.mapData) return;
    if (mapTarget.value === 'city' && cityTargetField.value) {
        setSelectValue(cityTargetField.value, String(cityId));
        return;
    }
    if (mapTarget.value === 'nation' && nationTargetField.value) {
        const nationId = props.mapData.cityList.find((entry) => entry[0] === cityId)?.[3];
        if (nationId && nationId > 0) setSelectValue(nationTargetField.value, String(nationId));
    }
};

const resourceSummary = computed(() => {
    const context: CommandInputContext | undefined = props.options.context;
    if (!context) return [];
    const result: string[] = [];
    const usesActorResources = new Set(['che_증여', 'che_헌납', 'che_군량매매', 'che_장비매매']);
    const usesNationResources = new Set(['che_몰수', 'che_포상', 'che_물자원조']);
    if (usesActorResources.has(props.commandKey)) {
        result.push(
            `현재 자금 ${context.actorGold.toLocaleString()}`,
            `현재 군량 ${context.actorRice.toLocaleString()}`
        );
    }
    if (props.commandKey === 'che_장비매매' && context.citySecurity !== undefined) {
        result.push(`현재 도시 치안 ${context.citySecurity.toLocaleString()}`);
    }
    if (usesNationResources.has(props.commandKey)) {
        if (context.nationGold !== undefined) result.push(`국고 ${context.nationGold.toLocaleString()}`);
        if (context.nationRice !== undefined) result.push(`국가 군량 ${context.nationRice.toLocaleString()}`);
        if (context.nationLevel !== undefined) result.push(`국가 작위 ${context.nationLevel}`);
    }
    return result;
});

const setTupleValue = (field: CommandInputField, index: number, rawValue: string) => {
    const tuple = Array.isArray(values[field.key]) ? [...(values[field.key] as unknown[])] : [0, 0];
    tuple[index] = Number(rawValue);
    values[field.key] = tuple;
};

const setNumberPreset = (field: CommandInputField, rawValue: string, tupleIndex?: number) => {
    if (!rawValue) return;
    if (tupleIndex === undefined) {
        values[field.key] = Number(rawValue);
        return;
    }
    setTupleValue(field, tupleIndex, rawValue);
};

const effectiveMin = (field: CommandInputField): number | undefined => amountPreset.value?.min ?? field.min;
const effectiveMax = (field: CommandInputField): number | undefined => amountPreset.value?.max ?? field.max;
const effectiveStep = (field: CommandInputField): number | undefined => amountPreset.value?.step ?? field.step;

const OPTION_CARD_COMMANDS = new Set([
    'che_물자원조',
    'che_불가침제의',
    'che_선전포고',
    'che_종전제의',
    'che_불가침파기제의',
    'che_포상',
    'che_발령',
    'che_몰수',
    'che_부대탈퇴지시',
]);
const showOptionCards = (field: CommandInputField): boolean =>
    field.kind === 'select' &&
    Boolean(field.optionSource && ['nations', 'generals'].includes(field.optionSource)) &&
    OPTION_CARD_COMMANDS.has(props.commandKey);

const isValid = computed(() =>
    props.fields.every((field) => {
        const value = values[field.key];
        if (field.kind === 'text') {
            const length = typeof value === 'string' ? value.trim().length : 0;
            return (
                (!field.required || length > 0) &&
                (field.min === undefined || length >= field.min) &&
                (field.max === undefined || length <= field.max)
            );
        }
        if (field.kind === 'number') {
            const min = effectiveMin(field);
            const max = effectiveMax(field);
            return (
                typeof value === 'number' &&
                Number.isFinite(value) &&
                (min === undefined || value >= min) &&
                (max === undefined || value <= max)
            );
        }
        if (field.kind === 'numberTuple') {
            const min = effectiveMin(field);
            const max = effectiveMax(field);
            return (
                Array.isArray(value) &&
                value.length === 2 &&
                value.every(
                    (entry) =>
                        typeof entry === 'number' &&
                        Number.isFinite(entry) &&
                        (min === undefined || entry >= min) &&
                        (max === undefined || entry <= max)
                )
            );
        }
        if (field.kind === 'select') return optionsFor(field).some((option) => option.value === value);
        return value !== undefined;
    })
);

watch(
    () => [props.commandKey, props.fields, props.options, props.mapData?.myCity, props.mapData?.myNation] as const,
    synchronizeValues,
    { immediate: true, deep: true }
);
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
    <div
        v-if="props.fields.length || showMap || presentation.lines.length"
        class="command-argument-form"
        data-testid="command-argument-form"
    >
        <div v-if="showMap" class="command-map" data-testid="command-argument-map">
            <MapViewer
                :map-data="props.mapData ?? null"
                :map-layout="props.mapLayout ?? null"
                :loading="false"
                :selected-city-id="mapSelectedCityId"
                :detail-mode="true"
                :fit-container="true"
                :show-current-city-marker="true"
                @select-city="selectMapCity"
            />
            <small>지도에서 도시를 클릭하거나 아래 목록에서 대상을 선택하세요.</small>
            <div class="map-selection-status" aria-live="polite" data-testid="command-map-selection-status">
                <span class="current-city-status">
                    <span class="status-key">현재 도시</span>
                    <strong>{{ currentCityName }}</strong>
                </span>
                <span aria-hidden="true">→</span>
                <span class="selected-target-status">
                    <span class="status-key">{{ mapTarget === 'nation' ? '선택 국가' : '선택 도시' }}</span>
                    <strong>{{ selectedMapTargetName }}</strong>
                </span>
            </div>
            <div v-if="mapTargetSummary" class="map-target-summary" data-testid="command-map-target-summary">
                {{ mapTargetSummary }}
            </div>
        </div>
        <div v-if="presentation.lines.length" class="command-guidance" data-testid="command-argument-guidance">
            <div v-for="line in presentation.lines" :key="line">{{ line }}</div>
        </div>
        <div v-if="resourceSummary.length" class="resource-summary" data-testid="command-resource-summary">
            <span v-for="entry in resourceSummary" :key="entry">{{ entry }}</span>
        </div>
        <div v-for="field in visibleFields" :key="field.key" class="argument-row">
            <label :for="`command-arg-${field.key}`">{{ field.label }}</label>
            <input
                v-if="field.kind === 'text'"
                :id="`command-arg-${field.key}`"
                :value="String(values[field.key] ?? '')"
                :minlength="field.min"
                :maxlength="field.max"
                @input="values[field.key] = ($event.target as HTMLInputElement).value"
            />
            <div v-else-if="field.kind === 'number'" class="number-options">
                <input
                    :id="`command-arg-${field.key}`"
                    type="number"
                    :value="Number(values[field.key] ?? 0)"
                    :min="effectiveMin(field)"
                    :max="effectiveMax(field)"
                    :step="effectiveStep(field)"
                    @input="values[field.key] = Number(($event.target as HTMLInputElement).value)"
                />
                <select
                    v-if="amountPreset"
                    aria-label="금액 프리셋"
                    class="amount-preset"
                    value=""
                    @change="setNumberPreset(field, ($event.target as HTMLSelectElement).value)"
                >
                    <option value="" disabled>프리셋</option>
                    <option v-for="preset in amountPreset.values" :key="preset" :value="preset">
                        {{ preset.toLocaleString() }}
                    </option>
                </select>
            </div>
            <NationColorSelect
                v-else-if="field.kind === 'select' && field.optionSource === 'colors'"
                :id="`command-arg-${field.key}`"
                :model-value="selectedValueFor(field)"
                :options="optionsFor(field)"
                @update:model-value="setSelectValue(field, String($event))"
            />
            <select
                v-else-if="field.kind === 'select'"
                :id="`command-arg-${field.key}`"
                :value="String(values[field.key] ?? '')"
                :style="colorOptionStyle(field, selectedOptionFor(field))"
                @change="setSelectValue(field, ($event.target as HTMLSelectElement).value)"
            >
                <option
                    v-for="option in optionsFor(field)"
                    :key="String(option.value)"
                    :value="String(option.value)"
                    :style="colorOptionStyle(field, option)"
                >
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
                        :min="effectiveMin(field)"
                        :max="effectiveMax(field)"
                        :step="effectiveStep(field)"
                        @input="setTupleValue(field, index, ($event.target as HTMLInputElement).value)"
                    />
                    <select
                        v-if="amountPreset"
                        :aria-label="`${tupleLabel} 금액 프리셋`"
                        class="amount-preset"
                        value=""
                        @change="setNumberPreset(field, ($event.target as HTMLSelectElement).value, index)"
                    >
                        <option value="" disabled>프리셋</option>
                        <option v-for="preset in amountPreset.values" :key="preset" :value="preset">
                            {{ preset.toLocaleString() }}
                        </option>
                    </select>
                </label>
            </div>
            <div
                v-if="
                    field.kind === 'select' &&
                    (selectedOptionFor(field)?.description || selectedOptionFor(field)?.color)
                "
                class="option-detail"
            >
                <span
                    v-if="selectedOptionFor(field)?.color"
                    class="option-color"
                    :style="{ backgroundColor: selectedOptionFor(field)?.color }"
                    aria-hidden="true"
                />
                <span>{{ selectedOptionFor(field)?.description }}</span>
            </div>
            <div
                v-if="showOptionCards(field)"
                class="target-option-list"
                :data-testid="field.optionSource === 'nations' ? 'nation-target-list' : 'general-target-list'"
            >
                <button
                    v-for="option in optionsFor(field)"
                    :key="String(option.value)"
                    type="button"
                    class="target-option"
                    :class="{
                        selected: option.value === values[field.key],
                        unavailable: option.availableNow === false,
                    }"
                    @click="setSelectValue(field, String(option.value))"
                >
                    <span v-if="option.color" class="option-color" :style="{ backgroundColor: option.color }" />
                    <strong :style="colorOptionStyle(field, option)">{{ option.label }}</strong>
                    <span class="target-state">{{
                        option.availableNow === false ? '현재 불가' : option.availableNow ? '우선 대상' : '대상'
                    }}</span>
                    <small>{{ option.description }}</small>
                </button>
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

.command-map {
    width: 100%;
    overflow: hidden;
    background: #111;
}

.command-map small {
    display: block;
    padding: 5px 8px;
    color: rgba(232, 221, 196, 0.72);
}

.map-target-summary {
    padding: 0 8px 6px;
    color: #f1d89a;
    line-height: 1.35;
}

.map-selection-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 7px;
    padding: 0 8px 5px;
    color: rgba(232, 221, 196, 0.82);
    line-height: 18px;
}

.map-selection-status > span:not([aria-hidden='true']) {
    display: inline-flex;
    gap: 4px;
    align-items: center;
}

.status-key {
    border-radius: 2px;
    padding: 0 4px;
    font-size: 10px;
    font-weight: 700;
}

.current-city-status .status-key {
    border: 1px solid #82cfff;
    background: rgba(5, 27, 43, 0.92);
    color: #d9f3ff;
}

.selected-target-status .status-key {
    border: 1px solid rgba(255, 235, 150, 0.9);
    background: rgba(201, 164, 90, 0.18);
    color: #ffe996;
}

.command-guidance {
    display: grid;
    gap: 3px;
    padding: 8px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.35);
    background: #191919;
    color: #eee;
    line-height: 1.35;
}

.resource-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 14px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.25);
    color: #f1d89a;
}

.argument-row {
    display: grid;
    grid-template-columns: minmax(76px, 0.36fr) 1fr;
    min-height: 34px;
    align-items: center;
}

.option-detail {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 6px 0;
    color: rgba(232, 221, 196, 0.74);
    line-height: 1.35;
}

.target-option-list {
    grid-column: 1 / -1;
    display: grid;
    max-height: 230px;
    overflow-y: auto;
    border-top: 1px solid rgba(201, 164, 90, 0.2);
}

.target-option {
    display: grid;
    grid-template-columns: 18px minmax(0, auto) max-content;
    align-items: center;
    gap: 3px 7px;
    border: 0;
    border-bottom: 1px solid rgba(201, 164, 90, 0.16);
    padding: 6px 8px;
    background: rgba(7, 9, 12, 0.82);
    color: #e8ddc4;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.target-option:hover,
.target-option:focus-visible {
    background: rgba(201, 164, 90, 0.13);
    outline: 1px solid rgba(201, 164, 90, 0.6);
    outline-offset: -1px;
}

.target-option.selected {
    background: rgba(201, 164, 90, 0.2);
    box-shadow: inset 3px 0 #e0bc6d;
}

.target-option.unavailable {
    color: rgba(232, 221, 196, 0.58);
}

.target-option > strong {
    grid-column: 2;
}

.target-option > .option-color + strong {
    grid-column: 2;
}

.target-option > strong:first-child {
    grid-column: 1 / 3;
}

.target-state {
    grid-column: 3;
    color: #aee6a7;
    font-size: 10px;
    text-align: right;
}

.target-option.unavailable .target-state {
    color: #e9a29a;
}

.target-option small {
    grid-column: 1 / -1;
    color: inherit;
    line-height: 1.35;
}

.option-color {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border: 1px solid #ddd;
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

.number-options {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(90px, 0.45fr);
    gap: 5px;
    padding-right: 6px;
}

.number-options input,
.number-options select {
    width: 100%;
    margin-right: 0;
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
    display: grid;
    grid-template-columns: max-content minmax(68px, 1fr) minmax(82px, 0.7fr);
    align-items: center;
    gap: 4px;
    min-width: 0;
}

.tuple-options input {
    width: 100%;
    margin: 0;
}

.tuple-options .amount-preset {
    min-width: 0;
    width: 100%;
    margin: 0;
}

@media (max-width: 520px) {
    .tuple-options {
        flex-direction: column;
    }

    .tuple-options label {
        width: 100%;
    }
}

.argument-error {
    padding: 5px 8px;
    color: #ff9a8f;
    border-top: 1px solid rgba(201, 164, 90, 0.2);
}
</style>
