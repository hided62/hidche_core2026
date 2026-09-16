<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { trpc } from '../../utils/trpc';
import AuditPolicyVersion from './AuditPolicyVersion.vue';

const props = defineProps<{
    nationId: number;
    area: 'NPC_VALUES' | 'NPC_NATION_PRIORITY' | 'NPC_GENERAL_PRIORITY' | 'DEFENCE';
    from: { year: number; month: number };
    to: { year: number; month: number };
}>();
type History = Awaited<ReturnType<typeof trpc.playAudit.policyHistory.query>>;
const route = useRoute();
const router = useRouter();
const data = ref<History | null>(null);
const error = ref('');
const loading = ref(false);
let generation = 0;
const selected = computed(() => (typeof route.query.policy === 'string' ? route.query.policy : null));
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
        <AuditPolicyVersion v-if="selected" :id="selected" @select="select" />
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
