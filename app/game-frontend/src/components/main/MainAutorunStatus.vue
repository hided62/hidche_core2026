<script setup lang="ts">
import { computed } from 'vue';
import { formatAutorunUserDetail, type AutorunUserSummary } from '../../utils/autorunUser';

const props = defineProps<{
    autorun: AutorunUserSummary | null;
}>();

const detail = computed(() => (props.autorun ? formatAutorunUserDetail(props.autorun) : ''));
</script>

<template>
    <span
        class="main-autorun-status"
        :class="{ 'main-autorun-status--enabled': autorun }"
        :tabindex="autorun ? 0 : undefined"
        :aria-describedby="autorun ? 'main-autorun-detail' : undefined"
        data-main-autorun-status
    >
        기타 설정: {{ autorun ? '자율행동' : '표준' }}
        <span v-if="autorun" id="main-autorun-detail" class="main-autorun-detail" role="tooltip">
            {{ detail }}
        </span>
    </span>
</template>

<style scoped>
.main-autorun-status {
    position: relative;
}

.main-autorun-status--enabled {
    cursor: help;
}

.main-autorun-detail {
    position: absolute;
    z-index: 40;
    top: calc(100% + 6px);
    right: 4px;
    visibility: hidden;
    box-sizing: border-box;
    width: max-content;
    max-width: min(520px, calc(100vw - 32px));
    padding: 6px 8px;
    border: 1px solid #52525b;
    border-radius: 4px;
    background: #18181b;
    box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
    color: #f4f4f5;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    opacity: 0;
    pointer-events: none;
    text-align: left;
    white-space: normal;
}

.main-autorun-status--enabled:hover .main-autorun-detail,
.main-autorun-status--enabled:focus-visible .main-autorun-detail {
    visibility: visible;
    opacity: 1;
}

.main-autorun-status--enabled:focus-visible {
    outline: 2px solid #fdba74;
    outline-offset: -2px;
}

@media (max-width: 939.98px) {
    .main-autorun-detail {
        position: fixed;
        z-index: 100;
        top: auto;
        right: 16px;
        bottom: 61px;
        left: 16px;
        width: auto;
        max-width: none;
    }
}
</style>
