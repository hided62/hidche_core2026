<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { formatOfficerLevelText } from '../utils/nationFormat';
import { getNpcColor } from '../utils/npcColor';
import { trpc } from '../utils/trpc';

type Directory = Awaited<ReturnType<typeof trpc.world.getGeneralDirectory.query>>;
type General = Directory['generals'][number];
type SortKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

const sortOptions: Array<{ value: SortKey; label: string }> = [
    { value: 1, label: '국가' },
    { value: 2, label: '통솔' },
    { value: 3, label: '무력' },
    { value: 4, label: '지력' },
    { value: 5, label: '명성' },
    { value: 6, label: '계급' },
    { value: 7, label: '관직' },
    { value: 8, label: '삭턴' },
    { value: 9, label: '벌점' },
    { value: 10, label: 'Lv' },
    { value: 11, label: '성격' },
    { value: 12, label: '내특' },
    { value: 13, label: '전특' },
    { value: 14, label: '연령' },
    { value: 15, label: 'NPC' },
];

const sort = ref<SortKey>(9);
const generals = ref<General[]>([]);
const loading = ref(false);
const error = ref('');

const loadDirectory = async () => {
    loading.value = true;
    error.value = '';
    try {
        const result = await trpc.world.getGeneralDirectory.query({ sort: sort.value });
        generals.value = result.generals;
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '장수일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const imageUrl = (general: General): string => {
    const picture = general.picture ?? 'default.jpg';
    return general.imageServer ? `${import.meta.env.BASE_URL}d_pic/${picture}` : `/image/general/${picture}`;
};
const injuredStat = (value: number, injury: number): number => Math.trunc((value * (100 - injury)) / 100);

onMounted(() => {
    void loadDirectory();
});
</script>

<template>
    <main class="directory-page" data-page="general-directory">
        <table class="directory-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>장 수 일 람<br /><RouterLink class="legacy-button" to="/">창 닫기</RouterLink></td>
                </tr>
                <tr>
                    <td>
                        <form class="sort-form" @submit.prevent="loadDirectory">
                            <label for="viewType">정렬순서 : </label>
                            <select id="viewType" v-model.number="sort" name="type" size="1">
                                <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </option>
                            </select>
                            <button type="submit">정렬하기</button>
                        </form>
                    </td>
                </tr>
            </tbody>
        </table>

        <p v-if="error" class="directory-error" role="alert">{{ error }}</p>
        <table class="directory-table general-table legacy-bg0">
            <colgroup>
                <col style="width: 64px" />
                <col style="width: 140px" />
                <col style="width: 45px" />
                <col style="width: 45px" />
                <col style="width: 80px" />
                <col style="width: 45px" />
                <col style="width: 140px" />
                <col style="width: 55px" />
                <col style="width: 55px" />
                <col style="width: 75px" />
                <col style="width: 45px" />
                <col style="width: 45px" />
                <col style="width: 45px" />
                <col style="width: 45px" />
                <col style="width: 70px" />
            </colgroup>
            <thead>
                <tr>
                    <td class="header-cell">얼 굴</td>
                    <td class="header-cell">이 름</td>
                    <td class="header-cell">연령</td>
                    <td class="header-cell">성격</td>
                    <td class="header-cell">특기</td>
                    <td class="header-cell">레 벨</td>
                    <td class="header-cell">국 가</td>
                    <td class="header-cell">명 성</td>
                    <td class="header-cell">계 급</td>
                    <td class="header-cell">관 직</td>
                    <td class="header-cell">통솔</td>
                    <td class="header-cell">무력</td>
                    <td class="header-cell">지력</td>
                    <td class="header-cell">삭턴</td>
                    <td class="header-cell">벌점</td>
                </tr>
            </thead>
            <tbody>
                <tr v-if="loading">
                    <td colspan="15" class="loading-cell">불러오는 중...</td>
                </tr>
                <tr
                    v-for="general in generals"
                    v-else
                    :key="general.id"
                    :data-general-id="general.id"
                    :data-general-wounded="general.injury"
                    :data-general-leadership="general.leadership"
                    :data-general-leadership-bonus="general.leadershipBonus"
                    :data-general-strength="general.strength"
                    :data-general-intel="general.intelligence"
                    :data-is-npc="general.npcState >= 2"
                    :data-npc-type="general.npcState"
                >
                    <td class="center">
                        <img class="general-icon" width="64" height="64" :src="imageUrl(general)" alt="" />
                    </td>
                    <td class="center">
                        <span :style="{ color: getNpcColor(general.npcState) }">{{ general.name }}</span>
                        <template v-if="general.ownerName"><br /><small>({{ general.ownerName }})</small></template>
                    </td>
                    <td class="center">{{ general.age }}세</td>
                    <td class="center">
                        <span :title="general.personality.info">{{ general.personality.name }}</span>
                    </td>
                    <td class="center">
                        <span :title="general.specialDomestic.info">{{ general.specialDomestic.name }}</span> /
                        <span :title="general.specialWar.info">{{ general.specialWar.name }}</span>
                    </td>
                    <td class="center">Lv {{ general.experienceLevel }}</td>
                    <td class="center">{{ general.nationName }}</td>
                    <td class="center">{{ general.honorText }}</td>
                    <td class="center">{{ general.dedicationText }}</td>
                    <td class="center">{{ formatOfficerLevelText(general.officerLevel, general.nationLevel) }}</td>
                    <td class="center">
                        <span :class="{ wounded: general.injury > 0 }">{{
                            general.injury > 0
                                ? injuredStat(general.leadership, general.injury)
                                : general.leadership
                        }}</span
                        ><span v-if="general.leadershipBonus > 0" class="leadership-bonus"
                            >+{{ general.leadershipBonus }}</span
                        >
                    </td>
                    <td class="center">
                        <span :class="{ wounded: general.injury > 0 }">{{
                            general.injury > 0 ? injuredStat(general.strength, general.injury) : general.strength
                        }}</span>
                    </td>
                    <td class="center">
                        <span :class="{ wounded: general.injury > 0 }">{{
                            general.injury > 0
                                ? injuredStat(general.intelligence, general.injury)
                                : general.intelligence
                        }}</span>
                    </td>
                    <td class="center">{{ general.killturn }}</td>
                    <td class="center">{{ general.refreshScoreTotal }}<br />【{{ general.refreshText }}】</td>
                </tr>
            </tbody>
        </table>

        <table class="directory-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td><RouterLink class="legacy-button" to="/">창 닫기</RouterLink></td>
                </tr>
                <tr>
                    <td><small>삼국지 모의전투 HiDCHe</small></td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.directory-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.3;
}
.directory-table {
    width: 1000px;
    border-collapse: collapse;
    table-layout: auto;
    padding: 0;
    font-size: 14px;
    word-break: break-all;
}
.directory-table td {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}
.title-table {
    text-align: center;
}
.directory-page > .title-table:first-child {
    height: 80.875px;
}
.title-table td {
    padding: 1px;
}
.legacy-button {
    padding: 5px 10px;
    font-size: 14px;
}
.sort-form {
    margin: 0;
}
.sort-form select,
.sort-form button {
    font-size: 14px;
}
.header-cell {
    height: 18px;
    text-align: center;
    background-color: #14241b;
    background-image: url('/image/game/back_green.jpg');
}
.general-icon {
    display: inline;
    width: 64px;
    min-width: 64px;
    max-width: none;
    height: 64px;
    object-fit: fill;
    vertical-align: middle;
}
.center {
    text-align: center;
}
.wounded {
    color: red;
}
.leadership-bonus {
    color: cyan;
}
.loading-cell {
    height: 64px;
    text-align: center;
}
.directory-error {
    width: 998px;
    margin: 0;
    border: 1px solid gray;
    padding: 8px 0;
    text-align: center;
    color: #ff7373;
}
</style>
