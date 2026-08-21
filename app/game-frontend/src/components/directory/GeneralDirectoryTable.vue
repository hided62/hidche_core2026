<script setup lang="ts">
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../../utils/generalIcon';
import { formatOfficerLevelText } from '../../utils/nationFormat';
import { getNpcColor } from '../../utils/npcColor';
import type { GeneralDirectoryGeneral } from '../../types/directory';
import type { GeneralDirectorySortCriterion, GeneralDirectorySortKey } from '../../utils/generalDirectorySort';
import DirectoryTooltip from './DirectoryTooltip.vue';
import GeneralDirectoryStat from './GeneralDirectoryStat.vue';

type SortDirection = 'ascending' | 'descending';
type Header = {
    label: string;
    sort?: GeneralDirectorySortKey;
};

const props = withDefaults(
    defineProps<{
        generals: GeneralDirectoryGeneral[];
        loading?: boolean;
        layout?: 'responsive' | 'card';
        sortCriteria?: readonly GeneralDirectorySortCriterion[];
    }>(),
    {
        loading: false,
        layout: 'responsive',
        sortCriteria: () => [],
    }
);

const emit = defineEmits<{ sort: [value: number] }>();

const headers: ReadonlyArray<Header> = [
    { label: '얼 굴' },
    { label: '이 름', sort: 0 },
    { label: '연령', sort: 14 },
    { label: '성격', sort: 11 },
    { label: '특기' },
    { label: '레 벨', sort: 10 },
    { label: '국 가', sort: 1 },
    { label: '명 성', sort: 5 },
    { label: '계 급', sort: 6 },
    { label: '관 직', sort: 7 },
    { label: '통솔', sort: 2 },
    { label: '무력', sort: 3 },
    { label: '지력', sort: 4 },
    { label: '삭턴', sort: 8 },
    { label: '벌점', sort: 9 },
];

const criterionIndex = (header: Header): number =>
    header.sort === undefined ? -1 : props.sortCriteria.findIndex(({ key }) => key === header.sort);
const criterionFor = (header: Header): GeneralDirectorySortCriterion | undefined => {
    const index = criterionIndex(header);
    return index < 0 ? undefined : props.sortCriteria[index];
};
const ariaSort = (header: Header): SortDirection | undefined =>
    criterionIndex(header) === 0 ? criterionFor(header)?.direction : undefined;
const sortIndicator = (header: Header): string => {
    const index = criterionIndex(header);
    if (index < 0) return '↕';
    const arrow = criterionFor(header)?.direction === 'ascending' ? '▲' : '▼';
    return props.sortCriteria.length > 1 ? `${arrow}${index + 1}` : arrow;
};
const nextSortAction = (header: Header): string => {
    const direction = criterionFor(header)?.direction;
    if (!direction) return '내림차순';
    return direction === 'descending' ? '오름차순' : '정렬 해제';
};
const sortHelp = (header: Header): string =>
    `${header.label.replaceAll(' ', '')} ${nextSortAction(header)}. 같은 값은 이전 정렬 순서를 유지합니다.`;
</script>

<template>
    <table class="directory-table general-table legacy-bg0" :class="{ 'layout-card': layout === 'card' }">
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
                <th
                    v-for="header in headers"
                    :key="header.label"
                    class="header-cell"
                    scope="col"
                    :aria-sort="ariaSort(header)"
                >
                    <button
                        v-if="header.sort !== undefined"
                        class="legacy-sort-header"
                        type="button"
                        :aria-label="sortHelp(header)"
                        :title="sortHelp(header)"
                        @click="emit('sort', header.sort)"
                    >
                        {{ header.label }}<span class="legacy-sort-indicator">{{ sortIndicator(header) }}</span>
                    </button>
                    <template v-else>{{ header.label }}</template>
                </th>
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
                    <DirectoryTooltip
                        :title="`성격 · ${general.personality.name}`"
                        :description="general.personality.info"
                        :test-id="`personality-${general.id}`"
                    >
                        {{ general.personality.name }}
                    </DirectoryTooltip>
                </td>
                <td class="center">
                    <DirectoryTooltip
                        :title="`내정 특기 · ${general.specialDomestic.name}`"
                        :description="general.specialDomestic.info"
                        :test-id="`special-domestic-${general.id}`"
                    >
                        {{ general.specialDomestic.name }}
                    </DirectoryTooltip>
                    /
                    <DirectoryTooltip
                        :title="`전투 특기 · ${general.specialWar.name}`"
                        :description="general.specialWar.info"
                        :test-id="`special-war-${general.id}`"
                    >
                        {{ general.specialWar.name }}
                    </DirectoryTooltip>
                </td>
                <td class="center">Lv {{ general.experienceLevel }}</td>
                <td class="center">{{ general.nationName }}</td>
                <td class="center">{{ general.honorText }}</td>
                <td class="center">{{ general.dedicationText }}</td>
                <td class="center">{{ formatOfficerLevelText(general.officerLevel, general.nationLevel) }}</td>
                <td class="center">
                    <GeneralDirectoryStat
                        label="통솔"
                        :value="general.leadership"
                        :injury="general.injury"
                        :bonus="general.leadershipBonus"
                        :test-id="`injury-leadership-${general.id}`"
                    />
                </td>
                <td class="center">
                    <GeneralDirectoryStat
                        label="무력"
                        :value="general.strength"
                        :injury="general.injury"
                        :test-id="`injury-strength-${general.id}`"
                    />
                </td>
                <td class="center">
                    <GeneralDirectoryStat
                        label="지력"
                        :value="general.intelligence"
                        :injury="general.injury"
                        :test-id="`injury-intelligence-${general.id}`"
                    />
                </td>
                <td class="center">{{ general.killturn }}</td>
                <td class="center">{{ general.refreshScoreTotal }}<br />【{{ general.refreshText }}】</td>
            </tr>
        </tbody>
    </table>

    <div class="general-card-list" :class="{ 'layout-card': layout === 'card' }">
        <div v-if="loading" class="general-card-loading legacy-bg0">불러오는 중...</div>
        <article
            v-for="general in generals"
            v-else
            :key="general.id"
            class="general-card legacy-bg0"
            :data-general-card-id="general.id"
            :data-general-wounded="general.injury"
            :data-general-leadership="general.leadership"
            :data-general-leadership-bonus="general.leadershipBonus"
            :data-general-strength="general.strength"
            :data-general-intel="general.intelligence"
            :data-is-npc="general.npcState >= 2"
            :data-npc-type="general.npcState"
        >
            <div class="general-card-portrait">
                <img
                    class="general-icon"
                    width="64"
                    height="64"
                    :src="resolveGeneralIconUrl(general)"
                    alt=""
                    @error="useDefaultGeneralIcon"
                />
            </div>
            <div class="general-card-field identity-field name-field">
                <span class="field-label">이름</span>
                <span :style="{ color: getNpcColor(general.npcState) }">{{ general.name }}</span>
                <small v-if="general.ownerName">({{ general.ownerName }})</small>
            </div>
            <div class="general-card-field identity-field nation-field">
                <span class="field-label">국가</span>
                <span>{{ general.nationName }}</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">연령</span><span>{{ general.age }}세</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">성격</span>
                <DirectoryTooltip
                    :title="`성격 · ${general.personality.name}`"
                    :description="general.personality.info"
                    :test-id="`card-personality-${general.id}`"
                >
                    {{ general.personality.name }}
                </DirectoryTooltip>
            </div>
            <div class="general-card-field">
                <span class="field-label">특기</span>
                <span>
                    <DirectoryTooltip
                        :title="`내정 특기 · ${general.specialDomestic.name}`"
                        :description="general.specialDomestic.info"
                        :test-id="`card-special-domestic-${general.id}`"
                    >
                        {{ general.specialDomestic.name }}
                    </DirectoryTooltip>
                    /
                    <DirectoryTooltip
                        :title="`전투 특기 · ${general.specialWar.name}`"
                        :description="general.specialWar.info"
                        :test-id="`card-special-war-${general.id}`"
                    >
                        {{ general.specialWar.name }}
                    </DirectoryTooltip>
                </span>
            </div>
            <div class="general-card-field">
                <span class="field-label">레벨</span><span>Lv {{ general.experienceLevel }}</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">명성</span><span>{{ general.honorText }}</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">계급</span><span>{{ general.dedicationText }}</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">관직</span>
                <span>{{ formatOfficerLevelText(general.officerLevel, general.nationLevel) }}</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">삭턴</span><span>{{ general.killturn }}</span>
            </div>
            <div class="general-card-field">
                <span class="field-label">통솔</span>
                <GeneralDirectoryStat
                    label="통솔"
                    :value="general.leadership"
                    :injury="general.injury"
                    :bonus="general.leadershipBonus"
                    :test-id="`card-injury-leadership-${general.id}`"
                />
            </div>
            <div class="general-card-field">
                <span class="field-label">무력</span>
                <GeneralDirectoryStat
                    label="무력"
                    :value="general.strength"
                    :injury="general.injury"
                    :test-id="`card-injury-strength-${general.id}`"
                />
            </div>
            <div class="general-card-field">
                <span class="field-label">지력</span>
                <GeneralDirectoryStat
                    label="지력"
                    :value="general.intelligence"
                    :injury="general.injury"
                    :test-id="`card-injury-intelligence-${general.id}`"
                />
            </div>
            <div class="general-card-field penalty-field">
                <span class="field-label">벌점</span>
                <span>{{ general.refreshScoreTotal }} 【{{ general.refreshText }}】</span>
            </div>
        </article>
    </div>
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
.directory-table td,
.directory-table th {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}
.header-cell {
    height: 18px;
    text-align: center;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
    color: inherit;
    font-weight: 400;
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
.loading-cell {
    height: 64px;
    text-align: center;
}
.general-card-list {
    display: none;
    width: 100%;
}
.general-table.layout-card {
    display: none;
}
.general-card-list.layout-card {
    display: grid;
}
.general-card,
.general-card-loading {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid gray;
}
.general-card {
    display: grid;
    grid-template-columns: 66px repeat(4, minmax(0, 1fr));
    color: inherit;
    font-size: 12px;
    line-height: 1.2;
}
.general-card + .general-card {
    border-top: 0;
}
.general-card-portrait {
    grid-row: 1 / span 4;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    border-right: 1px solid gray;
}
.general-card-field {
    display: flex;
    min-width: 0;
    min-height: 29px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-right: 1px solid gray;
    border-bottom: 1px solid gray;
    padding: 2px 3px;
    overflow-wrap: anywhere;
    text-align: center;
}
.general-card-field:nth-child(3),
.general-card-field:nth-child(7),
.general-card-field:nth-child(11),
.penalty-field {
    border-right: 0;
}
.general-card-field:nth-last-child(-n + 4) {
    border-bottom: 0;
}
.identity-field {
    min-height: 32px;
    flex-direction: row;
    gap: 4px;
    font-size: 14px;
}
.name-field,
.nation-field {
    grid-column: span 2;
}
.field-label {
    color: #a8d8bd;
    font-size: 10px;
    line-height: 1;
}
.identity-field .field-label {
    font-size: 11px;
}
.general-card-loading {
    min-height: 65px;
    padding: 22px 8px;
    text-align: center;
}

@media (max-width: 600px) {
    .general-table:not(.layout-card) {
        display: none;
    }
    .general-card-list {
        display: grid;
    }
}
</style>
