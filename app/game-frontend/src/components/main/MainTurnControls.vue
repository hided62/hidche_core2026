<script setup lang="ts">
import GatewayLobbyLink from './GatewayLobbyLink.vue';

defineProps<{
    realtimeEnabled: boolean;
    refreshing: boolean;
}>();

const emit = defineEmits<{
    refresh: [];
    toggleRealtime: [];
}>();
</script>

<template>
    <section class="main-turn-controls" aria-label="메인 갱신 및 이동">
        <div class="main-turn-controls__refresh-pair legacy-split-button">
            <button
                class="main-turn-controls__manual legacy-split-button__main legacy-button legacy-button--navigation"
                type="button"
                :aria-busy="refreshing"
                @click="emit('refresh')"
            >
                갱 신
            </button>
            <button
                class="main-turn-controls__auto legacy-split-button__toggle legacy-button legacy-button--navigation"
                :class="{ active: realtimeEnabled }"
                type="button"
                :aria-label="`자동 갱신 ${realtimeEnabled ? 'ON' : 'OFF'}`"
                :aria-pressed="realtimeEnabled"
                @click="emit('toggleRealtime')"
            >
                <span>자동 갱신</span>
                <strong>{{ realtimeEnabled ? 'ON' : 'OFF' }}</strong>
            </button>
        </div>
        <GatewayLobbyLink
            class="main-turn-controls__lobby legacy-button legacy-button--navigation"
        >
            로비로
        </GatewayLobbyLink>
    </section>
</template>

<style scoped>
.main-turn-controls {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 4px;
    margin-top: 4px;
}

.main-turn-controls__refresh-pair {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
}

.main-turn-controls .legacy-button {
    width: 100%;
    min-width: 0;
    padding-right: 4px;
    padding-left: 4px;
    font-weight: 400;
    white-space: nowrap;
}

.main-turn-controls__auto {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
}

.main-turn-controls__auto strong {
    color: #bbb;
    font-size: 0.85em;
}

.main-turn-controls__auto.active strong {
    color: #9ef0b8;
}
</style>
