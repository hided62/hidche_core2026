<script setup lang="ts">
import AdminConsoleLayout from '../layouts/AdminConsoleLayout.vue';

const sections = [
    {
        to: '/admin/users',
        eyebrow: 'Accounts',
        title: '사용자 관리',
        description: '계정 조회와 생성, 인증 유예, 권한, 제재, 복구 및 탈퇴 예약을 관리합니다.',
        tone: 'blue',
    },
    {
        to: '/admin/servers',
        eyebrow: 'Profiles',
        title: '서버 관리',
        description: '프로필별 공개 정보, 계정 정책, 실행 상태와 게임 운영 동작을 관리합니다.',
        tone: 'emerald',
    },
    {
        to: '/admin/releases',
        eyebrow: 'Releases',
        title: '버전 업데이트',
        description: '프로필 DB 유지·초기화 배포와 Gateway 릴리스, rollback 및 작업 이력을 확인합니다.',
        tone: 'violet',
    },
    {
        to: '/admin/system',
        eyebrow: 'System',
        title: '공지 · 접속',
        description: '로비 공지와 관리자 세션 연결 상태처럼 Gateway 공통 설정을 관리합니다.',
        tone: 'amber',
    },
    {
        to: '/admin/audit',
        eyebrow: 'Audit',
        title: '감사 로그',
        description: '누가 어떤 관리자 조치를 수행했는지 결과와 대상, 사유를 추적합니다.',
        tone: 'zinc',
    },
] as const;
</script>

<template>
    <AdminConsoleLayout
        title="운영 개요"
        description="관리 대상을 먼저 선택하세요. 위험도가 높은 변경과 배포 이력은 각 영역에서 분리해 확인할 수 있습니다."
        eyebrow="Admin workspace"
    >
        <section class="overview-guide" aria-label="관리 원칙">
            <div>
                <strong>작업 영역이 분리되었습니다.</strong>
                <p>계정 변경, 서버 설정, 버전 배포가 한 화면에 섞이지 않도록 책임별로 나누었습니다.</p>
            </div>
            <span>권한 검사는 기존 서버 정책을 그대로 따릅니다.</span>
        </section>

        <section class="overview-grid" aria-label="관리 기능">
            <RouterLink
                v-for="section in sections"
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
.overview-guide {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 22px;
    border: 1px solid #3f3f46;
    border-radius: 10px;
    background: #18181b;
    padding: 18px 20px;
}

.overview-guide strong {
    color: #f4f4f5;
    font-size: 14px;
}

.overview-guide p,
.overview-guide span {
    margin: 4px 0 0;
    color: #a1a1aa;
    font-size: 12px;
    line-height: 1.5;
}

.overview-guide > span {
    flex: 0 0 auto;
    margin: 0;
    color: #fbbf24;
}

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
    .overview-guide {
        align-items: flex-start;
        flex-direction: column;
    }

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
