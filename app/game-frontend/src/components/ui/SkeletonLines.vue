<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        lines?: number;
    }>(),
    {
        lines: 3,
    }
);
</script>

<template>
    <div class="skeleton-lines">
        <div v-for="line in props.lines" :key="line" class="skeleton-line" />
    </div>
</template>

<style scoped>
.skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.skeleton-line {
    height: 10px;
    border-radius: 2px;
    background: linear-gradient(90deg, rgba(201, 164, 90, 0.15), rgba(201, 164, 90, 0.3), rgba(201, 164, 90, 0.15));
    background-size: 180% 100%;
    animation: shimmer 1.4s infinite ease-in-out;
}

@keyframes shimmer {
    0% {
        background-position: 0% 0;
    }
    100% {
        background-position: -180% 0;
    }
}
</style>
