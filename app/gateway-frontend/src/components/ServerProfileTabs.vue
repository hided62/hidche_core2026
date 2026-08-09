<script setup lang="ts">
import { computed } from 'vue';

type ServerProfileTab = 'status' | 'version' | 'scenario';

const props = defineProps<{
    profileName: string;
    activeTab: ServerProfileTab;
    canDeploy: boolean;
    canReset: boolean;
}>();

const tabs = computed(() =>
    [
        {
            id: 'status' as const,
            label: '상태 설정',
            to: `/admin/servers/${encodeURIComponent(props.profileName)}`,
            visible: true,
        },
        {
            id: 'version' as const,
            label: '버전 업데이트',
            to: `/admin/servers/${encodeURIComponent(props.profileName)}/version`,
            visible: props.canDeploy,
        },
        {
            id: 'scenario' as const,
            label: '시나리오 초기화',
            to: `/admin/servers/${encodeURIComponent(props.profileName)}/scenario`,
            visible: props.canReset,
        },
    ].filter((tab) => tab.visible)
);
</script>

<template>
    <nav
        class="server-profile-tabs"
        :style="{ '--server-tab-count': tabs.length }"
        :aria-label="`${profileName} 서버 관리 탭`"
        data-testid="server-profile-tabs"
    >
        <RouterLink
            v-for="tab in tabs"
            :key="tab.id"
            :to="tab.to"
            class="server-profile-tab"
            :class="{ active: activeTab === tab.id }"
            :aria-current="activeTab === tab.id ? 'page' : undefined"
        >
            {{ tab.label }}
        </RouterLink>
    </nav>
</template>

<style scoped>
.server-profile-tabs {
    display: grid;
    grid-template-columns: repeat(var(--server-tab-count), minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border: 1px solid #3f3f46;
    border-radius: 12px;
    background: #09090b;
    box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
}

.server-profile-tab {
    display: flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 10px 14px;
    color: #d4d4d8;
    font-size: 0.875rem;
    font-weight: 700;
    line-height: 1.25rem;
    text-align: center;
    transition:
        border-color 140ms ease,
        background-color 140ms ease,
        color 140ms ease;
}

.server-profile-tab:hover,
.server-profile-tab:focus-visible {
    border-color: #71717a;
    background: #27272a;
    color: #fff;
    outline: none;
}

.server-profile-tab.active {
    border-color: #a78bfa;
    background: #4c1d95;
    color: #f5f3ff;
    box-shadow: inset 0 0 0 1px rgb(196 181 253 / 20%);
}

@media (max-width: 520px) {
    .server-profile-tabs {
        grid-template-columns: 1fr;
    }
}
</style>
