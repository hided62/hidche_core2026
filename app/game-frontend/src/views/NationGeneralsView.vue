<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatOfficerLevelText } from '../utils/nationFormat';
import { resolveGeneralIconUrl } from '../utils/generalIcon';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getGeneralList.query>>;
type General = Result['generals'][number];
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
const data = ref<Result | null>(null);
const router = useRouter();
const error = ref('');
const loading = ref(false);
const sort = ref<Sort>(1);
const viewMenuOpen = ref(false);
const columnMenuOpen = ref(false);
const nameFilter = ref('');
const officerFilter = ref('');
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
    [...(data.value?.generals ?? [])]
        .filter(
            (general) =>
                general.name.includes(nameFilter.value.trim()) &&
                formatOfficerLevelText(general.officerLevel, data.value?.nation.level).includes(
                    officerFilter.value.trim()
                )
        )
        .sort((a, b) => {
        if (sort.value === 1)
            return a.npcState - b.npcState || b.officerLevel - a.officerLevel || a.id - b.id;
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
const rank = (general: General) => (general.dedicationLevel ? `${11 - general.dedicationLevel}품관` : '무품관');
const iconUrl = (general: General) => resolveGeneralIconUrl(general);
onMounted(load);
</script>

<template>
    <main class="general-page legacy-bg0">
        <header class="top-bar">
            <span class="left-actions">
                <button class="top-button nation-button" @click="router.push('/')">돌아가기</button>
                <button class="top-button nation-button" :disabled="loading" @click="load">갱신</button>
            </span>
            <strong>세력 장수</strong>
            <span class="right-actions">
                <span class="dropdown">
                    <button class="top-button mode-button" @click="viewMenuOpen = !viewMenuOpen">보기 모드⌄</button>
                    <span v-if="viewMenuOpen" class="dropdown-menu">
                        <button @click="sort = 1; viewMenuOpen = false">기본</button>
                        <button @click="sort = 4; viewMenuOpen = false">전투</button>
                    </span>
                </span>
                <span class="dropdown">
                    <button class="top-button columns-button" @click="columnMenuOpen = !columnMenuOpen">열 선택⌄</button>
                    <span v-if="columnMenuOpen" class="dropdown-menu column-menu">
                        <label v-for="label in ['아이콘', '장수명', '관직', '명성/계급', '능력치', '자금', '특성']" :key="label">
                            <input type="checkbox" checked /> {{ label }}
                        </label>
                    </span>
                </span>
            </span>
        </header>
        <p v-if="error" class="state error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state">불러오는 중...</p>
        <div v-else class="grid-shell">
            <table id="nation-general-list">
                <colgroup>
                    <col v-for="(width, index) in [80, 126, 70, 70, 60, 60, 60, 60, 70, 70, 80, 100, 94]" :key="index" :style="{ width: `${width}px` }" />
                </colgroup>
                <thead>
                    <tr class="group-head">
                        <th colspan="2"></th>
                        <th></th>
                        <th>명성/계급　‹</th>
                        <th colspan="3">능력치　‹</th>
                        <th colspan="2">자금　‹</th>
                        <th colspan="2">특성　›</th>
                        <th>연도　›</th>
                        <th>기타　‹</th>
                    </tr>
                    <tr>
                        <th>아이콘</th><th>장수명</th><th>관직</th><th>계급</th><th>명성</th>
                        <th>통솔</th><th>무력</th><th>지력</th><th>금</th><th>쌀</th>
                        <th>요약</th><th>요약</th><th>벌점 ↓</th>
                    </tr>
                    <tr class="filter-head">
                        <th></th>
                        <th><input v-model="nameFilter" aria-label="장수명 필터" /><span>▽</span></th>
                        <th><input v-model="officerFilter" aria-label="관직 필터" /><span>▽</span></th>
                        <th><input aria-label="계급 필터" /><span>▽</span></th>
                        <th><input aria-label="명성 필터" /><span>▽</span></th>
                        <th><input aria-label="통솔 필터" /><span>▽</span></th>
                        <th><input aria-label="무력 필터" /><span>▽</span></th>
                        <th><input aria-label="지력 필터" /><span>▽</span></th>
                        <th><input aria-label="금 필터" /><span>▽</span></th>
                        <th><input aria-label="쌀 필터" /><span>▽</span></th>
                        <th></th><th></th><th><input aria-label="벌점 필터" /><span>▽</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="general in generals" :key="general.id">
                        <td class="icon-cell"><img :src="iconUrl(general)" alt="" /></td>
                        <td :class="`name-cell npc-${general.npcState}`">{{ general.name }}</td>
                        <td>{{ formatOfficerLevelText(general.officerLevel, data?.nation.level) }}</td>
                        <td>{{ rank(general) }}<br />({{ (general.dedicationLevel * 200).toLocaleString() }})</td>
                        <td>Lv {{ general.experienceLevel }}<br />({{ general.personality?.name ?? '-' }})</td>
                        <td>{{ general.stats.leadership }}</td><td>{{ general.stats.strength }}</td><td>{{ general.stats.intelligence }}</td>
                        <td>{{ general.gold.toLocaleString() }} 금</td><td>{{ general.rice.toLocaleString() }} 쌀</td>
                        <td :title="general.personality?.info ?? ''">{{ general.personality?.name ?? '-' }}<br />{{ general.specialDomestic?.name ?? '-' }}</td>
                        <td :title="[general.specialDomestic?.info, general.specialWar?.info].filter(Boolean).join('\n')">{{ special(general) }}</td>
                        <td>{{ general.refreshScoreTotal }}점<br />({{ general.belong ? '자주' : '안함' }})</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </main>
</template>

<style scoped>
.general-page {
    width: 100%;
    min-width: 500px;
    max-width: 1000px;
    height: 100vh;
    margin: 0 auto;
    overflow: hidden;
    font: 14px/21px var(--sammo-font-sans);
    color: #fff;
    background-color: transparent;
}
.state {
    text-align: center;
}
.top-bar {
    position: relative;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: transparent;
    background-image: var(--sammo-texture-walnut);
    border-bottom: 1px solid #42484a;
    font-size: 14px;
}
.top-bar strong { font-size: 22px; font-weight: 400; }
.left-actions,
.right-actions {
    position: absolute;
    top: 0;
    display: flex;
    height: 32px;
}
.left-actions { left: 0; }
.right-actions { right: 0; }
.top-button {
    display: inline-flex;
    height: 32px;
    align-items: center;
    border: 0;
    border-right: 1px solid #151515;
    border-radius: 3px;
    color: #fff;
    width: 89px;
    justify-content: center;
    padding: 0;
    font-weight: 700;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
}
.nation-button { background: #006c48; }
.nation-button:hover { background: #00855a; }
.mode-button { background: #375a7f; }
.mode-button, .columns-button { width: 90px; }
.columns-button { background: #3297cf; }
.columns-button:hover { filter: brightness(1.12); }
.dropdown { position: relative; }
.dropdown-menu {
    position: absolute;
    z-index: 5;
    top: 32px;
    right: 0;
    width: 150px;
    padding: 4px;
    background: #252a2c;
    border: 1px solid #596164;
}
.dropdown-menu button,
.dropdown-menu label {
    display: block;
    width: 100%;
    padding: 5px;
    border: 0;
    color: #fff;
    background: transparent;
    text-align: left;
}
.grid-shell {
    width: 100%;
    height: calc(100vh - 32px);
    overflow: auto;
    border: 1px solid #424242;
    background: #2d3436;
    color: #f5f5f5;
    cursor: default;
}
table {
    width: 1000px;
    min-width: 1000px;
    border-collapse: collapse;
    table-layout: fixed;
    background: #293033;
    font-size: 14px;
    line-height: normal;
    color: #f5f5f5;
    cursor: default;
}
th,
td {
    border-right: 1px solid #40484b;
    border-bottom: 1px solid #4a5255;
    padding: 0 4px;
    text-align: center;
    overflow: hidden;
}
th {
    height: 32px;
    background: #191b1c;
    color: #bdc5cf;
    font-weight: 400;
    white-space: nowrap;
}
.group-head th { height: 32px; border-bottom-color: #303537; }
.filter-head th { height: 32px; padding: 3px 4px; }
.filter-head input {
    width: calc(100% - 15px);
    height: 20px;
    border: 1px solid #aab3b7;
    background: #252a2c;
    color: #fff;
}
.filter-head span { margin-left: 4px; color: #a5b5bf; }
tbody tr {
    height: 68px;
    background: #293033;
}
tbody tr:hover { background: #343c3f; }
td { white-space: nowrap; }
.icon-cell { padding: 0 4px; text-align: left; }
.icon-cell img { width: 64px; height: 64px; object-fit: cover; vertical-align: middle; }
.name-cell { text-align: left; color: cyan; }
th:nth-child(9), td:nth-child(9), th:nth-child(10), td:nth-child(10) { text-align: right; }
.state { margin: 40px; }
.npc-0 {
    color: #f5f5f5;
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
        margin: 0;
    }
}
</style>
