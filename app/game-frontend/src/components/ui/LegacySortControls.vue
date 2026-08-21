<script setup lang="ts">
defineProps<{
    controlId: string;
    modelValue: number;
    options: ReadonlyArray<{ value: number; label: string }>;
    busy?: boolean;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: number];
    submit: [];
}>();

const updateValue = (event: Event): void => {
    const value = Number((event.target as HTMLSelectElement).value);
    emit('update:modelValue', value);
};
</script>

<template>
    <form class="legacy-sort-form" @submit.prevent="emit('submit')">
        <label :for="controlId">정렬순서 :</label>
        <select
            :id="controlId"
            class="legacy-sort-select"
            name="type"
            size="1"
            :value="modelValue"
            @change="updateValue"
        >
            <option v-for="option in options" :key="option.value" :value="option.value">
                {{ option.label }}
            </option>
        </select>
        <button class="legacy-sort-submit" type="submit" :aria-busy="busy || undefined">정렬하기</button>
    </form>
</template>
