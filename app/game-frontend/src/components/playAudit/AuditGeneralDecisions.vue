<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { trpc } from '../../utils/trpc';
import AuditPolicyVersion from './AuditPolicyVersion.vue';
const props = defineProps<{ generalId: number; month?: { year: number; month: number } }>();
const route = useRoute();
const router = useRouter();
type History = Awaited<ReturnType<typeof trpc.playAudit.decisionHistory.query>>;
type Detail = Awaited<ReturnType<typeof trpc.playAudit.decisionDetail.query>>;
type Step = Detail['chunks'][number]['steps'][number];
const history = ref<History | null>(null);
const detail = ref<Detail | null>(null);
const error = ref('');
const detailError = ref('');
const loading = ref(false);
const detailLoading = ref(false);
let generation = 0;
let detailGeneration = 0;
const selected = computed(() => (typeof route.query.decision === 'string' ? route.query.decision : null));
const policyLabels = {
    NPC_VALUES: 'NPC 설정 값',
    NPC_NATION_PRIORITY: '수뇌 우선순위',
    NPC_GENERAL_PRIORITY: '개인 우선순위',
    DEFENCE: '국방 설정',
};
const selectedPolicy = computed(() => {
    const id = route.query.policy;
    return typeof id === 'string' && Object.values(detail.value?.decision.summary.policyRefs ?? {}).includes(id)
        ? id
        : null;
});
const selectPolicy = (id: string | null) => router.push({ query: { ...route.query, policy: id ?? undefined } });
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'NPC 결정 기록을 조회하지 못했습니다.');
const load = async (more = false) => {
    if (loading.value) return;
    const request = generation;
    loading.value = true;
    error.value = '';
    try {
        const response = await trpc.playAudit.decisionHistory.query({
            generalId: props.generalId,
            month: more ? (history.value?.month ?? props.month) : props.month,
            limit: 50,
            cursor: more ? (history.value?.nextCursor ?? undefined) : undefined,
        });
        if (request === generation)
            history.value = {
                ...response,
                items: more ? [...(history.value?.items ?? []), ...response.items] : response.items,
            };
    } catch (cause) {
        if (request === generation) error.value = message(cause);
    } finally {
        if (request === generation) loading.value = false;
    }
};
const loadDetail = async (more = false) => {
    if (!selected.value || detailLoading.value) return;
    const request = detailGeneration;
    detailLoading.value = true;
    detailError.value = '';
    try {
        const response = await trpc.playAudit.decisionDetail.query({
            id: selected.value,
            generalId: props.generalId,
            cursor: more ? (detail.value?.nextCursor ?? undefined) : undefined,
            limit: 1,
        });
        if (request === detailGeneration)
            detail.value = {
                ...response,
                chunks: more ? [...(detail.value?.chunks ?? []), ...response.chunks] : response.chunks,
            };
    } catch (cause) {
        if (request === detailGeneration) detailError.value = message(cause);
    } finally {
        if (request === detailGeneration) detailLoading.value = false;
    }
};
const select = (id: string | null) => router.push({ query: { ...route.query, decision: id ?? undefined } });
const outcome = (done: boolean | null, status?: 'PREPARING' | 'BLOCKED' | 'RESOLVED') =>
    status === 'PREPARING'
        ? '준비 중'
        : status === 'BLOCKED'
          ? '실행 차단'
          : done === null
            ? '결과 미관측'
            : done
              ? '실행 완료'
              : '실행 실패';
const rngValue = (value: Extract<Step, { kind: 'RNG' }>['result']): string => {
    if (Array.isArray(value)) return value.map(rngValue).join(', ');
    if (value === null) return '없음';
    if (typeof value === 'object') return 'entityId' in value ? `대상 #${value.entityId}` : '상세 값 미수집';
    return String(value);
};
const checkLabels = {
    ARGS: '인자',
    CONSTRAINT: '조건',
    COOLDOWN: '재사용 대기',
    CONTEXT: '실행 문맥',
    BLOCK: '실행 제한',
};
const checkResultLabels = { allow: '통과', deny: '차단', unknown: '미확인' };
const stepText = (step: Step): string => {
    switch (step.kind) {
        case 'EXECUTION_ATTEMPT':
            return `실행 시도 ${step.attempt + 1} · 요청 ${step.requestedAction} · 처리 ${step.resolvedAction} → 실행 ${step.executedAction ?? '미실행'} · ${step.preparation ? '준비 중' : outcome(step.completed)}${step.usedFallback ? ' · 대체 실행' : ''}${step.alternativeAction ? ` · 다음 대안 ${step.alternativeAction}` : ''}${step.preparation ? ` · 준비 ${step.preparation.term}/${step.preparation.total}` : ''}`;
        case 'DECISION_START':
            return `판단 시작 · 예약 ${step.reservedAction}`;
        case 'DECISION_END':
            return `최종 선택 · ${step.action ?? '선택 없음'} · ${step.reason ?? '사유 미관측'}`;
        case 'DECISION_ERROR':
            return '판단 중 오류';
        case 'PROCEDURE_START':
            return `${step.procedure} · 평가 시작`;
        case 'PROCEDURE_END':
            return `${step.procedure} · ${step.action ?? '선택 없음'} · ${step.reason ?? '내부 사유 미수집'}`;
        case 'PROCEDURE_SKIP':
            return `${step.procedure} · ${{ POLICY: '정책으로 제외', AUTOMATION: '자동화 권한으로 제외', NO_HANDLER: '처리 절차 없음' }[step.reason]}`;
        case 'CANDIDATE':
            return `${step.action} · ${{ INVALID_ARGS: '인자 오류', allow: '조건 통과', deny: '조건 차단', unknown: '조건 미확인' }[step.result]}${step.constraint ? ` · ${step.constraint}` : ''}`;
        case 'RNG':
            return `${step.method}(${step.parameters?.join(', ') ?? ''}) → ${rngValue(step.result)}`;
    }
};
watch(
    [() => props.generalId, () => props.month?.year, () => props.month?.month],
    () => {
        generation++;
        history.value = null;
        error.value = '';
        loading.value = false;
        void load();
    },
    { immediate: true }
);
watch(
    [selected, () => props.generalId],
    () => {
        detailGeneration++;
        detail.value = null;
        detailError.value = '';
        detailLoading.value = false;
        if (selected.value) void loadDetail();
    },
    { immediate: true }
);
</script>

<template>
    <section class="audit-decisions" aria-label="NPC 결정 기록">
        <p>
            {{ history ? `${history.month.year}년 ${history.month.month}월` : '선택 월' }} · NPC·유저 자동턴의 개인/수뇌
            판단
        </p>
        <p>
            절차와 선택 결과를 수집한 기록입니다. 후보 내부 조건 전체는 아직 포함되지 않으며, 기록이 없다고 판단 시도가
            없었다는 뜻은 아닙니다.
        </p>
        <p v-if="loading" role="status">결정 목록 조회 중…</p>
        <p v-if="error" role="alert">
            {{ error }} <button class="legacy-button" @click="load()">결정 목록 다시 조회</button>
        </p>
        <p v-if="history && !history.items.length">이 월에 수집된 결정 기록이 없습니다.</p>
        <div v-if="history?.items.length" class="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>판단</th>
                        <th>주체</th>
                        <th>선택 → 실행</th>
                        <th>결과</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in history.items" :key="item.id">
                        <td>
                            <button class="legacy-button" @click="select(item.id)">
                                {{ item.phase === 'nation' ? '수뇌 판단' : '개인 판단' }} · tick {{ item.tick }}
                            </button>
                        </td>
                        <td>{{ item.npcState < 2 ? '유저 자동턴' : item.npcState === 5 ? '부대장 NPC' : 'NPC' }}</td>
                        <td>{{ item.summary.selectedAction ?? '선택 없음' }} → {{ item.summary.executedAction }}</td>
                        <td>
                            {{ outcome(item.summary.completed, item.summary.executionStatus)
                            }}{{ item.summary.usedFallback ? ' · 대체 실행' : '' }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <button v-if="history?.nextCursor" class="legacy-button" :disabled="loading" @click="load(true)">
            결정 목록 더 불러오기
        </button>
        <section v-if="selected" aria-label="선택 결정 상세">
            <button class="legacy-button" @click="select(null)">결정 상세 닫기</button>
            <p v-if="detailLoading" role="status">결정 상세 조회 중…</p>
            <p v-if="detailError" role="alert">
                {{ detailError }}
                <button class="legacy-button" @click="loadDetail(Boolean(detail))">결정 상세 다시 조회</button>
            </p>
            <template v-if="detail">
                <p v-if="!detail.decision.summary.executionCoverage">
                    이 기록에는 실행 단계의 시도 이력이 수집되지 않았습니다.
                </p>
                <p>
                    {{ detail.decision.year }}년 {{ detail.decision.month }}월 · 국가 #{{ detail.decision.nationId }} ·
                    도시 #{{ detail.decision.cityId }} · tick {{ detail.decision.tick }}
                </p>
                <p>
                    예약 {{ detail.decision.summary.requestedAction }} · 선택
                    {{ detail.decision.summary.selectedAction ?? '없음' }} · 실행
                    {{ detail.decision.summary.executedAction }}
                </p>
                <p>
                    선택 사유: {{ detail.decision.summary.selectedReason ?? '미관측' }} ·
                    {{ outcome(detail.decision.summary.completed, detail.decision.summary.executionStatus) }}
                </p>
                <p v-if="detail.decision.summary.blockedReason">
                    차단 사유: {{ detail.decision.summary.blockedReason }}
                </p>
                <p>
                    코드 버전: {{ detail.decision.summary.codeVersion ?? '미관측' }} · 전체 관측
                    {{ detail.decision.stepCount }}개
                </p>
                <details>
                    <summary>당시 정책 참조</summary>
                    <p v-if="!Object.keys(detail.decision.summary.policyRefs).length">확보된 정책 참조가 없습니다.</p>
                    <p>선택 당시 저장된 국가 설정입니다. NPC별 합성 유효 값과 다를 수 있습니다.</p>
                    <p v-for="(id, area) in detail.decision.summary.policyRefs" :key="area">
                        <button class="legacy-button" @click="selectPolicy(id ?? null)">
                            {{ policyLabels[area] }} 당시 버전 조회
                        </button>
                    </p>
                </details>
                <AuditPolicyVersion
                    v-if="selectedPolicy"
                    :id="selectedPolicy"
                    :allow-previous="false"
                    @select="selectPolicy"
                />
                <ol aria-label="판단 절차">
                    <template v-for="chunk in detail.chunks" :key="chunk.ordinal"
                        ><li v-for="step in chunk.steps" :key="step.sequence" :value="step.sequence + 1">
                            {{ stepText(step) }}
                            <ul v-if="step.kind === 'EXECUTION_ATTEMPT'">
                                <li v-for="(check, index) in step.checks" :key="index">
                                    {{ checkLabels[check.stage] }} · {{ check.action }} ·
                                    {{ checkResultLabels[check.result] }}{{ check.reason ? ` · ${check.reason}` : '' }}
                                </li>
                            </ul>
                        </li></template
                    >
                </ol>
                <button
                    v-if="detail.nextCursor !== null"
                    class="legacy-button"
                    :disabled="detailLoading"
                    @click="loadDetail(true)"
                >
                    판단 절차 더 불러오기
                </button>
            </template>
        </section>
    </section>
</template>

<style scoped>
.audit-decisions {
    display: grid;
    gap: 8px;
    margin-top: 12px;
    min-width: 0;
    overflow-wrap: anywhere;
}
.audit-decisions > section {
    min-width: 0;
}
.table-scroll {
    overflow-x: auto;
}
table {
    border-collapse: collapse;
    min-width: 640px;
    width: 100%;
}
th,
td {
    padding: 6px;
    text-align: left;
    border: 1px solid gray;
}
ol {
    padding-left: 28px;
}
li {
    padding: 4px 0;
}
</style>
