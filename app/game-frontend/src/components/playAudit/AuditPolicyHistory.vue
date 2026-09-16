<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { trpc } from '../../utils/trpc';

const props = defineProps<{
    nationId: number;
    area: 'NPC_VALUES' | 'NPC_NATION_PRIORITY' | 'NPC_GENERAL_PRIORITY' | 'DEFENCE';
    from: { year: number; month: number };
    to: { year: number; month: number };
}>();
type History = Awaited<ReturnType<typeof trpc.playAudit.policyHistory.query>>;
type Detail = Awaited<ReturnType<typeof trpc.playAudit.policyVersion.query>>;
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
const selected = computed(() => (typeof route.query.policy === 'string' ? route.query.policy : null));
const fieldLabels: Record<string, string> = {
    reqNationGold: '국가 권장 금',
    reqNationRice: '국가 권장 쌀',
    reqHumanWarUrgentGold: '유저전투장 긴급포상 금',
    reqHumanWarUrgentRice: '유저전투장 긴급포상 쌀',
    reqHumanWarRecommandGold: '유저전투장 권장 금',
    reqHumanWarRecommandRice: '유저전투장 권장 쌀',
    reqHumanDevelGold: '유저내정장 권장 금',
    reqHumanDevelRice: '유저내정장 권장 쌀',
    reqNPCWarGold: 'NPC전투장 권장 금',
    reqNPCWarRice: 'NPC전투장 권장 쌀',
    reqNPCDevelGold: 'NPC내정장 권장 금',
    reqNPCDevelRice: 'NPC내정장 권장 쌀',
    minimumResourceActionAmount: '포상/몰수/헌납/삼/팜 최소 단위',
    maximumResourceActionAmount: '포상/몰수/헌납/삼/팜 최대 단위',
    minWarCrew: '최소 전투 가능 병력 수',
    minNPCRecruitCityPopulation: 'NPC 최소 징병 가능 인구 수',
    safeRecruitCityPopulationRatio: '제자리 징병 허용 인구율 (비율)',
    minNPCWarLeadership: 'NPC 전투 참여 통솔 기준',
    properWarTrainAtmos: '훈련/사기진작 목표치',
    cureThreshold: '요양 기준',
    CombatForce: '전투 부대 편성',
    SupportForce: '지원 부대 편성',
    DevelopForce: '내정 부대 편성',
    priority: '행동 우선순위',
    war: '전쟁 금지 설정',
    scout: '임관 권유 설정',
    secretlimit: '기밀 공개 기준 (년)',
};
const labels = { BASELINE: '최초 관측', CHANGE: '실제 변경', OBSERVED_GAP: '관측 누락 이후 기준' };
const message = (cause: unknown) => (cause instanceof Error ? cause.message : '정책 이력을 조회하지 못했습니다.');
const load = async (append = false) => {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    if (!append) data.value = null;
    try {
        const response = await trpc.playAudit.policyHistory.query({
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
        const response = await trpc.playAudit.policyVersion.query({ id: selected.value });
        if (request === detailGeneration) detail.value = response;
    } catch (cause) {
        if (request === detailGeneration) detailError.value = message(cause);
    } finally {
        if (request === detailGeneration) detailLoading.value = false;
    }
};
const select = (id: string | null) => router.push({ query: { ...route.query, policy: id ?? undefined } });
watch(
    [
        () => props.nationId,
        () => props.area,
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
    <section aria-label="정책 변경 이력">
        <p>설정된 정책의 변경 이력입니다. 최초 관측 이전의 변경은 복원하지 않습니다.</p>
        <p v-if="loading" role="status">정책 이력 조회 중…</p>
        <p v-if="error" role="alert">{{ error }} <button class="legacy-button" @click="load()">다시 조회</button></p>
        <template v-if="data">
            <p v-if="data.coverage === 'IDENTITY_MISSING'">기수 식별자가 없어 정책 이력을 조회할 수 없습니다.</p>
            <p v-else-if="!data.items.length">선택한 기간에 기록된 버전이 없습니다. 변경이 없었다는 뜻은 아닙니다.</p>
            <div v-else class="table-scroll" tabindex="0" aria-label="정책 버전 목록">
                <table>
                    <thead>
                        <tr>
                            <th>버전</th>
                            <th>게임 시각</th>
                            <th>종류</th>
                            <th>당시 변경 주체</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in data.items" :key="item.id">
                            <th scope="row">
                                <button class="legacy-button" @click="select(item.id)">버전 {{ item.revision }}</button>
                            </th>
                            <td>{{ item.year }}년 {{ item.month }}월</td>
                            <td>{{ labels[item.source] }}</td>
                            <td v-if="item.actor">
                                {{ item.actor.name }} (#{{ item.actor.generalId }}) · 국가 #{{ item.actor.nationId }} ·
                                직책 {{ item.actor.officerLevel }}
                            </td>
                            <td v-else>관측 기준 · 변경 주체 미상</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <button v-if="data.nextCursor !== null" class="legacy-button" :disabled="loading" @click="load(true)">
                다음 정책 50개
            </button>
        </template>
        <section v-if="selected" aria-label="선택 정책 버전">
            <h3>선택 정책 버전 <button class="legacy-button" @click="select(null)">정책 상세 닫기</button></h3>
            <p v-if="detailLoading" role="status">정책 버전 조회 중…</p>
            <p v-if="detailError" role="alert">
                {{ detailError }} <button class="legacy-button" @click="loadDetail">버전 다시 조회</button>
            </p>
            <template v-if="detail">
                <p>
                    국가 #{{ detail.version.nationId }} · 버전 {{ detail.version.revision }} ·
                    {{ labels[detail.version.source] }} · {{ detail.version.year }}년 {{ detail.version.month }}월
                </p>
                <p>
                    기록 시각 {{ detail.version.createdAt }} · tick {{ detail.version.tick ?? '미상' }} · 순번
                    {{ detail.version.ordinal }}
                </p>
                <p v-if="detail.version.actor">
                    {{ detail.version.actor.name }} (#{{ detail.version.actor.generalId }}) · 당시 국가 #{{
                        detail.version.actor.nationId
                    }}
                    · 직책 {{ detail.version.actor.officerLevel }}
                </p>
                <p v-if="detail.version.source !== 'CHANGE'">
                    이 버전은 관측 기준입니다. 이전 값과 변경 주체를 추정하지 않습니다.
                </p>
                <p>
                    null은 개별 설정이 없음을 뜻합니다. 설정값을 기록하며 당시 NPC별 유효 값은 여기서 재계산하지
                    않습니다.
                </p>
                <div class="table-scroll" tabindex="0" aria-label="정책 전후 값">
                    <table>
                        <thead>
                            <tr>
                                <th>설정</th>
                                <th>변경 전</th>
                                <th>변경 후</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="field in detail.version.fields" :key="field.key">
                                <th scope="row">
                                    {{ fieldLabels[field.key] ?? field.key }} <span v-if="field.changed">(변경)</span>
                                </th>
                                <td>
                                    <pre>{{ field.beforeJson ?? '관측하지 않음' }}</pre>
                                </td>
                                <td>
                                    <pre>{{ field.afterJson }}</pre>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <button
                    v-if="detail.version.previousId"
                    class="legacy-button"
                    @click="select(detail.version.previousId)"
                >
                    이전 정책 버전
                </button>
                <details>
                    <summary>요청 연결</summary>
                    <p>요청 {{ detail.version.requestId ?? '해당 없음' }}</p>
                    <p>입력 순번 {{ detail.version.inputSequence ?? '해당 없음' }}</p>
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
    min-width: 640px;
    border-collapse: collapse;
}
th,
td {
    border: 1px solid gray;
    padding: 6px;
    text-align: left;
}
pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-width: 400px;
    font: inherit;
    margin: 0;
}
h3 {
    font-size: var(--sammo-font-size-normal);
}
[role='alert'] {
    color: #ffb9b9;
}
details {
    overflow-wrap: anywhere;
}
</style>
