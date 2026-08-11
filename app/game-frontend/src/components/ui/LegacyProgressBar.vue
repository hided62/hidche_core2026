<script setup lang="ts">
import { computed } from 'vue';
import { configuredGameAssetUrl } from '../../utils/imageAssets';
import { clampPercent } from '../../utils/legacyProgress';

const props = withDefaults(
    defineProps<{
        percent: number;
        height?: 7 | 10;
        label?: string;
        variant?: 'overall' | 'grade';
    }>(),
    { height: 10, label: undefined, variant: 'overall' }
);

const imageHeight = computed(() => props.height - 2);
const normalizedPercent = computed(() => clampPercent(props.percent));
const fallbackLabel = computed(
    () => `${normalizedPercent.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
);
const assetRoot = configuredGameAssetUrl();
</script>

<template>
    <div
        class="legacy-progress"
        :class="`legacy-progress--${props.variant}`"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Number(normalizedPercent.toFixed(1))"
        :aria-label="props.label ?? fallbackLabel"
        :title="props.label ?? fallbackLabel"
        :style="{
            height: `${props.height + 2}px`,
            backgroundImage: `url('${assetRoot}/pr${imageHeight}.gif')`,
        }"
    >
        <span
            class="legacy-progress__fill"
            :style="{
                width: `${normalizedPercent}%`,
                backgroundImage: `url('${assetRoot}/pb${imageHeight}.gif')`,
            }"
        />
    </div>
</template>

<style scoped>
.legacy-progress {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    overflow: hidden;
    border-top: 1px solid #888;
    border-bottom: 1px solid #333;
    background-position: left center;
    background-repeat: repeat-x;
}

.legacy-progress__fill {
    position: absolute;
    inset: 0 auto 0 0;
    background-position: left center;
    background-repeat: repeat-x;
}

.legacy-progress--grade {
    opacity: 0.82;
}
</style>
