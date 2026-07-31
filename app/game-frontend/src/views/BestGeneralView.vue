<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import { trpc } from '../utils/trpc';

type RankEntry = {
    id: number;
    name: string;
    ownerName: string | null;
    nationName: string;
    bgColor: string;
    fgColor: string;
    picture: string | null;
    imageServer: number;
    printValue: string;
};

type RankSection = {
    title: string;
    valueType: 'int' | 'percent';
    entries: RankEntry[];
};

type UniqueItemEntry = {
    itemKey: string;
    itemName: string;
    itemInfo: string;
    owner: Omit<RankEntry, 'ownerName' | 'printValue'>;
};

type UniqueItemSection = {
    title: string;
    slot: string;
    entries: UniqueItemEntry[];
};

type BestGeneralPayload = {
    isUnited: boolean;
    sections: RankSection[];
    uniqueItems: UniqueItemSection[];
};

const router = useRouter();
const viewMode = ref<'user' | 'npc'>('user');
const loading = ref(false);
const errorMessage = ref('');
const data = ref<BestGeneralPayload | null>(null);

const imageUrl = (entry: { picture: string | null; imageServer: number }): string => resolveGeneralIconUrl(entry);

const closePage = async (): Promise<void> => {
    if (window.opener) {
        window.close();
        return;
    }
    await router.push('/');
};

const refresh = async (): Promise<void> => {
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.ranking.getBestGeneral.query({ view: viewMode.value });
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '명장일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

onMounted(() => {
    void refresh();
});

watch(viewMode, () => {
    void refresh();
});
</script>

<template>
    <main id="best-general-container" class="legacy-ranking-page legacy-bg0">
        <div class="legacy-ranking-title">
            명 장 일 람<br />
            <button class="legacy-button" type="button" @click="closePage">창 닫기</button>
        </div>

        <div class="view-selector" role="group" aria-label="장수 유형">
            <button class="legacy-button" type="button" :aria-pressed="viewMode === 'user'" @click="viewMode = 'user'">
                유저 보기
            </button>
            <button class="legacy-button" type="button" :aria-pressed="viewMode === 'npc'" @click="viewMode = 'npc'">
                NPC 보기
            </button>
        </div>

        <div v-if="errorMessage" class="legacy-message error" role="alert">{{ errorMessage }}</div>
        <div v-else-if="loading && !data" class="legacy-message">불러오는 중...</div>

        <section v-if="data" class="ranking-sections" :aria-busy="loading">
            <article v-for="section in data.sections" :key="section.title" class="rankView legacy-bg0">
                <h2 class="rankType legacy-bg1">{{ section.title }}</h2>
                <ul>
                    <li v-for="(entry, rank) in section.entries" :key="`${section.title}:${entry.id}:${rank}`">
                        <div class="hall-rank legacy-bg2">{{ rank + 1 }}위</div>
                        <div class="hall-img">
                            <img
                                class="generalIcon"
                                :src="imageUrl(entry)"
                                width="64"
                                height="64"
                                :alt="entry.name"
                                @error="useDefaultGeneralIcon"
                            />
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

            <article v-for="section in data.uniqueItems" :key="section.slot" class="rankView legacy-bg0">
                <h2 class="rankType legacy-bg1">{{ section.title }}</h2>
                <ul>
                    <li v-for="(entry, index) in section.entries" :key="`${entry.itemKey}:${index}`" class="no-value">
                        <div class="hall-rank legacy-bg2 item-name" :title="entry.itemInfo">{{ entry.itemName }}</div>
                        <div class="hall-img">
                            <img
                                class="generalIcon"
                                :src="imageUrl(entry.owner)"
                                width="64"
                                height="64"
                                :alt="entry.owner.name"
                                @error="useDefaultGeneralIcon"
                            />
                        </div>
                        <div
                            class="hall-nation"
                            :style="{ backgroundColor: entry.owner.bgColor, color: entry.owner.fgColor }"
                        >
                            {{ entry.owner.nationName || '-' }}
                        </div>
                        <div
                            class="hall-name"
                            :style="{ backgroundColor: entry.owner.bgColor, color: entry.owner.fgColor }"
                        >
                            <span>{{ entry.owner.name || '-' }}</span>
                        </div>
                    </li>
                </ul>
            </article>
        </section>

        <div class="legacy-ranking-bottom">
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

.legacy-ranking-page {
    width: 500px;
    min-height: 100vh;
    margin: 0 auto 100px;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
}

.legacy-ranking-title,
.legacy-ranking-bottom {
    text-align: left;
}

.view-selector {
    text-align: center;
}

.legacy-ranking-title {
    padding-top: 2px;
}

.view-selector {
    padding: 2px 0;
}

.view-selector .legacy-button + .legacy-button {
    margin-left: 4px;
}

.view-selector .legacy-button[aria-pressed='true'] {
    border-style: inset;
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

.ranking-sections {
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

.rankView li.no-value {
    min-height: 128px;
}

.hall-rank,
.hall-nation,
.hall-value {
    border-bottom: 1px solid gray;
}

.hall-rank.item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

    .legacy-ranking-page {
        width: 1000px;
    }

    .rankType {
        font-size: 28px;
    }
}
</style>
