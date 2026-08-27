<script setup lang="ts">
import { useGameServerConnectionRecovery } from '../../composables/useGameServerConnectionRecovery';

const { reconnecting } = useGameServerConnectionRecovery();
</script>

<template>
    <div
        v-if="reconnecting"
        class="game-server-connection-notice"
        data-testid="game-server-connection-notice"
        role="status"
        aria-live="polite"
    >
        서버 연결이 잠시 끊겼습니다. 화면을 유지한 채 자동으로 다시 연결합니다.
    </div>
</template>

<style scoped>
.game-server-connection-notice {
    position: fixed;
    z-index: 1100;
    top: 0;
    left: 50%;
    box-sizing: border-box;
    width: min(100%, 520px);
    padding: 7px 12px;
    transform: translateX(-50%);
    border: 1px solid #a67c00;
    border-top: 0;
    background: #fff3bf;
    color: #3d3100;
    font: 13px/1.45 var(--sammo-font-sans);
    text-align: center;
    box-shadow: 0 2px 6px rgb(0 0 0 / 25%);
}
</style>
