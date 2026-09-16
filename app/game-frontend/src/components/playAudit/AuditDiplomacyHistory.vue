<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { trpc } from '../../utils/trpc';
const props = defineProps<{
    nationId: number;
    otherNationId: number;
    from: { year: number; month: number };
    to: { year: number; month: number };
}>();
type History = Awaited<ReturnType<typeof trpc.playAudit.diplomacyHistory.query>>;
type Detail = Awaited<ReturnType<typeof trpc.playAudit.diplomacyEvent.query>>;
const route = useRoute();
const router = useRouter();
const data = ref<History | null>(null);
const detail = ref<Detail | null>(null);
const error = ref('');
const detailError = ref('');
const loading = ref(false);
const detailLoading = ref(false);
let generation = 0;
let detailGeneration = 0;
const selected = computed(() => (typeof route.query.event === 'string' ? route.query.event : null));
const labels: Record<string, string> = {
    LETTER_BASELINE: '문서 최초 관측',
    NATION_RELATION_CREATED: '신생국 관계 생성',
    NATION_RELATION_REMOVED: '멸망국 관계 종료',
    RELATION_BASELINE: '관계 최초 관측',
    LETTER_PROPOSED: '문서 제안',
    LETTER_REPLACED: '문서 교체',
    LETTER_ACCEPTED: '문서 승인',
    LETTER_REJECTED: '문서 거절',
    LETTER_WITHDRAWN: '문서 회수',
    LETTER_DESTROY_REQUESTED: '문서 파기 요청',
    LETTER_DESTROYED: '문서 파기',
    MONTHLY_RELATION_CHANGED: '월간 관계 변경',
    TURN_RELATION_CHANGED: '명령 관계 변경',
    MESSAGE_ACCEPTED_noAggression: '불가침 체결',
    MESSAGE_ACCEPTED_cancelNA: '불가침 파기',
    MESSAGE_ACCEPTED_stopWar: '종전 합의',
};
const fieldLabels: Record<string, string> = {
    state: '상태',
    term: '남은 기간',
    dead: '사상자',
    isDead: '소멸 표시',
    isShowing: '표시 여부',
    srcSignerId: '발신 서명 장수',
    destSignerId: '수신 서명 장수',
    srcNationName: '발신 국명',
    destNationName: '수신 국명',
    srcSignerName: '발신 장수명',
    destSignerName: '수신 장수명',
    stateOption: '파기 요청 상태',
    reason: '사유',
    reasonAction: '사유 종류',
    reasonActorId: '사유 작성 장수',
};
const fields = computed(() => {
    const event = detail.value?.event;
    return [...new Set([...Object.keys(event?.before ?? {}), ...Object.keys(event?.after ?? {})])].map((key) => ({
        key,
        before: event?.before ? Reflect.get(event.before, key) : null,
        after: event?.after ? Reflect.get(event.after, key) : null,
    }));
});
const valueText = (key: string, value: unknown) => {
    if (value === null || value === undefined) return '미관측 / 없음';
    if (key === 'state')
        return (
            (
                {
                    PROPOSED: '제안',
                    ACTIVATED: '승인',
                    REPLACED: '교체',
                    CANCELLED: '종료',
                    '0': '전쟁',
                    '1': '선포',
                    '2': '교역',
                    '7': '불가침',
                } as Record<string, string>
            )[String(value)] ?? String(value)
        );
    if (typeof value === 'boolean') return value ? '예' : '아니오';
    if (key === 'stateOption')
        return (
            ({ try_destroy_src: '발신국 파기 요청', try_destroy_dest: '수신국 파기 요청' } as Record<string, string>)[
                String(value)
            ] ?? String(value)
        );
    return String(value);
};
const message = (cause: unknown) => (cause instanceof Error ? cause.message : '외교 기록을 조회하지 못했습니다.');
const load = async (append = false) => {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    if (!append) data.value = null;
    try {
        const response = await trpc.playAudit.diplomacyHistory.query({
            ...props,
            limit: 50,
            cursor: append ? (data.value?.nextCursor ?? undefined) : undefined,
        });
        if (request === generation)
            data.value = {
                ...response,
                items: append ? [...(data.value?.items ?? []), ...response.items] : response.items,
            };
    } catch (cause) {
        if (request === generation) error.value = message(cause);
    } finally {
        if (request === generation) loading.value = false;
    }
};
const loadDetail = async () => {
    const request = ++detailGeneration;
    detail.value = null;
    detailError.value = '';
    detailLoading.value = false;
    if (!selected.value) return;
    detailLoading.value = true;
    try {
        const response = await trpc.playAudit.diplomacyEvent.query({ id: selected.value });
        if (request === detailGeneration) detail.value = response;
    } catch (cause) {
        if (request === detailGeneration) detailError.value = message(cause);
    } finally {
        if (request === detailGeneration) detailLoading.value = false;
    }
};
const select = (id: string | null) => router.push({ query: { ...route.query, event: id ?? undefined } });
watch(
    [
        () => props.nationId,
        () => props.otherNationId,
        () => props.from.year,
        () => props.from.month,
        () => props.to.year,
        () => props.to.month,
    ],
    () => {
        void load();
    },
    { immediate: true }
);
watch(
    selected,
    () => {
        void loadDetail();
    },
    { immediate: true }
);
</script>
<template>
    <section aria-label="외교 감사 이력">
        <p>기록된 문서와 관계 변경입니다. 수집 이전의 상태와 기록 사이의 미관측 변경은 복원하지 않습니다.</p>
        <p v-if="loading" role="status">외교 이력 조회 중…</p>
        <p v-if="error" role="alert">{{ error }} <button class="legacy-button" @click="load()">다시 조회</button></p>
        <template v-if="data">
            <p v-if="data.coverage === 'IDENTITY_MISSING'">기수 식별자가 없어 외교 이력을 조회할 수 없습니다.</p>
            <p v-else-if="!data.items.length">선택한 기간에 기록된 외교 사건이 없습니다.</p>
            <div v-else class="table-scroll" tabindex="0" aria-label="외교 사건 목록">
                <table>
                    <thead>
                        <tr>
                            <th>사건</th>
                            <th>게임 시각</th>
                            <th>방향</th>
                            <th>당시 주체</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in data.items" :key="item.id">
                            <td>
                                <button class="legacy-button" @click="select(item.id)">
                                    {{ labels[item.eventType] ?? item.eventType }}</button
                                ><br />순번 {{ item.sequence }}
                            </td>
                            <td>{{ item.year }}년 {{ item.month }}월</td>
                            <td>국가 #{{ item.srcNationId }} → #{{ item.destNationId }}</td>
                            <td>
                                {{
                                    item.actor
                                        ? `${item.actor.name} (#${item.actor.generalId}) · 직책 ${item.actor.officerLevel}`
                                        : '월간 처리 / 관측 기준'
                                }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <button v-if="data.nextCursor" class="legacy-button" :disabled="loading" @click="load(true)">
                다음 사건 50개
            </button>
        </template>
        <section v-if="selected" aria-label="선택 외교 사건">
            <h3>선택 외교 사건 <button class="legacy-button" @click="select(null)">외교 상세 닫기</button></h3>
            <p v-if="detailLoading" role="status">외교 상세 조회 중…</p>
            <p v-if="detailError" role="alert">
                {{ detailError }} <button class="legacy-button" @click="loadDetail">상세 다시 조회</button>
            </p>
            <template v-if="detail">
                <p>
                    {{ labels[detail.event.eventType] ?? detail.event.eventType }} · {{ detail.event.year }}년
                    {{ detail.event.month }}월 · 순번 {{ detail.event.sequence }}
                </p>
                <p>기록 시각 {{ detail.event.createdAt }}</p>
                <p v-if="detail.event.previousDocumentId">이전 문서 #{{ detail.event.previousDocumentId }}</p>
                <p v-if="detail.event.actor">
                    {{ detail.event.actor.name }} (#{{ detail.event.actor.generalId }}) · 당시 국가 #{{
                        detail.event.actor.nationId
                    }}
                    · 직책 {{ detail.event.actor.officerLevel }}
                    <span v-if="detail.event.actor.actionKey">· {{ detail.event.actor.actionKey }}</span>
                </p>
                <div class="table-scroll" tabindex="0" aria-label="외교 전후 값">
                    <table>
                        <thead>
                            <tr>
                                <th>항목</th>
                                <th>변경 전</th>
                                <th>변경 후</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="field in fields" :key="field.key">
                                <th scope="row">{{ fieldLabels[field.key] ?? field.key }}</th>
                                <td>{{ valueText(field.key, field.before) }}</td>
                                <td>{{ valueText(field.key, field.after) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="detail.event.documentStatus === 'MISSING_REFERENCE'" role="status">
                    참조 문서가 없어 원문을 표시할 수 없습니다.
                </p>
                <p v-if="detail.event.documentStatus === 'HASH_MISMATCH'" role="alert">
                    원문이 기록 당시 해시와 달라 표시를 중단했습니다.
                </p>
                <section v-if="detail.event.document" aria-label="당시 외교 문서">
                    <h4>문서 #{{ detail.event.document.id }}</h4>
                    <p>작성 시각 {{ detail.event.document.writtenAt }}</p>
                    <!-- 서버가 기존 외교 HTML allowlist로 정제한 표시용 본문만 렌더링한다. -->
                    <div class="document-body" v-html="detail.event.document.briefHtml" />
                    <div class="document-body" v-html="detail.event.document.detailHtml" />
                    <details>
                        <summary>원문 HTML 확인</summary>
                        <pre>{{ detail.event.document.brief }}</pre>
                        <pre>{{ detail.event.document.detail }}</pre>
                    </details>
                </section>
                <details>
                    <summary>실행 연결</summary>
                    <p>
                        tick {{ detail.event.tick ?? '미상' }} · 시계 버전 {{ detail.event.clockRevision ?? '미상' }} ·
                        실행 {{ detail.event.executionId }}
                    </p>
                    <p>
                        요청 {{ detail.event.requestId ?? '해당 없음' }} · 입력 순번
                        {{ detail.event.inputSequence ?? '해당 없음' }}
                    </p>
                </details>
            </template>
        </section>
    </section>
</template>
<style scoped>
.table-scroll {
    overflow-x: auto;
}
table {
    width: 100%;
    min-width: 600px;
    border-collapse: collapse;
}
th,
td {
    border: 1px solid var(--legacy-border, #777);
    padding: 6px;
    text-align: left;
    vertical-align: top;
}
p,
td,
pre {
    overflow-wrap: anywhere;
}
pre {
    white-space: pre-wrap;
}
.document-body {
    overflow-wrap: anywhere;
    overflow-x: auto;
}
.document-body :deep(img) {
    max-width: 100%;
    height: auto;
}
</style>
