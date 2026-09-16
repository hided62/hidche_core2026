<script setup lang="ts">
import { ref, watch } from 'vue';
import { trpc } from '../../utils/trpc';
const props = defineProps<{ kind: 'POLICY' | 'DIPLOMACY'; id: string }>();
type Data = Awaited<ReturnType<typeof trpc.playAudit.requestState.query>>;
const data = ref<Data | null>(null);
const opened = ref(false);
const loading = ref(false);
const error = ref('');
let generation = 0;
const labels = { PENDING: '처리 대기', PROCESSING: '처리 중', SUCCEEDED: '처리 성공', FAILED: '처리 실패' };
const missing = {
    NOT_LINKED: '이 사건에는 연결된 요청이 없습니다. 자동 처리나 최초 관측일 수 있습니다.',
    INCOMPLETE_REFERENCE: '요청 순번이 없어 현재 요청 기록과의 일치를 확인할 수 없습니다.',
    MISSING_REQUEST: '연결된 요청 기록이 보존되어 있지 않습니다. 원인을 이 자료만으로 판단할 수 없습니다.',
    REFERENCE_MISMATCH: '요청 ID와 저장된 입력 순번이 일치하지 않아 내용을 표시하지 않습니다.',
};
const load = async () => {
    if (loading.value) return;
    opened.value = true;
    loading.value = true;
    error.value = '';
    const request = ++generation;
    try {
        const response = await trpc.playAudit.requestState.query({ kind: props.kind, id: props.id });
        if (request === generation) data.value = response;
    } catch (cause) {
        if (request === generation)
            error.value = cause instanceof Error ? cause.message : '요청 기록을 조회하지 못했습니다.';
    } finally {
        if (request === generation) loading.value = false;
    }
};
watch([() => props.kind, () => props.id], () => {
    generation++;
    data.value = null;
    opened.value = false;
    loading.value = false;
    error.value = '';
});
</script>
<template>
    <section class="audit-request" aria-label="요청 처리 기록">
        <button class="legacy-button" :disabled="loading" @click="load">
            {{ opened ? '요청 처리 다시 조회' : '요청 처리 조회' }}
        </button>
        <p v-if="loading" role="status">요청 처리 기록 조회 중…</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <template v-if="data">
            <p v-if="data.status !== 'AVAILABLE'">{{ missing[data.status] }}</p>
            <template v-else-if="data.request">
                <p>조회 시각 {{ data.asOf }}</p>
                <p>조회 시점에 보존된 요청 상태입니다. 처리 시도별 전체 이력이나 실제 변경 횟수는 아닙니다.</p>
                <dl>
                    <dt>요청</dt>
                    <dd>{{ data.request.requestId }}</dd>
                    <dt>입력 순번</dt>
                    <dd>{{ data.request.sequence }}</dd>
                    <dt>처리 대상 · 종류</dt>
                    <dd>{{ data.request.target }} · {{ data.request.eventType }}</dd>
                    <dt>현재 상태</dt>
                    <dd>{{ labels[data.request.status] }}</dd>
                    <dt>처리 시도 횟수</dt>
                    <dd>{{ data.request.attempts }}</dd>
                    <dt>접수</dt>
                    <dd>
                        {{ data.request.createdAt }} · tick {{ data.request.acceptedGameTick ?? '미관측' }} · 시계 버전
                        {{ data.request.acceptedClockRevision ?? '미관측' }}
                    </dd>
                    <dt>마지막 처리 시작</dt>
                    <dd>
                        {{ data.request.processingAt ?? '미관측' }} · tick
                        {{ data.request.processingGameTick ?? '미관측' }} · 시계 버전
                        {{ data.request.processingClockRevision ?? '미관측' }}
                    </dd>
                    <dt>완료 기록 시각</dt>
                    <dd>{{ data.request.completedAt ?? '미관측' }}</dd>
                    <dt>결과 · 오류 기록</dt>
                    <dd>
                        {{ data.request.resultRecorded ? '결과 있음' : '결과 없음' }} ·
                        {{ data.request.errorRecorded ? '오류 있음' : '오류 없음' }}
                    </dd>
                </dl>
            </template>
        </template>
    </section>
</template>
<style scoped>
.audit-request {
    margin-top: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
}
dl {
    margin: 8px 0;
}
dt {
    font-weight: bold;
    margin-top: 6px;
}
dd {
    margin-left: 12px;
}
</style>
