<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatOfficerLevelText } from '../utils/nationFormat';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getGeneralList.query>>;
type General = Result['generals'][number];
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
const data = ref<Result | null>(null);
const error = ref('');
const loading = ref(false);
const sort = ref<Sort>(1);
const options = [
    '관직',
    '계급',
    '명성',
    '통솔',
    '무력',
    '지력',
    '자금',
    '군량',
    '병사',
    '벌점',
    '성격',
    '내특',
    '전특',
    '사관',
    'NPC',
];
const visibleCrew = (general: General): number | null => ('crew' in general ? general.crew : null);
const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        data.value = await trpc.nation.getGeneralList.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력 장수를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};
const generals = computed(() =>
    [...(data.value?.generals ?? [])].sort((a, b) => {
        if (sort.value === 1) return b.officerLevel - a.officerLevel || a.id - b.id;
        if (sort.value === 2) return b.dedicationLevel - a.dedicationLevel || a.id - b.id;
        if (sort.value === 3) return b.experienceLevel - a.experienceLevel || a.id - b.id;
        if (sort.value === 4) return b.stats.leadership - a.stats.leadership || a.id - b.id;
        if (sort.value === 5) return b.stats.strength - a.stats.strength || a.id - b.id;
        if (sort.value === 6) return b.stats.intelligence - a.stats.intelligence || a.id - b.id;
        if (sort.value === 7) return b.gold - a.gold || a.id - b.id;
        if (sort.value === 8) return b.rice - a.rice || a.id - b.id;
        if (sort.value === 9) return (visibleCrew(b) ?? -1) - (visibleCrew(a) ?? -1) || a.id - b.id;
        if (sort.value === 10) return b.refreshScoreTotal - a.refreshScoreTotal || a.id - b.id;
        if (sort.value === 11) return (a.personality?.name ?? '').localeCompare(b.personality?.name ?? '');
        if (sort.value === 12) return (a.specialDomestic?.name ?? '').localeCompare(b.specialDomestic?.name ?? '');
        if (sort.value === 13) return (a.specialWar?.name ?? '').localeCompare(b.specialWar?.name ?? '');
        if (sort.value === 14) return b.belong - a.belong || a.id - b.id;
        if (sort.value === 15) return b.npcState - a.npcState || a.id - b.id;
        return a.id - b.id;
    })
);
const special = (general: General) => `${general.specialDomestic?.name ?? '-'} / ${general.specialWar?.name ?? '-'}`;
onMounted(load);
</script>

<template>
    <main class="general-page legacy-bg0">
        <header>
            <strong>세력 장수</strong>
            <span
                ><RouterLink to="/">돌아가기</RouterLink>
                <button :disabled="loading" @click="load">새로고침</button></span
            >
        </header>
        <section class="sort">
            정렬순서 :
            <select v-model.number="sort" aria-label="세력 장수 정렬">
                <option v-for="(label, index) in options" :key="label" :value="index + 1">{{ label }}</option>
            </select>
            <button>정렬하기</button>
            <small v-if="data">열람 등급 {{ data.viewer.permission }}</small>
        </section>
        <p v-if="error" class="state error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state">불러오는 중...</p>
        <div v-else class="scroll">
            <table id="nation-general-list">
                <thead>
                    <tr>
                        <th>이 름</th>
                        <th>관 직</th>
                        <th>통무지</th>
                        <th>명성/계급</th>
                        <th>자금</th>
                        <th>군량</th>
                        <th>도시</th>
                        <th>부대</th>
                        <th>병사</th>
                        <th>성격</th>
                        <th>특기</th>
                        <th>사관</th>
                        <th>벌점</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="general in generals" :key="general.id">
                        <td :class="`npc-${general.npcState}`">{{ general.name }}</td>
                        <td>{{ formatOfficerLevelText(general.officerLevel, data?.nation.level) }}</td>
                        <td>
                            {{ general.stats.leadership }}∥{{ general.stats.strength }}∥{{ general.stats.intelligence }}
                        </td>
                        <td>
                            Lv {{ general.experienceLevel }}<br />{{
                                general.dedicationLevel ? `${11 - general.dedicationLevel}품관` : '무품관'
                            }}
                        </td>
                        <td>{{ general.gold.toLocaleString() }}</td>
                        <td>{{ general.rice.toLocaleString() }}</td>
                        <td>{{ general.cityName ?? '?' }}</td>
                        <td>{{ general.troopName ?? '?' }}</td>
                        <td>{{ visibleCrew(general)?.toLocaleString() ?? '?' }}</td>
                        <td :title="general.personality?.info ?? ''">{{ general.personality?.name ?? '-' }}</td>
                        <td
                            :title="
                                [general.specialDomestic?.info, general.specialWar?.info].filter(Boolean).join('\n')
                            "
                        >
                            {{ special(general) }}
                        </td>
                        <td>{{ general.belong }}</td>
                        <td>{{ general.refreshScoreTotal }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <footer><RouterLink to="/">돌아가기</RouterLink></footer>
    </main>
</template>

<style scoped>
.general-page {
    width: 1000px;
    min-height: 100vh;
    margin: 8px auto 0;
    font:
        16px 'Times New Roman',
        serif;
    color: #fff;
}
header,
.sort,
footer,
.state {
    position: relative;
    border: 1px solid #777;
    padding: 4px;
    text-align: center;
}
header {
    min-height: 39px;
    display: flex;
    align-items: center;
    justify-content: center;
}
header span {
    position: absolute;
    right: 6px;
}
button,
select {
    border: 1px solid #888;
    border-radius: 2px;
    background: #222;
    color: #fff;
    padding: 1px 6px;
}
.sort small {
    float: right;
    margin-right: 6px;
    color: #ccc;
}
.scroll {
    width: 1030px;
    margin-left: -15px;
    min-height: calc(100vh - 112px);
    overflow: auto;
}
table {
    width: 1030px;
    min-width: 1030px;
    border-collapse: separate;
    table-layout: fixed;
}
th,
td {
    border: 1px solid #777;
    padding: 3px;
    text-align: center;
    overflow-wrap: anywhere;
}
th {
    height: 30px;
    background: #14241b url('/image/game/back_green.jpg');
    font-weight: 400;
}
tbody tr {
    height: 66px;
    background: rgb(0 0 0 / 18%);
}
.npc-1 {
    color: cyan;
}
.npc-2,
.npc-3,
.npc-4,
.npc-5 {
    color: #aaa;
}
.error {
    color: #ff7373;
}
@media (max-width: 1000px) {
    .general-page {
        margin: 8px 0 0;
    }
}
</style>
