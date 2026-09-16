<script setup lang="ts">
import { ref, watch } from 'vue';
import PanelCard from '../ui/PanelCard.vue';
import { trpc } from '../../utils/trpc';
const props = defineProps<{
    cityId: number;
    at?: { year: number; month: number; kind: 'MONTH_END' | 'FINAL' | 'INITIAL' };
}>();
defineEmits<{ close: []; generals: [cityId: number] }>();
type Detail = Awaited<ReturnType<typeof trpc.playAudit.cityDetail.query>>;
const data = ref<Detail | null>(null);
const error = ref('');
const loading = ref(false);
let generation = 0;
const load = async () => {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    data.value = null;
    try {
        const response = await trpc.playAudit.cityDetail.query({ id: props.cityId, at: props.at });
        if (request === generation) data.value = response;
    } catch (cause) {
        if (request === generation)
            error.value = cause instanceof Error ? cause.message : '도시 상세를 조회하지 못했습니다.';
    } finally {
        if (request === generation) loading.value = false;
    }
};
const format = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
watch(
    [() => props.cityId, () => props.at?.year, () => props.at?.month, () => props.at?.kind],
    () => {
        void load();
    },
    { immediate: true }
);
</script>

<template>
    <PanelCard
        title="선택 도시 상세"
        :subtitle="
            at
                ? `${at.year}년 ${at.month}월 ${at.kind === 'FINAL' ? '최종 표본' : at.kind === 'INITIAL' ? '수집 시작 기준' : '월말'}`
                : '현재 상태'
        "
    >
        <template #actions><button class="legacy-button" @click="$emit('close')">상세 닫기</button></template>
        <p v-if="loading" role="status">도시 조회 중…</p>
        <p v-if="error" role="alert">{{ error }} <button class="legacy-button" @click="load">다시 조회</button></p>
        <template v-if="data">
            <p v-if="!data.collected">선택한 시점의 표본이 없습니다.</p>
            <p v-else-if="!data.city">선택한 시점에 해당 도시가 없습니다.</p>
            <template v-else>
                <h3>
                    {{ data.city.name }} (#{{ data.city.id }}) ·
                    {{ data.nation?.name ?? `국가 #${data.city.nationId}` }}
                </h3>
                <dl class="city-values">
                    <div>
                        <dt>인구</dt>
                        <dd>{{ format(data.city.population) }} / {{ format(data.city.populationMax) }}</dd>
                    </div>
                    <div>
                        <dt>농업</dt>
                        <dd>{{ format(data.city.agriculture) }} / {{ format(data.city.agricultureMax) }}</dd>
                    </div>
                    <div>
                        <dt>상업</dt>
                        <dd>{{ format(data.city.commerce) }} / {{ format(data.city.commerceMax) }}</dd>
                    </div>
                    <div>
                        <dt>치안</dt>
                        <dd>{{ format(data.city.security) }} / {{ format(data.city.securityMax) }}</dd>
                    </div>
                    <div>
                        <dt>성벽</dt>
                        <dd>{{ format(data.city.wall) }} / {{ format(data.city.wallMax) }}</dd>
                    </div>
                    <div>
                        <dt>수비</dt>
                        <dd>{{ format(data.city.defence) }} / {{ format(data.city.defenceMax) }}</dd>
                    </div>
                    <div>
                        <dt>민심 / 보급 / 전방 / 상태 / 규모</dt>
                        <dd>
                            {{ data.city.trust }} / {{ data.city.supplyState }} / {{ data.city.frontState }} /
                            {{ data.city.state }} / {{ data.city.level }}
                        </dd>
                    </div>
                </dl>
                <button class="legacy-button" @click="$emit('generals', data.city.id)">
                    이 시점의 모든 국가 주둔 장수
                </button>
            </template>
        </template>
    </PanelCard>
</template>

<style scoped>
h3 {
    font-size: var(--sammo-font-size-normal);
    font-weight: bold;
}
.city-values {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 8px 0;
}
dt {
    font-weight: bold;
}
dd {
    margin: 0;
}
[role='alert'] {
    color: #ffb9b9;
}
</style>
