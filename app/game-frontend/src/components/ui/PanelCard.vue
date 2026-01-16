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
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(12, 12, 12, 0.8);
    padding: 12px;
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.3);
    padding-bottom: 8px;
    margin-bottom: 10px;
}

.panel-title {
    font-size: 1rem;
    font-weight: 600;
    color: #e8ddc4;
    letter-spacing: 0.02em;
}

.panel-subtitle {
    margin-top: 4px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.panel-body {
    font-size: 0.9rem;
    color: rgba(232, 221, 196, 0.9);
}
</style>
