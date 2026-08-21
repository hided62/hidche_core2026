<script setup lang="ts">
defineProps<{
    title: string;
    description?: string | null;
    testId?: string;
}>();
</script>

<template>
    <span
        class="directory-tooltip"
        :class="{ 'directory-tooltip--enabled': description }"
        :tabindex="description ? 0 : undefined"
        :data-directory-tooltip="testId"
    >
        <slot />
        <span v-if="description" class="directory-tooltip__content" role="tooltip">
            <strong>{{ title }}</strong>
            <span>{{ description }}</span>
        </span>
    </span>
</template>

<style scoped>
.directory-tooltip {
    position: relative;
    display: inline;
    min-width: 0;
}
.directory-tooltip--enabled {
    cursor: help;
    text-decoration: underline dotted rgb(150 210 255 / 85%);
    text-underline-offset: 2px;
}
.directory-tooltip--enabled:focus-visible {
    border-radius: 2px;
    outline: 1px solid #6fc7ff;
    outline-offset: 1px;
}
.directory-tooltip__content {
    display: none;
    position: absolute;
    z-index: 30;
    left: 50%;
    bottom: calc(100% + 5px);
    box-sizing: border-box;
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    transform: translateX(-50%);
    border: 1px solid #8c8c8c;
    border-radius: 3px;
    padding: 7px 9px;
    background: #101010;
    box-shadow: 0 3px 12px rgb(0 0 0 / 65%);
    color: #f5f5f5;
    font-family: var(--sammo-font-sans);
    font-size: 12.5px;
    font-weight: 400;
    line-height: 1.45;
    text-align: left;
    white-space: normal;
    word-break: keep-all;
}
.directory-tooltip__content strong,
.directory-tooltip__content span {
    display: block;
}
.directory-tooltip__content strong {
    margin-bottom: 4px;
    color: #7fd4ff;
    font-size: 13px;
}
.directory-tooltip--enabled:hover > .directory-tooltip__content,
.directory-tooltip--enabled:focus > .directory-tooltip__content {
    display: block;
}

@media (max-width: 600px) {
    .directory-tooltip__content {
        position: fixed;
        right: 8px;
        bottom: 8px;
        left: 8px;
        width: auto;
        max-width: none;
        transform: none;
    }
}
</style>
