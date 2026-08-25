<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import AdminConsoleLayout from '../layouts/AdminConsoleLayout.vue';
import { useToast } from '../composables/useToast';
import { trpc } from '../utils/trpc';

type OperationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
type BulkTarget = {
    kind: 'GATEWAY' | 'PROFILE';
    order: number;
    label: string;
    profileName?: string;
    operationId: string;
    status: OperationStatus;
    error?: string;
    startedAt?: string;
    completedAt?: string;
};
type BulkRelease = {
    id: string;
    sourceMode: 'BRANCH' | 'COMMIT';
    sourceRef: string;
    resolvedCommitSha: string;
    reason?: string;
    requestedBy: string;
    createdAt: string;
    status: OperationStatus;
    targets: BulkTarget[];
};
type AvailableProfile = {
    profileName: string;
    displayName: string;
    status: string;
    currentScenario: string | null;
    buildCommitSha?: string;
    activeOperation?: { id: string; type: string; status: OperationStatus } | null;
    scheduledResetAt?: string;
};

const adminClient = trpc.admin as unknown as {
    bulkReleases: {
        targets: { query: () => Promise<{ gateway: boolean; profiles: AvailableProfile[] }> };
        list: { query: (input: { limit: number }) => Promise<BulkRelease[]> };
        request: {
            mutate: (input: {
                includeGateway: boolean;
                profileNames: string[];
                sourceMode: 'BRANCH' | 'COMMIT';
                sourceRef: string;
                reason?: string;
            }) => Promise<{ id: string; resolvedCommitSha: string; targetCount: number }>;
        };
    };
    operations: { retry: { mutate: (input: { id: string }) => Promise<unknown> } };
    releases: { retry: { mutate: (input: { id: string }) => Promise<unknown> } };
};

const form = reactive({
    sourceMode: 'BRANCH' as 'BRANCH' | 'COMMIT',
    sourceRef: 'main',
    reason: '',
});
const gatewayAvailable = ref(false);
const includeGateway = ref(false);
const profiles = ref<AvailableProfile[]>([]);
const selectedProfileNames = ref<string[]>([]);
const batches = ref<BulkRelease[]>([]);
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const expandedBatchId = ref('');
const { success: showSuccessToast, error: showErrorToast } = useToast();
let pollTimer: ReturnType<typeof setInterval> | undefined;

const selectableProfiles = computed(() => profiles.value.filter((profile) => !profile.activeOperation));
const selectedCount = computed(() => selectedProfileNames.value.length + (includeGateway.value ? 1 : 0));
const allProfilesSelected = computed(
    () =>
        selectableProfiles.value.length > 0 &&
        selectableProfiles.value.every((profile) => selectedProfileNames.value.includes(profile.profileName))
);
const hasActiveBatch = computed(() =>
    batches.value.some((batch) => batch.status === 'QUEUED' || batch.status === 'RUNNING')
);

const statusLabel = (status: OperationStatus): string =>
    ({
        QUEUED: '대기 중',
        RUNNING: '진행 중',
        SUCCEEDED: '완료',
        FAILED: '실패',
        CANCELLED: '중단됨',
    })[status];

const shortSha = (value?: string): string => value?.slice(0, 12) ?? '-';

const toggleAllProfiles = () => {
    selectedProfileNames.value = allProfilesSelected.value
        ? []
        : selectableProfiles.value.map((profile) => profile.profileName);
};

const loadTargets = async () => {
    const result = await adminClient.bulkReleases.targets.query();
    gatewayAvailable.value = result.gateway;
    profiles.value = result.profiles;
    if (!gatewayAvailable.value) includeGateway.value = false;
    const availableNames = new Set(selectableProfiles.value.map((profile) => profile.profileName));
    selectedProfileNames.value = selectedProfileNames.value.filter((profileName) => availableNames.has(profileName));
};

const loadBatches = async () => {
    batches.value = await adminClient.bulkReleases.list.query({ limit: 20 });
};

const loadState = async () => {
    if (loading.value) return;
    loading.value = true;
    try {
        await Promise.all([loadTargets(), loadBatches()]);
        errorMessage.value = '';
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '일괄 업데이트 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const submit = async () => {
    errorMessage.value = '';
    const sourceRef = form.sourceRef.trim();
    if (!selectedCount.value || !sourceRef) return;
    const labels = [
        ...(includeGateway.value ? ['Gateway'] : []),
        ...profiles.value
            .filter((profile) => selectedProfileNames.value.includes(profile.profileName))
            .map((profile) => profile.displayName),
    ];
    if (
        !window.confirm(
            `${labels.join(' · ')}을(를) ${sourceRef}의 동일 커밋으로 순차 업데이트하시겠습니까? 각 profile의 게임 DB는 유지됩니다.`
        )
    ) {
        return;
    }
    submitting.value = true;
    try {
        const result = await adminClient.bulkReleases.request.mutate({
            includeGateway: includeGateway.value,
            profileNames: selectedProfileNames.value,
            sourceMode: form.sourceMode,
            sourceRef,
            reason: form.reason.trim() || undefined,
        });
        includeGateway.value = false;
        selectedProfileNames.value = [];
        expandedBatchId.value = result.id;
        showSuccessToast(
            `${result.targetCount}개 대상의 일괄 업데이트를 ${shortSha(result.resolvedCommitSha)}로 등록했습니다.`
        );
        await loadState();
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '일괄 업데이트 등록에 실패했습니다.';
        showErrorToast(errorMessage.value);
    } finally {
        submitting.value = false;
    }
};

const retryTarget = async (target: BulkTarget) => {
    if (!window.confirm(`${target.label} 작업을 일괄 업데이트의 고정 커밋으로 다시 실행하시겠습니까?`)) return;
    try {
        if (target.kind === 'GATEWAY') {
            await adminClient.releases.retry.mutate({ id: target.operationId });
        } else {
            await adminClient.operations.retry.mutate({ id: target.operationId });
        }
        showSuccessToast(`${target.label} 재시도를 등록했습니다.`);
        await loadState();
    } catch (error) {
        showErrorToast(error instanceof Error ? error.message : '재시도 등록에 실패했습니다.');
    }
};

onMounted(async () => {
    await loadState();
    pollTimer = setInterval(() => void loadState(), 2_000);
});

onBeforeUnmount(() => {
    if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
    <AdminConsoleLayout
        title="일괄 업데이트"
        description="Gateway와 권한이 있는 서버를 하나의 고정 커밋으로 순차 업데이트합니다."
        eyebrow="Release batch"
    >
        <div class="space-y-6">
            <section class="batch-panel space-y-5" data-testid="bulk-release-form">
                <div class="batch-heading">
                    <div>
                        <h2>새 일괄 업데이트</h2>
                        <p>Gateway를 먼저 처리하고, 선택한 서버는 표시 순서대로 DB 유지 배포합니다.</p>
                    </div>
                    <button type="button" class="secondary-button" :disabled="loading" @click="loadState">
                        새로고침
                    </button>
                </div>

                <div class="source-grid">
                    <label>
                        <span>소스 종류</span>
                        <select v-model="form.sourceMode" data-testid="bulk-source-mode">
                            <option value="BRANCH">브랜치</option>
                            <option value="COMMIT">커밋</option>
                        </select>
                    </label>
                    <label>
                        <span>브랜치 또는 전체 commit SHA</span>
                        <input v-model="form.sourceRef" class="font-mono" data-testid="bulk-source-ref" />
                    </label>
                    <label>
                        <span>작업 사유</span>
                        <input v-model="form.reason" maxlength="200" placeholder="운영 메모" />
                    </label>
                </div>

                <fieldset class="target-fieldset">
                    <legend>업데이트 대상</legend>
                    <label v-if="gatewayAvailable" class="target-row gateway-target">
                        <input v-model="includeGateway" type="checkbox" data-testid="bulk-target-gateway" />
                        <span class="target-copy">
                            <strong>Gateway</strong>
                            <small>API · frontend · orchestrator</small>
                        </span>
                        <span class="target-badge">먼저 실행</span>
                    </label>

                    <div class="target-toolbar">
                        <span>서버 {{ selectableProfiles.length }}개</span>
                        <button
                            type="button"
                            class="text-button"
                            :disabled="!selectableProfiles.length"
                            @click="toggleAllProfiles"
                        >
                            {{ allProfilesSelected ? '서버 선택 해제' : '권한 있는 서버 전체 선택' }}
                        </button>
                    </div>
                    <label
                        v-for="profile in profiles"
                        :key="profile.profileName"
                        class="target-row"
                        :class="{ blocked: Boolean(profile.activeOperation) }"
                    >
                        <input
                            v-model="selectedProfileNames"
                            type="checkbox"
                            :value="profile.profileName"
                            :disabled="Boolean(profile.activeOperation)"
                            :data-testid="`bulk-target-${profile.profileName}`"
                        />
                        <span class="target-copy">
                            <strong>{{ profile.displayName }}</strong>
                            <small>현재 {{ shortSha(profile.buildCommitSha) }} · {{ profile.status }}</small>
                        </span>
                        <span v-if="profile.activeOperation" class="target-badge warning">
                            {{ statusLabel(profile.activeOperation.status) }} 작업 있음
                        </span>
                        <span v-else-if="profile.scheduledResetAt" class="target-badge warning">초기화 예약 유지</span>
                        <span v-else-if="profile.currentScenario === null" class="target-badge warning"
                            >시나리오 미설정</span
                        >
                        <span v-else class="target-badge">DB 유지</span>
                    </label>
                </fieldset>

                <div v-if="errorMessage" class="error-box" role="alert">{{ errorMessage }}</div>
                <div class="submit-row">
                    <p>
                        선택 {{ selectedCount }}개 · branch도 등록 시 하나의 commit SHA로 고정됩니다. 실패한 대상 뒤의
                        작업은 재시도 전까지 대기합니다.
                    </p>
                    <button
                        type="button"
                        class="primary-button"
                        :disabled="submitting || !selectedCount || !form.sourceRef.trim() || hasActiveBatch"
                        data-testid="submit-bulk-release"
                        @click="submit"
                    >
                        {{ submitting ? '등록 중…' : `선택 ${selectedCount}개 일괄 업데이트` }}
                    </button>
                </div>
                <p v-if="hasActiveBatch" class="active-notice">
                    진행 중인 일괄 업데이트가 끝난 뒤 새 묶음을 등록할 수 있습니다.
                </p>
            </section>

            <section class="space-y-3" aria-labelledby="bulk-history-title">
                <div class="batch-heading">
                    <div>
                        <h2 id="bulk-history-title">일괄 업데이트 이력</h2>
                        <p>묶음은 원자적 rollback이 아니며, 성공한 대상은 그대로 유지됩니다.</p>
                    </div>
                </div>
                <div v-if="!batches.length" class="empty-state">등록된 일괄 업데이트가 없습니다.</div>
                <article v-for="batch in batches" :key="batch.id" class="batch-history" :data-status="batch.status">
                    <button
                        type="button"
                        class="batch-summary"
                        :aria-expanded="expandedBatchId === batch.id"
                        :aria-controls="`bulk-release-${batch.id}`"
                        @click="expandedBatchId = expandedBatchId === batch.id ? '' : batch.id"
                    >
                        <span>
                            <strong>{{ shortSha(batch.resolvedCommitSha) }}</strong>
                            <small
                                >{{ batch.sourceMode }} {{ batch.sourceRef }} ·
                                {{ formatServerDateTime(batch.createdAt) }}</small
                            >
                        </span>
                        <span class="status-pill" :data-status="batch.status">{{ statusLabel(batch.status) }}</span>
                    </button>
                    <div v-if="expandedBatchId === batch.id" :id="`bulk-release-${batch.id}`" class="batch-details">
                        <p v-if="batch.reason" class="batch-reason">사유: {{ batch.reason }}</p>
                        <ol class="target-progress">
                            <li v-for="target in batch.targets" :key="target.operationId">
                                <span class="target-order">{{ target.order + 1 }}</span>
                                <span class="target-progress-copy">
                                    <strong>{{ target.label }}</strong>
                                    <small v-if="target.error">{{ target.error }}</small>
                                    <small v-else-if="target.completedAt"
                                        >완료 {{ formatServerDateTime(target.completedAt) }}</small
                                    >
                                    <small v-else-if="target.startedAt"
                                        >시작 {{ formatServerDateTime(target.startedAt) }}</small
                                    >
                                    <small v-else>앞 작업 완료 대기</small>
                                </span>
                                <span class="status-pill" :data-status="target.status">{{
                                    statusLabel(target.status)
                                }}</span>
                                <button
                                    v-if="target.status === 'FAILED' || target.status === 'CANCELLED'"
                                    type="button"
                                    class="secondary-button compact"
                                    @click="retryTarget(target)"
                                >
                                    재시도
                                </button>
                                <RouterLink
                                    v-else
                                    class="detail-link"
                                    :to="
                                        target.kind === 'GATEWAY'
                                            ? '/admin/releases'
                                            : `/admin/servers/${encodeURIComponent(target.profileName ?? '')}/version`
                                    "
                                >
                                    상세
                                </RouterLink>
                            </li>
                        </ol>
                    </div>
                </article>
            </section>
        </div>
    </AdminConsoleLayout>
</template>

<style scoped>
.batch-panel,
.batch-history,
.empty-state {
    border: 1px solid #27272a;
    border-radius: 10px;
    background: #111113;
}

.batch-panel {
    padding: 20px;
}

.batch-heading,
.submit-row,
.target-toolbar,
.batch-summary,
.target-row,
.target-progress li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
}

.batch-heading h2 {
    margin: 0;
    font-size: 18px;
}

.batch-heading p,
.submit-row p {
    margin: 5px 0 0;
    color: #a1a1aa;
    font-size: 12px;
    line-height: 1.6;
}

.source-grid {
    display: grid;
    grid-template-columns: minmax(130px, 0.6fr) minmax(220px, 1.4fr) minmax(200px, 1fr);
    gap: 12px;
}

.source-grid label {
    display: grid;
    gap: 6px;
    color: #a1a1aa;
    font-size: 12px;
}

.source-grid input,
.source-grid select {
    min-width: 0;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    background: #09090b;
    padding: 10px 12px;
    color: #fafafa;
}

.target-fieldset {
    border: 0;
    padding: 0;
}

.target-fieldset legend {
    margin-bottom: 10px;
    color: #d4d4d8;
    font-size: 13px;
    font-weight: 700;
}

.target-row {
    min-height: 58px;
    border: 1px solid #27272a;
    border-radius: 7px;
    background: #09090b;
    padding: 10px 12px;
    cursor: pointer;
}

.target-row + .target-row {
    margin-top: 8px;
}

.target-row.gateway-target {
    margin-bottom: 14px;
    border-color: #5b21b6;
    background: #1e1234;
}

.target-row.blocked {
    cursor: not-allowed;
    opacity: 0.62;
}

.target-row input {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    accent-color: #0ea5e9;
}

.target-copy,
.target-progress-copy,
.batch-summary > span:first-child {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 3px;
}

.target-copy small,
.target-progress-copy small,
.batch-summary small {
    overflow-wrap: anywhere;
    color: #71717a;
    font-size: 11px;
}

.target-toolbar {
    margin: 0 0 8px;
    color: #a1a1aa;
    font-size: 12px;
}

.target-badge,
.status-pill {
    flex: 0 0 auto;
    border: 1px solid #3f3f46;
    border-radius: 999px;
    padding: 4px 8px;
    color: #d4d4d8;
    font-size: 10px;
}

.target-badge.warning {
    border-color: #92400e;
    color: #fcd34d;
}

.primary-button,
.secondary-button,
.text-button {
    border: 0;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
}

.primary-button {
    min-width: 220px;
    background: #0369a1;
    padding: 11px 16px;
    color: white;
}

.secondary-button {
    background: #3f3f46;
    padding: 8px 12px;
    color: white;
}

.secondary-button.compact {
    padding: 6px 9px;
    font-size: 11px;
}

.text-button {
    background: transparent;
    padding: 4px;
    color: #7dd3fc;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.error-box,
.active-notice {
    border: 1px solid #7f1d1d;
    border-radius: 6px;
    background: #450a0a66;
    padding: 10px 12px;
    color: #fecaca;
    font-size: 12px;
}

.active-notice {
    margin: 0;
    border-color: #854d0e;
    background: #42200666;
    color: #fde68a;
}

.empty-state {
    padding: 28px;
    color: #71717a;
    text-align: center;
}

.batch-summary {
    width: 100%;
    border: 0;
    background: transparent;
    padding: 15px 16px;
    color: #fafafa;
    text-align: left;
    cursor: pointer;
}

.batch-details {
    border-top: 1px solid #27272a;
    padding: 14px 16px 16px;
}

.batch-reason {
    margin: 0 0 12px;
    color: #a1a1aa;
    font-size: 12px;
}

.target-progress {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.target-progress li {
    border-radius: 6px;
    background: #09090b;
    padding: 10px;
}

.target-order {
    display: grid;
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 50%;
    background: #27272a;
    color: #d4d4d8;
    font-size: 11px;
}

.status-pill[data-status='RUNNING'] {
    border-color: #047857;
    color: #6ee7b7;
}

.status-pill[data-status='SUCCEEDED'] {
    border-color: #155e75;
    color: #67e8f9;
}

.status-pill[data-status='FAILED'] {
    border-color: #991b1b;
    color: #fca5a5;
}

.status-pill[data-status='QUEUED'] {
    border-color: #92400e;
    color: #fcd34d;
}

.detail-link {
    color: #7dd3fc;
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
}

@media (max-width: 760px) {
    .source-grid {
        grid-template-columns: 1fr;
    }

    .batch-heading,
    .submit-row {
        align-items: stretch;
        flex-direction: column;
    }

    .primary-button {
        width: 100%;
        min-width: 0;
    }

    .target-progress li {
        display: grid;
        grid-template-columns: auto 1fr auto;
    }

    .target-progress li .secondary-button,
    .target-progress li .detail-link {
        grid-column: 2 / -1;
        justify-self: start;
    }
}
</style>
