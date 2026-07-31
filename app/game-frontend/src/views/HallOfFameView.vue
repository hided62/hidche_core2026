<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { trpc } from '../utils/trpc';

type HallOption = {
    season: number;
    scenarios: Array<{ id: number; name: string; count: number }>;
};

type HallEntry = {
    generalId: number;
    name: string;
    ownerName?: string | null;
    nationName: string;
    bgColor: string;
    fgColor: string;
    picture?: string | null;
    imageServer?: number;
    value: number;
    printValue: string;
    serverName?: string;
    serverIdx?: number;
    scenarioName?: string;
    startTime?: string | null;
    unitedTime?: string | null;
};

type HallSection = {
    title: string;
    valueType: 'int' | 'percent';
    entries: HallEntry[];
};

type HallPayload = {
    sections: HallSection[];
};

const router = useRouter();
const loading = ref(false);
const errorMessage = ref('');
const options = ref<HallOption[]>([]);
const selectedSeason = ref<number | null>(null);
const selectedScenario = ref<number | null>(null);
const data = ref<HallPayload | null>(null);

const selection = computed({
    get: () =>
        selectedSeason.value === null
            ? ''
            : selectedScenario.value === null
              ? `season:${selectedSeason.value}`
              : `scenario:${selectedSeason.value}:${selectedScenario.value}`,
    set: (value: string) => {
        const [kind, season, scenario] = value.split(':');
        selectedSeason.value = Number(season);
        selectedScenario.value = kind === 'scenario' ? Number(scenario) : null;
    },
});

const imageUrl = (entry: HallEntry): string => {
    const picture = entry.picture?.trim() || 'default.jpg';
    return entry.imageServer ? `${import.meta.env.BASE_URL}d_pic/${picture}` : `/image/icons/${picture}`;
};

const closePage = async (): Promise<void> => {
    if (window.opener) {
        window.close();
        return;
    }
    await router.push('/');
};

const loadOptions = async (): Promise<void> => {
    try {
        options.value = await trpc.ranking.getHallOfFameOptions.query();
        if (options.value.length > 0 && selectedSeason.value === null) {
            selectedSeason.value = options.value[0]!.season;
        }
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '명예의 전당 옵션을 불러오지 못했습니다.';
    }
};

const loadHall = async (): Promise<void> => {
    if (selectedSeason.value === null) {
        data.value = null;
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = (await trpc.ranking.getHallOfFame.query({
            season: selectedSeason.value,
            scenario: selectedScenario.value ?? undefined,
        })) as HallPayload;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '명예의 전당 데이터를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

watch([selectedSeason, selectedScenario], () => {
    void loadHall();
});

onMounted(loadOptions);
</script>

<template>
    <main id="container" class="legacy-hall-page legacy-bg0">
        <div class="legacy-hall-title">
            명 예 의 전 당<br />
            <button class="legacy-button" type="button" @click="closePage">창 닫기</button>
        </div>

        <label class="scenario-search">
            시나리오 검색 :
            <select v-model="selection" aria-label="시나리오 검색">
                <template v-for="season in options" :key="season.season">
                    <option :value="`season:${season.season}`">* 시즌 : {{ season.season }} 종합 *</option>
                    <option
                        v-for="scenario in season.scenarios"
                        :key="`${season.season}:${scenario.id}`"
                        :value="`scenario:${season.season}:${scenario.id}`"
                    >
                        {{ scenario.name }}({{ scenario.count }}회)
                    </option>
                </template>
            </select>
        </label>

        <div v-if="errorMessage" class="legacy-message error" role="alert">{{ errorMessage }}</div>
        <div v-else-if="loading" class="legacy-message">불러오는 중...</div>
        <div v-else-if="!data" class="legacy-message">표시할 데이터가 없습니다.</div>

        <section v-if="data" class="hall-sections">
            <article v-for="section in data.sections" :key="section.title" class="rankView legacy-bg0">
                <h2 class="rankType legacy-bg1">{{ section.title }}</h2>
                <ul>
                    <li v-for="(entry, rank) in section.entries" :key="`${section.title}:${entry.generalId}:${rank}`">
                        <div class="hall-rank legacy-bg2">{{ rank + 1 }}위</div>
                        <div class="hall-img">
                            <img class="generalIcon" :src="imageUrl(entry)" width="64" height="64" :alt="entry.name" />
                        </div>
                        <div
                            v-if="entry.serverName"
                            class="hall-server"
                            :title="`${entry.scenarioName ?? ''} ${entry.startTime ?? ''} ~ ${entry.unitedTime ?? ''}`"
                        >
                            {{ entry.serverName }}{{ entry.serverIdx }}기
                        </div>
                        <div class="hall-nation" :style="{ backgroundColor: entry.bgColor, color: entry.fgColor }">
                            {{ entry.nationName || '-' }}
                        </div>
                        <div class="hall-name" :style="{ backgroundColor: entry.bgColor, color: entry.fgColor }">
                            <span>{{ entry.name || '-' }}</span>
                            <small v-if="entry.ownerName">({{ entry.ownerName }})</small>
                        </div>
                        <div class="hall-value">{{ entry.printValue }}</div>
                    </li>
                </ul>
            </article>
        </section>

        <div class="legacy-hall-bottom">
            <button class="legacy-button" type="button" @click="closePage">창 닫기</button>
        </div>
        <footer class="legacy-banner">
            삼국지 모의전투 HiDCHe core2026 / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD /
            <a href="https://sam.hided.net/wiki/hidche/credit" target="_blank" rel="noreferrer">Credit</a>
        </footer>
    </main>
</template>

<style scoped>
:global(body) {
    min-width: 500px;
    overflow-x: hidden;
}

.legacy-hall-page {
    width: 500px;
    min-height: 100vh;
    margin: 0 auto 100px;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
}

.legacy-hall-title,
.legacy-hall-bottom {
    text-align: left;
}

.legacy-hall-title {
    padding-top: 2px;
}

.scenario-search {
    display: block;
    padding: 2px 0;
    text-align: center;
}

.scenario-search select {
    width: 189px;
    height: 20px;
    border: 1px solid #555;
    background: #ddd;
    color: #303030;
}

.legacy-button {
    border: 0;
    border-radius: 5.25px;
    background: #375a7f;
    padding: 5.25px 10.5px;
    font-weight: 700;
    line-height: 21px;
}

.legacy-button:hover,
.legacy-button:focus,
.legacy-button:active {
    background: #6b6b6b;
}

.legacy-button:focus-visible {
    outline: revert;
    outline-offset: 0;
}

.legacy-message {
    border: 1px solid gray;
    padding: 12px;
    text-align: center;
}

.legacy-message.error {
    color: #ff6b6b;
}

.legacy-banner {
    font-size: 13px;
}

.legacy-banner a {
    color: #fff;
    text-decoration: underline;
}

.hall-sections {
    display: block;
}

.rankView {
    position: relative;
    margin: auto;
    outline: 1px solid gray;
}

.rankType {
    margin: 0;
    border-bottom: 1px solid gray;
    padding: 2px;
    font-size: calc(19px + 0.784615vw);
    font-weight: 500;
    line-height: 1.2;
    text-align: center;
}

.rankView ul {
    display: flex;
    flex-wrap: wrap;
    box-sizing: border-box;
    margin: -1px 0;
    padding: 0;
    list-style: none;
}

.rankView li {
    box-sizing: border-box;
    flex: 0 0 100px;
    width: 100px;
    min-height: 149px;
    margin: 0;
    border-top: 1px solid gray;
    border-right: 1px solid gray;
    text-align: center;
    vertical-align: top;
}

.hall-rank,
.hall-server,
.hall-nation,
.hall-value {
    border-bottom: 1px solid gray;
}

.hall-img {
    height: 64px;
}

.generalIcon {
    display: inline-block;
    width: 64px;
    height: 64px;
    object-fit: fill;
}

.hall-server,
.hall-nation,
.hall-name {
    font-size: 11px;
}

.hall-name {
    display: flex;
    height: 28px;
    flex-direction: column;
    justify-content: center;
}

.hall-name small {
    font-size: 95%;
}

.hall-value {
    box-sizing: border-box;
    padding: 3px 0;
    line-height: 13px;
}

@media (min-width: 1000px) {
    :global(body) {
        min-width: 1000px;
    }

    .legacy-hall-page {
        width: 1000px;
    }

    .rankType {
        font-size: 28px;
    }
}
</style>
