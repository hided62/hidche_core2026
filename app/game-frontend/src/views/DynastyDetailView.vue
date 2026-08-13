<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { formatLog } from '../utils/formatLog';
import { legacyNationTextColor } from '../utils/legacyNationColor';
import { trpc } from '../utils/trpc';

type DynastyDetailPayload = Awaited<ReturnType<typeof trpc.dynasty.getDetail.query>>;

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const errorMessage = ref('');
const data = ref<DynastyDetailPayload | null>(null);

const emperorId = computed(() => {
    const idParam = route.params.id;
    const raw = Array.isArray(idParam) ? idParam[0] : idParam;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
});

const closePage = async (): Promise<void> => {
    if (window.opener) {
        window.close();
        return;
    }
    await router.push('/');
};

const loadDetail = async (): Promise<void> => {
    if (emperorId.value === null) {
        data.value = null;
        errorMessage.value = '잘못된 왕조 번호입니다.';
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.dynasty.getDetail.query({ emperorId: emperorId.value });
    } catch (error) {
        data.value = null;
        errorMessage.value = error instanceof Error ? error.message : '왕조 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const formatArchiveDate = (value: string): string =>
    new Intl.DateTimeFormat('sv-SE', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'UTC',
    }).format(new Date(value));

watch(emperorId, loadDetail);
onMounted(loadDetail);
</script>

<template>
    <main id="dynasty-detail-container" class="dynasty-page">
        <table class="legacy-table legacy-bg0 title-table">
            <tbody>
                <tr>
                    <td>
                        역 대 왕 조<br />
                        <button class="native-button" type="button" @click="closePage">창 닫기</button>
                        <span class="all-link">
                            <RouterLink to="/dynasty"><button class="native-button" type="button">전체보기</button></RouterLink>
                        </span>
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="errorMessage" class="legacy-message error" role="alert">{{ errorMessage }}</div>
        <div v-else-if="loading && !data" class="legacy-message" role="status">불러오는 중...</div>

        <template v-if="data">
            <table class="legacy-table legacy-bg0 emperor-table">
                <colgroup>
                    <col class="short-label" />
                    <col class="picture-column" />
                    <col class="long-value" />
                    <col class="short-label" />
                    <col class="picture-column" />
                    <col class="long-value" />
                </colgroup>
                <tbody>
                    <tr>
                        <td class="phase-heading centered" colspan="6">
                            <span class="large-text">{{ data.emperor.phase }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">국 가 수<br />(최종 / 최대)</td>
                        <td class="centered" colspan="2">{{ data.emperor.nationCount }}</td>
                        <td class="legacy-bg1 centered">장 수 수<br />(최종 / 최대)</td>
                        <td class="centered" colspan="2">{{ data.emperor.genCount }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">등 장 국 가</td>
                        <td colspan="5">{{ data.emperor.nationName }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">국가별 성향</td>
                        <td colspan="5">{{ data.emperor.nationHist }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">장 수 성 격</td>
                        <td colspan="5">{{ data.emperor.personalHist }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">장 수 특 기</td>
                        <td colspan="5">{{ data.emperor.specialHist }}</td>
                    </tr>
                    <tr>
                        <td
                            class="nation-heading centered"
                            colspan="6"
                            :style="{
                                backgroundColor: data.emperor.color,
                                color: legacyNationTextColor(data.emperor.color),
                            }"
                        >
                            <span class="large-text">
                                {{ data.emperor.name }} ({{ data.emperor.year }}年 {{ data.emperor.month }}月)
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">국 력</td>
                        <td class="centered" colspan="2">{{ data.emperor.power }}</td>
                        <td class="legacy-bg1 centered">성 향</td>
                        <td class="centered" colspan="2">{{ data.emperor.type }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">장 수</td>
                        <td class="centered" colspan="2">{{ data.emperor.gennum }}</td>
                        <td class="legacy-bg1 centered">속 령</td>
                        <td class="centered" colspan="2">{{ data.emperor.citynum }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">총 인 구</td>
                        <td class="centered" colspan="2">{{ data.emperor.pop }}</td>
                        <td class="legacy-bg1 centered">인 구 율</td>
                        <td class="centered" colspan="2">{{ data.emperor.poprate }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">국 고</td>
                        <td class="centered" colspan="2">{{ data.emperor.gold }}</td>
                        <td class="legacy-bg1 centered">병 량</td>
                        <td class="centered" colspan="2">{{ data.emperor.rice }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">황 제</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l12name }}</td>
                        <td class="legacy-bg1 centered">승 상</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l11name }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">위 장 군</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l10name }}</td>
                        <td class="legacy-bg1 centered">사 공</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l9name }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">표 기 장 군</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l8name }}</td>
                        <td class="legacy-bg1 centered">태 위</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l7name }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">거 기 장 군</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l6name }}</td>
                        <td class="legacy-bg1 centered">사 도</td>
                        <td>&nbsp;</td>
                        <td>{{ data.emperor.l5name }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">오 호 장 군</td>
                        <td colspan="5">{{ data.emperor.tiger }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">건 안 칠 자</td>
                        <td colspan="5">{{ data.emperor.eagle }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">장 수 들<br />(공헌도 순서)</td>
                        <td colspan="5">{{ data.emperor.gen }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 centered">역 사 기 록</td>
                        <td colspan="5">
                            <!-- 레거시 색상 tag를 동일한 span 구조로 변환한다. -->
                            <!-- eslint-disable-next-line vue/no-v-html -->
                            <div v-for="(entry, index) in data.emperor.history" :key="index" v-html="formatLog(entry)" />
                        </td>
                    </tr>
                </tbody>
            </table>

            <table
                v-for="nation in data.nations"
                :key="nation.archiveId"
                class="legacy-table legacy-bg2 old-nation-table"
            >
                <colgroup>
                    <col class="old-label" />
                    <col class="old-value" />
                    <col class="old-label" />
                    <col class="old-value" />
                    <col class="old-label" />
                    <col class="old-value" />
                </colgroup>
                <thead>
                    <tr>
                        <td
                            class="centered"
                            colspan="6"
                            :style="{ backgroundColor: nation.color, color: legacyNationTextColor(nation.color) }"
                        >
                            【 {{ nation.name }} 】
                        </td>
                    </tr>
                </thead>
                <tbody class="centered">
                    <tr>
                        <td class="legacy-bg1">성향</td>
                        <td>{{ nation.typeName }}</td>
                        <td class="legacy-bg1">-</td>
                        <td>-</td>
                        <td class="legacy-bg1">일자</td>
                        <td>{{ formatArchiveDate(nation.date) }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1">최종 작위</td>
                        <td>{{ nation.levelName }}</td>
                        <td class="legacy-bg1">최종 장수 수</td>
                        <td>{{ nation.generals.length }}명</td>
                        <td class="legacy-bg1">기술력</td>
                        <td>{{ nation.tech ?? '' }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1">최대 영토 수</td>
                        <td>{{ nation.maxCities.length }}</td>
                        <td class="legacy-bg1">최대 병력 수</td>
                        <td>{{ nation.maxCrew ?? 0 }}명</td>
                        <td class="legacy-bg1">최대 국력</td>
                        <td>{{ nation.maxPower ?? 0 }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 top-cell">최대영토</td>
                        <td colspan="5">{{ nation.maxCities.join(', ') }}</td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 top-cell">장수명단</td>
                        <td colspan="5">
                            <template v-for="general in nation.generalsFull" :key="general.generalNo">
                                {{ general.name }},
                            </template>
                        </td>
                    </tr>
                    <tr>
                        <td class="legacy-bg1 top-cell">국가열전</td>
                        <td class="legacy-bg0 nation-history" colspan="5">
                            <!-- eslint-disable-next-line vue/no-v-html -->
                            <div v-for="(entry, index) in nation.history" :key="index" v-html="formatLog(entry)" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </template>

        <table class="legacy-table legacy-bg0 footer-table">
            <tbody>
                <tr>
                    <td>
                        <button class="native-button" type="button" @click="closePage">창 닫기</button><br />
                    </td>
                </tr>
                <tr>
                    <td class="banner">
                        삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD
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
    font-family: 'Times New Roman', serif;
    font-size: 16px;
    line-height: normal;
}

.legacy-table {
    width: 1000px;
    border-spacing: 2px;
}

.legacy-table td {
    padding: 1px;
}

.title-table {
    height: 47px;
}

.all-link {
    float: right;
}

.emperor-table {
    margin-top: 0;
}

.short-label {
    width: 98px;
}

.picture-column {
    width: 64px;
}

.long-value {
    width: 332px;
}

.phase-heading {
    background: skyblue;
    color: #000;
}

.large-text {
    font-size: x-large;
}

.centered {
    text-align: center;
}

.old-nation-table {
    margin: 20px auto 0;
}

.old-label {
    width: 98px;
}

.old-value {
    width: 238px;
}

.top-cell {
    vertical-align: top;
}

.nation-history {
    text-align: left;
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
    margin-top: 20px;
}

.banner {
    font-size: 13px;
}
</style>
