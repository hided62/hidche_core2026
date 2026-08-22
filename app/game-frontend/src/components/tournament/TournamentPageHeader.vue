<script setup lang="ts">
defineProps<{
    activePage: 'tournament' | 'betting';
    title: string;
}>();

const closeWindow = (): void => window.close();
</script>

<template>
    <header class="tournament-page-header">
        <strong class="tournament-page-title">{{ title }}</strong>
        <div class="tournament-page-actions">
            <nav class="tournament-page-tabs" role="tablist" aria-label="토너먼트와 베팅장 이동">
                <RouterLink v-slot="{ navigate }" custom to="/tournament">
                    <button
                        type="button"
                        role="tab"
                        class="legacy-button legacy-button--dark legacy-button--fixed-height"
                        :aria-selected="activePage === 'tournament'"
                        :class="{ active: activePage === 'tournament' }"
                        @click="navigate"
                    >
                        토너먼트
                    </button>
                </RouterLink>
                <RouterLink v-slot="{ navigate }" custom to="/betting">
                    <button
                        type="button"
                        role="tab"
                        class="legacy-button legacy-button--dark legacy-button--fixed-height"
                        :aria-selected="activePage === 'betting'"
                        :class="{ active: activePage === 'betting' }"
                        @click="navigate"
                    >
                        베팅장
                    </button>
                </RouterLink>
            </nav>
            <button
                class="legacy-button legacy-button--navigation legacy-button--fixed-height close-button"
                type="button"
                @click="closeWindow"
            >
                창 닫기
            </button>
        </div>
    </header>
</template>

<style scoped>
.tournament-page-header {
    display: flex;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 4px;
}
.tournament-page-title {
    min-width: 0;
    overflow: hidden;
    font-size: 16px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tournament-page-actions,
.tournament-page-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
}
button {
    --legacy-button-height: 44px;
    margin: 0;
    font-size: 14px;
}
.tournament-page-tabs button {
    min-width: 72px;
    padding: 10px 12px;
}
.tournament-page-tabs button.active {
    --legacy-button-bg: #8a5b13;
    --legacy-button-border: #704a0f;
}
.close-button {
    width: 88px;
    padding: 10px 16px;
}
button:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}
@media (max-width: 800px) {
    .tournament-page-header {
        gap: 4px;
        padding-inline: 2px;
    }
    .tournament-page-title {
        font-size: 13px;
    }
    .tournament-page-actions,
    .tournament-page-tabs {
        gap: 2px;
    }
    .tournament-page-tabs button {
        min-width: 68px;
        padding-inline: 8px;
    }
}
</style>
