<script setup lang="ts">
interface Props {
    title: string;
    subtitle?: string;
}

defineProps<Props>();
</script>

<template>
    <section class="panel-card">
        <header class="panel-header">
            <div>
                <h2 class="panel-title">{{ title }}</h2>
                <p v-if="subtitle" class="panel-subtitle">{{ subtitle }}</p>
            </div>
            <div class="panel-actions">
                <slot name="actions" />
            </div>
        </header>
        <div class="panel-body">
            <slot />
        </div>
    </section>
</template>

<style scoped>
.panel-card {
    border: 1px solid gray;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px solid gray;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
    padding: 3px 6px;
}

.panel-title {
    margin: 0;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
}

.panel-subtitle {
    margin: 1px 0 0;
    color: #ccc;
    font-size: 11px;
}

.panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.panel-body {
    padding: 6px;
    color: #fff;
    font-size: 14px;
}
</style>
