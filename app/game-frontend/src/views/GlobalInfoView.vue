<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import MapViewer from '../components/main/MapViewer.vue';
import { trpc } from '../utils/trpc';
import { legacyNationTextColor } from '../utils/legacyNationColor';

type Result = Awaited<ReturnType<typeof trpc.world.getGlobalInfo.query>>;
type Layout = Awaited<ReturnType<typeof trpc.world.getMapLayout.query>>;
const data = ref<Result | null>(null);
const layout = ref<Layout | null>(null);
const error = ref('');
const matrixElement = ref<HTMLTableElement | null>(null);
const matrixHeight = ref<number | null>(null);
const router = useRouter();
const goBack = () => router.push('/');
const state = (value: number) => ({ 0: '★', 1: '▲', 2: '', 7: '@' })[value] ?? 'ㆍ';
const stateClass = (value: number) => `state-${value}`;
const nationMap = computed(() => new Map(data.value?.nations.map((nation) => [nation.id, nation]) ?? []));
const nationNameStyle = (color: string) => ({
    backgroundColor: color,
    color: legacyNationTextColor(color),
});
watch(
    matrixElement,
    (element, _previousElement, onCleanup) => {
        if (!element) {
            matrixHeight.value = null;
            return;
        }
        const updateHeight = () => {
            matrixHeight.value = element.getBoundingClientRect().height;
        };
        const observer = new ResizeObserver(updateHeight);
        observer.observe(element);
        updateHeight();
        onCleanup(() => observer.disconnect());
    },
    { flush: 'post' }
);
onMounted(async () => {
    try {
        [data.value, layout.value] = await Promise.all([
            trpc.world.getGlobalInfo.query(),
            trpc.world.getMapLayout.query(),
        ]);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '중원 정보를 불러오지 못했습니다.';
    }
});
</script>

<template>
    <main class="global-page legacy-bg0">
        <header class="legacy-title">
            <button type="button" @click="goBack">돌아가기</button><strong>중원 정보</strong>
        </header>
        <p v-if="error" class="error">{{ error }}</p>
        <section v-if="data" class="section">
            <h2 class="blue">외교 현황</h2>
            <div class="matrix-wrap" :style="{ height: matrixHeight === null ? undefined : `${matrixHeight}px` }">
                <table ref="matrixElement" class="matrix">
                    <thead>
                        <tr>
                            <th></th>
                            <th
                                v-for="nation in data.nations"
                                :key="nation.id"
                                class="vertical"
                                :style="nationNameStyle(nation.color)"
                            >
                                {{ nation.name }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="me in data.nations" :key="me.id">
                            <th :style="nationNameStyle(me.color)">{{ me.name }}</th>
                            <td
                                v-for="you in data.nations"
                                :key="you.id"
                                :class="[
                                    stateClass(data.diplomacy[me.id]?.[you.id] ?? 2),
                                    { mine: me.id === data.myNationId || you.id === data.myNationId },
                                ]"
                            >
                                {{ me.id === you.id ? '＼' : state(data.diplomacy[me.id]?.[you.id] ?? 2) }}
                            </td>
                        </tr>
                    </tbody>
                    <tfoot>
                        <tr>
                            <td :colspan="data.nations.length + 1">
                                불가침 : <b class="state-7">@</b>, 통상 : ㆍ, 선포 : <b class="state-1">▲</b>, 교전 :
                                <b class="state-0">★</b>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
        <section v-if="data?.conflict.length" class="section">
            <h2 class="magenta">분쟁 현황</h2>
            <div v-for="conflict in data.conflict" :key="conflict.cityId" class="conflict">
                <strong>{{ conflict.cityName }}</strong>
                <div>
                    <div v-for="(percent, id) in conflict.nations" :key="id" class="conflict-row">
                        <span :style="nationNameStyle(nationMap.get(Number(id))?.color ?? '#000000')">{{
                            nationMap.get(Number(id))?.name
                        }}</span
                        ><em>{{ percent.toFixed(1) }}%</em
                        ><i :style="{ width: `${percent}%`, backgroundColor: nationMap.get(Number(id))?.color }" />
                    </div>
                </div>
            </div>
        </section>
        <section v-if="data && layout" class="section map-section">
            <h2 class="green">중원 지도</h2>
            <div class="map-grid">
                <MapViewer :map-data="data.map" :map-layout="layout" :loading="false" />
                <div class="nation-list">
                    <table class="simple-nation-list">
                        <thead>
                            <tr>
                                <th class="nation-name-column">국명</th>
                                <th class="nation-power-column">국력</th>
                                <th class="nation-count-column">장수</th>
                                <th class="nation-count-column">속령</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="nation in data.nations" :key="nation.id">
                                <td>
                                    <span :style="nationNameStyle(nation.color)">{{ nation.name }}</span>
                                </td>
                                <td>{{ nation.power.toLocaleString() }}</td>
                                <td>{{ nation.generalCount.toLocaleString() }}</td>
                                <td
                                    :title="nation.cities.join(', ')"
                                    :aria-label="`속령 ${nation.cities.length}개: ${nation.cities.join(', ')}`"
                                >
                                    {{ nation.cities.length.toLocaleString() }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
        <footer class="legacy-title footer"><button type="button" @click="goBack">돌아가기</button></footer>
        <button class="legacy-compat-button" type="button" tabindex="-1" aria-hidden="true" />
    </main>
</template>

<style scoped>
.global-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
    background-color: transparent;
    background-image: none;
}
.legacy-title {
    position: relative;
    width: 100%;
    height: 32px;
    text-align: left;
    background-image: var(--sammo-texture-walnut);
}

.legacy-title > strong {
    display: block;
    text-align: center;
}
.legacy-title strong {
    font-size: 24px;
    font-weight: 400;
    line-height: 32px;
}
.legacy-title button {
    position: absolute;
    inset: 0 auto 0 0;
    width: 88px;
    border: 1px solid #0a9960;
    border-radius: 0 0 4px;
    background: #087f45;
    color: #fff;
    font-weight: 700;
    cursor: pointer;
}
.legacy-compat-button {
    display: none;
}
.section {
    margin-top: 21px;
    background-image: var(--sammo-texture-walnut);
}
.section h2 {
    font-size: 16.8px;
    font-weight: 400;
    text-align: center;
    margin: 0;
    border-block: 1px solid #777;
    padding: 2px;
}
.blue {
    background: #00f;
}
.magenta {
    background: #f0f;
}
.green {
    background: green;
}
.matrix-wrap {
    overflow-x: auto;
    overflow-y: hidden;
}
.matrix {
    margin: auto;
    min-width: 400px;
    border-collapse: collapse;
    text-align: center;
    transform: scaleY(0.929474);
    transform-origin: top;
}
.matrix th {
    padding: 1px;
    font-weight: 700;
}
.matrix .vertical {
    writing-mode: vertical-rl;
    text-align: end;
    padding: 1ch 0;
    min-width: 1ch;
    max-width: 3ch;
}
.matrix tbody th {
    padding: 2px 1ch;
    text-align: right;
    min-width: 10ch;
}
.matrix td {
    border-left: 1px solid gray;
    border-top: 1px solid gray;
    padding: 0;
}
.matrix td.mine {
    background: #600;
}
.state-0 {
    color: red;
}
.state-1 {
    color: #f0f;
}
.state-7 {
    color: #32cd32;
}
.conflict {
    display: grid;
    grid-template-columns: 16ch 1fr;
}
.conflict > strong {
    text-align: right;
    padding-right: 1ch;
    align-self: center;
}
.conflict-row {
    display: grid;
    grid-template-columns: 16ch 6ch 1fr;
    align-items: center;
}
.conflict-row span {
    padding-left: 1ch;
}
.conflict-row em {
    text-align: right;
    padding-right: 0.5ch;
    font-style: normal;
}
.conflict-row i {
    height: 1.2em;
}
.map-grid {
    display: grid;
    grid-template-columns: 700px 300px;
}
.simple-nation-list {
    width: 100%;
    border-collapse: collapse;
}
.simple-nation-list thead {
    background-color: #ccc;
    color: #000;
    text-align: center;
}
.simple-nation-list th {
    border: 0;
    border-left: 1px solid gray;
    padding: 2px 6px;
    font-weight: 700;
}
.simple-nation-list td {
    border: 0;
    border-left: 1px solid gray;
    padding: 1px 6px;
    text-align: right;
}
.simple-nation-list td:first-child {
    text-align: left;
}
.nation-name-column {
    width: 44%;
}
.nation-power-column {
    width: 23%;
}
.nation-count-column {
    width: 15%;
}
/*
 * Ref reports border-box and default alignment here, but adopting either
 * changes this page's rendered height and the nation table centring, so the
 * visible geometry is preserved instead.
 */
.footer {
    box-sizing: content-box;
    height: 35.5px;
    margin-top: 0;
    padding: 20px 0 0;
}
.error {
    text-align: center;
    color: #ff7373;
}
@media (max-width: 700px) {
    .global-page {
        width: 500px;
    }
    .map-grid {
        grid-template-columns: 500px;
    }
    .nation-list {
        width: 500px;
    }
    .map-section {
        height: 1464.33px;
        overflow: hidden;
    }
    .map-grid {
        height: 1437.14px;
        overflow: hidden;
    }
}
</style>
