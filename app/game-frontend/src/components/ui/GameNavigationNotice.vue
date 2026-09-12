<script setup lang="ts">
import { routeNavigation } from '../../utils/routeNavigation';
</script>

<template>
    <aside
        v-if="routeNavigation.state !== 'idle'"
        class="game-navigation-notice"
        role="status"
        aria-live="polite"
        data-testid="game-navigation-notice"
    >
        <span v-if="routeNavigation.state === 'loading'">화면을 여는 중입니다.</span>
        <template v-else>
            <span v-if="routeNavigation.state === 'failed'">화면을 불러오지 못했습니다.</span>
            <span v-else>화면을 여는 데 시간이 걸리고 있습니다.</span>
            <a :href="routeNavigation.href">이 페이지 다시 열기</a>
        </template>
    </aside>
</template>

<style scoped>
.game-navigation-notice {
    position: fixed;
    z-index: 2050;
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: max-content;
    max-width: calc(100vw - 24px);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 16px;
    padding: 12px 16px;
    border: 1px solid #8a7765;
    border-radius: 6px;
    background: #251b15;
    color: #fff;
}
.game-navigation-notice a {
    color: #ffd59a;
    text-decoration: underline;
}
</style>
