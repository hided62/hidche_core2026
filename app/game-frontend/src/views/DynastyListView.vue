<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { legacyNationTextColor } from '../utils/legacyNationColor';
import { trpc } from '../utils/trpc';

type DynastyListPayload = Awaited<ReturnType<typeof trpc.dynasty.getList.query>>;

const router = useRouter();
const loading = ref(false);
const errorMessage = ref('');
const data = ref<DynastyListPayload | null>(null);

const closePage = async (): Promise<void> => {
    if (window.opener) {
        window.close();
        return;
    }
    await router.push('/');
};

const loadDynasty = async (): Promise<void> => {
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.dynasty.getList.query();
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '왕조일람을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

onMounted(loadDynasty);
</script>

<template>
    <main id="dynasty-list-container" class="dynasty-page">
        <table class="legacy-table legacy-bg0 title-table">
            <tbody>
                <tr>
                    <td>
                        역 대 왕 조<br />
                        <button class="native-button" type="button" @click="closePage">창 닫기</button><br />
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="errorMessage" class="legacy-message error" role="alert">{{ errorMessage }}</div>
        <div v-else-if="loading && !data" class="legacy-message" role="status">불러오는 중...</div>

        <template v-if="data">
            <table v-if="data.current" class="legacy-table legacy-bg0 current-table spaced-table">
                <tbody>
                    <tr>
                        <td class="current-heading" colspan="8">
                            <span class="large-text">현재 ({{ data.current.year }}年 {{ data.current.month }}月)</span>
                            <RouterLink to="/yearbook"><button class="native-button" type="button">역사 보기</button></RouterLink>
                        </td>
                    </tr>
                </tbody>
            </table>

            <div v-if="data.entries.length === 0" class="legacy-message">표시할 왕조 기록이 없습니다.</div>

            <table
                v-for="entry in data.entries"
                :key="entry.id"
                class="legacy-table legacy-bg0 dynasty-table spaced-table"
            >
                <colgroup>
                    <col class="label-column" />
                    <col class="value-column" />
                    <col class="label-column" />
                    <col class="value-column" />
                    <col class="label-column" />
                    <col class="value-column" />
                    <col class="label-column" />
                    <col class="value-column" />
                </colgroup>
                <tbody>
                    <tr>
                        <td class="phase-heading" colspan="8">
                            <span class="large-text">{{ entry.phase }}</span>
                            <RouterLink :to="`/dynasty/${entry.id}`">
                                <button class="native-button" type="button">자세히</button>
                            </RouterLink>
                            <RouterLink v-if="entry.serverId" :to="{ path: '/yearbook', query: { serverID: entry.serverId } }">
                                <button class="native-button" type="button">역사 보기</button>
                            </RouterLink>
                        </td>
                    </tr>
                    <tr>
                        <td
                            class="nation-heading"
                            colspan="8"
                            :style="{ backgroundColor: entry.color, color: legacyNationTextColor(entry.color) }"
                        >
                            <span class="large-text">{{ entry.name }} ({{ entry.year }}年 {{ entry.month }}月)</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">국 력</td>
                        <td class="centered">{{ entry.power }}</td>
                        <td class="legacy-bg1 centered">장 수</td>
                        <td class="centered">{{ entry.gennum }}</td>
                        <td class="legacy-bg1 centered">속 령</td>
                        <td class="centered">{{ entry.citynum }}</td>
                        <td class="legacy-bg1 centered">성 향</td>
                        <td class="centered">{{ entry.type }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">황 제</td>
                        <td class="centered">{{ entry.l12name }}</td>
                        <td class="legacy-bg1 centered">승 상</td>
                        <td class="centered">{{ entry.l11name }}</td>
                        <td class="legacy-bg1 centered">표 기 장 군</td>
                        <td class="centered">{{ entry.l10name }}</td>
                        <td class="legacy-bg1 centered">사 공</td>
                        <td class="centered">{{ entry.l9name }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">거 기 장 군</td>
                        <td class="centered">{{ entry.l8name }}</td>
                        <td class="legacy-bg1 centered">태 위</td>
                        <td class="centered">{{ entry.l7name }}</td>
                        <td class="legacy-bg1 centered">위 장 군</td>
                        <td class="centered">{{ entry.l6name }}</td>
                        <td class="legacy-bg1 centered">사 도</td>
                        <td class="centered">{{ entry.l5name }}</td>
                    </tr>
                </tbody>
            </table>
        </template>

        <table class="legacy-table legacy-bg0 footer-table spaced-table">
            <tbody>
                <tr>
                    <td>
                        <button class="native-button" type="button" @click="closePage">창 닫기</button><br />
                    </td>
                </tr>
                <tr>
                    <td class="banner">
                        삼국지 모의전투 TypeScript core2026 / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD
                    </td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
:global(body:has(.dynasty-page)) {
    /* Ref renders this page as a 1000px column, mobile included. */
    min-width: 1000px;
}

.dynasty-page {
    width: 1000px;
    margin: 8px auto 0;
    color: #fff;
}

/* Ref `table.tb_layout` + `.tb_layout td`: collapsed 1px gray cell borders. */
.legacy-table {
    width: 1000px;
    background-color: transparent;
    border-collapse: collapse;
    font-size: 14px;
    word-break: break-all;
}

.legacy-table td {
    border: 1px solid gray;
    padding: 0;
    word-break: break-all;
}

.spaced-table {
    margin-top: 10px;
}

.title-table {
    height: 47px;
}

.current-table {
    height: 37px;
}

.dynasty-table {
    height: 139px;
}

.current-heading,
.phase-heading,
.nation-heading,
.centered {
    text-align: center;
}

.current-heading {
    background: #333;
}

.phase-heading {
    background: skyblue;
    color: #000;
}

.large-text {
    font-size: x-large;
}

.label-column {
    width: 80px;
}

.value-column {
    width: 170px;
}

.native-button {
    appearance: auto;
    box-sizing: border-box;
    border: 2px outset buttonborder;
    border-radius: 0;
    padding: 1px 6px;
    background: buttonface;
    color: buttontext;
    font-family: Arial;
    font-size: 13.3333px;
    font-weight: 400;
    line-height: normal;
    cursor: default;
}

.legacy-message {
    margin-top: 10px;
    border: 1px solid gray;
    padding: 12px;
    background: #302016;
    text-align: center;
}

.legacy-message.error {
    color: #ff6b6b;
}

.footer-table {
    min-height: 50px;
}

.banner {
    font-size: 13px;
}
</style>
