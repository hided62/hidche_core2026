<script setup lang="ts">
import { useId } from 'vue';

const props = defineProps<{
    label: string;
    text: string;
    testId?: string;
}>();

const tooltipId = useId();
</script>

<template>
    <span class="group relative inline-flex shrink-0 align-middle">
        <button
            type="button"
            class="inline-flex size-[18px] items-center justify-center rounded-full border border-zinc-600 bg-zinc-900 text-[11px] font-bold leading-none text-zinc-300 transition-colors duration-100 hover:border-sky-400 hover:text-sky-200 focus-visible:border-sky-400 focus-visible:text-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            :aria-label="`${props.label} 도움말`"
            :aria-describedby="tooltipId"
            :data-testid="props.testId"
        >
            ?
        </button>
        <span
            :id="tooltipId"
            role="tooltip"
            class="compact-help-tooltip pointer-events-none invisible absolute left-0 top-[calc(100%+0.4rem)] z-40 w-72 max-w-[calc(100vw-2rem)] rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-left text-xs font-normal leading-5 text-zinc-100 opacity-0 shadow-xl transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
            :data-testid="props.testId ? `${props.testId}-tooltip` : undefined"
        >
            {{ props.text }}
        </span>
    </span>
</template>

<style scoped>
@media (max-width: 639px) {
    .compact-help-tooltip {
        position: fixed;
        inset: auto 1rem 1rem;
        width: auto;
        max-width: none;
        z-index: 60;
    }
}
</style>
