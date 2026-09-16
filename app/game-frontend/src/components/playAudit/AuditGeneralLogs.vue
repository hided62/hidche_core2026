<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import GeneralRecordPanels from '../main/GeneralRecordPanels.vue';
import type { GeneralRecordType } from '../generalRecords';
import { formatLog } from '../../utils/formatLog';
import { trpc } from '../../utils/trpc';
const props = defineProps<{ generalId: number; month?: { year: number; month: number } }>();
type LogPage = Awaited<ReturnType<typeof trpc.playAudit.generalLogs.query>>;
const type = ref<GeneralRecordType>('generalHistory');
const pages = ref<Partial<Record<GeneralRecordType, LogPage>>>({});
const errors = ref<Partial<Record<GeneralRecordType, string>>>({});
const loading = ref<Partial<Record<GeneralRecordType, boolean>>>({});
let generation = 0;
const records = computed(() =>
    Object.fromEntries(
        Object.entries(pages.value).map(([key, page]) => [
            key,
            page.items.map((item) => ({ id: item.id, content: formatLog(item.text) })),
        ])
    )
);
const load = async (target: GeneralRecordType, more = false) => {
    if (loading.value[target]) return;
    const request = generation;
    loading.value[target] = true;
    errors.value[target] = '';
    try {
        const response = await trpc.playAudit.generalLogs.query({
            generalId: props.generalId,
            type: target,
            month: props.month,
            limit: 50,
            cursor: more ? (pages.value[target]?.nextCursor ?? undefined) : undefined,
        });
        if (request === generation)
            pages.value[target] = {
                ...response,
                items: more ? [...(pages.value[target]?.items ?? []), ...response.items] : response.items,
            };
    } catch (cause) {
        if (request === generation)
            errors.value[target] = cause instanceof Error ? cause.message : '기록을 조회하지 못했습니다.';
    } finally {
        if (request === generation) loading.value[target] = false;
    }
};
watch(
    [() => props.generalId, () => props.month?.year, () => props.month?.month],
    () => {
        generation++;
        pages.value = {};
        errors.value = {};
        loading.value = {};
        void load(type.value);
    },
    { immediate: true }
);
watch(type, (target) => {
    if (!pages.value[target]) void load(target);
});
</script>

<template>
    <div class="audit-logs">
        <label
            >기록 종류
            <select v-model="type" class="legacy-sort-select" aria-label="기록 종류">
                <option value="generalHistory">장수 열전</option>
                <option value="generalAction">개인 기록</option>
                <option value="battleResult">전투 결과</option>
                <option value="battleDetail">전투 기록</option>
            </select></label
        >
        <p>
            {{ month ? `${month.year}년 ${month.month}월 전체 기록` : '현재 기수 기록' }} · 기수가 확인되는 로그만
            표시합니다. 도입 이전의 식별자 없는 기록은 포함하지 않습니다.
        </p>
        <p v-if="pages[type]?.coverage === 'IDENTITY_MISSING'">게임의 기수 식별자가 없어 기록을 구분할 수 없습니다.</p>
        <GeneralRecordPanels
            :types="[type]"
            :records="records"
            :loading="loading[type]"
            :errors="errors"
            trusted-html
            @retry="load($event)"
        />
        <button
            v-if="pages[type]?.nextCursor != null"
            class="legacy-button"
            :disabled="loading[type]"
            @click="load(type, true)"
        >
            기록 더 불러오기
        </button>
    </div>
</template>

<style scoped>
.audit-logs {
    display: grid;
    gap: 8px;
    margin-top: 12px;
    min-width: 0;
    overflow-wrap: anywhere;
}
</style>
