<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import GeneralDirectoryTable from '../components/directory/GeneralDirectoryTable.vue';
import type { GeneralDirectoryGeneral } from '../types/directory';
import { formatNationLevelText, formatOfficerLevelText } from '../utils/nationFormat';
import { getNpcColor } from '../utils/npcColor';
import { legacyNationTextColor } from '../utils/legacyNationColor';
import { trpc } from '../utils/trpc';

type Directory = Awaited<ReturnType<typeof trpc.world.getNationDirectory.query>>;
type Nation = Directory[number];

const nations = ref<Directory>([]);
const loading = ref(false);
const error = ref('');
const generalDetails = ref<GeneralDirectoryGeneral[]>([]);
const generalDetailsLoaded = ref(false);
const generalDetailsLoading = ref(false);
const generalDetailsError = ref('');
const activeGeneralId = ref<number | null>(null);
const generalPreviewStyle = ref({ left: '8px', top: '8px', visibility: 'hidden' as 'hidden' | 'visible' });
const generalPreviewAnchor = ref<HTMLElement | null>(null);
let generalDetailsRequest: Promise<void> | null = null;

const generalDetailsById = computed(
    () => new Map(generalDetails.value.map((general) => [general.id, general] as const))
);
const activeGeneral = computed(() =>
    activeGeneralId.value === null ? null : (generalDetailsById.value.get(activeGeneralId.value) ?? null)
);

const loadDirectory = async () => {
    loading.value = true;
    error.value = '';
    try {
        nations.value = await trpc.world.getNationDirectory.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const officerName = (nation: Nation, officerLevel: number) =>
    nation.officers.find((officer) => officer.officerLevel === officerLevel)?.general;
const displayGeneralName = (general: { name: string; npcState: number }) =>
    general.npcState > 0 && !/^[ⓜⓝ㉥]/u.test(general.name) ? `ⓝ${general.name}` : general.name;
const displayAmbassadorName = (nation: Nation, name: string) => {
    const general = nation.generals.find((candidate) => candidate.name === name);
    return general ? displayGeneralName(general) : name;
};

const closeWindow = () => window.close();
const officerLevelAt = (row: number, column: number, columns: number) => 13 - ((row - 1) * columns + column);

const positionGeneralPreview = async (): Promise<void> => {
    await nextTick();
    const anchor = generalPreviewAnchor.value;
    const preview = document.getElementById('nation-general-preview');
    if (!anchor || !preview || activeGeneralId.value === null) {
        return;
    }

    const viewportMargin = 8;
    const anchorGap = 8;
    const anchorRect = anchor.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const maxLeft = Math.max(viewportMargin, window.innerWidth - previewRect.width - viewportMargin);
    const left = Math.min(
        maxLeft,
        Math.max(viewportMargin, anchorRect.left + anchorRect.width / 2 - previewRect.width / 2)
    );
    const below = anchorRect.bottom + anchorGap;
    const above = anchorRect.top - previewRect.height - anchorGap;
    const maxTop = Math.max(viewportMargin, window.innerHeight - previewRect.height - viewportMargin);
    const top =
        below + previewRect.height <= window.innerHeight - viewportMargin ? below : Math.max(viewportMargin, above);

    generalPreviewStyle.value = {
        left: `${left}px`,
        top: `${Math.min(maxTop, top)}px`,
        visibility: 'visible',
    };
};

const loadGeneralDetails = async (): Promise<void> => {
    if (generalDetailsLoaded.value) {
        return;
    }
    if (!generalDetailsRequest) {
        generalDetailsLoading.value = true;
        generalDetailsError.value = '';
        generalDetailsRequest = trpc.world.getGeneralDirectory
            .query({ sort: 9 })
            .then((result) => {
                generalDetails.value = result.generals;
                generalDetailsLoaded.value = true;
                void positionGeneralPreview();
            })
            .catch((cause: unknown) => {
                generalDetailsError.value =
                    cause instanceof Error ? cause.message : '장수 기본 정보를 불러오지 못했습니다.';
            })
            .finally(() => {
                generalDetailsLoading.value = false;
                generalDetailsRequest = null;
            });
    }
    await generalDetailsRequest;
};

const showGeneralDetails = (event: Event, generalId: number): void => {
    if (event.currentTarget instanceof HTMLElement) {
        generalPreviewAnchor.value = event.currentTarget;
    }
    activeGeneralId.value = generalId;
    generalPreviewStyle.value = { ...generalPreviewStyle.value, visibility: 'hidden' };
    void positionGeneralPreview();
    void loadGeneralDetails().then(positionGeneralPreview);
};

const showGeneralDetailsFromTouch = (event: PointerEvent, generalId: number): void => {
    if (event.pointerType === 'touch') {
        showGeneralDetails(event, generalId);
    }
};

const hideGeneralDetails = (generalId: number): void => {
    if (activeGeneralId.value === generalId) {
        activeGeneralId.value = null;
        generalPreviewAnchor.value = null;
    }
};

const hideGeneralDetailsFromPointer = (event: PointerEvent, generalId: number): void => {
    if (document.activeElement === event.currentTarget) {
        return;
    }
    hideGeneralDetails(generalId);
};

onMounted(() => {
    void loadDirectory();
    window.addEventListener('resize', positionGeneralPreview);
    window.addEventListener('scroll', positionGeneralPreview, true);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', positionGeneralPreview);
    window.removeEventListener('scroll', positionGeneralPreview, true);
});
</script>

<template>
    <main class="directory-page" data-page="nation-directory">
        <table class="directory-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        세 력 일 람<br /><button class="legacy-button" type="button" @click="closeWindow">
                            창 닫기
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>

        <p v-if="error" class="directory-error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="directory-loading">불러오는 중...</p>

        <template v-for="nation in nations" :key="nation.id">
            <table v-if="nation.id !== 0" class="directory-table nation-table legacy-bg2" :data-nation-id="nation.id">
                <tbody>
                    <tr>
                        <td
                            colspan="8"
                            class="center nation-title"
                            :style="{ color: legacyNationTextColor(nation.color), backgroundColor: nation.color }"
                        >
                            【 {{ nation.name }} 】
                        </td>
                    </tr>
                    <tr class="desktop-only">
                        <td class="label-cell">성 향</td>
                        <td class="value-wide type-name">{{ Array.from(nation.type.name).join(' ') }}</td>
                        <td class="label-cell">작 위</td>
                        <td class="value-wide">{{ formatNationLevelText(nation.level) }}</td>
                        <td class="label-cell">국 력</td>
                        <td class="value-wide">{{ nation.power }}</td>
                        <td class="label-cell">장수 / 속령</td>
                        <td class="value-wide">{{ nation.generalCount }} / {{ nation.cityCount }}</td>
                    </tr>
                    <tr class="mobile-only">
                        <td class="label-cell">성 향</td>
                        <td class="value-wide type-name">{{ Array.from(nation.type.name).join(' ') }}</td>
                        <td class="label-cell">작 위</td>
                        <td class="value-wide">{{ formatNationLevelText(nation.level) }}</td>
                    </tr>
                    <tr class="mobile-only">
                        <td class="label-cell">국 력</td>
                        <td class="value-wide">{{ nation.power }}</td>
                        <td class="label-cell">장수 / 속령</td>
                        <td class="value-wide">{{ nation.generalCount }} / {{ nation.cityCount }}</td>
                    </tr>
                    <tr class="desktop-only">
                        <td class="label-cell">총 병사</td>
                        <td class="value-wide">{{ nation.totalCrew.toLocaleString('ko-KR') }}</td>
                        <td colspan="6"></td>
                    </tr>
                    <tr class="mobile-only">
                        <td class="label-cell">총 병사</td>
                        <td class="value-wide">{{ nation.totalCrew.toLocaleString('ko-KR') }}</td>
                        <td colspan="2"></td>
                    </tr>
                    <tr v-for="row in 2" :key="`desktop-officers-${row}`" class="desktop-only">
                        <template v-for="column in 4" :key="column">
                            <td class="label-cell">
                                {{ formatOfficerLevelText(officerLevelAt(row, column, 4), nation.level) }}
                            </td>
                            <td class="value-wide">
                                <span
                                    v-if="officerName(nation, officerLevelAt(row, column, 4))"
                                    :style="{
                                        color: getNpcColor(
                                            officerName(nation, officerLevelAt(row, column, 4))?.npcState ?? 0
                                        ),
                                    }"
                                >
                                    {{ displayGeneralName(officerName(nation, officerLevelAt(row, column, 4))!) }}
                                </span>
                                <template v-else>-</template>
                            </td>
                        </template>
                    </tr>
                    <tr v-for="row in 4" :key="`mobile-officers-${row}`" class="mobile-only">
                        <template v-for="column in 2" :key="column">
                            <td class="label-cell">
                                {{ formatOfficerLevelText(officerLevelAt(row, column, 2), nation.level) }}
                            </td>
                            <td class="value-wide">
                                <span
                                    v-if="officerName(nation, officerLevelAt(row, column, 2))"
                                    :style="{
                                        color: getNpcColor(
                                            officerName(nation, officerLevelAt(row, column, 2))?.npcState ?? 0
                                        ),
                                    }"
                                >
                                    {{ displayGeneralName(officerName(nation, officerLevelAt(row, column, 2))!) }}
                                </span>
                                <template v-else>-</template>
                            </td>
                        </template>
                    </tr>
                    <tr class="desktop-only">
                        <td class="label-cell">외교권자</td>
                        <td colspan="5">
                            {{ nation.ambassadorNames.map((name) => displayAmbassadorName(nation, name)).join(', ') }}
                        </td>
                        <td class="label-cell">조언자</td>
                        <td class="value-wide">{{ nation.auditorCount }}명</td>
                    </tr>
                    <tr class="mobile-only">
                        <td class="label-cell">외교권자</td>
                        <td class="value-wide">
                            {{ nation.ambassadorNames.map((name) => displayAmbassadorName(nation, name)).join(', ') }}
                        </td>
                        <td class="label-cell">조언자</td>
                        <td class="value-wide">{{ nation.auditorCount }}명</td>
                    </tr>
                    <tr>
                        <td colspan="8">
                            <template v-if="nation.level > 0">
                                속령 일람 :
                                <template v-for="city in nation.cities" :key="city.id">
                                    <span :class="{ capital: city.capital }">{{
                                        city.capital ? `[${city.name}]` : city.name
                                    }}</span
                                    >,
                                </template>
                            </template>
                            <template v-else
                                >현재 위치 :
                                <span class="roaming-city">{{ nation.rulerCityName ?? '-' }}</span></template
                            >
                        </td>
                    </tr>
                    <tr>
                        <td colspan="8">
                            장수 일람 :
                            <template v-for="general in nation.generals" :key="general.id">
                                <button
                                    type="button"
                                    class="general-preview-trigger"
                                    :data-general-preview-trigger="general.id"
                                    :style="{ color: getNpcColor(general.npcState) }"
                                    :aria-expanded="activeGeneralId === general.id"
                                    :aria-describedby="
                                        activeGeneralId === general.id ? 'nation-general-preview' : undefined
                                    "
                                    @pointerdown="showGeneralDetailsFromTouch($event, general.id)"
                                    @pointerenter="showGeneralDetails($event, general.id)"
                                    @pointerleave="hideGeneralDetailsFromPointer($event, general.id)"
                                    @focus="showGeneralDetails($event, general.id)"
                                    @blur="hideGeneralDetails(general.id)"
                                >
                                    {{ displayGeneralName(general) }}</button
                                >,
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
            <br v-if="nation.id !== 0" />

            <table v-else class="directory-table neutral-table legacy-bg2" data-nation-id="0">
                <tbody>
                    <tr>
                        <td colspan="5" class="center">【 재 야 】</td>
                    </tr>
                    <tr>
                        <td class="neutral-spacer">&nbsp;</td>
                        <td class="neutral-label">장 수</td>
                        <td class="neutral-value">{{ nation.generalCount }}</td>
                        <td class="neutral-label">속 령</td>
                        <td class="neutral-value">{{ nation.cityCount }}</td>
                    </tr>
                    <tr>
                        <td class="neutral-spacer">&nbsp;</td>
                        <td class="neutral-label">총 병사</td>
                        <td class="neutral-value">{{ nation.totalCrew.toLocaleString('ko-KR') }}</td>
                        <td colspan="2"></td>
                    </tr>
                    <tr>
                        <td colspan="5">
                            속령 일람 :
                            <template v-for="city in nation.cities" :key="city.id">{{ city.name }}, </template>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="5">
                            장수 일람 :
                            <template v-for="general in nation.generals" :key="general.id">
                                <button
                                    type="button"
                                    class="general-preview-trigger"
                                    :data-general-preview-trigger="general.id"
                                    :style="{ color: getNpcColor(general.npcState) }"
                                    :aria-expanded="activeGeneralId === general.id"
                                    :aria-describedby="
                                        activeGeneralId === general.id ? 'nation-general-preview' : undefined
                                    "
                                    @pointerdown="showGeneralDetailsFromTouch($event, general.id)"
                                    @pointerenter="showGeneralDetails($event, general.id)"
                                    @pointerleave="hideGeneralDetailsFromPointer($event, general.id)"
                                    @focus="showGeneralDetails($event, general.id)"
                                    @blur="hideGeneralDetails(general.id)"
                                >
                                    {{ displayGeneralName(general) }}</button
                                >,
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
        </template>

        <div
            v-if="activeGeneralId !== null"
            id="nation-general-preview"
            class="general-hover-preview"
            role="tooltip"
            aria-live="polite"
            :style="generalPreviewStyle"
        >
            <GeneralDirectoryTable v-if="activeGeneral" :generals="[activeGeneral]" layout="card" />
            <div v-else class="general-hover-status">
                <template v-if="generalDetailsLoading">장수 기본 정보를 불러오는 중...</template>
                <template v-else-if="generalDetailsError">{{ generalDetailsError }}</template>
                <template v-else>표시할 수 있는 장수 기본 정보가 없습니다.</template>
            </div>
        </div>

        <div class="legacy-analysis-helper" aria-hidden="true">
            <table>
                <thead>
                    <tr>
                        <td v-for="column in 15" :key="column"></td>
                    </tr>
                </thead>
            </table>
        </div>

        <table class="directory-table title-table footer-table legacy-bg0">
            <tbody>
                <tr>
                    <td><button class="legacy-button" type="button" @click="closeWindow">창 닫기</button></td>
                </tr>
                <tr>
                    <td>
                        <small>
                            삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                            HideD(hided62@gmail.com) /
                            <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                        </small>
                    </td>
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
    font-size: 14px;
    word-break: break-all;
    background-color: transparent;
}
.directory-table td {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}
.title-table {
    text-align: left;
}
.directory-page > .title-table:first-child {
    height: 55.6875px;
}
.title-table td {
    padding: 1px;
}
.legacy-button {
    border: 0;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    background-color: rgb(55 90 127);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    line-height: 21px;
    cursor: pointer;
}
.nation-title {
    height: 19px;
}
.label-cell {
    width: 80px;
    text-align: center;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}
.value-wide {
    width: 170px;
    text-align: center;
}
.type-name {
    color: yellow;
}
.capital {
    color: cyan;
}
.roaming-city {
    color: yellow;
}
.neutral-spacer {
    width: 498px;
    text-align: center;
}
.neutral-label,
.neutral-value {
    width: 123px;
    text-align: center;
}
.neutral-label {
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}
.center {
    text-align: center;
}
.mobile-only {
    display: none;
}
.general-preview-trigger {
    appearance: none;
    border: 0;
    padding: 0;
    background: transparent;
    font: inherit;
    line-height: inherit;
    cursor: help;
}
.general-preview-trigger:focus-visible {
    outline: 1px dashed cyan;
    outline-offset: 1px;
}
.general-hover-preview {
    position: fixed;
    z-index: 30;
    width: min(500px, calc(100vw - 16px));
    margin: 0;
    padding: 0;
    background: #000;
    box-shadow: 0 0 7px 3px rgb(255 255 255 / 50%);
    pointer-events: none;
}
.general-hover-status {
    box-sizing: border-box;
    width: 100%;
    min-height: 65px;
    border: 1px solid gray;
    padding: 22px 8px;
    background: #000;
    text-align: center;
}
.footer-table {
    margin-top: 0;
}
.footer-table a {
    color: inherit;
}
.legacy-analysis-helper {
    display: none;
}
.directory-error,
.directory-loading {
    width: 998px;
    margin: 0;
    border: 1px solid gray;
    padding: 8px 0;
    text-align: center;
}
.directory-error {
    color: #ff7373;
}

@media (max-width: 600px) {
    .directory-page {
        width: 100%;
        max-width: 500px;
        margin: 0;
    }
    .directory-table {
        width: 100%;
    }
    .desktop-only {
        display: none;
    }
    .mobile-only {
        display: table-row;
    }
    .label-cell {
        width: 80px;
    }
    .value-wide {
        width: 170px;
    }
    .neutral-spacer {
        display: none;
    }
    .neutral-label,
    .neutral-value {
        width: 25%;
    }
    .general-preview-trigger {
        min-height: 24px;
        padding: 2px 4px;
    }
    .directory-error,
    .directory-loading {
        box-sizing: border-box;
        width: 100%;
    }
}
</style>
