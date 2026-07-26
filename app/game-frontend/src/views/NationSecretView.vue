<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getSecretGeneralList.query>>;
type General = Result['generals'][number];
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const data = ref<Result | null>(null);
const error = ref('');
const loading = ref(false);
const sort = ref<Sort>(7);
const sortOptions = ['자금', '군량', '도시', '병종', '병사', '삭제턴', '턴', '부대'];
const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        data.value = await trpc.nation.getSecretGeneralList.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '암행부를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};
const generals = computed(() =>
    [...(data.value?.generals ?? [])].sort((left, right) => {
        const leftDetail = left.detail;
        const rightDetail = right.detail;
        if (!leftDetail || !rightDetail) return left.id - right.id;
        if (sort.value === 1) return right.gold - left.gold || left.id - right.id;
        if (sort.value === 2) return right.rice - left.rice || left.id - right.id;
        if (sort.value === 3) return leftDetail.cityId - rightDetail.cityId || left.id - right.id;
        if (sort.value === 4) return rightDetail.crewTypeId - leftDetail.crewTypeId || left.id - right.id;
        if (sort.value === 5) return rightDetail.crew - leftDetail.crew || left.id - right.id;
        if (sort.value === 6) return leftDetail.killTurn - rightDetail.killTurn || left.id - right.id;
        if (sort.value === 7) return leftDetail.turnTime.localeCompare(rightDetail.turnTime) || left.id - right.id;
        return rightDetail.troopId - leftDetail.troopId || left.id - right.id;
    })
);
const turnTime = (general: General): string => {
    const value = general.detail?.turnTime;
    return value ? value.slice(11, 16) : '-';
};
onMounted(load);
</script>

<template>
    <main class="secret-page">
        <table class="layout-table legacy-bg0 title">
            <tbody>
                <tr>
                    <td>암 행 부<br /><RouterLink to="/">창 닫기</RouterLink></td>
                </tr>
                <tr>
                    <td>
                        정렬순서 :
                        <select v-model.number="sort" aria-label="암행부 정렬">
                            <option v-for="(label, index) in sortOptions" :key="label" :value="index + 1">
                                {{ label }}
                            </option>
                        </select>
                        <button type="button">정렬하기</button>
                        <button type="button" :disabled="loading" @click="load">새로고침</button>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error legacy-bg0" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="state legacy-bg0">불러오는 중...</p>
        <template v-else-if="data">
            <table class="layout-table summary legacy-bg0">
                <tbody>
                    <tr>
                        <th>전체 금</th>
                        <td>{{ data.summary.gold.toLocaleString() }}</td>
                        <th>전체 쌀</th>
                        <td>{{ data.summary.rice.toLocaleString() }}</td>
                        <th>평균 금</th>
                        <td>{{ data.summary.averageGold.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</td>
                        <th>평균 쌀</th>
                        <td>{{ data.summary.averageRice.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</td>
                    </tr>
                    <tr>
                        <th>전체 병력/장수</th>
                        <td>{{ data.summary.crew.toLocaleString() }}/{{ data.summary.generalCount }}</td>
                        <th>훈사 90 병력/장수</th>
                        <td>
                            {{ data.summary.readiness[90].crew.toLocaleString() }}/{{
                                data.summary.readiness[90].generals
                            }}
                        </td>
                        <th>훈사 80 병력/장수</th>
                        <td>
                            {{ data.summary.readiness[80].crew.toLocaleString() }}/{{
                                data.summary.readiness[80].generals
                            }}
                        </td>
                        <th>훈사 60 병력/장수</th>
                        <td>
                            {{ data.summary.readiness[60].crew.toLocaleString() }}/{{
                                data.summary.readiness[60].generals
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
            <table id="secret-general-list" class="layout-table general-list legacy-bg0">
                <thead>
                    <tr>
                        <th class="name">이 름</th>
                        <th class="stat">통무지</th>
                        <th class="troop">부 대</th>
                        <th>자 금</th>
                        <th>군 량</th>
                        <th>도시</th>
                        <th class="mode">守</th>
                        <th>병 종</th>
                        <th>병 사</th>
                        <th>훈련</th>
                        <th>사기</th>
                        <th class="turns">명 령</th>
                        <th>삭턴</th>
                        <th>턴</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="general in generals" :key="general.id">
                        <td>{{ general.name }}<br />Lv {{ general.experienceLevel }}</td>
                        <td>
                            <span :class="{ wounded: general.injury > 0 }">{{ general.stats.leadership }}</span
                            ><span v-if="general.leadershipBonus" class="bonus">+{{ general.leadershipBonus }}</span
                            >∥<span :class="{ wounded: general.injury > 0 }">{{ general.stats.strength }}</span
                            >∥<span :class="{ wounded: general.injury > 0 }">{{ general.stats.intelligence }}</span>
                        </td>
                        <td>{{ general.detail?.troopName ?? '-' }}</td>
                        <td>{{ general.gold }}</td>
                        <td>{{ general.rice }}</td>
                        <td>{{ general.detail?.cityName ?? '-' }}</td>
                        <td>{{ general.defenceTrainText }}</td>
                        <td>{{ general.detail?.crewTypeId ?? '-' }}</td>
                        <td>{{ general.detail?.crew ?? '-' }}</td>
                        <td>{{ general.detail?.train ?? '-' }}</td>
                        <td>{{ general.detail?.atmos ?? '-' }}</td>
                        <td class="turn-list">
                            <template v-if="general.npcState >= 2">NPC 장수</template>
                            <template v-else>
                                <div
                                    v-for="(command, index) in general.detail?.reservedCommands ?? []"
                                    :key="`${general.id}-${index}`"
                                >
                                    {{ index + 1 }} : {{ command }}
                                </div>
                            </template>
                        </td>
                        <td>{{ general.detail?.killTurn ?? '-' }}</td>
                        <td>{{ turnTime(general) }}</td>
                    </tr>
                </tbody>
            </table>
        </template>
        <table class="layout-table legacy-bg0 footer">
            <tbody>
                <tr>
                    <td><RouterLink to="/">창 닫기</RouterLink></td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.secret-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
    color: #fff;
}
.layout-table {
    width: 1000px;
    border-collapse: collapse;
}
.layout-table td,
.layout-table th,
.state,
.error {
    border: 1px solid #777;
    padding: 3px;
    font-weight: 400;
    text-align: center;
}
.title {
    text-align: center;
}
.title button,
.title select {
    border: 1px solid #888;
    border-radius: 2px;
    background: #222;
    color: #fff;
    padding: 1px 6px;
}
.summary {
    margin: 5px auto;
}
.summary th,
.general-list th {
    background: #14241b url('/image/game/back_green.jpg');
}
.summary th {
    width: 120px;
}
.general-list {
    table-layout: fixed;
}
.general-list .name,
.general-list .stat,
.general-list .troop {
    width: 98px;
}
.general-list .mode {
    width: 28px;
}
.general-list .turns {
    width: 213px;
}
.general-list tbody tr {
    height: 50px;
}
.turn-list {
    text-align: left !important;
    font-size: 11px;
}
.wounded {
    color: red;
}
.bonus {
    color: cyan;
}
.error {
    color: #ff7373;
}
.footer {
    margin-top: 5px;
}
@media (max-width: 1000px) {
    .secret-page {
        margin: 0;
    }
}
</style>
