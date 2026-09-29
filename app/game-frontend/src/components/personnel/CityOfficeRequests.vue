<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { trpc } from '../../utils/trpc';
import { useGameFeedback } from '../../composables/useGameFeedback';

type Response = Awaited<ReturnType<typeof trpc.nation.getCityOfficeRequests.query>>;
type Request = Response['requests'][number];
const emit = defineEmits<{ changed: [] }>();
const data = ref<Response | null>(null);
const busy = ref(false);
const error = ref('');
const feedback = useGameFeedback();
const labels = { 2: '종사', 3: '군사', 4: '태수' };
const defaults = { approve: '미처리 시 자동 승인', reject: '미처리 시 자동 거부' };
const reasons = { vacant: '공석', npc: 'M장·N장 재직', absent: '재직자 부재', secret: '기밀 열람 승인 필요' };
const states = { approved: '임명 완료', rejected: '거부', withdrawn: '철회', cancelled: '취소', pending: '대기' };
let timer: ReturnType<typeof setInterval> | undefined;
let loading = false;
let disposed = false;
const load = async () => {
    if (loading || disposed) return;
    loading = true;
    try {
        const result = await trpc.nation.getCityOfficeRequests.query();
        if (!disposed) {
            data.value = result;
            error.value = '';
        }
    } catch {
        if (!disposed) error.value = '관직 요청을 불러오지 못했습니다.';
    } finally {
        loading = false;
    }
};
const remaining = (request: Request) => {
    if (request.remainingSeconds === null) return '시계 준비 중';
    if (!data.value?.running) return '시간 정지';
    if (request.remainingSeconds <= 0) return '월 처리 대기';
    return `${Math.ceil(request.remainingSeconds / 60)}분 남음`;
};
const mutate = async (input: Parameters<typeof trpc.nation.cityOfficeRequest.mutate>[0]) => {
    if (busy.value) return;
    busy.value = true;
    try {
        await trpc.nation.cityOfficeRequest.mutate(input);
        await load();
        emit('changed');
        feedback.success(
            input.action === 'request'
                ? '자원했습니다.'
                : input.action === 'approve'
                  ? '임명했습니다.'
                  : input.action === 'reject'
                    ? '거부했습니다.'
                    : '철회했습니다.'
        );
    } catch (err) {
        feedback.error(err instanceof Error ? err.message : '요청 처리에 실패했습니다.');
        await load();
        emit('changed');
    } finally {
        busy.value = false;
    }
};
const request = async (option: Response['options'][number]) => {
    if (
        !data.value ||
        !(await feedback.confirm({
            title: `${data.value.city?.name ?? ''} ${labels[option.level]} 자원`,
            message: `${defaults[option.defaultDecision]}\n분기 1회 · 게임 한 달 이상 대기`,
            acknowledgeLabel: '자원',
        }))
    )
        return;
    await mutate({ action: 'request', officerLevel: option.level });
};
const decide = async (entry: Request, action: 'approve' | 'reject' | 'withdraw') => {
    const verb = action === 'approve' ? '승인' : action === 'reject' ? '거부' : '철회';
    const message = `${entry.generalName} · ${entry.cityName} ${labels[entry.officerLevel]}${action === 'approve' && entry.defaultReason === 'secret' ? '\n승인 시 기밀 열람 가능' : ''}`;
    if (!(await feedback.confirm({ title: `관직 요청 ${verb}`, message, acknowledgeLabel: verb }))) return;
    await mutate({ action, targetGeneralId: entry.generalId, officeRequestId: entry.id });
};
const refreshVisible = () => {
    if (!document.hidden) void load();
};
onMounted(() => {
    void load();
    timer = setInterval(refreshVisible, 15_000);
    window.addEventListener('focus', refreshVisible);
});
onUnmounted(() => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('focus', refreshVisible);
});
</script>

<template>
    <section id="city-office-requests" class="office-requests" aria-label="도시 관직 자원">
        <div class="request-heading">
            <strong>도시 관직 자원</strong><span>분기 1회</span
            ><button type="button" class="legacy-button" :disabled="busy" @click="load">새로고침</button>
        </div>
        <div v-if="error" role="alert">{{ error }}</div>
        <template v-if="data">
            <div v-if="!data.canManage" class="request-options">
                <strong>{{ data.city?.name ?? '아국 도시 체류 필요' }}</strong>
                <div v-for="option in data.options" :key="option.level" class="request-option">
                    <strong>{{ labels[option.level] }}</strong>
                    <div>
                        <span :class="['default-decision', option.defaultDecision]">{{
                            defaults[option.defaultDecision]
                        }}</span
                        ><small>{{ option.reason ?? reasons[option.defaultReason] }}</small>
                    </div>
                    <button
                        type="button"
                        class="legacy-button"
                        :disabled="busy || !option.allowed"
                        @click="request(option)"
                    >
                        자원
                    </button>
                </div>
            </div>
            <div class="request-list-heading">
                {{
                    data.canManage
                        ? `대기 요청 ${data.requests.filter((entry) => entry.status === 'pending').length}건`
                        : '내 요청'
                }}
            </div>
            <div v-if="!data.requests.length" class="empty">
                {{ data.canManage ? '대기 중인 요청 없음' : '요청 없음' }}
            </div>
            <article v-for="entry in data.requests" :key="entry.id" class="request-row">
                <div class="request-title">
                    <strong>{{ entry.generalName }}</strong
                    ><span>{{ entry.cityName }} {{ labels[entry.officerLevel] }}</span>
                </div>
                <template v-if="entry.status === 'pending'">
                    <strong :class="['default-decision', entry.defaultDecision]">{{
                        entry.invalidReason ? '조건 변경 · 취소 예정' : defaults[entry.defaultDecision]
                    }}</strong>
                    <small>{{ reasons[entry.defaultReason] }}</small>
                    <span>{{ entry.dueYear }}년 {{ entry.dueMonth }}월 · {{ remaining(entry) }}</span>
                    <small v-if="entry.invalidReason" class="invalid">{{ entry.invalidReason }} · 처리 시 취소</small>
                    <div class="request-actions">
                        <template v-if="data.canManage"
                            ><button
                                type="button"
                                class="legacy-button"
                                :disabled="busy || !!entry.invalidReason"
                                @click="decide(entry, 'approve')"
                            >
                                승인</button
                            ><button
                                type="button"
                                class="legacy-button"
                                :disabled="busy"
                                @click="decide(entry, 'reject')"
                            >
                                거부
                            </button></template
                        >
                        <button
                            v-else
                            type="button"
                            class="legacy-button"
                            :disabled="busy"
                            @click="decide(entry, 'withdraw')"
                        >
                            철회
                        </button>
                    </div>
                </template>
                <span v-else
                    >{{ states[entry.status] }}<small v-if="entry.resultReason">{{ entry.resultReason }}</small></span
                >
            </article>
        </template>
    </section>
</template>

<style scoped>
.office-requests {
    margin: 8px 0;
    border: 1px solid #777;
    background: #242424;
    padding: 8px;
}
.request-heading,
.request-title,
.request-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.request-heading {
    margin-bottom: 8px;
}
.request-heading > span {
    color: #ccc;
}
.request-heading > button {
    margin-left: auto;
}
.request-option {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 7px 0;
    border-top: 1px solid #555;
}
.request-option small,
.request-row small {
    display: block;
    color: #ccc;
}
.default-decision.approve {
    color: #9ae2a3;
}
.default-decision.reject,
.request-row .invalid {
    color: #ffd28b;
}
.request-list-heading {
    margin-top: 10px;
    font-weight: bold;
}
.request-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(180px, 1.3fr) minmax(150px, 1fr) auto;
    align-items: center;
    gap: 5px 12px;
    padding: 10px 0;
    border-top: 1px solid #555;
}
.request-title {
    grid-column: 1;
    grid-row: 1 / span 2;
}
.request-row > .default-decision {
    grid-column: 2;
    grid-row: 1;
}
.request-row > small {
    grid-column: 2;
    grid-row: 2;
}
.request-row > span {
    grid-column: 3;
    grid-row: 1 / span 2;
}
.request-row > .invalid {
    grid-column: 1 / -1;
    grid-row: 3;
}
.request-actions {
    grid-column: 4;
    grid-row: 1 / span 2;
    justify-content: end;
}
.request-actions button {
    min-width: 56px;
}
.empty {
    padding: 8px 0;
    color: #ccc;
}
@media (max-width: 600px) {
    .request-row {
        grid-template-columns: minmax(0, 1fr);
    }
    .request-row > * {
        grid-column: 1;
        grid-row: auto;
    }
    .request-actions {
        justify-content: start;
    }
}
</style>
