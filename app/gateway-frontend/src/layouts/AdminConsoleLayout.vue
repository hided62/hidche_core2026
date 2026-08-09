<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import DefaultLayout from './DefaultLayout.vue';
import { useAuthStore } from '../stores/auth';
import { trpc } from '../utils/trpc';

defineProps<{
    title: string;
    description: string;
    eyebrow?: string;
}>();

const menuOpen = ref(false);
const auth = useAuthStore();
const adminClient = trpc.admin as unknown as {
    capabilities: { list: { query: () => Promise<Array<{ permission: string; scopes?: string[] }>> } };
    profiles: {
        list: {
            query: () => Promise<Array<{ profileName: string; profile: string; meta?: Record<string, unknown> }>>;
        };
    };
};
const capabilities = ref<Array<{ permission: string; scopes?: string[] }>>([]);
const profiles = ref<Array<{ profileName: string; profile: string; meta?: Record<string, unknown> }>>([]);

const isRootAdmin = computed(() =>
    (auth.user?.roles ?? []).some((role) => role === 'superuser' || role === 'admin' || role === 'admin.superuser')
);

const hasCapability = (permission: string): boolean =>
    isRootAdmin.value || capabilities.value.some((capability) => capability.permission === permission);

const hasAnyProfileCapability = computed(() =>
    capabilities.value.some(
        (capability) => capability.scopes?.length || capability.permission.startsWith('admin.profiles.')
    )
);

const profileLabel = (profile: (typeof profiles.value)[number]): string => {
    const korName = profile.meta?.korName;
    return typeof korName === 'string' && korName.trim() ? `${korName} (${profile.profileName})` : profile.profileName;
};

const navigation = computed(() => [
    {
        label: '관리',
        items: [
            { to: '/admin', label: '운영 개요', icon: '⌂', exact: true, visible: true, child: false },
            {
                to: '/admin/users',
                label: '사용자 관리',
                icon: '人',
                exact: false,
                visible: hasCapability('admin.users.manage') || hasCapability('admin.users.create'),
                child: false,
            },
        ],
    },
    {
        label: '서버 관리',
        items: [
            {
                to: '/admin/servers',
                label: '서버 목록',
                icon: '◫',
                exact: true,
                visible: isRootAdmin.value || hasAnyProfileCapability.value || profiles.value.length > 0,
                child: false,
            },
            ...profiles.value.map((profile) => ({
                to: `/admin/servers/${encodeURIComponent(profile.profileName)}`,
                label: profileLabel(profile),
                icon: '└',
                exact: false,
                visible: true,
                child: true,
            })),
        ],
    },
    {
        label: 'Gateway',
        items: [
            {
                to: '/admin/releases',
                label: 'Gateway 릴리스',
                icon: '↥',
                exact: false,
                visible: hasCapability('admin.releases.manage'),
                child: false,
            },
            {
                to: '/admin/system',
                label: '공지 · 접속',
                icon: '⚙',
                exact: false,
                visible: hasCapability('admin.notice.manage'),
                child: false,
            },
            {
                to: '/admin/audit',
                label: '감사 로그',
                icon: '≡',
                exact: false,
                visible: hasCapability('admin.audit.read'),
                child: false,
            },
        ],
    },
]);

onMounted(async () => {
    const [capabilityResult, profileResult] = await Promise.allSettled([
        adminClient.capabilities.list.query(),
        adminClient.profiles.list.query(),
    ]);
    capabilities.value = capabilityResult.status === 'fulfilled' ? capabilityResult.value : [];
    profiles.value = profileResult.status === 'fulfilled' ? profileResult.value : [];
});
</script>

<template>
    <DefaultLayout>
        <div class="admin-shell">
            <button
                class="admin-menu-button"
                type="button"
                :aria-expanded="menuOpen"
                aria-controls="admin-navigation"
                @click="menuOpen = !menuOpen"
            >
                <span>관리자 메뉴</span>
                <span aria-hidden="true">{{ menuOpen ? '닫기' : '열기' }}</span>
            </button>

            <aside id="admin-navigation" class="admin-sidebar" :class="{ open: menuOpen }">
                <div class="admin-identity">
                    <span class="admin-mark" aria-hidden="true">管</span>
                    <div>
                        <strong>관리자 콘솔</strong>
                        <span>Gateway control</span>
                    </div>
                </div>

                <nav aria-label="관리자 메뉴">
                    <section
                        v-for="group in navigation.filter((entry) => entry.items.some((item) => item.visible))"
                        :key="group.label"
                        class="admin-nav-group"
                    >
                        <h2>{{ group.label }}</h2>
                        <RouterLink
                            v-for="item in group.items.filter((entry) => entry.visible)"
                            :key="item.to"
                            :to="item.to"
                            class="admin-nav-link"
                            :class="{ child: item.child }"
                            :active-class="item.exact ? '' : 'active'"
                            :exact-active-class="item.exact ? 'active' : ''"
                            @click="menuOpen = false"
                        >
                            <span class="admin-nav-icon" aria-hidden="true">{{ item.icon }}</span>
                            <span>{{ item.label }}</span>
                        </RouterLink>
                    </section>
                </nav>

                <RouterLink class="admin-exit" to="/lobby">← 로비로 돌아가기</RouterLink>
            </aside>

            <main class="admin-content">
                <header class="admin-page-header">
                    <div>
                        <p>{{ eyebrow ?? 'Admin console' }}</p>
                        <h1>{{ title }}</h1>
                        <div class="admin-description">{{ description }}</div>
                    </div>
                    <div v-if="$slots.actions" class="admin-header-actions">
                        <slot name="actions" />
                    </div>
                </header>
                <slot />
            </main>
        </div>
    </DefaultLayout>
</template>

<style scoped>
.admin-shell {
    display: grid;
    width: min(1480px, 100%);
    min-height: calc(100vh - 56px);
    margin: 0 auto;
    grid-template-columns: 244px minmax(0, 1fr);
    padding-top: 56px;
    background: #09090b;
}

:deep(.gateway-navbar) {
    position: absolute;
}

.admin-sidebar {
    position: sticky;
    top: 56px;
    height: calc(100vh - 56px);
    border-right: 1px solid #27272a;
    background: #111113;
    padding: 24px 16px;
}

.admin-identity {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 28px;
    padding: 0 8px;
}

.admin-identity strong,
.admin-identity span {
    display: block;
}

.admin-identity strong {
    color: #fafafa;
    font-size: 15px;
}

.admin-identity div > span {
    margin-top: 2px;
    color: #71717a;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.admin-mark {
    display: grid;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    place-items: center;
    border: 1px solid #a16207;
    border-radius: 8px;
    background: #422006;
    color: #facc15;
    font-weight: 800;
}

.admin-nav-group {
    margin: 0 0 24px;
}

.admin-nav-group h2 {
    margin: 0 8px 7px;
    color: #71717a;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
}

.admin-nav-link {
    display: flex;
    min-height: 40px;
    align-items: center;
    gap: 10px;
    margin: 2px 0;
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 8px 10px;
    color: #a1a1aa;
    font-size: 13px;
    text-decoration: none;
    transition:
        border-color 120ms ease,
        background-color 120ms ease,
        color 120ms ease;
}

.admin-nav-link:hover,
.admin-nav-link:focus-visible {
    border-color: #3f3f46;
    background: #1c1c1f;
    color: #fafafa;
    outline: none;
}

.admin-nav-link.active {
    border-color: #713f12;
    background: #2d1b08;
    color: #fde68a;
}

.admin-nav-link.child {
    min-height: 34px;
    margin-left: 15px;
    padding-block: 5px;
    font-size: 12px;
}

.admin-nav-icon {
    width: 20px;
    color: #d4d4d8;
    font-family: sans-serif;
    font-size: 15px;
    text-align: center;
}

.admin-exit {
    position: absolute;
    right: 24px;
    bottom: 24px;
    left: 24px;
    border-top: 1px solid #27272a;
    padding-top: 17px;
    color: #71717a;
    font-size: 12px;
    text-decoration: none;
}

.admin-exit:hover,
.admin-exit:focus-visible {
    color: #e4e4e7;
}

.admin-content {
    min-width: 0;
    padding: 30px clamp(20px, 3vw, 44px) 56px;
}

.admin-page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
    border-bottom: 1px solid #27272a;
    padding-bottom: 22px;
}

.admin-page-header p {
    margin: 0 0 7px;
    color: #ca8a04;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
}

.admin-page-header h1 {
    margin: 0;
    color: #fafafa;
    font-size: clamp(25px, 3vw, 34px);
    line-height: 1.2;
}

.admin-description {
    margin-top: 8px;
    color: #a1a1aa;
    font-size: 13px;
    line-height: 1.6;
}

.admin-header-actions {
    flex: 0 0 auto;
}

.admin-menu-button {
    display: none;
}

@media (max-width: 860px) {
    .admin-shell {
        display: block;
        padding-top: 72px;
    }

    .admin-menu-button {
        position: absolute;
        z-index: 20;
        top: 72px;
        right: 16px;
        left: 16px;
        display: flex;
        min-height: 44px;
        align-items: center;
        justify-content: space-between;
        border: 1px solid #3f3f46;
        border-radius: 8px;
        background: #18181b;
        padding: 10px 14px;
        color: #f4f4f5;
        font-size: 13px;
    }

    .admin-sidebar {
        position: absolute;
        z-index: 19;
        top: 124px;
        right: 16px;
        left: 16px;
        display: none;
        width: auto;
        height: auto;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        box-shadow: 0 20px 45px rgb(0 0 0 / 55%);
        padding: 18px 14px 14px;
    }

    .admin-sidebar.open {
        display: block;
    }

    .admin-identity {
        margin-bottom: 18px;
    }

    .admin-nav-group {
        margin-bottom: 14px;
    }

    .admin-exit {
        position: static;
        display: block;
        margin: 16px 8px 0;
    }

    .admin-content {
        padding: 76px 16px 40px;
    }

    .admin-page-header {
        align-items: flex-start;
        flex-direction: column;
        gap: 14px;
    }
}
</style>
