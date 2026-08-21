<script setup lang="ts">
import { computed } from 'vue';

import DirectoryTooltip from './DirectoryTooltip.vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: number;
        injury: number;
        bonus?: number;
        testId?: string;
    }>(),
    { bonus: 0, testId: undefined }
);

const displayedValue = computed(() =>
    props.injury > 0 ? Math.trunc((props.value * (100 - props.injury)) / 100) : props.value
);
const injuryDescription = computed(() =>
    props.injury > 0
        ? `부상 ${props.injury}% · 원래 ${props.label} ${props.value} → 적용 ${displayedValue.value}`
        : null
);
</script>

<template>
    <DirectoryTooltip :title="`${label} 부상`" :description="injuryDescription" :test-id="testId">
        <span :class="{ wounded: injury > 0 }">{{ displayedValue }}</span>
    </DirectoryTooltip>
    <span v-if="bonus > 0" class="leadership-bonus">+{{ bonus }}</span>
</template>

<style scoped>
.wounded {
    color: red;
}
.leadership-bonus {
    color: cyan;
}
</style>
