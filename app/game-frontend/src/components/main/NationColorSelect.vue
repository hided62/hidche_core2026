<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { legacyNationTextColor } from '../../utils/legacyNationColor';
import type { CommandOption } from '../command/types';

const props = defineProps<{
    id: string;
    modelValue: string | number;
    options: CommandOption[];
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string | number];
}>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const selectedIndex = computed(() =>
    Math.max(
        props.options.findIndex((option) => option.value === props.modelValue),
        0
    )
);

const optionStyle = (option?: CommandOption) => {
    if (!option?.color) return undefined;
    return {
        backgroundColor: option.color,
        color: legacyNationTextColor(option.color),
    };
};

const focusOption = async (index: number): Promise<void> => {
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>(`[data-color-option-index="${index}"]`)?.focus();
};

const openAndFocus = (index: number): void => {
    open.value = true;
    void focusOption(index);
};

const toggleOpen = (): void => {
    open.value = !open.value;
};

const selectOption = (option: CommandOption): void => {
    emit('update:modelValue', option.value);
    open.value = false;
    void nextTick(() => trigger.value?.focus());
};

const handleTriggerKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        openAndFocus(selectedIndex.value);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        openAndFocus(open.value ? selectedIndex.value : props.options.length - 1);
    } else if (event.key === 'Home') {
        event.preventDefault();
        openAndFocus(0);
    } else if (event.key === 'End') {
        event.preventDefault();
        openAndFocus(props.options.length - 1);
    } else if (event.key === 'Escape' && open.value) {
        event.preventDefault();
        event.stopPropagation();
        open.value = false;
    }
};

const handleOptionKeydown = (event: KeyboardEvent, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, props.options.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = props.options.length - 1;
    else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        open.value = false;
        void nextTick(() => trigger.value?.focus());
        return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    void focusOption(nextIndex);
};

const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!root.value?.contains(event.target as Node)) open.value = false;
};

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown));
</script>

<template>
    <div ref="root" class="nation-color-select">
        <button
            :id="id"
            ref="trigger"
            type="button"
            class="nation-color-select-trigger"
            :style="optionStyle(selectedOption)"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :aria-controls="`${id}-options`"
            @click="toggleOpen"
            @keydown="handleTriggerKeydown"
        >
            <span>{{ selectedOption?.label ?? '색상 선택' }}</span>
            <span class="nation-color-select-arrow" aria-hidden="true">▾</span>
        </button>
        <div v-if="open" :id="`${id}-options`" class="nation-color-select-options" role="listbox">
            <button
                v-for="(option, index) in options"
                :key="String(option.value)"
                type="button"
                class="nation-color-select-option"
                role="option"
                :aria-selected="option.value === modelValue"
                :data-color-option-index="index"
                :style="optionStyle(option)"
                @click="selectOption(option)"
                @keydown="handleOptionKeydown($event, index)"
            >
                <span>{{ option.label }}</span>
                <span v-if="option.value === modelValue" aria-hidden="true">✓</span>
            </button>
        </div>
    </div>
</template>

<style scoped>
.nation-color-select {
    position: relative;
    min-width: 0;
    margin: 4px 6px 4px 0;
}

.nation-color-select-trigger,
.nation-color-select-option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    width: 100%;
    border: 1px solid rgba(201, 164, 90, 0.45);
    padding: 5px 6px;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.nation-color-select-trigger {
    min-height: 28px;
}

.nation-color-select-trigger:hover,
.nation-color-select-trigger[aria-expanded='true'] {
    border-color: rgba(244, 216, 153, 0.9);
}

.nation-color-select-trigger:focus-visible,
.nation-color-select-option:focus-visible {
    position: relative;
    z-index: 1;
    outline: 2px solid #fff;
    outline-offset: -3px;
}

.nation-color-select-arrow {
    margin-left: 8px;
}

.nation-color-select-options {
    position: absolute;
    z-index: 60;
    top: calc(100% + 2px);
    right: 0;
    left: 0;
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid rgba(201, 164, 90, 0.7);
    background: #111;
    box-shadow: 0 5px 14px rgb(0 0 0 / 75%);
}

.nation-color-select-option {
    min-height: 34px;
    border: 0;
    border-bottom: 1px solid rgb(0 0 0 / 30%);
}

.nation-color-select-option:hover,
.nation-color-select-option[aria-selected='true'] {
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 78%);
}

@media (max-width: 520px) {
    .nation-color-select-options {
        position: static;
        margin-top: 2px;
    }

    .nation-color-select-option {
        min-height: 44px;
    }
}
</style>
