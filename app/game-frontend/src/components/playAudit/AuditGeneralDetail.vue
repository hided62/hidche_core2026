<script setup lang="ts">
import { ref, watch } from 'vue';
import PanelCard from '../ui/PanelCard.vue';
import { trpc } from '../../utils/trpc';
const props = defineProps<{ generalId: number; at?: { year: number; month: number; kind: 'MONTH_END' | 'FINAL' } }>();
defineEmits<{ close: [] }>();
type Detail = Awaited<ReturnType<typeof trpc.playAudit.generalDetail.query>>;
type Turns = Awaited<ReturnType<typeof trpc.playAudit.generalTurns.query>>;
const data = ref<Detail | null>(null);
const turns = ref<Turns | null>(null);
const loading = ref(false);
const turnsLoading = ref(false);
const error = ref('');
const turnsError = ref('');
let generation = 0;
const format = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const load = async () => {
    const request = ++generation;
    data.value = null;
    turns.value = null;
    error.value = '';
    turnsError.value = '';
    loading.value = true;
    turnsLoading.value = false;
    try {
        const response = await trpc.playAudit.generalDetail.query({ id: props.generalId, at: props.at });
        if (request === generation) data.value = response;
    } catch (cause) {
        if (request === generation)
            error.value = cause instanceof Error ? cause.message : '장수 상세를 조회하지 못했습니다.';
    } finally {
        if (request === generation) loading.value = false;
    }
};
const loadTurns = async (more = false) => {
    if (props.at || turnsLoading.value) return;
    const request = generation;
    turnsLoading.value = true;
    turnsError.value = '';
    try {
        const response = await trpc.playAudit.generalTurns.query({
            generalId: props.generalId,
            limit: 50,
            cursor: more ? (turns.value?.nextCursor ?? undefined) : undefined,
        });
        if (request === generation)
            turns.value = {
                ...response,
                items: more ? [...(turns.value?.items ?? []), ...response.items] : response.items,
            };
    } catch (cause) {
        if (request === generation)
            turnsError.value = cause instanceof Error ? cause.message : '예약 명령을 조회하지 못했습니다.';
    } finally {
        if (request === generation) turnsLoading.value = false;
    }
};
watch(
    () => [props.generalId, props.at] as const,
    () => {
        void load();
    },
    { immediate: true }
);
</script>

<template>
    <PanelCard
        title="선택 장수 상세"
        :subtitle="at ? `${at.year}년 ${at.month}월 ${at.kind === 'FINAL' ? '최종 표본' : '월말'}` : '현재 상태'"
    >
        <template #actions><button class="legacy-button" @click="$emit('close')">상세 닫기</button></template>
        <p v-if="loading" role="status">상세 조회 중…</p>
        <p v-if="error" role="alert">{{ error }} <button class="legacy-button" @click="load">다시 조회</button></p>
        <template v-if="data">
            <p v-if="!data.collected">선택한 시점의 표본이 없습니다.</p>
            <p v-else-if="!data.general">선택한 시점에 해당 장수가 없습니다.</p>
            <template v-else>
                <h3>{{ data.general.name }} (#{{ data.general.id }})</h3>
                <p>
                    국가 {{ data.nation?.name ?? `#${data.general.nationId}` }} · 도시
                    {{ data.city?.name ?? `#${data.general.cityId}` }} · 부대 #{{ data.general.troopId }}
                </p>
                <p>
                    금 {{ format(data.general.gold) }} · 쌀 {{ format(data.general.rice) }} · 병력
                    {{ format(data.general.crew) }} · 훈련 {{ data.general.train }} · 사기 {{ data.general.atmos }}
                </p>
                <p>
                    통솔 {{ data.general.stats.leadership }} · 무력 {{ data.general.stats.strength }} · 지력
                    {{ data.general.stats.intelligence }} · 경험 {{ format(data.general.experience) }} · 공헌
                    {{ format(data.general.dedication) }}
                </p>
                <p>숙련 (보 / 궁 / 기 / 귀 / 차): {{ Object.values(data.general.dex).map(format).join(' / ') }}</p>
                <p v-if="at">과거 예약 명령은 월말 표본에 포함되지 않습니다.</p>
                <button v-else class="legacy-button" :disabled="turnsLoading" @click="loadTurns()">
                    현재 예약 명령 조회
                </button>
                <p v-if="turnsLoading" role="status">예약 조회 중…</p>
                <p v-if="turnsError" role="alert">{{ turnsError }}</p>
                <template v-if="turns">
                    <p>예약 조회 시각 {{ turns.asOf }} · tick {{ turns.tick ?? '없음' }}</p>
                    <p v-if="!turns.generalExists">현재 해당 장수가 없습니다.</p>
                    <p v-else-if="!turns.items.length">저장된 예약 명령이 없습니다.</p>
                    <ol class="turns">
                        <li v-for="turn in turns.items" :key="turn.turnIdx">
                            위치 {{ turn.turnIdx }}: {{ turn.actionCode }} <code>{{ turn.argumentJson }}</code>
                        </li>
                    </ol>
                    <button
                        v-if="turns.nextCursor !== null"
                        class="legacy-button"
                        :disabled="turnsLoading"
                        @click="loadTurns(true)"
                    >
                        예약 더 불러오기
                    </button>
                </template>
            </template>
        </template>
    </PanelCard>
</template>

<style scoped>
h3 {
    font-size: var(--sammo-font-size-normal);
    font-weight: bold;
}
.turns {
    padding-left: 24px;
}
.turns li {
    overflow-wrap: anywhere;
    padding: 4px 0;
}
[role='alert'] {
    color: #ffb9b9;
}
</style>
