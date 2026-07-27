<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { trpc } from '../utils/trpc';
import { cityLevelMap, formatOfficerLevelText, getNationChiefLevel, regionMap } from '../utils/nationFormat';

type PersonnelResponse = Awaited<ReturnType<typeof trpc.nation.getPersonnelInfo.query>>;
type GeneralEntry = PersonnelResponse['generals'][number];
type OfficerLevel = 2 | 3 | 4;

const officerLabels: Record<OfficerLevel, string> = { 4: '태수', 3: '군사', 2: '종사' };
const cityOfficerLevels: OfficerLevel[] = [4, 3, 2];
const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<string | null>(null);
const data = ref<PersonnelResponse | null>(null);
const chiefAppointmentDraft = reactive<Record<number, number>>({});
const cityDraft = reactive<Record<OfficerLevel, { cityId: number; generalId: number }>>({
    4: { cityId: 0, generalId: 0 },
    3: { cityId: 0, generalId: 0 },
    2: { cityId: 0, generalId: 0 },
});
const kickTargetId = ref(0);
const ambassadorSelection = ref<number[]>([]);
const auditorSelection = ref<number[]>([]);

const resolveErrorMessage = (value: unknown): string =>
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'unknown_error';

const loadPersonnel = async () => {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
        data.value = await trpc.nation.getPersonnelInfo.query();
        status.value = null;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const nationLevel = computed(() => data.value?.nation.level ?? 0);
const canManage = computed(() => data.value?.me.canManage ?? false);
const canChangePermissions = computed(() => data.value?.me.canChangePermissions ?? false);
const canKick = computed(() => data.value?.me.canKick ?? false);
const chiefLevels = computed(() => {
    const levels: number[] = [];
    for (let level = 12; level >= getNationChiefLevel(nationLevel.value); level -= 1) levels.push(level);
    return levels;
});
const chiefPairs = computed(() => {
    const pairs: Array<[number, number]> = [];
    for (let level = 12; level >= getNationChiefLevel(nationLevel.value); level -= 2) {
        pairs.push([level, level - 1]);
    }
    return pairs;
});
const chiefAssignments = computed(() => data.value?.chiefAssignments ?? {});
const cityNameMap = computed(() => new Map((data.value?.cityAssignments ?? []).map((city) => [city.id, city.name])));
const generalMap = computed(() => new Map((data.value?.generals ?? []).map((general) => [general.id, general])));

const imageUrl = (general: GeneralEntry | undefined): string => {
    const picture = general?.picture ?? 'default.jpg';
    return general?.imageServer ? `${import.meta.env.BASE_URL}d_pic/${picture}` : `/image/icons/${picture}`;
};
const officerLocked = (value: number, level: number): boolean => (value & (1 << level)) !== 0;
const chiefLocked = (level: number): boolean => officerLocked(data.value?.nation.chiefSet ?? 0, level);
const cityOfficerLocked = (city: PersonnelResponse['cityAssignments'][number], level: number): boolean =>
    officerLocked(city.officerSet, level);
const candidateLabel = (general: GeneralEntry): string =>
    `${general.name} 【${cityNameMap.value.get(general.cityId) ?? '-'}】`;
const chiefCandidates = (level: number): GeneralEntry[] => {
    const minimum = data.value?.chiefStatMin ?? 0;
    const candidates = (data.value?.generals ?? []).filter((general) => general.officerLevel !== 12);
    if (level === 11) return candidates;
    if (level % 2 === 0) return candidates.filter((general) => general.stats.strength >= minimum);
    return candidates.filter((general) => general.stats.intelligence >= minimum);
};
const cityCandidates = (level: OfficerLevel): GeneralEntry[] => {
    const minimum = data.value?.chiefStatMin ?? 0;
    const candidates = (data.value?.generals ?? []).filter((general) => general.officerLevel !== 12);
    if (level === 4) return candidates.filter((general) => general.stats.strength >= minimum);
    if (level === 3) return candidates.filter((general) => general.stats.intelligence >= minimum);
    return candidates;
};
const openCities = (level: OfficerLevel) =>
    (data.value?.cityAssignments ?? []).filter((city) => !cityOfficerLocked(city, level));
const kickCandidates = computed(() =>
    (data.value?.generals ?? []).filter((general) => general.id !== data.value?.me.id)
);
const awardText = (entries: PersonnelResponse['awards']['tigers']): string =>
    entries.map((entry) => `${entry.name}【${entry.value.toLocaleString('ko-KR')}】`).join(', ');

const initializeDrafts = () => {
    if (!data.value) return;
    for (const level of chiefLevels.value) chiefAppointmentDraft[level] = chiefAssignments.value[level]?.id ?? 0;
    for (const level of [4, 3, 2] as const) {
        cityDraft[level].cityId = openCities(level)[0]?.id ?? 0;
        cityDraft[level].generalId = 0;
    }
    ambassadorSelection.value = data.value.permissionCandidates.ambassadors
        .filter((candidate) => candidate.permission === 'ambassador')
        .map((candidate) => candidate.id);
    auditorSelection.value = data.value.permissionCandidates.auditors
        .filter((candidate) => candidate.permission === 'auditor')
        .map((candidate) => candidate.id);
};
watch(data, initializeDrafts);

const runMutation = async (action: () => Promise<unknown>, successMessage: string) => {
    error.value = null;
    status.value = null;
    try {
        await action();
        status.value = successMessage;
        await loadPersonnel();
        status.value = successMessage;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const appointChief = async (level: number) => {
    const targetId = chiefAppointmentDraft[level] ?? 0;
    const target = generalMap.value.get(targetId);
    const office = formatOfficerLevelText(level, nationLevel.value);
    const prompt = target ? `${target.name}을(를) ${office}직에 임명하시겠습니까?` : `${office}직을 비우시겠습니까?`;
    if (!window.confirm(prompt)) return;
    await runMutation(
        () => trpc.nation.appoint.mutate({ destGeneralId: targetId, destCityId: 0, officerLevel: level }),
        target ? `${target.name}을(를) 임명했습니다.` : '관직을 비웠습니다.'
    );
};

const appointCityOfficer = async (level: OfficerLevel) => {
    const draft = cityDraft[level];
    const city = data.value?.cityAssignments.find((entry) => entry.id === draft.cityId);
    const target = generalMap.value.get(draft.generalId);
    const prompt = target
        ? `${target.name}을(를) ${city?.name ?? ''} ${officerLabels[level]}직에 임명하시겠습니까?`
        : `${city?.name ?? ''} ${officerLabels[level]}직을 비우시겠습니까?`;
    if (!window.confirm(prompt)) return;
    await runMutation(
        () =>
            trpc.nation.appoint.mutate({
                destGeneralId: draft.generalId,
                destCityId: draft.cityId,
                officerLevel: level,
            }),
        target ? `${target.name}을(를) 임명했습니다.` : '관직을 비웠습니다.'
    );
};

const enforcePermissionLimit = (selection: number[]) => {
    if (selection.length <= 2) return;
    selection.splice(0, selection.length - 2);
    window.alert('최대 2명까지 설정 가능합니다.');
};

const changePermissions = async (isAmbassador: boolean) => {
    const selection = isAmbassador ? ambassadorSelection.value : auditorSelection.value;
    if (!window.confirm(`${isAmbassador ? '외교권자' : '조언자'}를 변경할까요?`)) return;
    await runMutation(
        () => trpc.nation.changePermission.mutate({ isAmbassador, targetGeneralIds: selection }),
        '권한을 변경했습니다.'
    );
};

const kickGeneral = async () => {
    const target = generalMap.value.get(kickTargetId.value);
    if (!target || !window.confirm(`${target.name}을(를) 추방하시겠습니까?`)) return;
    await runMutation(
        () => trpc.nation.kick.mutate({ destGeneralId: target.id }),
        `${target.name}을(를) 추방했습니다.`
    );
};

onMounted(() => void loadPersonnel());
</script>

<template>
    <main id="personnel-container" class="legacy-office">
        <table class="legacy-table heading-table">
            <tbody>
                <tr>
                    <td>인 사 부<br /><RouterLink class="legacy-button" to="/">돌아가기</RouterLink></td>
                </tr>
            </tbody>
        </table>

        <div v-if="error" class="feedback error" role="alert">{{ error }}</div>
        <div v-if="status" class="feedback status" role="status">{{ status }}</div>
        <div v-if="loading" class="loading">불러오는 중...</div>

        <template v-if="data && !loading">
            <table class="legacy-table chief-status">
                <colgroup>
                    <col class="chief-role-column" />
                    <col class="chief-icon-column" />
                    <col class="chief-name-column" />
                    <col class="chief-role-column" />
                    <col class="chief-icon-column" />
                    <col class="chief-name-column" />
                </colgroup>
                <tbody>
                    <tr>
                        <td
                            class="nation-heading"
                            colspan="6"
                            :style="{ color: '#fff', backgroundColor: data.nation.color }"
                        >
                            【 {{ data.nation.name }} 】
                        </td>
                    </tr>
                    <tr v-for="[leftLevel, rightLevel] in chiefPairs" :key="leftLevel">
                        <template v-for="level in [leftLevel, rightLevel]" :key="level">
                            <td class="green-cell role-cell">{{ formatOfficerLevelText(level, nationLevel) }}</td>
                            <td
                                class="general-icon"
                                :style="{ backgroundImage: `url('${imageUrl(chiefAssignments[level])}')` }"
                            />
                            <td class="chief-name">
                                {{ chiefAssignments[level]?.name ?? '-' }}({{
                                    chiefAssignments[level]?.belong ?? '-'
                                }}년)
                            </td>
                        </template>
                    </tr>
                    <tr>
                        <td class="green-cell">오호장군【승전】</td>
                        <td colspan="5">{{ awardText(data.awards.tigers) }}</td>
                    </tr>
                    <tr>
                        <td class="green-cell">건안칠자【계략】</td>
                        <td colspan="5">{{ awardText(data.awards.eagles) }}</td>
                    </tr>
                </tbody>
            </table>

            <table class="legacy-table appointment-table">
                <colgroup>
                    <col class="office-label-column" />
                    <col class="office-control-column" />
                    <col class="office-label-column" />
                    <col class="office-control-column" />
                </colgroup>
                <tbody>
                    <tr>
                        <td colspan="4" class="spacer" />
                    </tr>
                    <tr>
                        <td colspan="4" class="section-title blue">수 뇌 부 임 명</td>
                    </tr>
                    <tr v-for="(pair, pairIndex) in chiefPairs" :key="pairIndex">
                        <template v-for="level in pair" :key="level">
                            <td class="green-cell appoint-label">{{ formatOfficerLevelText(level, nationLevel) }}</td>
                            <td class="appoint-control">
                                <template v-if="canManage && level !== 12 && !chiefLocked(level)">
                                    <select
                                        v-model.number="chiefAppointmentDraft[level]"
                                        :aria-label="`${formatOfficerLevelText(level, nationLevel)} 대상`"
                                    >
                                        <option :value="0">____공석____</option>
                                        <option
                                            v-for="candidate in chiefCandidates(level)"
                                            :key="candidate.id"
                                            :value="candidate.id"
                                        >
                                            {{ candidateLabel(candidate) }}
                                        </option>
                                    </select>
                                    <button type="button" @click="appointChief(level)">임명</button>
                                </template>
                                <template v-else>
                                    {{ chiefAssignments[level]?.name ?? '-' }}
                                    <template v-if="chiefAssignments[level]">
                                        【{{ chiefAssignments[level]?.cityName ?? '-' }}】</template
                                    >
                                </template>
                            </td>
                        </template>
                    </tr>
                    <tr>
                        <td colspan="4" class="legend">
                            ※ <span class="red">빨간색</span>은 현재 임명중인 장수, <span class="orange">노란색</span>은
                            다른 관직에 임명된 장수, 하얀색은 일반 장수를 뜻합니다.
                        </td>
                    </tr>
                </tbody>
            </table>

            <table v-if="canChangePermissions" class="legacy-table permission-table">
                <colgroup>
                    <col class="office-label-column" />
                    <col class="office-control-column" />
                    <col class="office-label-column" />
                    <col class="office-control-column" />
                </colgroup>
                <tbody>
                    <tr>
                        <td colspan="4" class="spacer" />
                    </tr>
                    <tr>
                        <td colspan="4" class="section-title purple">외 교 권 자 임 명</td>
                    </tr>
                    <tr>
                        <td class="green-cell permission-label">외교권자</td>
                        <td>
                            <select
                                v-model="ambassadorSelection"
                                multiple
                                aria-label="외교권자"
                                @change="enforcePermissionLimit(ambassadorSelection)"
                            >
                                <option
                                    v-for="candidate in data.permissionCandidates.ambassadors"
                                    :key="candidate.id"
                                    :value="candidate.id"
                                >
                                    {{ candidate.name }}
                                </option>
                            </select>
                            <button type="button" @click="changePermissions(true)">임명</button>
                        </td>
                        <td class="green-cell permission-label">조언자</td>
                        <td>
                            <select
                                v-model="auditorSelection"
                                multiple
                                aria-label="조언자"
                                @change="enforcePermissionLimit(auditorSelection)"
                            >
                                <option
                                    v-for="candidate in data.permissionCandidates.auditors"
                                    :key="candidate.id"
                                    :value="candidate.id"
                                >
                                    {{ candidate.name }}
                                </option>
                            </select>
                            <button type="button" @click="changePermissions(false)">임명</button>
                        </td>
                    </tr>
                </tbody>
            </table>

            <table id="officer-list" class="legacy-table city-table">
                <colgroup>
                    <col class="city-level-column" />
                    <col class="city-name-column" />
                    <col class="city-officer-column" />
                    <col class="city-officer-column" />
                    <col class="city-officer-column" />
                </colgroup>
                <tbody>
                    <template v-if="canManage">
                        <tr>
                            <td colspan="5" class="spacer" />
                        </tr>
                        <tr>
                            <td colspan="5" class="section-title orange-bg">도 시 관 직 임 명</td>
                        </tr>
                        <tr v-for="level in cityOfficerLevels" :key="level">
                            <td colspan="3" class="blue-cell city-appoint-label">{{ officerLabels[level] }} 임명</td>
                            <td colspan="2">
                                <select
                                    v-model.number="cityDraft[level].cityId"
                                    :aria-label="`${officerLabels[level]} 도시`"
                                >
                                    <option v-for="city in openCities(level)" :key="city.id" :value="city.id">
                                        【{{ regionMap[city.region] ?? '-' }}】 {{ city.name }}
                                    </option>
                                </select>
                                <select
                                    v-model.number="cityDraft[level].generalId"
                                    :aria-label="`${officerLabels[level]} 장수`"
                                >
                                    <option :value="0">____공석____</option>
                                    <option
                                        v-for="candidate in cityCandidates(level)"
                                        :key="candidate.id"
                                        :value="candidate.id"
                                    >
                                        {{ candidateLabel(candidate) }}
                                    </option>
                                </select>
                                <button type="button" @click="appointCityOfficer(level)">임명</button>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="5" class="legend">
                                ※ <span class="red">빨간색</span>은 현재 임명중인 장수,
                                <span class="orange">노란색</span>은 다른 관직에 임명된 장수, 하얀색은 일반 장수를
                                뜻합니다.
                            </td>
                        </tr>
                    </template>
                    <tr class="city-header">
                        <td colspan="2">도 시</td>
                        <td>태 수 (사관) 【현재도시】</td>
                        <td>군 사 (사관) 【현재도시】</td>
                        <td>종 사 (사관) 【현재도시】</td>
                    </tr>
                    <template v-for="(city, index) in data.cityAssignments" :key="city.id">
                        <tr v-if="index === 0 || data.cityAssignments[index - 1]?.region !== city.region">
                            <td colspan="5" class="region-heading">【 {{ regionMap[city.region] ?? '-' }} 】</td>
                        </tr>
                        <tr>
                            <td class="nation-city" :style="{ backgroundColor: data.nation.color }">
                                【{{ cityLevelMap[city.level] ?? '-' }}】
                            </td>
                            <td class="nation-city city-name" :style="{ backgroundColor: data.nation.color }">
                                {{ city.name }}
                            </td>
                            <td
                                v-for="level in cityOfficerLevels"
                                :key="level"
                                :class="{ locked: cityOfficerLocked(city, level) }"
                            >
                                <template v-if="city.officers[level]">
                                    {{ city.officers[level]?.name }}({{ city.officers[level]?.belong }}년) 【{{
                                        city.officers[level]?.cityName ?? '-'
                                    }}】
                                </template>
                                <template v-else>-</template>
                            </td>
                        </tr>
                    </template>
                    <tr>
                        <td colspan="5" class="legend">
                            ※ <span class="orange">노란색</span>은 변경 불가능, 하얀색은 변경 가능 관직입니다.
                        </td>
                    </tr>
                </tbody>
            </table>

            <table v-if="canManage" class="legacy-table kick-table">
                <colgroup>
                    <col class="kick-label-column" />
                    <col class="kick-control-column" />
                </colgroup>
                <tbody>
                    <tr>
                        <td colspan="2" class="spacer" />
                    </tr>
                    <tr>
                        <td colspan="2" class="section-title red-bg">추 방</td>
                    </tr>
                    <tr>
                        <td class="green-cell kick-label">대상 장수</td>
                        <td>
                            <template v-if="canKick">
                                <select v-model.number="kickTargetId" aria-label="추방 대상 장수">
                                    <option :value="0">장수 선택</option>
                                    <option
                                        v-for="candidate in kickCandidates"
                                        :key="candidate.id"
                                        :value="candidate.id"
                                    >
                                        {{ candidate.name }} ({{ candidate.stats.leadership }}/{{
                                            candidate.stats.strength
                                        }}/{{ candidate.stats.intelligence }})
                                    </option>
                                </select>
                                <button type="button" :disabled="kickTargetId === 0" @click="kickGeneral">추방</button>
                            </template>
                            <template v-else>이번 분기에는 추방할 수 없습니다.</template>
                        </td>
                    </tr>
                </tbody>
            </table>

            <table class="legacy-table footer-table">
                <tbody>
                    <tr>
                        <td><RouterLink class="legacy-button" to="/">돌아가기</RouterLink></td>
                    </tr>
                </tbody>
            </table>
        </template>
    </main>
</template>

<style scoped>
.legacy-office {
    width: 1000px;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font:
        14px/1.3 Pretendard,
        'Apple SD Gothic Neo',
        'Noto Sans KR',
        'Malgun Gothic',
        sans-serif;
}
.legacy-table {
    width: 1000px;
    margin: 0 auto;
    border-collapse: collapse;
    table-layout: fixed;
    background: var(--sammo-texture-walnut);
}
.legacy-table td {
    border: 1px solid gray;
    padding: 0;
}
.heading-table {
    height: 56px;
    margin-bottom: 18px;
}
.heading-table td {
    text-align: left;
}
button {
    display: inline-block;
    border: 1px solid #6c757d;
    border-radius: 4px;
    padding: 5.25px 10.5px;
    color: #fff;
    background: #6c757d;
    font: inherit;
    line-height: 21px;
    text-decoration: none;
    cursor: pointer;
}
.legacy-button {
    display: inline-block;
    border: 1px solid #325172;
    border-radius: 4px;
    padding: 5.25px 10.5px;
    color: #fff;
    background: #375a7f;
    font: inherit;
    line-height: 21px;
    text-decoration: none;
    cursor: pointer;
}
button:hover,
.legacy-button:hover {
    filter: brightness(1.16);
}
button:focus-visible,
.legacy-button:focus-visible,
select:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 1px;
}
button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
select {
    height: 20px;
    border: 1px solid #858585;
    padding: 0;
    color: #fff;
    background: #000;
    font: inherit;
}
select[multiple] {
    width: 300px;
    height: 34px;
}
.nation-heading {
    height: 32px;
    text-align: center;
    font-size: 20px;
}
.chief-status {
    margin-bottom: 0;
    table-layout: fixed;
}
.chief-role-column {
    width: 10%;
}
.chief-icon-column {
    width: 6.5%;
}
.chief-name-column {
    width: 33.5%;
}
.office-label-column {
    width: 10%;
}
.office-control-column {
    width: 40%;
}
.city-level-column,
.city-name-column {
    width: 8%;
}
.city-officer-column {
    width: 28%;
}
.kick-label-column {
    width: 10%;
}
.kick-control-column {
    width: 90%;
}
.chief-status .role-cell {
    text-align: center;
    font-size: 18px;
}
.general-icon {
    height: 64px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: 64px 64px;
}
.chief-name {
    width: 332px;
    font-size: 18px;
}
.green-cell,
.city-header,
.region-heading {
    background: var(--sammo-texture-green);
}
.blue-cell {
    background: var(--sammo-texture-blue);
}
.spacer {
    height: 5px;
}
.section-title {
    text-align: center;
    line-height: 19px;
}
.blue {
    background: blue;
}
.purple {
    background: purple;
}
.orange-bg {
    background: orange;
}
.red-bg {
    background: red;
}
.appointment-table .appoint-label,
.permission-label {
    width: 98px;
    text-align: right;
}
.appointment-table .appoint-control {
    width: 398px;
}
.legend {
    line-height: 18px;
}
.red {
    color: red;
}
.orange,
.locked {
    color: orange;
}
.permission-table select {
    vertical-align: middle;
}
.city-appoint-label {
    text-align: right;
}
.city-header td {
    height: 29px;
    text-align: center;
    font-size: 18px;
}
.city-header td:first-child {
    width: 158px;
}
.region-heading {
    height: 29px;
    color: skyblue;
    font-size: 18px;
}
.nation-city {
    width: 78px;
    text-align: center;
    font-size: 16.8px;
}
.city-name {
    text-align: right;
}
.kick-label {
    width: 498px;
    text-align: right;
}
.footer-table {
    margin-top: 18px;
}
.feedback,
.loading {
    width: 1000px;
    box-sizing: border-box;
    border: 1px solid gray;
    padding: 6px 8px;
    background: var(--sammo-texture-walnut);
}
.error {
    color: #ff8080;
}
.status {
    color: #80ff80;
}
@media (max-width: 1000px) {
    .legacy-office {
        margin: 0;
    }
}
</style>
