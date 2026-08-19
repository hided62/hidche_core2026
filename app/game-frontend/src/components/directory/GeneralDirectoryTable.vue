<script setup lang="ts">
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../../utils/generalIcon';
import { formatOfficerLevelText } from '../../utils/nationFormat';
import { getNpcColor } from '../../utils/npcColor';
import type { GeneralDirectoryGeneral } from '../../types/directory';

withDefaults(
    defineProps<{
        generals: GeneralDirectoryGeneral[];
        loading?: boolean;
    }>(),
    {
        loading: false,
    }
);

const injuredStat = (value: number, injury: number): number => Math.trunc((value * (100 - injury)) / 100);
</script>

<template>
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
                    <img
                        class="general-icon"
                        width="64"
                        height="64"
                        :src="resolveGeneralIconUrl(general)"
                        alt=""
                        @error="useDefaultGeneralIcon"
                    />
                </td>
                <td class="center">
                    <span :style="{ color: getNpcColor(general.npcState) }">{{ general.name }}</span>
                    <template v-if="general.ownerName"
                        ><br /><small>({{ general.ownerName }})</small></template
                    >
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
                        general.injury > 0 ? injuredStat(general.leadership, general.injury) : general.leadership
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
                        general.injury > 0 ? injuredStat(general.intelligence, general.injury) : general.intelligence
                    }}</span>
                </td>
                <td class="center">{{ general.killturn }}</td>
                <td class="center">{{ general.refreshScoreTotal }}<br />【{{ general.refreshText }}】</td>
            </tr>
        </tbody>
    </table>
</template>

<style scoped>
.directory-table {
    width: 1000px;
    border-collapse: collapse;
    table-layout: auto;
    padding: 0;
    font-size: 14px;
    line-height: 1.3;
    word-break: break-all;
}
.directory-table td {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}
.header-cell {
    height: 18px;
    text-align: center;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
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
</style>
