<script setup lang="ts">
import { ref, watch } from 'vue';
import { trpc } from '../utils/trpc';
import { fieldLabels } from './playAudit/policyLabels';

const props = defineProps<{ revision: number }>();
type History = Awaited<ReturnType<typeof trpc.npc.policyHistory.query>>;
type Version = Awaited<ReturnType<typeof trpc.npc.policyVersion.query>>;
const open = ref(false);
const area = ref<'NPC_VALUES' | 'NPC_NATION_PRIORITY' | 'NPC_GENERAL_PRIORITY'>('NPC_VALUES');
const history = ref<History | null>(null);
const version = ref<Version | null>(null);
const loading = ref(false);
const error = ref('');
const labels = { BASELINE: '최초 관측', CHANGE: '변경', OBSERVED_GAP: '관측 누락 이후 기준' };
let generation = 0;
const load = async (append = false) => {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    if (!append) {
        history.value = null;
        version.value = null;
    }
    try {
        const response = await trpc.npc.policyHistory.query({
            area: area.value,
            cursor: append ? (history.value?.nextCursor ?? undefined) : undefined,
        });
        if (request === generation)
            history.value = {
                ...response,
                items: append ? [...(history.value?.items ?? []), ...response.items] : response.items,
            };
    } catch (cause) {
        if (request === generation)
            error.value = cause instanceof Error ? cause.message : '이력을 조회하지 못했습니다.';
    } finally {
        if (request === generation) loading.value = false;
    }
};
const select = async (id: string) => {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    version.value = null;
    try {
        const response = await trpc.npc.policyVersion.query({ id });
        if (request === generation) version.value = response;
    } catch (cause) {
        if (request === generation)
            error.value = cause instanceof Error ? cause.message : '변경 내용을 조회하지 못했습니다.';
    } finally {
        if (request === generation) loading.value = false;
    }
};
watch([open, area, () => props.revision], () => {
    if (open.value) void load();
    else {
        ++generation;
        loading.value = false;
        history.value = null;
        version.value = null;
    }
});
</script>

<template>
    <section class="npc-policy-history" aria-label="NPC 정책 변경 이력">
        <button class="legacy-button" :aria-expanded="open" @click="open = !open">
            정책 변경 이력 {{ open ? '닫기' : '조회' }}
        </button>
        <div v-if="open">
            <p>자국의 현재 기수 기록입니다. 최초 관측 이전의 변경은 복원하지 않습니다.</p>
            <p>우선순위는 실행을 시도하는 순서입니다. 징병은 전쟁 상태·병력·인구·자원 조건을 만족해야 합니다.</p>
            <p>0이면 자동 계산하는 항목은 저장값이 같아도 기술·내정 비용에 따라 기준이 달라질 수 있습니다.</p>
            <label
                >이력 종류
                <select v-model="area">
                    <option value="NPC_VALUES">국가 정책</option>
                    <option value="NPC_NATION_PRIORITY">국가턴 우선순위</option>
                    <option value="NPC_GENERAL_PRIORITY">일반턴 우선순위</option>
                </select>
            </label>
            <button class="legacy-button" :disabled="loading" @click="load()">이력 새로고침</button>
            <p v-if="loading" role="status">조회 중…</p>
            <p v-if="error" role="alert">{{ error }}</p>
            <template v-if="history">
                <p v-if="history.historyGap" role="status">
                    {{ history.historyGap.firstYear }}년 {{ history.historyGap.firstMonth }}월 이후 일부 기록에 누락이
                    있습니다. 이력이 없다는 사실만으로 변경이 없었다고 판단할 수 없습니다.
                </p>
                <p v-if="history.coverage === 'IDENTITY_MISSING'">기수 식별자가 없어 이력을 조회할 수 없습니다.</p>
                <p v-else-if="!history.items.length">기록된 정책 이력이 없습니다.</p>
                <ol v-else>
                    <li v-for="item in history.items" :key="item.id">
                        <button class="legacy-button" :disabled="loading" @click="select(item.id)">
                            버전 {{ item.revision }}
                        </button>
                        {{ item.year }}년 {{ item.month }}월 · {{ labels[item.source] }} ·
                        {{ item.actor ? `${item.actor.name} (#${item.actor.generalId})` : '변경 주체 미상' }}
                    </li>
                </ol>
                <button
                    v-if="history.nextCursor !== null"
                    class="legacy-button"
                    :disabled="loading"
                    @click="load(true)"
                >
                    이전 기록 더 보기
                </button>
            </template>
            <section v-if="version" aria-label="정책 변경 내용">
                <h3>버전 {{ version.revision }} · {{ version.actor?.name ?? '변경 주체 미상' }}</h3>
                <p>{{ version.year }}년 {{ version.month }}월 · 기록 시각 {{ version.createdAt }}</p>
                <p v-if="version.source !== 'CHANGE'">관측 기준입니다. 이전 값과 변경 주체를 추정하지 않습니다.</p>
                <p>null은 개별 설정 없이 기본값을 상속함을 뜻합니다.</p>
                <div class="table-scroll" tabindex="0" aria-label="정책 변경 전후 값">
                    <table>
                        <thead>
                            <tr>
                                <th>설정</th>
                                <th>변경 전</th>
                                <th>변경 후</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="field in version.fields" :key="field.key" :class="{ changed: field.changed }">
                                <th scope="row">
                                    {{ fieldLabels[field.key] ?? field.key }}{{ field.changed ? ' (변경)' : '' }}
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
            </section>
        </div>
    </section>
</template>

<style scoped>
.npc-policy-history {
    margin-top: 16px;
    padding: 8px;
    border: 1px solid gray;
}
select,
button {
    margin: 4px;
    vertical-align: middle;
}
li {
    margin-block: 6px;
}
.table-scroll {
    overflow-x: auto;
}
table {
    width: 100%;
    border-collapse: collapse;
}
th,
td {
    border: 1px solid gray;
    padding: 6px;
    text-align: left;
    vertical-align: middle;
}
pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    min-width: 100px;
    margin: 0;
    font: inherit;
}
.changed {
    background: #343425;
}
[role='alert'] {
    color: #ffb9b9;
}
h3 {
    font-size: var(--sammo-font-size-normal);
}
</style>
