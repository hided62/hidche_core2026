<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { trpc } from '../utils/trpc';
type Result = Awaited<ReturnType<typeof trpc.nation.getSecretGeneralList.query>>;
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const data = ref<Result | null>(null);
const error = ref('');
const loading = ref(false);
const sort = ref<Sort>(7);
const options = ['자금', '군량', '도시', '병종', '병사', '삭제턴', '턴', '부대'];
const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        data.value = await trpc.nation.getSecretGeneralList.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '암행부를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};
const generals = computed(() =>
    [...(data.value?.generals ?? [])].sort((a, b) => {
        if (sort.value === 1) return b.gold - a.gold || a.id - b.id;
        if (sort.value === 2) return b.rice - a.rice || a.id - b.id;
        if (sort.value === 3) return a.cityId - b.cityId || a.id - b.id;
        if (sort.value === 4) return b.crewTypeId - a.crewTypeId || a.id - b.id;
        if (sort.value === 5) return b.crew - a.crew || a.id - b.id;
        if (sort.value === 6) return a.killTurn - b.killTurn || a.id - b.id;
        if (sort.value === 7) return a.turnTime.localeCompare(b.turnTime) || a.id - b.id;
        return b.troopId - a.troopId || a.id - b.id;
    })
);
onMounted(load);
</script>

<template>
    <main class="secret-page">
        <table class="layout legacy-bg0 title">
            <tbody>
                <tr>
                    <td>암 행 부<br /><RouterLink to="/">창 닫기</RouterLink></td>
                </tr>
                <tr>
                    <td>
                        정렬순서 :
                        <select v-model.number="sort" aria-label="암행부 정렬">
                            <option v-for="(label, index) in options" :key="label" :value="index + 1">
                                {{ label }}
                            </option>
                        </select>
                        <button>정렬하기</button> <button :disabled="loading" @click="load">새로고침</button>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="state error legacy-bg0" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state legacy-bg0">불러오는 중...</p>
        <template v-else-if="data">
            <table class="layout summary legacy-bg0">
                <tbody>
                    <tr>
                        <th>전체 금</th>
                        <td>{{ data.summary.gold.toLocaleString() }}</td>
                        <th>전체 쌀</th>
                        <td>{{ data.summary.rice.toLocaleString() }}</td>
                        <th>평균 금</th>
                        <td>{{ data.summary.averageGold.toFixed(2) }}</td>
                        <th>평균 쌀</th>
                        <td>{{ data.summary.averageRice.toFixed(2) }}</td>
                    </tr>
                    <tr>
                        <th>전체 병력/장수</th>
                        <td>{{ data.summary.crew.toLocaleString() }}/{{ data.summary.generalCount }}</td>
                        <template v-for="level in [90, 80, 60] as const" :key="level"
                            ><th>훈사 {{ level }} 병력/장수</th>
                            <td>
                                {{ data.summary.readiness[level].crew.toLocaleString() }}/{{
                                    data.summary.readiness[level].generals
                                }}
                            </td></template
                        >
                    </tr>
                </tbody>
            </table>
            <table id="secret-general-list" class="layout list legacy-bg0">
                <thead>
                    <tr>
                        <th>이 름</th>
                        <th>통무지</th>
                        <th>부 대</th>
                        <th>자 금</th>
                        <th>군 량</th>
                        <th>도시</th>
                        <th>守</th>
                        <th>병 종</th>
                        <th>병 사</th>
                        <th>훈련</th>
                        <th>사기</th>
                        <th class="commands">명 령</th>
                        <th>삭턴</th>
                        <th>턴</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="general in generals" :key="general.id">
                        <td>{{ general.name }}<br />Lv {{ general.experienceLevel }}</td>
                        <td>
                            {{ general.stats.leadership }}∥{{ general.stats.strength }}∥{{ general.stats.intelligence }}
                        </td>
                        <td>{{ general.troopName ?? '-' }}</td>
                        <td>{{ general.gold }}</td>
                        <td>{{ general.rice }}</td>
                        <td>{{ general.cityName ?? '-' }}</td>
                        <td>{{ general.defenceTrainText }}</td>
                        <td>{{ general.crewTypeId }}</td>
                        <td>{{ general.crew }}</td>
                        <td>{{ general.train }}</td>
                        <td>{{ general.atmos }}</td>
                        <td class="turns">
                            <template v-if="general.npcState >= 2">NPC 장수</template
                            ><template v-else
                                ><div v-for="(command, index) in general.reservedCommands" :key="index">
                                    {{ index + 1 }} : {{ command }}
                                </div></template
                            >
                        </td>
                        <td>{{ general.killTurn }}</td>
                        <td>{{ general.turnTime.slice(11, 16) }}</td>
                    </tr>
                </tbody>
            </table>
        </template>
        <table class="layout legacy-bg0 footer">
            <tbody>
                <tr>
                    <td><RouterLink to="/">창 닫기</RouterLink></td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.secret-page {
    width: 1000px;
    margin: 8px auto 0;
    font:
        16px 'Times New Roman',
        serif;
    color: #fff;
}
.layout {
    width: 1000px;
    border-collapse: collapse;
    table-layout: fixed;
}
td,
th,
.state {
    border: 1px solid #777;
    padding: 3px;
    text-align: center;
    font-weight: 400;
}
button,
select {
    border: 1px solid #888;
    border-radius: 2px;
    background: #222;
    color: #fff;
    padding: 1px 6px;
}
.summary {
    margin: 5px auto;
}
.summary th,
.list th {
    background: #14241b url('/image/game/back_green.jpg');
}
.summary th {
    width: 120px;
}
.list {
    width: 1030px;
    margin-left: -15px;
    border-collapse: separate;
}
.list tbody tr {
    height: 39px;
}
.commands {
    width: 213px;
}
.turns {
    text-align: left;
    font-size: 11px;
}
.error {
    color: #ff7373;
}
.footer {
    margin-top: 5px;
}
@media (max-width: 1000px) {
    .secret-page {
        margin: 8px 0 0;
    }
}
</style>
