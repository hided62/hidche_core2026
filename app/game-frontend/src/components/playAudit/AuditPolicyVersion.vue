<script setup lang="ts">
import { ref, watch } from 'vue';
import { trpc } from '../../utils/trpc';
const props = withDefaults(defineProps<{ id: string; allowPrevious?: boolean }>(), { allowPrevious: true });
const emit = defineEmits<{ select: [id: string | null] }>();
type Detail = Awaited<ReturnType<typeof trpc.playAudit.policyVersion.query>>;
const detail = ref<Detail | null>(null);
const detailError = ref('');
const detailLoading = ref(false);
let detailGeneration = 0;
const select = (id: string | null) => emit('select', id);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : '정책 버전을 조회하지 못했습니다.');
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
const loadDetail = async () => {
    const request = ++detailGeneration;
    detail.value = null;
    detailError.value = '';
    detailLoading.value = false;
    if (!props.id) return;
    detailLoading.value = true;
    try {
        const response = await trpc.playAudit.policyVersion.query({ id: props.id });
        if (request === detailGeneration) detail.value = response;
    } catch (cause) {
        if (request === detailGeneration) detailError.value = message(cause);
    } finally {
        if (request === detailGeneration) detailLoading.value = false;
    }
};
watch(
    () => props.id,
    () => {
        void loadDetail();
    },
    { immediate: true }
);
</script>
<template>
    <section aria-label="선택 정책 버전">
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
                null은 개별 설정이 없음을 뜻합니다. 설정값을 기록하며 당시 NPC별 유효 값은 여기서 재계산하지 않습니다.
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
                v-if="allowPrevious && detail.version.previousId"
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
