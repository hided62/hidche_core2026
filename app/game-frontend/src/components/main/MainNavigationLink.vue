<script setup lang="ts">
import { computed } from 'vue';
import type { MainNavigationLink } from './mainNavigation';

const props = withDefaults(
    defineProps<{
        link: MainNavigationLink;
        enabled?: boolean;
        compact?: boolean;
        active?: boolean;
        lumenVariant?: 'navigation' | 'lumen';
    }>(),
    {
        enabled: true,
        compact: false,
        active: false,
        lumenVariant: undefined,
    }
);

const emit = defineEmits<{
    navigate: [];
}>();

const label = computed(() => (props.compact ? (props.link.compactLabel ?? props.link.label) : props.link.label));
const rel = computed(() => (props.link.newTab ? 'noopener noreferrer' : undefined));
const lumenClasses = computed(() =>
    props.lumenVariant ? ['legacy-button', `legacy-button--${props.lumenVariant}`] : []
);
</script>

<template>
    <RouterLink
        v-if="enabled && link.to"
        class="main-menu-link"
        :class="[lumenClasses, { highlight: active }]"
        :to="link.to"
        :target="link.newTab ? '_blank' : undefined"
        :rel="rel"
        :data-navigation-id="link.id"
        @click="emit('navigate')"
    >
        {{ label }}
    </RouterLink>
    <a
        v-else-if="enabled && link.href"
        class="main-menu-link"
        :class="[lumenClasses, { highlight: active }]"
        :href="link.href"
        :target="link.newTab ? '_blank' : undefined"
        :rel="rel"
        :data-navigation-id="link.id"
        @click="emit('navigate')"
    >
        {{ label }}
    </a>
    <span
        v-else
        class="main-menu-link disabled"
        :class="lumenClasses"
        role="link"
        aria-disabled="true"
        :title="link.unavailableReason"
        :data-navigation-id="link.id"
    >
        {{ label }}
    </span>
</template>

<style>
.main-menu-link,
.main-menu-button {
    box-sizing: border-box;
    display: flex;
    min-width: 0;
    min-height: 31px;
    align-items: center;
    justify-content: center;
    border: 1px solid #1f1712;
    border-radius: 3px;
    padding: 6px 12px;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
    color: #fff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.5;
    text-align: center;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
}

.main-menu-link:hover,
.main-menu-link:focus-visible,
.main-menu-button:hover,
.main-menu-button:focus-visible {
    border-color: #6f5140;
    color: #fff;
    filter: brightness(1.14);
    outline: 2px solid transparent;
}

.main-menu-link:active,
.main-menu-button:active,
.main-menu-button[aria-expanded='true'] {
    filter: brightness(0.82);
}

.main-menu-link.highlight,
.main-menu-button.highlight {
    color: magenta;
}

.main-menu-link.disabled,
.main-menu-button:disabled {
    pointer-events: none;
    cursor: not-allowed;
    filter: none;
    opacity: 0.65;
}
</style>
