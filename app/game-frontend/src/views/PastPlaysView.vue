<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { isLegacyArchiveProfile, LEGACY_ARCHIVE_PROFILES, type LegacyArchiveProfile } from '@sammo-ts/common';

import GeneralBasicCard from '../components/main/GeneralBasicCard.vue';
import GeneralBattleSummary, { type GeneralBattleSummaryData } from '../components/main/GeneralBattleSummary.vue';
import GeneralRecordPanels from '../components/main/GeneralRecordPanels.vue';
import {
    GENERAL_RECORD_TYPES,
    type GeneralRecordCollection,
    type GeneralRecordType,
} from '../components/generalRecords';
import LegacyGeneralProgress from '../components/ui/LegacyGeneralProgress.vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';

type Archive = Awaited<ReturnType<typeof trpc.archive.myPastPlays.query>>;
type ArchiveSeason = Archive['seasons'][number] & {
    sourceProfile?: string;
    source?: string;
    openedAt?: string | null;
    date?: string | null;
    status?: 'OPEN' | 'COMPLETED' | 'ABANDONED' | 'LEGACY';
    cancellationId?: string | null;
    cancelledAt?: string | null;
};

type ArchiveGeneral = {
    id: number;
    name: string;
    picture?: string | null;
    imageServer?: number | null;
    npcState: number;
    officerLevel: number;
    officerLevelText: string;
    officerCityName?: string | null;
    generalType?: string;
    leadershipBonus?: number;
    stats: { leadership: number; strength: number; intelligence: number };
    gold: number;
    rice: number;
    crew: number;
    train: number;
    atmos: number;
    injury: number;
    experience: number;
    dedication: number;
    age?: number;
    retirementYear?: number;
    turnTime?: string | null;
    crewTypeId?: number;
    crewTypeName?: string;
    traits?: { personal: string; specialWar: string; specialDomestic: string };
    progression: {
        experienceLevel: number;
        dedicationLevel: number;
        dedicationText: string;
        statExperience: { leadership: number; strength: number; intelligence: number };
        statUpgradeLimit: number;
        dex: number[];
    };
};

type ArchiveLogChannel = {
    available: boolean;
    entries: Array<{ id: number | string; text: string }>;
};

type PastPlayDetail = {
    sourceProfile: string;
    source: string;
    serverId: string;
    generalNo: number;
    dynastyPath: string | null;
    nation: { name: string; color: string } | null;
    general: ArchiveGeneral;
    masteryAvailable: boolean;
    battle: GeneralBattleSummaryData & {
        winRate?: number | null;
        killRate?: number | null;
    };
    hallBattle: {
        available: boolean;
        semantics: 'independent-records';
        strategies: number | null;
        warnum: number | null;
        wins: number | null;
        winRate: number | null;
        occupied: number | null;
        killCrew: number | null;
        killRate: number | null;
        killCrewPerson: number | null;
        killRatePerson: number | null;
    };
    logs: Partial<Record<GeneralRecordType, ArchiveLogChannel>>;
};

type PastPlayDetailInput = {
    sourceProfile: string;
    source: string;
    serverId: string;
    generalNo: number;
};

const queryPastPlayDetail = trpc.archive.myPastPlayDetail.query as unknown as (
    input: PastPlayDetailInput
) => Promise<PastPlayDetail>;

const profileLabels: Record<LegacyArchiveProfile, string> = {
    che: '체',
    kwe: '퀘',
    pwe: '풰',
    twe: '퉤',
    nya: '냐',
    pya: '퍄',
    hwe: '훼',
};
const profileOptions = LEGACY_ARCHIVE_PROFILES.map((profile) => ({ profile, label: profileLabels[profile] }));
const configuredProfile = import.meta.env.VITE_GAME_PROFILE?.trim();
const selectedProfile = ref<LegacyArchiveProfile>(
    configuredProfile && isLegacyArchiveProfile(configuredProfile) ? configuredProfile : 'che'
);

const archive = ref<Archive | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedKey = ref<string | null>(null);
const detail = ref<PastPlayDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
let archiveRequestId = 0;

const loadArchive = async () => {
    const requestId = ++archiveRequestId;
    const sourceProfile = selectedProfile.value;
    loading.value = true;
    error.value = null;
    try {
        const result = await trpc.archive.myPastPlays.query({ sourceProfile });
        if (requestId === archiveRequestId) archive.value = result;
    } catch (cause) {
        if (requestId === archiveRequestId) {
            error.value = cause instanceof Error ? cause.message : '지난 플레이를 불러오지 못했습니다.';
        }
    } finally {
        if (requestId === archiveRequestId) loading.value = false;
    }
};

const selectProfile = (profile: LegacyArchiveProfile): void => {
    if (selectedProfile.value === profile) return;
    selectedProfile.value = profile;
    archive.value = null;
    selectedKey.value = null;
    detail.value = null;
    detailError.value = null;
    void loadArchive();
};

const yearMonth = (value: number): string => `${Math.floor(value / 100)}년 ${value % 100}월`;
const valueOrDash = (value: number | string | null): string => (value === null || value === '' ? '-' : String(value));
const hallNumber = (value: number | null): string =>
    value === null ? '-' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
const hallPercent = (value: number | null): string => (value === null ? '-' : `${value.toFixed(2)}%`);
const plainLog = (value: string): string => value.replace(/<[^>]+>/g, '');
const seasonSourceProfile = (season: ArchiveSeason): string => season.sourceProfile ?? '현재 서버';
const profileDisplayName = (profile: string): string =>
    isLegacyArchiveProfile(profile) ? profileLabels[profile] : profile;
const seasonSource = (season: ArchiveSeason): string => season.source ?? 'current';
const detailKey = (season: ArchiveSeason, generalNo: number): string =>
    `${seasonSourceProfile(season)}:${seasonSource(season)}:${season.serverId}:${generalNo}`;
const isSelectedSeason = (season: ArchiveSeason): boolean =>
    selectedKey.value?.startsWith(`${seasonSourceProfile(season)}:${seasonSource(season)}:${season.serverId}:`) ??
    false;

const formatOpenedAt = (season: ArchiveSeason): string => {
    const value = season.openedAt ?? season.date;
    if (!value) return '개장일 미상';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '개장일 미상';
    return `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(date)} 개장`;
};
const archiveLabel = (season: ArchiveSeason): string =>
    season.status === 'ABANDONED' ? '취소 게임' : '이전 서버 기록';
const archiveIdentifier = (season: ArchiveSeason): string =>
    season.status === 'ABANDONED' && season.cancellationId
        ? `취소 ID ${season.cancellationId.slice(0, 8)}`
        : season.serverId;

const selectGeneral = async (season: ArchiveSeason, generalNo: number): Promise<void> => {
    const key = detailKey(season, generalNo);
    if (selectedKey.value === key) {
        selectedKey.value = null;
        detail.value = null;
        detailError.value = null;
        return;
    }

    selectedKey.value = key;
    detail.value = null;
    detailError.value = null;
    detailLoading.value = true;
    try {
        const result = await queryPastPlayDetail({
            sourceProfile: seasonSourceProfile(season),
            source: seasonSource(season),
            serverId: season.serverId,
            generalNo,
        });
        if (selectedKey.value === key) detail.value = result;
    } catch (cause) {
        if (selectedKey.value === key) {
            detailError.value = cause instanceof Error ? cause.message : '지난 장수 상세 기록을 불러오지 못했습니다.';
        }
    } finally {
        if (selectedKey.value === key) detailLoading.value = false;
    }
};

const archiveRecords = computed<GeneralRecordCollection>(() => {
    const result: GeneralRecordCollection = {};
    for (const type of GENERAL_RECORD_TYPES) {
        const channel = detail.value?.logs[type];
        result[type] = (channel?.entries ?? []).map((entry) => ({ id: entry.id, content: plainLog(entry.text) }));
    }
    return result;
});

const unavailableRecords = computed<GeneralRecordType[]>(() =>
    GENERAL_RECORD_TYPES.filter((type) => {
        const channel = detail.value?.logs[type];
        return channel ? !channel.available : type !== 'generalHistory';
    })
);

const battleSummary = computed<GeneralBattleSummaryData>(() => ({
    ...detail.value?.battle,
    experience: detail.value?.general.experience ?? null,
    dedicationText: detail.value?.general.progression.dedicationText ?? null,
}));

onMounted(() => {
    void loadArchive();
});
</script>

<template>
    <main id="container" class="past-plays-page legacy-bg0">
        <header class="title-row legacy-bg1">
            <h1>내 지난 플레이 보기</h1>
            <nav>
                <RouterLink class="legacy-button" to="/">돌아가기</RouterLink>
                <button class="legacy-button" type="button" :disabled="loading" @click="loadArchive">새로고침</button>
            </nav>
        </header>

        <p class="page-note">종료된 기수와 관리자가 보존한 취소 게임의 내 장수 기록입니다.</p>
        <nav class="profile-tabs legacy-bg1" aria-label="과거 장수 서버 선택">
            <button
                v-for="option in profileOptions"
                :key="option.profile"
                class="profile-tab"
                :class="{ selected: selectedProfile === option.profile }"
                type="button"
                :aria-label="`${option.label} 서버`"
                :aria-pressed="selectedProfile === option.profile"
                @click="selectProfile(option.profile)"
            >
                {{ option.label }}
            </button>
        </nav>
        <p v-if="error" class="error-row">{{ error }}</p>
        <p v-else-if="loading && !archive" class="empty-row">불러오는 중...</p>
        <p v-else-if="archive?.seasons.length === 0" class="empty-row">보관된 지난 플레이가 없습니다.</p>

        <section v-for="season in archive?.seasons ?? []" :key="detailKey(season, 0)" class="season-card">
            <div class="season-heading legacy-bg2">
                <div class="season-identity">
                    <strong class="archive-label" :class="{ abandoned: season.status === 'ABANDONED' }">
                        {{ archiveLabel(season) }}
                    </strong>
                    <strong>{{ profileDisplayName(seasonSourceProfile(season)) }}</strong>
                    <span>{{ archiveIdentifier(season) }}</span>
                </div>
                <div class="season-meta">
                    <span>{{ formatOpenedAt(season) }}</span>
                    <span>
                        {{ season.scenarioName ?? '시나리오 미상' }}
                        <template v-if="season.status !== 'ABANDONED' && season.season !== null">
                            · {{ season.season }}기
                        </template>
                    </span>
                </div>
            </div>

            <div class="table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th>장수명</th>
                            <th>소속</th>
                            <th>마지막 기록</th>
                            <th>통솔</th>
                            <th>무력</th>
                            <th>지력</th>
                            <th>관직</th>
                            <th>성격</th>
                            <th>내정 특기</th>
                            <th>전투 특기</th>
                            <th>상세</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="general in season.generals" :key="general.generalNo">
                            <td class="general-name">{{ general.name }}</td>
                            <td>
                                <span
                                    class="nation-name"
                                    :style="{ backgroundColor: general.nationColor, color: '#fff' }"
                                >
                                    {{ general.nationName }}
                                </span>
                            </td>
                            <td>{{ yearMonth(general.lastYearMonth) }}</td>
                            <td>{{ valueOrDash(general.leadership) }}</td>
                            <td>{{ valueOrDash(general.strength) }}</td>
                            <td>{{ valueOrDash(general.intel) }}</td>
                            <td>{{ valueOrDash(general.officerLevelText) }}</td>
                            <td>{{ valueOrDash(general.personal) }}</td>
                            <td>{{ valueOrDash(general.special) }}</td>
                            <td>{{ valueOrDash(general.special2) }}</td>
                            <td>
                                <button
                                    class="legacy-button detail-toggle"
                                    type="button"
                                    :aria-expanded="selectedKey === detailKey(season, general.generalNo)"
                                    @click="selectGeneral(season, general.generalNo)"
                                >
                                    {{ selectedKey === detailKey(season, general.generalNo) ? '접기' : '상세 보기' }}
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div v-if="isSelectedSeason(season)" class="detail-region">
                <SkeletonLines v-if="detailLoading" :lines="8" />
                <p v-else-if="detailError" class="detail-error" role="alert">{{ detailError }}</p>
                <div v-else-if="detail" class="detail-shell">
                    <div class="detail-source">
                        <span>{{ profileDisplayName(detail.sourceProfile) }} · {{ detail.source }}</span>
                        <RouterLink
                            v-if="detail.dynastyPath"
                            class="legacy-button nation-archive-link"
                            :to="detail.dynastyPath"
                        >
                            이 기수 국가 정보
                        </RouterLink>
                    </div>
                    <div class="detail-grid">
                        <PanelCard title="장수 정보">
                            <GeneralBasicCard
                                class="archive-general-card"
                                :general="detail.general"
                                :loading="false"
                                :nation-color="detail.nation?.color"
                            >
                                <template #details>
                                    <GeneralBattleSummary :summary="battleSummary" show-win-rate rate-scale="percent" />
                                    <section
                                        v-if="detail.hallBattle.available"
                                        class="hall-battle-record"
                                        data-hall-battle-record
                                    >
                                        <div class="hall-battle-record__heading">
                                            <strong>명예의 전당 보존 기록</strong>
                                            <span>항목별 기록 시점이 서로 다를 수 있습니다.</span>
                                        </div>
                                        <dl>
                                            <div>
                                                <dt>전투</dt>
                                                <dd>{{ hallNumber(detail.hallBattle.warnum) }}</dd>
                                            </div>
                                            <div>
                                                <dt>승리</dt>
                                                <dd>{{ hallNumber(detail.hallBattle.wins) }}</dd>
                                            </div>
                                            <div>
                                                <dt>승률</dt>
                                                <dd>{{ hallPercent(detail.hallBattle.winRate) }}</dd>
                                            </div>
                                            <div>
                                                <dt>계략</dt>
                                                <dd>{{ hallNumber(detail.hallBattle.strategies) }}</dd>
                                            </div>
                                            <div>
                                                <dt>점령</dt>
                                                <dd>{{ hallNumber(detail.hallBattle.occupied) }}</dd>
                                            </div>
                                            <div>
                                                <dt>사살</dt>
                                                <dd>{{ hallNumber(detail.hallBattle.killCrew) }}</dd>
                                            </div>
                                            <div>
                                                <dt>살상률</dt>
                                                <dd>{{ hallPercent(detail.hallBattle.killRate) }}</dd>
                                            </div>
                                            <div>
                                                <dt>대인 사살</dt>
                                                <dd>{{ hallNumber(detail.hallBattle.killCrewPerson) }}</dd>
                                            </div>
                                            <div>
                                                <dt>대인 살상률</dt>
                                                <dd>{{ hallPercent(detail.hallBattle.killRatePerson) }}</dd>
                                            </div>
                                        </dl>
                                    </section>
                                    <LegacyGeneralProgress
                                        v-if="detail.masteryAvailable"
                                        :general="detail.general"
                                        :show-primary="false"
                                    />
                                    <div v-else class="archive-unavailable">
                                        이 기수에는 숙련도 기록이 보존되지 않았습니다.
                                    </div>
                                </template>
                            </GeneralBasicCard>
                        </PanelCard>
                        <PanelCard title="장수 기록" subtitle="보존된 과거 기록">
                            <GeneralRecordPanels :records="archiveRecords" :unavailable="unavailableRecords" />
                        </PanelCard>
                    </div>
                </div>
            </div>
        </section>
    </main>
</template>

<style scoped>
.past-plays-page {
    width: min(1000px, 100%);
    min-height: 100vh;
    margin: 0 auto;
    color: #eee;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
    font-family: var(--sammo-font-sans);
    font-size: 14px;
}

.title-row,
.season-heading {
    border: 1px solid #666;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}

.title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
}

.title-row h1 {
    margin: 0;
    color: skyblue;
    font-size: 18px;
}

.title-row nav,
.season-identity,
.season-meta,
.detail-source {
    display: flex;
    align-items: center;
    gap: 6px;
}

.legacy-button {
    box-sizing: border-box;
    min-height: 28px;
    padding: 4px 9px;
    border: 1px solid #2d5d7f;
    border-radius: 4px;
    color: #fff;
    background: #315f86;
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
}

.legacy-button:hover,
.legacy-button:focus-visible {
    border-color: skyblue;
    color: skyblue;
}

.legacy-button:active {
    transform: translateY(1px);
}

.legacy-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.page-note,
.profile-tabs,
.empty-row,
.error-row {
    margin: 0;
    padding: 12px 10px;
    border-inline: 1px solid #666;
    border-bottom: 1px solid #666;
}

.profile-tabs {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
    padding: 6px 8px;
}

.profile-tab {
    min-height: 30px;
    border: 1px solid #777;
    color: #ddd;
    background: #222;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
}

.profile-tab:hover,
.profile-tab:focus-visible,
.profile-tab.selected {
    border-color: skyblue;
    color: skyblue;
    background: #143a2a;
}

.page-note,
.season-heading span {
    color: #bbb;
}

.error-row,
.detail-error {
    color: #ff8d8d;
}

.season-card {
    margin-top: 12px;
}

.season-heading {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 9px;
}

.season-heading strong {
    color: skyblue;
}

.archive-label {
    padding: 2px 5px;
    border: 1px solid #777;
    color: #fff !important;
    background: #00582c;
}

.archive-label.abandoned {
    border-color: #956f38;
    background: #66471f;
}

.season-meta {
    justify-content: flex-end;
}

.table-scroll {
    overflow-x: auto;
}

table {
    width: 100%;
    min-width: 940px;
    border-collapse: collapse;
    table-layout: auto;
    background: #191919;
}

th,
td {
    padding: 6px 7px;
    border: 1px solid #666;
    text-align: center;
    white-space: nowrap;
}

th {
    color: #ddd;
    background: #303030;
    font-weight: 600;
}

.general-name {
    color: skyblue;
    font-weight: 600;
}

.nation-name {
    display: inline-block;
    min-width: 54px;
    padding: 2px 5px;
    border: 1px solid rgb(255 255 255 / 25%);
    text-shadow: 0 1px 1px #000;
}

.detail-toggle,
.nation-archive-link {
    min-height: 24px;
    padding-block: 2px;
}

.detail-region {
    border: 1px solid #666;
    background: #101010;
}

.detail-error {
    margin: 0;
    padding: 10px 12px;
}

.detail-source {
    justify-content: space-between;
    min-height: 34px;
    padding: 4px 8px;
    border-bottom: 1px solid #666;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}

.detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.detail-grid :deep(.panel-card) {
    height: 100%;
    border-radius: 0;
    box-shadow: none;
}

.detail-grid :deep(.panel-body) {
    padding: 0;
}

.detail-grid :deep(.panel-title) {
    color: skyblue;
    font-size: 18px;
    font-weight: 500;
}

.archive-unavailable {
    min-height: 28px;
    padding: 5px 8px;
    border-top: 1px solid #666;
    color: #bbb;
    text-align: center;
}

.hall-battle-record {
    border-top: 1px solid #666;
}

.hall-battle-record__heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    background: rgb(20 75 42 / 70%);
}

.hall-battle-record__heading span {
    color: #bbb;
    font-size: 12px;
}

.hall-battle-record dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0;
}

.hall-battle-record dl > div {
    display: grid;
    grid-template-columns: minmax(70px, 1fr) 1fr;
    min-height: 24px;
    border-right: 1px solid #777;
    border-bottom: 1px solid #777;
}

.hall-battle-record dt,
.hall-battle-record dd {
    margin: 0;
    padding: 2px 5px;
}

.hall-battle-record dt {
    background: rgb(20 75 42 / 45%);
    text-align: center;
}

.hall-battle-record dd {
    text-align: right;
}

@media (max-width: 640px) {
    .title-row,
    .season-heading,
    .season-identity,
    .season-meta {
        align-items: flex-start;
        flex-direction: column;
    }

    .season-meta {
        justify-content: flex-start;
    }

    .detail-grid {
        grid-template-columns: 1fr;
    }

    .hall-battle-record__heading {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
