<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminConsoleLayout from '../layouts/AdminConsoleLayout.vue';
import { useAuthStore } from '../stores/auth';
import { trpc } from '../utils/trpc';

const auth = useAuthStore();
const capabilities = ref<string[]>([]);
const profileCount = ref(0);
const adminClient = trpc.admin as unknown as {
    capabilities: { list: { query: () => Promise<Array<{ permission: string }>> } };
    profiles: { list: { query: () => Promise<unknown[]> } };
};
const isRootAdmin = computed(() =>
    (auth.user?.roles ?? []).some((role) => role === 'superuser' || role === 'admin' || role === 'admin.superuser')
);
const hasCapability = (permission: string): boolean => isRootAdmin.value || capabilities.value.includes(permission);

const sections = computed(
    () =>
        [
            {
                to: '/admin/users',
                eyebrow: 'Accounts',
                title: '사용자 관리',
                description: '계정 조회와 생성, 인증 유예, 권한, 제재, 복구 및 탈퇴 예약을 관리합니다.',
                tone: 'blue',
                visible: hasCapability('admin.users.manage') || hasCapability('admin.users.create'),
            },
            {
                to: '/admin/servers',
                eyebrow: 'Profiles',
                title: '서버 관리',
                description: '프로필별 공개 정보, 계정 정책, 실행 상태와 게임 운영 동작을 관리합니다.',
                tone: 'emerald',
                visible: isRootAdmin.value || profileCount.value > 0,
            },
            {
                to: '/admin/releases',
                eyebrow: 'Releases',
                title: 'Gateway 릴리스',
                description: 'Gateway API·frontend·orchestrator 배포와 rollback을 별도 제어면에서 관리합니다.',
                tone: 'violet',
                visible: hasCapability('admin.releases.manage'),
            },
            {
                to: '/admin/system',
                eyebrow: 'System',
                title: '공지 · 접속',
                description: '로비 공지와 관리자 세션 연결 상태처럼 Gateway 공통 설정을 관리합니다.',
                tone: 'amber',
                visible: hasCapability('admin.notice.manage'),
            },
            {
                to: '/admin/audit',
                eyebrow: 'Audit',
                title: '감사 로그',
                description: '누가 어떤 관리자 조치를 수행했는지 결과와 대상, 사유를 추적합니다.',
                tone: 'zinc',
                visible: hasCapability('admin.audit.read'),
            },
        ] as const
);

onMounted(async () => {
    try {
        capabilities.value = (await adminClient.capabilities.list.query()).map((entry) => entry.permission);
    } catch {
        capabilities.value = [];
    }
    try {
        profileCount.value = (await adminClient.profiles.list.query()).length;
    } catch {
        profileCount.value = 0;
    }
});
</script>

<template>
    <AdminConsoleLayout title="운영 개요" description="관리 대상을 선택하세요." eyebrow="Admin workspace">
        <section class="overview-grid" aria-label="관리 기능">
            <RouterLink
                v-for="section in sections.filter((entry) => entry.visible)"
                :key="section.to"
                :to="section.to"
                class="overview-card"
                :class="`tone-${section.tone}`"
            >
                <span>{{ section.eyebrow }}</span>
                <h2>{{ section.title }}</h2>
                <p>{{ section.description }}</p>
                <strong>열기 →</strong>
            </RouterLink>
        </section>
    </AdminConsoleLayout>
</template>

<style scoped>
.overview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
}

.overview-card {
    min-height: 190px;
    border: 1px solid #27272a;
    border-radius: 10px;
    background: #111113;
    padding: 22px;
    color: #fafafa;
    text-decoration: none;
    transition:
        border-color 140ms ease,
        transform 140ms ease,
        background-color 140ms ease;
}

.overview-card:hover,
.overview-card:focus-visible {
    border-color: var(--accent);
    background: #18181b;
    outline: none;
    transform: translateY(-2px);
}

.overview-card > span {
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
}

.overview-card h2 {
    margin: 15px 0 9px;
    font-size: 19px;
}

.overview-card p {
    min-height: 58px;
    margin: 0 0 20px;
    color: #a1a1aa;
    font-size: 12px;
    line-height: 1.65;
}

.overview-card strong {
    color: #d4d4d8;
    font-size: 12px;
}

.tone-blue {
    --accent: #60a5fa;
}

.tone-emerald {
    --accent: #34d399;
}

.tone-violet {
    --accent: #a78bfa;
}

.tone-amber {
    --accent: #fbbf24;
}

.tone-zinc {
    --accent: #a1a1aa;
}

@media (max-width: 700px) {
    .overview-grid {
        grid-template-columns: 1fr;
    }

    .overview-card {
        min-height: 0;
    }

    .overview-card p {
        min-height: 0;
    }
}
</style>
