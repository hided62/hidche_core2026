<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

type PermissionCandidate = {
    id: number;
    name: string;
};

const props = withDefaults(
    defineProps<{
        modelValue: number[];
        candidates: PermissionCandidate[];
        label: string;
        max?: number;
    }>(),
    { max: 2 }
);

const emit = defineEmits<{
    'update:modelValue': [value: number[]];
    limit: [];
}>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const selectedCandidates = computed(() => {
    const selected = new Set(props.modelValue);
    return props.candidates.filter((candidate) => selected.has(candidate.id));
});

const toggleOpen = (): void => {
    open.value = !open.value;
};

const toggleCandidate = (id: number): void => {
    if (props.modelValue.includes(id)) {
        emit(
            'update:modelValue',
            props.modelValue.filter((selectedId) => selectedId !== id)
        );
        return;
    }
    if (props.modelValue.length >= props.max) {
        emit('limit');
        return;
    }
    emit('update:modelValue', [...props.modelValue, id]);
};

const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!root.value?.contains(event.target as Node)) open.value = false;
};

const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
        event.preventDefault();
        open.value = false;
    }
};

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown));
</script>

<template>
    <div ref="root" class="permission-multiselect" @keydown="handleKeydown">
        <button
            type="button"
            class="permission-multiselect-trigger"
            :aria-label="`${label} 선택, 현재 ${modelValue.length}명`"
            aria-haspopup="listbox"
            :aria-expanded="open"
            @click="toggleOpen"
        >
            <span v-if="selectedCandidates.length" class="permission-multiselect-values">
                <span v-for="candidate in selectedCandidates" :key="candidate.id">{{ candidate.name }}</span>
            </span>
            <span v-else class="permission-multiselect-placeholder">선택 안 함</span>
            <span class="permission-multiselect-arrow" aria-hidden="true">▾</span>
        </button>
        <div
            v-if="open"
            class="permission-multiselect-options"
            role="listbox"
            aria-multiselectable="true"
            :aria-label="`${label} 후보`"
        >
            <button
                v-for="candidate in candidates"
                :key="candidate.id"
                type="button"
                class="permission-multiselect-option"
                role="option"
                :aria-selected="modelValue.includes(candidate.id)"
                @click="toggleCandidate(candidate.id)"
            >
                <span class="permission-multiselect-check" aria-hidden="true">
                    {{ modelValue.includes(candidate.id) ? '✓' : '' }}
                </span>
                <span>{{ candidate.name }}</span>
            </button>
            <p v-if="candidates.length === 0" class="permission-multiselect-empty">임명 가능한 장수가 없습니다.</p>
            <p class="permission-multiselect-help">클릭해서 선택·해제 · 최대 {{ max }}명</p>
        </div>
    </div>
</template>

<style scoped>
.permission-multiselect {
    position: relative;
    display: inline-block;
    width: 300px;
    max-width: calc(100% - 58px);
    vertical-align: middle;
}
.permission-multiselect-trigger {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    width: 100%;
    min-height: 34px;
    border: 1px solid #858585;
    border-radius: 4px;
    padding: 3px 7px;
    color: #fff;
    background: #000;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.permission-multiselect-trigger:hover,
.permission-multiselect-trigger[aria-expanded='true'] {
    border-color: #b9b9b9;
}
.permission-multiselect-trigger:focus-visible,
.permission-multiselect-option:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
}
.permission-multiselect-values {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    min-width: 0;
}
.permission-multiselect-values > span {
    overflow: hidden;
    max-width: 126px;
    border-radius: 3px;
    padding: 2px 5px;
    color: #fff;
    background: #4d4d4d;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.permission-multiselect-placeholder {
    color: #aaa;
}
.permission-multiselect-arrow {
    margin-left: 5px;
    color: #ccc;
}
.permission-multiselect-options {
    position: absolute;
    z-index: 40;
    top: calc(100% + 2px);
    left: 0;
    width: 100%;
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid #858585;
    border-radius: 3px;
    color: #fff;
    background: #101010;
    box-shadow: 0 5px 14px rgb(0 0 0 / 70%);
}
.permission-multiselect-option {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 5px;
    align-items: center;
    width: 100%;
    border: 0;
    border-bottom: 1px solid #353535;
    border-radius: 0;
    padding: 7px 8px;
    color: #fff;
    background: #101010;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.permission-multiselect-option:hover,
.permission-multiselect-option[aria-selected='true'] {
    background: #424242;
}
.permission-multiselect-check {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    border: 1px solid #aaa;
    border-radius: 2px;
    color: #111;
    background: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}
.permission-multiselect-empty,
.permission-multiselect-help {
    margin: 0;
    padding: 6px 8px;
    color: #bbb;
    font-size: 11px;
}
.permission-multiselect-help {
    border-top: 1px solid #454545;
}
@media (max-width: 620px) {
    .permission-multiselect {
        width: calc(100% - 54px);
        max-width: none;
    }
    .permission-multiselect-values > span {
        max-width: 82px;
    }
    .permission-multiselect-option {
        min-height: 38px;
    }
}
</style>
