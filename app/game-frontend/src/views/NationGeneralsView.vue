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
const sortOptions = [
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

const load = async () => {
    if (loading.value) return;
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

const sortedGenerals = computed(() =>
    [...(data.value?.generals ?? [])].sort((left, right) => {
        const key = sort.value;
        if (key === 1) return right.officerLevel - left.officerLevel || left.id - right.id;
        if (key === 2) return right.dedicationLevel - left.dedicationLevel || left.id - right.id;
        if (key === 3) return right.experienceLevel - left.experienceLevel || left.id - right.id;
        if (key === 4) return right.stats.leadership - left.stats.leadership || left.id - right.id;
        if (key === 5) return right.stats.strength - left.stats.strength || left.id - right.id;
        if (key === 6) return right.stats.intelligence - left.stats.intelligence || left.id - right.id;
        if (key === 7) return right.gold - left.gold || left.id - right.id;
        if (key === 8) return right.rice - left.rice || left.id - right.id;
        if (key === 9) return (right.detail?.crew ?? -1) - (left.detail?.crew ?? -1) || left.id - right.id;
        if (key === 10) return right.refreshScoreTotal - left.refreshScoreTotal || left.id - right.id;
        if (key === 11) return (left.personality?.name ?? '').localeCompare(right.personality?.name ?? '');
        if (key === 12) return (left.specialDomestic?.name ?? '').localeCompare(right.specialDomestic?.name ?? '');
        if (key === 13) return (left.specialWar?.name ?? '').localeCompare(right.specialWar?.name ?? '');
        if (key === 14) return right.belong - left.belong || left.id - right.id;
        return right.npcState - left.npcState || left.id - right.id;
    })
);

const imageUrl = (general: General): string => {
    const picture = general.picture || 'default.jpg';
    return general.imageServer ? `${import.meta.env.BASE_URL}d_pic/${picture}` : `/image/icons/${picture}`;
};
const specialText = (general: General): string =>
    `${general.specialDomestic?.name ?? '-'} / ${general.specialWar?.name ?? '-'}`;

onMounted(load);
</script>

<template>
    <main class="general-page legacy-bg0">
        <header class="top-bar">
            <strong>세력 장수</strong>
            <span class="toolbar">
                <RouterLink to="/">돌아가기</RouterLink>
                <button type="button" :disabled="loading" @click="load">새로고침</button>
            </span>
        </header>
        <section class="sort-bar">
            정렬순서 :
            <select v-model.number="sort" aria-label="세력 장수 정렬">
                <option v-for="(label, index) in sortOptions" :key="label" :value="index + 1">{{ label }}</option>
            </select>
            <button type="button">정렬하기</button>
            <span v-if="data" class="permission">열람 등급 {{ data.viewer.permission }}</span>
        </section>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state">불러오는 중...</p>
        <div v-else class="grid-scroll">
            <table id="nation-general-list" class="general-table">
                <thead>
                    <tr>
                        <th class="icon-column">아이콘</th>
                        <th class="name-column">장수명</th>
                        <th>관직</th>
                        <th>통|무|지</th>
                        <th>명성/계급</th>
                        <th>금/쌀</th>
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
                    <tr v-for="general in sortedGenerals" :key="general.id">
                        <td class="icon"><img :src="imageUrl(general)" width="64" height="64" alt="" /></td>
                        <td class="name" :class="`npc-${general.npcState}`">
                            <RouterLink :to="`/battle-center?generalId=${general.id}`">{{ general.name }}</RouterLink>
                        </td>
                        <td>{{ formatOfficerLevelText(general.officerLevel, data?.nation.level) }}</td>
                        <td>
                            <span :class="{ wounded: general.injury > 0 }">{{ general.stats.leadership }}</span
                            ><span v-if="general.leadershipBonus" class="bonus">+{{ general.leadershipBonus }}</span>
                            | <span :class="{ wounded: general.injury > 0 }">{{ general.stats.strength }}</span> |
                            <span :class="{ wounded: general.injury > 0 }">{{ general.stats.intelligence }}</span>
                        </td>
                        <td>Lv {{ general.experienceLevel }}<br />{{ general.dedicationLevelText }}</td>
                        <td>{{ general.gold.toLocaleString() }}<br />{{ general.rice.toLocaleString() }}</td>
                        <td>{{ general.detail?.cityName ?? '?' }}</td>
                        <td>{{ general.detail?.troopName ?? (general.detail ? '-' : '?') }}</td>
                        <td>{{ general.detail?.crew.toLocaleString() ?? '?' }}</td>
                        <td :title="general.personality?.info ?? ''">{{ general.personality?.name ?? '-' }}</td>
                        <td
                            :title="[general.specialDomestic?.info, general.specialWar?.info].filter(Boolean).join('\\n')"
                        >
                            {{ specialText(general) }}
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
    margin: 0 auto;
    color: #fff;
    font-size: 14px;
}
.top-bar,
.sort-bar,
footer,
.state,
.error {
    border: 1px solid #777;
    padding: 4px;
    text-align: center;
}
.top-bar {
    position: relative;
    min-height: 39px;
    display: flex;
    align-items: center;
    justify-content: center;
}
.toolbar {
    position: absolute;
    right: 6px;
    display: flex;
    gap: 8px;
}
button,
select {
    border: 1px solid #888;
    border-radius: 2px;
    background: #222;
    color: #fff;
    padding: 1px 6px;
}
.permission {
    float: right;
    margin-right: 6px;
    color: #ccc;
}
.grid-scroll {
    width: 100%;
    min-height: calc(100vh - 116px);
    overflow: auto;
}
.general-table {
    width: 100%;
    min-width: 1000px;
    border-collapse: collapse;
    table-layout: fixed;
}
.general-table th,
.general-table td {
    border: 1px solid #777;
    padding: 2px 3px;
    text-align: center;
    overflow-wrap: anywhere;
}
.general-table th {
    height: 30px;
    background: #14241b url('/image/game/back_green.jpg');
    font-weight: 400;
}
.general-table tbody tr {
    height: 68px;
    background: rgba(0, 0, 0, 0.18);
}
.icon-column {
    width: 70px;
}
.name-column {
    width: 88px;
}
.icon {
    padding: 1px !important;
}
.icon img {
    display: block;
    margin: auto;
    object-fit: cover;
}
.name a {
    color: inherit;
}
.npc-1 {
    color: #0ff;
}
.npc-2,
.npc-3,
.npc-4,
.npc-5 {
    color: #aaa;
}
.wounded {
    color: red;
}
.bonus {
    color: cyan;
}
.error {
    color: #ff7373;
}
footer {
    min-height: 25px;
}
@media (max-width: 1000px) {
    .general-page {
        margin: 0;
    }
}
</style>
