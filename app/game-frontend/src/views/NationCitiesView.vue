<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { JosaUtil } from '@sammo-ts/common/util/JosaUtil';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatReservedCommandBrief } from '../components/command/reservedCommandBrief';
import type { CommandTable } from '../components/command/types';
import LegacySortControls from '../components/ui/LegacySortControls.vue';
import { useGameFeedback } from '../composables/useGameFeedback';
import { getNpcColor } from '../utils/npcColor';
import { sortGeneralsByTypeThenName } from '../utils/generalOrder';
import { legacyNationTextColor } from '../utils/legacyNationColor';
import { cityLevelMap, regionMap } from '../utils/nationFormat';
import { trpc } from '../utils/trpc';

type Result = Awaited<ReturnType<typeof trpc.nation.getCityOverview.query>>;
type SecretResult = Awaited<ReturnType<typeof trpc.nation.getSecretGeneralList.query>>;
type PersonnelResult = Awaited<ReturnType<typeof trpc.nation.getPersonnelInfo.query>>;
type City = Result['cities'][number];
type SecretGeneral = SecretResult['generals'][number];
type ReservedCommand = SecretGeneral['reservedCommands'][number];
type OfficerLevel = 2 | 3 | 4;
type Sort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
const data = ref<Result | null>(null);
const secretData = ref<SecretResult | null>(null);
const commandTable = ref<CommandTable | null>(null);
const personnelData = ref<PersonnelResult | null>(null);
const error = ref('');
const integrationError = ref('');
const secretLoading = ref(false);
const personnelLoading = ref(false);
const pendingAppointment = ref('');
const sort = ref<Sort>(10);
const selectedSort = ref<Sort>(10);
const extraSort = ref<
    | 'name'
    | 'populationRate'
    | 'populationRemain'
    | 'agricultureRemain'
    | 'commerceRemain'
    | 'securityRemain'
    | 'defenceRemain'
    | 'wallRemain'
    | 'generalCount'
    | null
>(null);
const router = useRouter();
const { error: showErrorToast, info: showInfoToast, success: showSuccessToast } = useGameFeedback();
const sortOptions = [
    '기본',
    '인구',
    '인구율',
    '민심',
    '농업',
    '상업',
    '치안',
    '수비',
    '성벽',
    '시세',
    '지역',
    '규모',
].map((label, index) => ({ value: index + 1, label }));
const officerLabels: Record<OfficerLevel, string> = { 4: '태수', 3: '군사', 2: '종사' };
const appointmentDescription = (city: City, general: SecretGeneral, level: OfficerLevel): string =>
    `${JosaUtil.put(general.name, '을')} ${city.name} ${JosaUtil.put(officerLabels[level], '으로')} 임명`;
const generalsForCity = (cityId: number) =>
    sortGeneralsByTypeThenName(data.value?.generals.filter((general) => general.cityId === cityId) ?? []);
const secretGeneralsForCity = (cityId: number) =>
    sortGeneralsByTypeThenName(secretData.value?.generals.filter((general) => general.cityId === cityId) ?? []);
const displayGeneralName = (general: Result['generals'][number]) =>
    general.npcState > 0 && !/^[ⓜⓝ]/u.test(general.name) ? `ⓝ${general.name}` : general.name;
const displaySecretGeneralName = (general: SecretGeneral) =>
    general.npcState > 0 && !/^[ⓜⓝ㉥]/u.test(general.name) ? `ⓝ${general.name}` : general.name;
const generalCount = (cityId: number) =>
    data.value?.generals.filter((general) => general.cityId === cityId).length ?? 0;
const cities = computed(() => {
    const values = [...(data.value?.cities ?? [])];
    if (extraSort.value) {
        const key = extraSort.value;
        return values.sort((a, b) => {
            if (key === 'name') return a.name.localeCompare(b.name);
            if (key === 'populationRate') return a.population / a.populationMax - b.population / b.populationMax;
            if (key === 'populationRemain') return a.population - a.populationMax - (b.population - b.populationMax);
            if (key === 'agricultureRemain')
                return a.agriculture - a.agricultureMax - (b.agriculture - b.agricultureMax);
            if (key === 'commerceRemain') return a.commerce - a.commerceMax - (b.commerce - b.commerceMax);
            if (key === 'securityRemain') return a.security - a.securityMax - (b.security - b.securityMax);
            if (key === 'defenceRemain') return a.defence - a.defenceMax - (b.defence - b.defenceMax);
            if (key === 'wallRemain') return a.wall - a.wallMax - (b.wall - b.wallMax);
            return generalCount(b.id) - generalCount(a.id);
        });
    }
    return values.sort((a, b) => {
        const key = sort.value;
        if (key === 1) return a.id - b.id;
        if (key === 2) return b.population - a.population;
        if (key === 3) return b.population / b.populationMax - a.population / a.populationMax;
        if (key === 4) return b.trust - a.trust;
        if (key === 5) return b.agriculture - a.agriculture;
        if (key === 6) return b.commerce - a.commerce;
        if (key === 7) return b.security - a.security;
        if (key === 8) return b.defence - a.defence;
        if (key === 9) return b.wall - a.wall;
        if (key === 10) return (b.trade ?? -1) - (a.trade ?? -1);
        if (key === 11) return a.region - b.region || b.level - a.level;
        return b.level - a.level || a.region - b.region;
    });
});
const setExtraSort = (value: NonNullable<typeof extraSort.value>) => {
    extraSort.value = value;
};
const updateSelectedSort = (value: number): void => {
    selectedSort.value = value as Sort;
};
const applySelectedSort = (): void => {
    sort.value = selectedSort.value;
    extraSort.value = null;
};
const sortByHeader = (value: Sort): void => {
    selectedSort.value = value;
    sort.value = value;
    extraSort.value = null;
};
const sortIndicator = (value: Sort, direction: 'ascending' | 'descending'): string =>
    sort.value === value && extraSort.value === null ? (direction === 'ascending' ? '▲' : '▼') : '↕';
const remain = (value: number, maximum: number) => value - maximum;
const warnRemain = (
    kind: 'agriculture' | 'commerce' | 'security' | 'defence' | 'wall',
    value: number,
    maximum: number
) => {
    const threshold = kind === 'defence' || kind === 'wall' ? -700 : -1000;
    return remain(value, maximum) > threshold;
};
const developmentClass = (
    kind: 'population' | 'agriculture' | 'commerce' | 'security' | 'defence' | 'wall',
    value: number,
    maximum: number
) => {
    const ratio = value / maximum;
    if (kind === 'population')
        return ratio > 0.9 ? 'development-high' : ratio > 0.7 ? 'development-mid' : 'development-low';
    if (kind === 'defence' || kind === 'wall')
        return ratio > 0.6 ? 'development-high' : ratio > 0.3 ? 'development-mid' : 'development-low';
    return ratio > 0.8 ? 'development-high' : ratio > 0.4 ? 'development-mid' : 'development-low';
};
const isRegionBreak = (city: City, index: number) =>
    sort.value === 10 && extraSort.value === null && (index === 0 || cities.value[index - 1]?.region !== city.region);
const officer = (city: City, level: 2 | 3 | 4) => city.officers[level]?.name ?? '-';
const officerIsStationed = (city: City, level: OfficerLevel): boolean =>
    secretData.value !== null && city.officers[level]?.cityId === city.id;
const personnelGeneralMap = computed(
    () => new Map((personnelData.value?.generals ?? []).map((general) => [general.id, general]))
);
const personnelCityMap = computed(
    () => new Map((personnelData.value?.cityAssignments ?? []).map((city) => [city.id, city]))
);
const officerLocked = (cityId: number, level: OfficerLevel): boolean => {
    const officerSet = personnelCityMap.value.get(cityId)?.officerSet ?? 0;
    return (officerSet & (1 << level)) !== 0;
};
const canAppoint = (cityId: number, generalId: number, level: OfficerLevel): boolean => {
    if (!personnelData.value?.me.canManage || officerLocked(cityId, level)) return false;
    const general = personnelGeneralMap.value.get(generalId);
    if (!general || general.officerLevel === 12) return false;
    if (level === 4) return general.stats.strength >= personnelData.value.chiefStatMin;
    if (level === 3) return general.stats.intelligence >= personnelData.value.chiefStatMin;
    return true;
};
const canShowAppointmentButtons = (generalId: number): boolean => {
    const general = personnelGeneralMap.value.get(generalId);
    return personnelData.value?.me.canManage === true && general !== undefined && general.officerLevel !== 12;
};
const isChief = (generalId: number): boolean => (personnelGeneralMap.value.get(generalId)?.officerLevel ?? 0) >= 5;
const appointmentKey = (cityId: number, generalId: number, level: OfficerLevel): string =>
    `${cityId}:${generalId}:${level}`;
const commandNeedsAttention = (city: City, command: string): boolean => {
    const normalized = command.replaceAll(/\s/gu, '');
    if (normalized.includes('정착장려')) {
        return city.population - city.populationMax > -20_000 || city.population > city.populationMax * 0.92;
    }
    if (normalized.includes('농지개간')) return city.agriculture - city.agricultureMax > -1_000;
    if (normalized.includes('상업투자')) return city.commerce - city.commerceMax > -1_000;
    if (normalized.includes('치안강화')) return city.security - city.securityMax > -1_000;
    if (normalized.includes('수비강화')) return city.defence - city.defenceMax > -700;
    if (normalized.includes('성벽보수')) return city.wall - city.wallMax > -700;
    return false;
};
const commandBrief = (command: ReservedCommand): string =>
    formatReservedCommandBrief('general', command.action, command.args, commandTable.value);

const loadSecretIntegration = async (): Promise<void> => {
    if (secretLoading.value) {
        showInfoToast('암행부 정보를 불러오는 중입니다.');
        return;
    }
    if (secretData.value) {
        showInfoToast('암행부 정보가 이미 연동되어 있습니다.');
        return;
    }
    secretLoading.value = true;
    integrationError.value = '';
    try {
        const secret = await trpc.nation.getSecretGeneralList.query();
        const table = await trpc.turns.getCommandTable.query({ generalId: secret.viewer.generalId });
        secretData.value = secret;
        commandTable.value = table;
    } catch (cause) {
        integrationError.value = cause instanceof Error ? cause.message : '암행부 연동에 실패했습니다.';
        showErrorToast(integrationError.value);
    } finally {
        secretLoading.value = false;
    }
};

const loadPersonnelIntegration = async (): Promise<void> => {
    if (personnelLoading.value) {
        showInfoToast('인사부 정보를 불러오는 중입니다.');
        return;
    }
    if (personnelData.value?.me.canManage) {
        showInfoToast('인사부 정보가 이미 연동되어 있습니다.');
        return;
    }
    personnelLoading.value = true;
    integrationError.value = '';
    try {
        const personnel = await trpc.nation.getPersonnelInfo.query();
        if (!personnel.me.canManage) {
            window.alert('수뇌가 아닙니다!');
            return;
        }
        personnelData.value = personnel;
    } catch (cause) {
        integrationError.value = cause instanceof Error ? cause.message : '인사부 연동에 실패했습니다.';
        showErrorToast(integrationError.value);
    } finally {
        personnelLoading.value = false;
    }
};

const refreshIntegratedData = async (): Promise<void> => {
    const [overview, secret, personnel] = await Promise.all([
        trpc.nation.getCityOverview.query(),
        trpc.nation.getSecretGeneralList.query(),
        trpc.nation.getPersonnelInfo.query(),
    ]);
    data.value = overview;
    secretData.value = secret;
    personnelData.value = personnel;
};

const appointCityOfficer = async (city: City, general: SecretGeneral, level: OfficerLevel): Promise<void> => {
    if (!canAppoint(city.id, general.id, level)) return;
    const key = appointmentKey(city.id, general.id, level);
    if (pendingAppointment.value) {
        showInfoToast('다른 임명을 처리하는 중입니다.');
        return;
    }
    if (isChief(general.id) && !window.confirm('수뇌입니다. 임명할까요?')) return;

    pendingAppointment.value = key;
    integrationError.value = '';
    try {
        await trpc.nation.appoint.mutate({
            destGeneralId: general.id,
            destCityId: city.id,
            officerLevel: level,
        });
        showSuccessToast(`${appointmentDescription(city, general, level)}했습니다.`);
        try {
            await refreshIntegratedData();
        } catch (cause) {
            integrationError.value =
                cause instanceof Error
                    ? `임명은 완료됐지만 화면을 갱신하지 못했습니다: ${cause.message}`
                    : '임명은 완료됐지만 화면을 갱신하지 못했습니다.';
            showErrorToast(integrationError.value);
        }
    } catch (cause) {
        integrationError.value = cause instanceof Error ? cause.message : '임명에 실패했습니다.';
        showErrorToast(integrationError.value);
    } finally {
        pendingAppointment.value = '';
    }
};
onMounted(async () => {
    try {
        data.value = await trpc.nation.getCityOverview.query();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '세력 도시를 불러오지 못했습니다.';
    }
});
</script>

<template>
    <main class="nation-cities-page">
        <table class="legacy-table legacy-bg0 title">
            <tbody>
                <tr>
                    <td>
                        세 력 도 시<br /><button
                            class="legacy-button legacy-button--navigation back-button"
                            type="button"
                            @click="router.push('/')"
                        >
                            돌아가기
                        </button>
                    </td>
                </tr>
                <tr>
                    <td>
                        <div class="city-sort-actions">
                            <LegacySortControls
                                control-id="nation-city-sort"
                                :model-value="selectedSort"
                                :options="sortOptions"
                                @update:model-value="updateSelectedSort"
                                @submit="applySelectedSort"
                            />
                            <button
                                class="legacy-button legacy-button--primary integration-button"
                                type="button"
                                :aria-busy="secretLoading"
                                @click="loadSecretIntegration"
                            >
                                암행부 연동
                            </button>
                            <button
                                v-if="secretData"
                                id="load-duty-button"
                                class="legacy-button legacy-button--primary integration-button"
                                type="button"
                                :aria-busy="personnelLoading"
                                @click="loadPersonnelIntegration"
                            >
                                인사부 연동
                            </button>
                        </div>
                    </td>
                </tr>
                <tr>
                    <td class="sort-more">
                        재 정렬 순서 :
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('name')"
                        >
                            도시명
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('populationRate')"
                        >
                            인구율
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('populationRemain')"
                        >
                            남은 주민
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('agricultureRemain')"
                        >
                            남은 농업
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('commerceRemain')"
                        >
                            남은 상업
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('securityRemain')"
                        >
                            남은 치안
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('defenceRemain')"
                        >
                            남은 수비
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('wallRemain')"
                        >
                            남은 성벽
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary extra-sort-button"
                            type="button"
                            @click="setExtraSort('generalCount')"
                        >
                            배치 장수 수
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="integrationError" class="error integration-error" role="alert">{{ integrationError }}</p>
        <table
            v-for="(city, index) in cities"
            :key="city.id"
            class="legacy-table city legacy-bg2"
            :class="{ 'region-break': isRegionBreak(city, index) }"
            :data-city-id="city.id"
        >
            <tbody>
                <tr>
                    <td
                        colspan="10"
                        class="city-title"
                        :style="{
                            backgroundColor: data?.nation.color,
                            color: legacyNationTextColor(data?.nation.color ?? '#000000'),
                        }"
                    >
                        【 {{ regionMap[city.region] }} | {{ cityLevelMap[city.level] }} 】
                        <span :class="{ capital: city.id === data?.nation.capitalCityId }">{{
                            city.id === data?.nation.capitalCityId ? `[${city.name}]` : city.name
                        }}</span>
                    </td>
                </tr>
                <tr>
                    <th :aria-sort="sort === 2 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="주민 기준 정렬"
                            @click="sortByHeader(2)"
                        >
                            주민<span class="legacy-sort-indicator">{{ sortIndicator(2, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('population', city.population, city.populationMax)">
                        {{ city.population }}/{{ city.populationMax }}
                    </td>
                    <th :aria-sort="sort === 3 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="인구율 기준 정렬"
                            @click="sortByHeader(3)"
                        >
                            인구율<span class="legacy-sort-indicator">{{ sortIndicator(3, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('population', city.population, city.populationMax)">
                        {{ Number(((city.population / city.populationMax) * 100).toFixed(2)) }}%
                    </td>
                    <th>자금 수입</th>
                    <td>{{ city.incomes.gold.toLocaleString() }}</td>
                    <th>군량 수입</th>
                    <td>{{ city.incomes.rice.toLocaleString() }}</td>
                    <th>둔전 수입</th>
                    <td>{{ city.incomes.wall.toLocaleString() }}</td>
                </tr>
                <tr>
                    <th :aria-sort="sort === 5 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="농업 기준 정렬"
                            @click="sortByHeader(5)"
                        >
                            농업<span class="legacy-sort-indicator">{{ sortIndicator(5, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('agriculture', city.agriculture, city.agricultureMax)">
                        {{ city.agriculture }}/{{ city.agricultureMax
                        }}<span v-if="warnRemain('agriculture', city.agriculture, city.agricultureMax)" class="remain"
                            >[{{ remain(city.agriculture, city.agricultureMax) }}]</span
                        >
                    </td>
                    <th :aria-sort="sort === 6 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="상업 기준 정렬"
                            @click="sortByHeader(6)"
                        >
                            상업<span class="legacy-sort-indicator">{{ sortIndicator(6, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('commerce', city.commerce, city.commerceMax)">
                        {{ city.commerce }}/{{ city.commerceMax
                        }}<span v-if="warnRemain('commerce', city.commerce, city.commerceMax)" class="remain"
                            >[{{ remain(city.commerce, city.commerceMax) }}]</span
                        >
                    </td>
                    <th :aria-sort="sort === 7 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="치안 기준 정렬"
                            @click="sortByHeader(7)"
                        >
                            치안<span class="legacy-sort-indicator">{{ sortIndicator(7, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('security', city.security, city.securityMax)">
                        {{ city.security }}/{{ city.securityMax
                        }}<span v-if="warnRemain('security', city.security, city.securityMax)" class="remain"
                            >[{{ remain(city.security, city.securityMax) }}]</span
                        >
                    </td>
                    <th :aria-sort="sort === 8 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="수비 기준 정렬"
                            @click="sortByHeader(8)"
                        >
                            수비<span class="legacy-sort-indicator">{{ sortIndicator(8, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('defence', city.defence, city.defenceMax)">
                        {{ city.defence }}/{{ city.defenceMax
                        }}<span v-if="warnRemain('defence', city.defence, city.defenceMax)" class="remain"
                            >[{{ remain(city.defence, city.defenceMax) }}]</span
                        >
                    </td>
                    <th :aria-sort="sort === 9 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="성벽 기준 정렬"
                            @click="sortByHeader(9)"
                        >
                            성벽<span class="legacy-sort-indicator">{{ sortIndicator(9, 'descending') }}</span>
                        </button>
                    </th>
                    <td :class="developmentClass('wall', city.wall, city.wallMax)">
                        {{ city.wall }}/{{ city.wallMax
                        }}<span v-if="warnRemain('wall', city.wall, city.wallMax)" class="remain"
                            >[{{ remain(city.wall, city.wallMax) }}]</span
                        >
                    </td>
                </tr>
                <tr>
                    <th :aria-sort="sort === 4 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="민심 기준 정렬"
                            @click="sortByHeader(4)"
                        >
                            민심<span class="legacy-sort-indicator">{{ sortIndicator(4, 'descending') }}</span>
                        </button>
                    </th>
                    <td>{{ city.trust.toFixed(1) }}</td>
                    <th :aria-sort="sort === 10 && extraSort === null ? 'descending' : undefined">
                        <button
                            class="legacy-sort-header"
                            type="button"
                            aria-label="시세 기준 정렬"
                            @click="sortByHeader(10)"
                        >
                            시세<span class="legacy-sort-indicator">{{ sortIndicator(10, 'descending') }}</span>
                        </button>
                    </th>
                    <td>{{ city.trade ?? '-' }}%</td>
                    <th>태수</th>
                    <td class="officer-4-value" :class="{ 'effective-officer': officerIsStationed(city, 4) }">
                        {{ officer(city, 4) }}
                    </td>
                    <th>군사</th>
                    <td class="officer-3-value" :class="{ 'effective-officer': officerIsStationed(city, 3) }">
                        {{ officer(city, 3) }}
                    </td>
                    <th>종사</th>
                    <td class="officer-2-value" :class="{ 'effective-officer': officerIsStationed(city, 2) }">
                        {{ officer(city, 2) }}
                    </td>
                </tr>
                <tr>
                    <th>장수</th>
                    <td colspan="9" class="general-list">
                        <template v-if="generalsForCity(city.id).length">
                            <template v-for="(general, cityGeneralIndex) in generalsForCity(city.id)" :key="general.id">
                                <span v-if="cityGeneralIndex">, </span
                                ><span :style="{ color: getNpcColor(general.npcState) }">{{
                                    displayGeneralName(general)
                                }}</span>
                            </template>
                        </template>
                        <template v-else>-</template>
                    </td>
                </tr>
                <tr v-if="secretData" class="secret-integration-row">
                    <td colspan="10">
                        <table class="city-user-table legacy-bg0">
                            <colgroup>
                                <col class="secret-name-column" />
                                <col class="secret-stat-column" />
                                <col class="secret-troop-column" />
                                <col class="secret-gold-column" />
                                <col class="secret-rice-column" />
                                <col class="secret-defence-column" />
                                <col class="secret-crew-type-column" />
                                <col class="secret-crew-column" />
                                <col class="secret-train-column" />
                                <col class="secret-atmos-column" />
                                <col class="secret-command-column" />
                                <col class="secret-kill-column" />
                                <col class="secret-turn-column" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>이 름</th>
                                    <th>통무지</th>
                                    <th>부 대</th>
                                    <th>자 금</th>
                                    <th>군 량</th>
                                    <th>守</th>
                                    <th>병 종</th>
                                    <th>병 사</th>
                                    <th>훈련</th>
                                    <th>사기</th>
                                    <th>명 령</th>
                                    <th>삭턴</th>
                                    <th>턴</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="general in secretGeneralsForCity(city.id)"
                                    :key="general.id"
                                    :data-general-id="general.id"
                                >
                                    <td class="secret-name-cell">
                                        <span :style="{ color: getNpcColor(general.npcState) }">{{
                                            displaySecretGeneralName(general)
                                        }}</span
                                        ><br />Lv {{ general.experienceLevel }}
                                        <template v-if="canShowAppointmentButtons(general.id)">
                                            <br class="for-duty" />
                                            <button
                                                v-for="level in [4, 3, 2] as const"
                                                :key="level"
                                                type="button"
                                                class="legacy-button legacy-button--primary appointment-button for-duty"
                                                :class="[`mode-${level}`, { 'chief-target': isChief(general.id) }]"
                                                :disabled="
                                                    !canAppoint(city.id, general.id, level) || pendingAppointment !== ''
                                                "
                                                :aria-label="appointmentDescription(city, general, level)"
                                                @click="appointCityOfficer(city, general, level)"
                                            >
                                                {{ officerLabels[level].slice(0, 1) }}
                                            </button>
                                        </template>
                                    </td>
                                    <td :class="{ injured: general.injury > 0 }">
                                        {{ general.stats.leadership
                                        }}<span v-if="general.leadershipBonus" class="bonus"
                                            >+{{ general.leadershipBonus }}</span
                                        >∥{{ general.stats.strength }}∥{{ general.stats.intelligence }}
                                    </td>
                                    <td>{{ general.troopName ?? '-' }}</td>
                                    <td>{{ general.gold }}</td>
                                    <td>{{ general.rice }}</td>
                                    <td>{{ general.defenceTrainText }}</td>
                                    <td>{{ general.crewTypeName }}</td>
                                    <td>{{ general.crew }}</td>
                                    <td>{{ general.train }}</td>
                                    <td>{{ general.atmos }}</td>
                                    <td class="secret-commands">
                                        <template v-if="general.npcState >= 2">NPC 장수</template>
                                        <template v-else>
                                            <div
                                                v-for="(command, commandIndex) in general.reservedCommands"
                                                :key="commandIndex"
                                                :title="commandBrief(command)"
                                            >
                                                {{ commandIndex + 1 }} :
                                                <span
                                                    :class="{
                                                        'command-attention': commandNeedsAttention(
                                                            city,
                                                            commandBrief(command)
                                                        ),
                                                    }"
                                                    >{{ commandBrief(command) }}</span
                                                >
                                            </div>
                                        </template>
                                    </td>
                                    <td>{{ general.killTurn }}</td>
                                    <td>{{ formatServerDateTime(general.turnTime, { format: 'minuteSecond' }) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
            </tbody>
        </table>
        <table class="legacy-table legacy-bg0 title footer">
            <tbody>
                <tr>
                    <td>
                        <button
                            class="legacy-button legacy-button--navigation back-button"
                            type="button"
                            @click="router.push('/')"
                        >
                            돌아가기
                        </button>
                    </td>
                </tr>
                <tr>
                    <td class="legacy-banner">
                        삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                        <a href="mailto:hided62@gmail.com">HideD(hided62@gmail.com)</a> /
                        <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                    </td>
                </tr>
            </tbody>
        </table>
    </main>
</template>

<style scoped>
.nation-cities-page {
    width: 1000px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.3;
}
.legacy-table {
    width: 100%;
    border-collapse: collapse;
    background-color: transparent;
}
.legacy-table td,
.legacy-table th {
    border: 1px solid #808080;
    padding: 0;
    font-weight: 400;
}
.title {
    text-align: left;
}
.city-sort-actions {
    min-height: 25px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
}
.city {
    margin-top: 0;
}
.city.region-break {
    margin-top: 18px;
}
.city th {
    width: 60px;
    text-align: center;
    background-image: var(--sammo-texture-green);
}
.city td {
    width: 140px;
    text-align: center;
}
.city-title {
    text-align: left !important;
}
.general-list {
    text-align: left !important;
}
.effective-officer {
    color: lightgreen;
}
.secret-integration-row > td {
    padding: 0;
}
.city-user-table {
    width: 940px;
    margin: 0 auto;
    border-collapse: collapse;
    table-layout: fixed;
}
.city-user-table td,
.city-user-table th {
    width: auto;
    border: 1px solid #808080;
    padding: 0;
    text-align: center;
    word-break: break-all;
}
.city-user-table th {
    background-image: var(--sammo-texture-green);
}
.secret-name-column,
.secret-stat-column,
.secret-troop-column {
    width: 100px;
}
.secret-gold-column,
.secret-rice-column,
.secret-crew-type-column,
.secret-crew-column,
.secret-kill-column,
.secret-turn-column {
    width: 60px;
}
.secret-defence-column {
    width: 30px;
}
.secret-train-column,
.secret-atmos-column {
    width: 50px;
}
.secret-command-column {
    width: 150px;
}
.secret-name-cell {
    line-height: normal;
}
.secret-commands {
    text-align: left !important;
    font-size: 12px;
}
.bonus {
    color: cyan;
}
.injured {
    color: red;
}
.command-attention {
    color: yellow;
}
.nation-cities-page .appointment-button {
    margin: 0;
    padding: 1px 4px;
}
.nation-cities-page .appointment-button.chief-target:not(:disabled) {
    color: red;
}
.nation-cities-page .appointment-button:disabled {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: default;
}
.capital {
    color: #0ff;
}
.footer {
    margin-top: 0;
}
.nation-cities-page button:not(.legacy-button, .legacy-sort-submit, .legacy-sort-header),
.nation-cities-page input[type='submit'] {
    border: 2px outset #fff;
    background-color: buttonface;
    color: buttontext;
    cursor: pointer;
    padding: 1px 6px;
}
.nation-cities-page .back-button {
    margin-bottom: 0;
}
.nation-cities-page .integration-button,
.nation-cities-page .extra-sort-button,
.nation-cities-page .appointment-button {
    padding: 1px 6px;
    line-height: 21px;
}
.sort-more .extra-sort-button {
    margin-bottom: 0;
}
.development-high {
    color: lightgreen;
}
.development-mid,
.remain {
    color: yellow;
}
.development-low {
    color: orangered;
}
.legacy-banner a {
    color: inherit;
}
.error {
    text-align: center;
    color: #ff7373;
}
@media (max-width: 700px) {
    .nation-cities-page {
        width: 1000px;
        transform-origin: top left;
    }
}
</style>
