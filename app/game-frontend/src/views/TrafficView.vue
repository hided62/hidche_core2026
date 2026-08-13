<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { trpc } from '../utils/trpc';

type TrafficData = Awaited<ReturnType<typeof trpc.public.getTraffic.query>>;

const data = ref<TrafficData | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const router = useRouter();

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : '요청을 처리하지 못했습니다.';
};

const load = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.public.getTraffic.query();
    } catch (error) {
        // Preserve the last successful graph if a later refresh fails.
        errorMessage.value = getErrorMessage(error);
    } finally {
        loading.value = false;
    }
};

const refreshRows = computed(() =>
    (data.value?.history ?? []).map((entry) => ({
        ...entry,
        value: entry.refresh,
        width: Math.round((entry.refresh / Math.max(1, data.value?.maxRefresh ?? 1)) * 1_000) / 10,
    }))
);

const onlineRows = computed(() =>
    (data.value?.history ?? []).map((entry) => ({
        ...entry,
        value: entry.online,
        width: Math.round((entry.online / Math.max(1, data.value?.maxOnline ?? 1)) * 1_000) / 10,
    }))
);

const timeLabel = (value: string): string => formatServerDateTime(value, { format: 'hourMinute' });

const trafficColor = (percentage: number): string => {
    const channel = (value: number): string =>
        Math.floor((Math.max(0, Math.min(100, value)) * 255) / 100)
            .toString(16)
            .padStart(2, '0');
    return `#${channel(percentage)}00${channel(100 - percentage)}`;
};

onMounted(() => {
    void load();
});
</script>

<template>
    <main id="traffic-container" class="traffic-page">
        <table class="legacy-table title-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        트 래 픽 정 보<br />
                        <button class="legacy-close" type="button" @click="router.push('/')">돌아가기</button>
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="errorMessage" class="traffic-error" role="alert">{{ errorMessage }}</div>
        <div v-if="loading && !data" class="traffic-loading">불러오는 중...</div>

        <table v-if="data" class="chart-layout-table">
            <tbody>
                <tr>
                    <td>
                        <table class="legacy-table chart-table legacy-bg0">
                            <thead>
                                <tr>
                                    <td colspan="4" class="legacy-bg2 chart-title">접 속 량</td>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="(entry, index) in refreshRows"
                                    :key="`${entry.date}-${index}`"
                                    class="chart-row"
                                >
                                    <td class="period">{{ entry.year }}년 {{ entry.month }}월</td>
                                    <td class="time legacy-bg2">{{ timeLabel(entry.date) }}</td>
                                    <td class="separator legacy-bg1"></td>
                                    <td class="bar-cell">
                                        <div
                                            v-if="entry.width > 0"
                                            class="big-bar"
                                            :style="{
                                                width: `${entry.width}%`,
                                                backgroundColor: trafficColor(entry.width),
                                            }"
                                        >
                                            <span v-if="entry.width >= 10">{{ entry.value }}</span>
                                        </div>
                                        <span v-if="entry.width < 10" class="out-bar">{{ entry.value }}</span>
                                    </td>
                                </tr>
                                <tr>
                                    <td colspan="4" class="legacy-bg1 spacer"></td>
                                </tr>
                                <tr>
                                    <td colspan="4" class="record">최고기록: {{ data.maxRefresh }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </td>

                    <td>
                        <table class="legacy-table chart-table legacy-bg0">
                            <thead>
                                <tr>
                                    <td colspan="4" class="legacy-bg2 chart-title">접 속 자</td>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="(entry, index) in onlineRows"
                                    :key="`${entry.date}-${index}`"
                                    class="chart-row"
                                >
                                    <td class="period">{{ entry.year }}년 {{ entry.month }}월</td>
                                    <td class="time legacy-bg2">{{ timeLabel(entry.date) }}</td>
                                    <td class="separator legacy-bg1"></td>
                                    <td class="bar-cell">
                                        <div
                                            v-if="entry.width > 0"
                                            class="big-bar"
                                            :style="{
                                                width: `${entry.width}%`,
                                                backgroundColor: trafficColor(entry.width),
                                            }"
                                        >
                                            <span v-if="entry.width >= 10">{{ entry.value }}</span>
                                        </div>
                                        <span v-if="entry.width < 10" class="out-bar">{{ entry.value }}</span>
                                    </td>
                                </tr>
                                <tr>
                                    <td colspan="4" class="legacy-bg1 spacer"></td>
                                </tr>
                                <tr>
                                    <td colspan="4" class="record">최고기록: {{ data.maxOnline }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
            </tbody>
        </table>

        <table v-if="data" class="legacy-table suspect-table legacy-bg0">
            <thead>
                <tr>
                    <td colspan="3" class="legacy-bg2 chart-title">주 의 대 상 자 (순간과도갱신)</td>
                </tr>
            </thead>
            <tbody>
                <tr v-for="entry in data.suspects" :key="entry.generalId ?? 'total'">
                    <td class="suspect-name">{{ entry.name }}</td>
                    <td class="suspect-score">{{ entry.refreshScoreTotal }}({{ entry.refresh }})</td>
                    <td class="little-bar-cell">
                        <div
                            v-if="entry.refresh > 0"
                            class="little-bar"
                            :style="{
                                width: `${Math.round((entry.refresh / Math.max(1, data.suspects[0]?.refresh ?? 1)) * 1_000) / 10}%`,
                                backgroundColor: trafficColor(
                                    Math.round((entry.refresh / Math.max(1, data.suspects[0]?.refresh ?? 1)) * 1_000) /
                                        10
                                ),
                            }"
                        ></div>
                    </td>
                </tr>
            </tbody>
        </table>

        <table class="legacy-table footer-table legacy-bg0">
            <tbody>
                <tr>
                    <td><button class="legacy-close" type="button" @click="router.push('/')">돌아가기</button></td>
                </tr>
                <tr>
                    <td class="banner">
                        삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD(hided62@gmail.com)
                        /
                        <a href="https://sam.hided.net/wiki/hidche/credit" target="_blank" rel="noreferrer">Credit</a>
                    </td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.traffic-page {
    width: 1016px;
    min-width: 1016px;
    min-height: 100vh;
    margin: 0 auto;
    padding: 0;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: normal;
}

.legacy-table {
    border-collapse: collapse;
    padding: 0;
    color: #fff;
    font-size: 14px;
}

/*
 * Ref's `.tb_layout td` sets no text alignment; the legacy markup centres
 * individual cells with `align=center` instead.
 */
.legacy-table td,
.legacy-table th {
    border: 1px solid gray;
    padding: 0;
    font-weight: 400;
}

.chart-title,
.period,
.time,
.separator,
.spacer,
.record,
.suspect-table td,
.suspect-table th {
    text-align: center;
}

.title-table,
.footer-table {
    width: 1000px;
    margin: 0 auto;
}

.title-table {
    margin-bottom: 18px;
}

.title-table td {
    height: 54px;
}

.chart-layout-table {
    width: 1016px;
    margin: 0 auto;
    border-spacing: 2px;
}
.chart-layout-table > tbody > tr > td:first-child {
    text-align: left;
}
.chart-layout-table > tbody > tr > td:last-child {
    text-align: right;
}

.chart-table {
    width: 483px;
    table-layout: fixed;
}

.chart-title {
    height: 34px;
    font-size: 24px;
}

.chart-row {
    height: 30px;
}

.period {
    width: 100px;
}

.time {
    width: 60px;
}

.separator {
    width: 2px;
}

.bar-cell {
    width: 320px;
    text-align: left !important;
    white-space: nowrap;
}

.big-bar {
    float: left;
    position: relative;
    height: 30px;
}

.big-bar span {
    float: right;
    padding-right: 1ch;
    line-height: 30px;
}

.out-bar {
    line-height: 30px;
    margin-left: 1ch;
}

.spacer {
    height: 5px;
}

.record {
    height: 30px;
}

.suspect-table {
    margin: 18px auto;
}

.suspect-name,
.suspect-score {
    width: 98px;
}

.little-bar-cell {
    width: 798px;
    text-align: left !important;
}

.little-bar {
    height: 17px;
}

.footer-table {
    margin-top: 18px;
}

.banner {
    height: 24px;
}
.banner a {
    color: #fff;
    text-decoration: underline;
}

.legacy-close {
    color: #fff;
    text-decoration: underline;
}

.traffic-error,
.traffic-loading {
    width: 1000px;
    margin: -12px auto 12px;
    border: 1px solid gray;
    padding: 6px;
    text-align: center;
    background: #302016;
}

.traffic-error {
    color: #ff8080;
}
</style>
