<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { trpc } from '../utils/trpc';

type Archive = Awaited<ReturnType<typeof trpc.archive.myPastPlays.query>>;
type PastPlayDetail = Awaited<ReturnType<typeof trpc.archive.myPastPlayDetail.query>>;
type DetailState = {
    open: boolean;
    loading: boolean;
    error: string | null;
    detail: PastPlayDetail | null;
};

const archive = ref<Archive | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const details = ref<Record<string, DetailState>>({});

const loadArchive = async () => {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
        archive.value = await trpc.archive.myPastPlays.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '지난 플레이를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const yearMonth = (value: number): string => `${Math.floor(value / 100)}년 ${value % 100}월`;
const valueOrDash = (value: number | string | null): string => (value === null || value === '' ? '-' : String(value));
const plainLog = (value: string): string => value.replace(/<[^>]+>/g, '');
const detailKey = (serverId: string, generalNo: number): string => `${serverId}:${generalNo}`;

const toggleHistory = async (serverId: string, generalNo: number): Promise<void> => {
    const key = detailKey(serverId, generalNo);
    const current = details.value[key];
    if (current?.open) {
        details.value = { ...details.value, [key]: { ...current, open: false } };
        return;
    }
    if (current?.detail) {
        details.value = { ...details.value, [key]: { ...current, open: true } };
        return;
    }

    details.value = {
        ...details.value,
        [key]: { open: true, loading: true, error: null, detail: null },
    };
    try {
        const detail = await trpc.archive.myPastPlayDetail.query({ serverId, generalNo });
        details.value = {
            ...details.value,
            [key]: { open: true, loading: false, error: null, detail },
        };
    } catch (cause) {
        details.value = {
            ...details.value,
            [key]: {
                open: true,
                loading: false,
                error: cause instanceof Error ? cause.message : '장수 열전을 불러오지 못했습니다.',
                detail: null,
            },
        };
    }
};

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

        <p class="page-note">종료된 기수에 보관된 내 장수 기록입니다.</p>
        <p v-if="error" class="error-row">{{ error }}</p>
        <p v-else-if="loading && !archive" class="empty-row">불러오는 중...</p>
        <p v-else-if="archive?.seasons.length === 0" class="empty-row">보관된 지난 플레이가 없습니다.</p>

        <section v-for="season in archive?.seasons ?? []" :key="season.serverId" class="season-card">
            <div class="season-heading legacy-bg2">
                <strong>{{ season.serverId }}</strong>
                <div class="season-actions">
                    <span>
                        {{ season.scenarioName ?? '시나리오 미상' }}
                        <template v-if="season.season !== null"> · {{ season.season }}기</template>
                    </span>
                    <RouterLink
                        v-if="season.dynastyId !== null"
                        class="legacy-button nation-archive-link"
                        :to="`/dynasty/${season.dynastyId}`"
                    >
                        이 기수 국가 정보
                    </RouterLink>
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
                            <th>장수 열전</th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="general in season.generals" :key="general.generalNo">
                            <tr>
                                <td class="general-name">{{ general.name }}</td>
                                <td>
                                    <span
                                        class="nation-name"
                                        :style="{ backgroundColor: general.nationColor, color: '#ffffff' }"
                                    >
                                        {{ general.nationName }}
                                    </span>
                                </td>
                                <td>{{ yearMonth(general.lastYearMonth) }}</td>
                                <td>{{ valueOrDash(general.leadership) }}</td>
                                <td>{{ valueOrDash(general.strength) }}</td>
                                <td>{{ valueOrDash(general.intel) }}</td>
                                <td>{{ valueOrDash(general.officerLevel) }}</td>
                                <td>{{ valueOrDash(general.personal) }}</td>
                                <td>{{ valueOrDash(general.special) }}</td>
                                <td>{{ valueOrDash(general.special2) }}</td>
                                <td>
                                    <button
                                        class="legacy-button history-toggle"
                                        type="button"
                                        :aria-expanded="
                                            details[detailKey(season.serverId, general.generalNo)]?.open ?? false
                                        "
                                        @click="toggleHistory(season.serverId, general.generalNo)"
                                    >
                                        {{
                                            details[detailKey(season.serverId, general.generalNo)]?.open
                                                ? '접기'
                                                : `보기 (${general.historyCount})`
                                        }}
                                    </button>
                                </td>
                            </tr>
                            <tr v-if="details[detailKey(season.serverId, general.generalNo)]?.open" class="history-row">
                                <td colspan="11">
                                    <p
                                        v-if="details[detailKey(season.serverId, general.generalNo)]?.loading"
                                        role="status"
                                    >
                                        장수 열전을 불러오는 중...
                                    </p>
                                    <p
                                        v-else-if="details[detailKey(season.serverId, general.generalNo)]?.error"
                                        class="history-error"
                                        role="alert"
                                    >
                                        {{ details[detailKey(season.serverId, general.generalNo)]?.error }}
                                    </p>
                                    <p
                                        v-else-if="
                                            details[detailKey(season.serverId, general.generalNo)]?.detail?.history
                                                .length === 0
                                        "
                                    >
                                        보관된 장수 열전이 없습니다.
                                    </p>
                                    <ol v-else class="history-list">
                                        <li
                                            v-for="(entry, index) in details[
                                                detailKey(season.serverId, general.generalNo)
                                            ]?.detail?.history ?? []"
                                            :key="index"
                                        >
                                            {{ plainLog(entry) }}
                                        </li>
                                    </ol>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
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
    background: #151515;
}

.title-row,
.season-heading {
    border: 1px solid #555;
    background: #2b2b2b;
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

.title-row nav {
    display: flex;
    gap: 6px;
}

.legacy-button {
    box-sizing: border-box;
    min-height: 28px;
    padding: 4px 9px;
    border: 1px solid #777;
    border-radius: 0;
    color: #eee;
    background: #333;
    font: inherit;
    text-decoration: none;
    cursor: pointer;
}

.legacy-button:hover,
.legacy-button:focus-visible {
    border-color: skyblue;
    color: skyblue;
}

.legacy-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.page-note,
.empty-row,
.error-row {
    margin: 0;
    padding: 12px 10px;
    border-inline: 1px solid #555;
    border-bottom: 1px solid #555;
}

.page-note {
    color: #bbb;
}

.error-row {
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

.season-heading span {
    color: #bbb;
}

.season-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.nation-archive-link {
    min-height: 24px;
    padding-block: 2px;
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
    border: 1px solid #555;
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

.history-toggle {
    min-height: 24px;
    padding-block: 2px;
}

.history-row td {
    padding: 10px 12px;
    text-align: left;
    white-space: normal;
    background: #101010;
}

.history-row p {
    margin: 0;
    color: #bbb;
}

.history-error {
    color: #ff8d8d !important;
}

.history-list {
    display: grid;
    gap: 5px;
    margin: 0;
    padding-left: 26px;
    color: #ddd;
}

@media (max-width: 640px) {
    .title-row,
    .season-heading {
        align-items: flex-start;
        flex-direction: column;
    }

    .season-actions {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
