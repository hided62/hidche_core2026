<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue';
import tippy, { type Instance, type Placement } from 'tippy.js';
import 'tippy.js/dist/tippy.css';

const props = withDefaults(
    defineProps<{
        title?: string;
        description?: string | readonly string[] | null;
        placement?: Placement;
        maxWidth?: number;
        testId?: string;
    }>(),
    {
        title: '',
        description: null,
        placement: 'top',
        maxWidth: 360,
        testId: undefined,
    }
);

const slots = useSlots();
const triggerElement = ref<HTMLElement | null>(null);
const contentElement = ref<HTMLElement | null>(null);
let instance: Instance | null = null;

const descriptionLines = computed(() => {
    const source = Array.isArray(props.description) ? props.description : [props.description ?? ''];
    return source
        .flatMap((line) => line.split(/<br\s*\/?\s*>|\r?\n/giu))
        .map((line) => line.trim())
        .filter(Boolean);
});

const hasContent = computed(() => Boolean(slots.content) || descriptionLines.value.length > 0);

const destroyTooltip = () => {
    instance?.destroy();
    instance = null;
};

const installTooltip = async () => {
    destroyTooltip();
    await nextTick();
    if (!hasContent.value || !triggerElement.value || !contentElement.value) return;

    instance = tippy(triggerElement.value, {
        allowHTML: true,
        appendTo: () => document.body,
        content: () => contentElement.value?.innerHTML ?? '',
        maxWidth: props.maxWidth,
        placement: props.placement,
        theme: 'sammo-rich',
        trigger: 'mouseenter focus',
    });
};

onMounted(() => void installTooltip());
onBeforeUnmount(destroyTooltip);
watch(
    () => [props.title, props.description, props.placement, props.maxWidth],
    () => void installTooltip(),
    { deep: true }
);
</script>

<template>
    <span
        ref="triggerElement"
        class="rich-tooltip-trigger"
        :class="{ 'rich-tooltip-trigger--enabled': hasContent }"
        :tabindex="hasContent ? 0 : undefined"
        :data-rich-tooltip="props.testId"
    >
        <slot />
    </span>
    <span ref="contentElement" class="rich-tooltip-template" hidden aria-hidden="true">
        <slot name="content" :description-lines="descriptionLines">
            <span v-if="props.title" class="rich-tooltip-content__title">{{ props.title }}</span>
            <span
                v-for="(line, index) in descriptionLines"
                :key="`${index}:${line}`"
                class="rich-tooltip-content__line"
            >
                {{ line }}
            </span>
        </slot>
    </span>
</template>

<style>
.rich-tooltip-trigger {
    display: inline;
    min-width: 0;
}

.rich-tooltip-trigger--enabled {
    cursor: help;
    text-decoration: underline dotted rgb(150 210 255 / 85%);
    text-underline-offset: 2px;
}

.rich-tooltip-trigger--enabled:focus-visible {
    border-radius: 2px;
    outline: 1px solid #6fc7ff;
    outline-offset: 1px;
}

.tippy-box[data-theme~='sammo-rich'] {
    border: 1px solid #8c8c8c;
    border-radius: 3px;
    background: #101010;
    box-shadow: 0 3px 12px rgb(0 0 0 / 65%);
    color: #f5f5f5;
    font-family: var(--sammo-font-sans);
    font-size: 12.5px;
    line-height: 1.45;
    text-align: left;
}

.tippy-box[data-theme~='sammo-rich'][data-placement^='top'] > .tippy-arrow::before {
    border-top-color: #101010;
}

.tippy-box[data-theme~='sammo-rich'][data-placement^='bottom'] > .tippy-arrow::before {
    border-bottom-color: #101010;
}

.tippy-box[data-theme~='sammo-rich'][data-placement^='left'] > .tippy-arrow::before {
    border-left-color: #101010;
}

.tippy-box[data-theme~='sammo-rich'][data-placement^='right'] > .tippy-arrow::before {
    border-right-color: #101010;
}

.tippy-box[data-theme~='sammo-rich'] .tippy-content {
    padding: 7px 9px;
}

.rich-tooltip-content__title,
.rich-tooltip-content__line,
.rich-tooltip-content__section,
.rich-tooltip-content__meta {
    display: block;
}

.rich-tooltip-content__title {
    margin-bottom: 4px;
    color: #7fd4ff;
    font-size: 13px;
    font-weight: 700;
}

.rich-tooltip-content__line + .rich-tooltip-content__line {
    margin-top: 2px;
}

.rich-tooltip-content__section {
    margin-top: 5px;
    border-top: 1px solid #4d4d4d;
    padding-top: 4px;
    color: #ffdc76;
    font-weight: 700;
}

.rich-tooltip-content__meta {
    color: #d5d5d5;
}

.rich-tooltip-content__pros {
    color: cyan;
}

.rich-tooltip-content__cons {
    color: magenta;
}
</style>
