<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatOfficerLevelText, cityLevelMap, regionMap } from '../utils/nationFormat';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.world.getCurrentCity.query>>;
const data = ref<Result | null>(null);
const error = ref('');
const selected = ref<number>();
const show = (value: number | null) => (value === null ? '?' : value.toLocaleString('ko-KR'));
const load = async (cityId?: number) => {
    try {
        data.value = await trpc.world.getCurrentCity.query(cityId ? { cityId } : undefined);
        selected.value = data.value.city.id;
        error.value = '';
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '도시 정보를 불러오지 못했습니다.';
    }
};
const city = computed(() => data.value?.city);
onMounted(() => void load());
</script>

<template>
    <main class="city-page">
        <table class="legacy-table legacy-bg0 center">
            <tbody>
                <tr>
                    <td>도 시 정 보<br /><RouterLink to="/">돌아가기</RouterLink></td>
                </tr>
            </tbody>
        </table>
        <table class="legacy-table legacy-bg0 selector">
            <tbody>
                <tr>
                    <td>
                        도시선택 :
                        <select v-model.number="selected" @change="load(selected)">
                            <option v-for="option in data?.options ?? []" :key="option.id" :value="option.id">
                                【{{ option.name.padEnd(4, '_') }}】{{
                                    option.nationId === data?.me.nationId
                                        ? '본국'
                                        : option.nationId === 0
                                          ? '공백지'
                                          : '타국'
                                }}
                            </option>
                        </select>
                        <p>명령 화면에서 도시를 클릭하셔도 됩니다.</p>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error">{{ error }}</p>
        <template v-if="data && city">
            <table class="legacy-table legacy-bg2 stats">
                <tbody>
                    <tr>
                        <td colspan="11" class="city-title">
                            【 {{ regionMap[city.region] }} | {{ cityLevelMap[city.level] }} 】 {{ city.name }}
                        </td>
                        <td class="city-title">{{ data.lastExecute }}</td>
                    </tr>
                    <tr>
                        <th>주민</th>
                        <td>{{ show(city.population) }}/{{ show(city.populationMax) }}</td>
                        <th>농업</th>
                        <td>{{ show(city.agriculture) }}/{{ show(city.agricultureMax) }}</td>
                        <th>상업</th>
                        <td>{{ show(city.commerce) }}/{{ show(city.commerceMax) }}</td>
                        <th>치안</th>
                        <td>{{ show(city.security) }}/{{ show(city.securityMax) }}</td>
                        <th>수비</th>
                        <td>{{ show(city.defence) }}/{{ show(city.defenceMax) }}</td>
                        <th>성벽</th>
                        <td>{{ show(city.wall) }}/{{ show(city.wallMax) }}</td>
                    </tr>
                    <tr>
                        <th>민심</th>
                        <td>{{ show(city.trust) }}</td>
                        <th>시세</th>
                        <td>{{ city.trade ?? '-' }}%</td>
                        <th>인구</th>
                        <td>
                            {{
                                city.population === null
                                    ? '?'
                                    : ((city.population / city.populationMax) * 100).toFixed(2)
                            }}%
                        </td>
                        <th>태수</th>
                        <td>{{ city.officers[4] }}</td>
                        <th>군사</th>
                        <td>{{ city.officers[3] }}</td>
                        <th>종사</th>
                        <td>{{ city.officers[2] }}</td>
                    </tr>
                    <tr>
                        <th>장수</th>
                        <td colspan="11">
                            {{
                                data.visibility.detailed
                                    ? data.generals.map((g) => g.name).join(', ') || '-'
                                    : '알 수 없음'
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
            <table v-if="data.visibility.detailed" class="legacy-table legacy-bg0 generals">
                <thead>
                    <tr>
                        <th>얼 굴</th>
                        <th>이 름</th>
                        <th>통솔</th>
                        <th>무력</th>
                        <th>지력</th>
                        <th>관 직</th>
                        <th>守</th>
                        <th>병 종</th>
                        <th>병 사</th>
                        <th>훈련</th>
                        <th>사기</th>
                        <th>명 령</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="general in data.generals" :key="general.id">
                        <td>
                            <img
                                v-if="general.picture"
                                width="64"
                                height="64"
                                :src="`/image/icons/${general.picture}`"
                            />
                        </td>
                        <td>{{ general.name }}</td>
                        <td>{{ general.leadership }}</td>
                        <td>{{ general.strength }}</td>
                        <td>{{ general.intelligence }}</td>
                        <td>{{ formatOfficerLevelText(general.officerLevel) }}</td>
                        <td>{{ general.defenceTrain ?? '?' }}</td>
                        <td>{{ general.crewTypeId ?? '?' }}</td>
                        <td>{{ general.crew ?? '?' }}</td>
                        <td>{{ general.train ?? '?' }}</td>
                        <td>{{ general.atmos ?? '?' }}</td>
                        <td class="turns">
                            {{
                                general.turns.length
                                    ? general.turns.map((turn, index) => `${index + 1} : ${turn}`).join(' / ')
                                    : general.npcState > 1
                                      ? 'NPC 장수'
                                      : `【${general.nationName}】 장수`
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </template>
        <table class="legacy-table legacy-bg0 center footer">
            <tbody>
                <tr>
                    <td><RouterLink to="/">돌아가기</RouterLink></td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.city-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
}
.legacy-table {
    width: 100%;
    border-collapse: collapse;
}
.legacy-table td,
.legacy-table th {
    border: 1px solid #777;
    padding: 3px;
    font-weight: 400;
}
.center {
    text-align: center;
}
.selector {
    text-align: center;
    margin-top: 0;
}
.selector select {
    display: inline-block;
    min-width: 400px;
}
.stats {
    margin-top: 14px;
}
.stats th,
.generals th {
    background-image: url('/image/game/back_green.jpg');
    text-align: center;
}
.stats td {
    text-align: center;
}
.city-title {
    text-align: center;
}
.generals {
    margin-top: 14px;
}
.generals td {
    text-align: center;
}
.generals td:last-child {
    text-align: left;
    padding-left: 1em;
}
.turns {
    font-size: x-small;
}
.footer {
    margin-top: 14px;
}
.error {
    text-align: center;
    color: #ff7373;
}
@media (max-width: 700px) {
    .city-page {
        width: 1000px;
        transform-origin: top left;
    }
    .selector select {
        min-width: 300px;
    }
}
</style>
