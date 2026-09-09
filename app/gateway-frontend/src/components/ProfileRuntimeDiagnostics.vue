<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { trpc } from '../utils/trpc';

const props = defineProps<{ profileName: string }>();
type Diagnostics = Awaited<ReturnType<typeof trpc.admin.profiles.diagnostics.query>>;
const result = ref<Diagnostics | null>(null);
const opened = ref(false);
const loading = ref(false);
const error = ref('');
const inspect = async (): Promise<void> => {
    opened.value = true;
    loading.value = true;
    error.value = '';
    try {
        result.value = await trpc.admin.profiles.diagnostics.query({ profileName: props.profileName });
    } catch {
        error.value = '진단 정보를 가져오지 못했습니다. 연결과 조회 권한을 확인한 뒤 다시 시도하세요.';
    } finally {
        loading.value = false;
    }
};
const assessment = computed(() => {
    const data = result.value;
    if (!data) return '';
    if (['STOPPED', 'CANCELLED'].includes(data.status)) return '서버 중지 상태';
    if (!data.observation || data.observation.database === 'UNAVAILABLE') return 'DB 상태 확인 실패';
    if (data.observation.database === 'UNINITIALIZED') return '게임 DB 초기화 대기';
    if (data.observation.processObservation === 'UNAVAILABLE') return '프로세스 상태 확인 실패';
    if (!data.runtime?.daemonRunning) return '턴 데몬 프로세스 중지';
    if (!data.observation.lease) return '턴 실행 권한 없음';
    if (!data.observation.lease.valid) return '턴 실행 권한 만료';
    if (!data.observation.lease.clockReady) return '게임 시계 준비 중';
    if (data.status === 'PAUSED') return '턴 일시정지 상태';
    if (data.observation.clock?.phase === 'COMPLETED') return '시즌 종료';
    if (data.observation.clock?.phase === 'PREOPEN') return '가오픈 대기';
    const anchor = data.observation.clock?.wallAnchor;
    if (anchor && anchor > data.observation.checkedAt) return '예정된 시각까지 복구 대기';
    return '턴 프로세스와 실행 권한 정상';
});
const displayTime = (value: string | null | undefined): string => (value ? formatServerDateTime(value) : '없음');
</script>

<template>
    <section class="min-w-0 rounded border border-zinc-700 p-3 text-sm" data-testid="runtime-diagnostics">
        <button
            type="button"
            class="rounded border border-zinc-600 px-3 py-1 disabled:opacity-50"
            :disabled="loading"
            @click="inspect"
        >
            {{ loading ? '조회 중…' : opened ? '장애 진단 새로고침' : '장애 진단과 이력' }}
        </button>
        <p v-if="error" role="alert" class="mt-2 text-red-200">{{ error }}</p>
        <div v-if="opened && result" class="mt-3 min-w-0 space-y-2" data-testid="runtime-diagnostics-result">
            <p class="font-semibold">{{ assessment }}</p>
            <p class="text-xs text-zinc-400">
                조회 시각: {{ displayTime(result.observation?.checkedAt) }} · 상태는 조회 시점 기준입니다.
            </p>
            <dl v-if="result.observation" class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt>DB 연결</dt>
                <dd>{{ result.observation.database }}</dd>
                <dt>마지막 heartbeat</dt>
                <dd>{{ displayTime(result.observation.lease?.heartbeatAt) }}</dd>
                <dt>실행 권한 만료</dt>
                <dd>{{ displayTime(result.observation.lease?.leaseUntil) }}</dd>
                <dt>시계 상태</dt>
                <dd>
                    {{ result.observation.clock?.phase ?? '없음' }} / revision
                    {{ result.observation.clock?.revision ?? '없음' }}
                </dd>
                <dt>게임 연월</dt>
                <dd>{{ result.observation.clock?.year ?? '-' }}년 {{ result.observation.clock?.month ?? '-' }}월</dd>
                <dt>마지막 처리 tick</dt>
                <dd class="break-all">{{ result.observation.clock?.lastTurnTick ?? '없음' }}</dd>
                <dt>복구 시작</dt>
                <dd>{{ displayTime(result.observation.clock?.recoveryStartWallAt) }}</dd>
                <dt>owner / epoch</dt>
                <dd class="break-all">
                    {{ result.observation.lease?.ownerId ?? '없음' }} /
                    {{ result.observation.lease?.fencingEpoch ?? '-' }}
                </dd>
            </dl>
            <p class="text-xs text-zinc-300">
                정지 원인을 해결한 뒤 턴을 재개하세요. 배포 작업 중이거나 복구 시작 시각을 기다리는 경우에는 해당 작업과
                일정을 먼저 확인하세요.
            </p>
            <details v-if="result.observation?.processes?.length" class="min-w-0 text-xs">
                <summary class="cursor-pointer">프로세스 상태와 종료 코드</summary>
                <p v-for="process in result.observation.processes" :key="process.name" class="mt-1 break-all">
                    {{ process.name }}: {{ process.status }} · 재시작 {{ process.restartCount }}회 · 마지막 종료 코드
                    {{ process.exitCode ?? '없음' }}
                </p>
            </details>
            <h4 class="pt-2 font-semibold">최근 장애 이력</h4>
            <p v-if="!result.incidents.length" class="text-xs text-zinc-400">
                저장된 장애 이력이 없습니다. 이력 수집 이전의 오류는 현재 정지 사유와 운영 로그에서 확인하세요.
            </p>
            <details
                v-for="incident in result.incidents"
                :key="incident.id"
                class="min-w-0 rounded border border-red-900/60 p-2"
            >
                <summary class="cursor-pointer break-words">
                    {{ displayTime(incident.createdAt) }} · {{ incident.errorCode }}
                </summary>
                <p class="mt-2 whitespace-pre-wrap break-words text-xs text-red-200">{{ incident.errorMessage }}</p>
                <pre class="mt-2 whitespace-pre-wrap break-all text-xs text-zinc-400">{{
                    JSON.stringify(incident.summary, null, 2)
                }}</pre>
            </details>
        </div>
    </section>
</template>
