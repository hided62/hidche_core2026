<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { JosaUtil } from '@sammo-ts/common';

import PersonnelSelectionDialog from '../components/personnel/PersonnelSelectionDialog.vue';
import { useGameFeedback } from '../composables/useGameFeedback';
import { resolveGeneralIconBackgroundImage } from '../utils/generalIcon';
import { trpc } from '../utils/trpc';
import { cityLevelMap, formatOfficerLevelText, getNationChiefLevel, regionMap } from '../utils/nationFormat';
import { legacyNationTextColor } from '../utils/legacyNationColor';

type PersonnelResponse = Awaited<ReturnType<typeof trpc.nation.getPersonnelInfo.query>>;
type GeneralEntry = PersonnelResponse['generals'][number];
type OfficerLevel = 2 | 3 | 4;
type SelectionDialogItem = {
    id: number;
    name: string;
    subtitle: string;
    searchText: string;
    accent: 'current' | 'assigned' | 'available';
    iconBackground?: string;
    badges: string[];
    stats?: Array<{ label: string; value: string }>;
    details: Array<{ label: string; value: string }>;
};
type SelectionContext =
    | { kind: 'chief-general'; level: number }
    | { kind: 'city'; level: OfficerLevel }
    | { kind: 'city-general'; level: OfficerLevel };

const officerLabels: Record<OfficerLevel, string> = { 4: '태수', 3: '군사', 2: '종사' };
const cityOfficerLevels: OfficerLevel[] = [4, 3, 2];
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<PersonnelResponse | null>(null);
const selectionContext = ref<SelectionContext | null>(null);
const chiefAppointmentDraft = reactive<Record<number, number>>({});
const cityDraft = reactive<Record<OfficerLevel, { cityId: number; generalId: number }>>({
    4: { cityId: 0, generalId: 0 },
    3: { cityId: 0, generalId: 0 },
    2: { cityId: 0, generalId: 0 },
});
const kickTargetId = ref(0);
const ambassadorSelection = ref<number[]>([]);
const auditorSelection = ref<number[]>([]);
const router = useRouter();
const { success: showSuccessToast, error: showErrorToast } = useGameFeedback();

const resolveErrorMessage = (value: unknown): string =>
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'unknown_error';

const loadPersonnel = async () => {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
        data.value = await trpc.nation.getPersonnelInfo.query();
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

const imageBackground = (general: GeneralEntry | undefined): string => resolveGeneralIconBackgroundImage(general ?? {});
const officerLocked = (value: number, level: number): boolean => (value & (1 << level)) !== 0;
const chiefLocked = (level: number): boolean => officerLocked(data.value?.nation.chiefSet ?? 0, level);
const cityOfficerLocked = (city: PersonnelResponse['cityAssignments'][number], level: number): boolean =>
    officerLocked(city.officerSet, level);
const currentOfficeText = (general: GeneralEntry): string => {
    if (general.officerLevel <= 1) return '일반 장수';
    const office = formatOfficerLevelText(general.officerLevel, nationLevel.value);
    if (general.officerLevel >= 2 && general.officerLevel <= 4 && general.officerCityName) {
        return `${general.officerCityName} ${office}`;
    }
    return office;
};
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
const selectedChief = (level: number): GeneralEntry | undefined =>
    generalMap.value.get(chiefAppointmentDraft[level] ?? 0);
const selectedCity = (level: OfficerLevel): PersonnelResponse['cityAssignments'][number] | undefined =>
    data.value?.cityAssignments.find((city) => city.id === cityDraft[level].cityId);
const selectedCityGeneral = (level: OfficerLevel): GeneralEntry | undefined =>
    generalMap.value.get(cityDraft[level].generalId);
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
    try {
        await action();
        await loadPersonnel();
        showSuccessToast(successMessage);
    } catch (err) {
        showErrorToast(resolveErrorMessage(err));
    }
};

const appointChief = async (level: number) => {
    const targetId = chiefAppointmentDraft[level] ?? 0;
    const target = generalMap.value.get(targetId);
    const office = formatOfficerLevelText(level, nationLevel.value);
    const prompt = target
        ? `${JosaUtil.put(target.name, '을')} ${office}직에 임명하시겠습니까?`
        : `${office}직을 비우시겠습니까?`;
    if (!window.confirm(prompt)) return;
    await runMutation(
        () => trpc.nation.appoint.mutate({ destGeneralId: targetId, destCityId: 0, officerLevel: level }),
        target ? `${JosaUtil.put(target.name, '을')} 임명했습니다.` : '관직을 비웠습니다.'
    );
};

const appointCityOfficer = async (level: OfficerLevel) => {
    const draft = cityDraft[level];
    const city = data.value?.cityAssignments.find((entry) => entry.id === draft.cityId);
    const target = generalMap.value.get(draft.generalId);
    const prompt = target
        ? `${JosaUtil.put(target.name, '을')} ${city?.name ?? ''} ${officerLabels[level]}직에 임명하시겠습니까?`
        : `${city?.name ?? ''} ${officerLabels[level]}직을 비우시겠습니까?`;
    if (!window.confirm(prompt)) return;
    await runMutation(
        () =>
            trpc.nation.appoint.mutate({
                destGeneralId: draft.generalId,
                destCityId: draft.cityId,
                officerLevel: level,
            }),
        target ? `${JosaUtil.put(target.name, '을')} 임명했습니다.` : '관직을 비웠습니다.'
    );
};

const generalSelectionItem = (general: GeneralEntry, targetLevel: number): SelectionDialogItem => {
    const isCurrent = general.officerLevel === targetLevel;
    const isAssigned = general.officerLevel > 1 && !isCurrent;
    const office = currentOfficeText(general);
    const city = general.cityName ?? cityNameMap.value.get(general.cityId) ?? '-';
    const badges = [isCurrent ? '현재 임명 중' : isAssigned ? '다른 관직 재직' : '일반 장수'];
    if (general.npcState > 0) badges.push('NPC');
    if (general.personality?.name) badges.push(general.personality.name);
    if (general.specialDomestic?.name) badges.push(general.specialDomestic.name);
    if (general.specialWar?.name) badges.push(general.specialWar.name);
    return {
        id: general.id,
        name: general.name,
        subtitle: `${city} · ${office}`,
        searchText: [
            general.name,
            city,
            office,
            general.personality?.name,
            general.specialDomestic?.name,
            general.specialWar?.name,
            general.troopName,
        ]
            .filter(Boolean)
            .join(' '),
        accent: isCurrent ? 'current' : isAssigned ? 'assigned' : 'available',
        iconBackground: imageBackground(general),
        badges,
        stats: [
            { label: '통솔', value: general.stats.leadership.toLocaleString('ko-KR') },
            { label: '무력', value: general.stats.strength.toLocaleString('ko-KR') },
            { label: '지력', value: general.stats.intelligence.toLocaleString('ko-KR') },
        ],
        details: [
            { label: '소속', value: `${general.belong.toLocaleString('ko-KR')}년` },
            { label: '병력', value: general.crew.toLocaleString('ko-KR') },
            { label: '부대', value: general.troopName ?? '없음' },
            { label: '부상', value: general.injury > 0 ? `${general.injury}%` : '없음' },
        ],
    };
};

const citySelectionItem = (
    city: PersonnelResponse['cityAssignments'][number],
    level: OfficerLevel
): SelectionDialogItem => {
    const current = city.officers[level];
    const region = regionMap[city.region] ?? '-';
    const scale = cityLevelMap[city.level] ?? '-';
    return {
        id: city.id,
        name: city.name,
        subtitle: `${region} · ${scale}도시`,
        searchText: `${city.name} ${region} ${scale} ${current?.name ?? '공석'}`,
        accent: current ? 'assigned' : 'available',
        badges: [current ? `${officerLabels[level]} 재직 중` : `${officerLabels[level]} 공석`],
        details: [
            { label: '지역', value: region },
            { label: '규모', value: `${scale}도시` },
            { label: `현재 ${officerLabels[level]}`, value: current?.name ?? '공석' },
            { label: '소재지', value: current?.cityName ?? '-' },
        ],
    };
};

const selectionTitle = computed(() => {
    const context = selectionContext.value;
    if (!context) return '';
    if (context.kind === 'chief-general') {
        return `${formatOfficerLevelText(context.level, nationLevel.value)} 임명 대상 선택`;
    }
    if (context.kind === 'city') return `${officerLabels[context.level]} 임명 도시 선택`;
    return `${officerLabels[context.level]} 임명 대상 선택`;
});
const selectionDescription = computed(() => {
    const context = selectionContext.value;
    if (!context) return '';
    if (context.kind === 'city') {
        return '지역과 도시 규모, 현재 재직자를 확인한 뒤 임명할 도시를 선택하세요.';
    }
    if (context.kind === 'chief-general') {
        if (context.level === 11) return '군주를 제외한 장수 중에서 임명할 수 있습니다.';
        const stat = context.level % 2 === 0 ? '무력' : '지력';
        return `${stat} ${data.value?.chiefStatMin ?? 0} 이상인 장수만 표시합니다. 현재 관직과 주요 능력치를 함께 확인하세요.`;
    }
    if (context.level === 4) {
        return `무력 ${data.value?.chiefStatMin ?? 0} 이상인 장수만 표시합니다. 현재 관직과 소재지를 함께 확인하세요.`;
    }
    if (context.level === 3) {
        return `지력 ${data.value?.chiefStatMin ?? 0} 이상인 장수만 표시합니다. 현재 관직과 소재지를 함께 확인하세요.`;
    }
    return '현재 관직과 소재지, 주요 능력치를 확인한 뒤 임명할 장수를 선택하세요.';
});
const selectionItems = computed<SelectionDialogItem[]>(() => {
    const context = selectionContext.value;
    if (!context) return [];
    if (context.kind === 'chief-general') {
        return chiefCandidates(context.level).map((general) => generalSelectionItem(general, context.level));
    }
    if (context.kind === 'city') {
        return openCities(context.level).map((city) => citySelectionItem(city, context.level));
    }
    return cityCandidates(context.level).map((general) => generalSelectionItem(general, context.level));
});
const selectionId = computed(() => {
    const context = selectionContext.value;
    if (!context) return 0;
    if (context.kind === 'chief-general') return chiefAppointmentDraft[context.level] ?? 0;
    if (context.kind === 'city') return cityDraft[context.level].cityId;
    return cityDraft[context.level].generalId;
});
const applySelection = (id: number): void => {
    const context = selectionContext.value;
    if (!context) return;
    if (context.kind === 'chief-general') chiefAppointmentDraft[context.level] = id;
    else if (context.kind === 'city') cityDraft[context.level].cityId = id;
    else cityDraft[context.level].generalId = id;
    selectionContext.value = null;
};

const enforcePermissionLimit = (selection: number[]) => {
    if (selection.length <= 2) return;
    selection.splice(0, selection.length - 2);
    showErrorToast('최대 2명까지 설정 가능합니다.');
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
    if (!target || !window.confirm(`${JosaUtil.put(target.name, '을')} 추방하시겠습니까?`)) return;
    await runMutation(
        () => trpc.nation.kick.mutate({ destGeneralId: target.id }),
        `${JosaUtil.put(target.name, '을')} 추방했습니다.`
    );
};

onMounted(() => void loadPersonnel());
</script>

<template>
    <main id="personnel-container" class="legacy-office">
        <table class="legacy-table heading-table">
            <tbody>
                <tr>
                    <td>
                        인 사 부<br /><button class="legacy-button" type="button" @click="router.push('/')">
                            돌아가기
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="error" class="feedback error" role="alert">{{ error }}</div>
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
                            :style="{
                                color: legacyNationTextColor(data.nation.color),
                                backgroundColor: data.nation.color,
                            }"
                        >
                            【 {{ data.nation.name }} 】
                        </td>
                    </tr>
                    <tr v-for="[leftLevel, rightLevel] in chiefPairs" :key="leftLevel">
                        <template v-for="level in [leftLevel, rightLevel]" :key="level">
                            <td class="green-cell role-cell">{{ formatOfficerLevelText(level, nationLevel) }}</td>
                            <td
                                class="general-icon"
                                :style="{ backgroundImage: imageBackground(chiefAssignments[level]) }"
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
                    <tr>
                        <td colspan="4" class="appointment-workspace-cell">
                            <div class="appointment-card-grid">
                                <article v-for="level in chiefLevels" :key="level" class="appointment-card">
                                    <header class="appointment-card-header">
                                        <span>{{ formatOfficerLevelText(level, nationLevel) }}</span>
                                        <small v-if="chiefLocked(level)" class="appointment-lock">변경 잠금</small>
                                        <small v-else> 현재 {{ chiefAssignments[level]?.name ?? '공석' }} </small>
                                    </header>

                                    <template v-if="canManage && level !== 12 && !chiefLocked(level)">
                                        <button
                                            type="button"
                                            class="selection-trigger"
                                            :aria-label="`${formatOfficerLevelText(level, nationLevel)} 장수 선택`"
                                            aria-haspopup="dialog"
                                            @click="selectionContext = { kind: 'chief-general', level }"
                                        >
                                            <span
                                                v-if="selectedChief(level)"
                                                class="selection-trigger-portrait"
                                                :style="{ backgroundImage: imageBackground(selectedChief(level)) }"
                                                aria-hidden="true"
                                            />
                                            <span v-else class="selection-trigger-empty" aria-hidden="true">＋</span>
                                            <span class="selection-trigger-copy">
                                                <small>임명 대상</small>
                                                <strong>{{ selectedChief(level)?.name ?? '공석으로 두기' }}</strong>
                                                <span v-if="selectedChief(level)">
                                                    {{ selectedChief(level)?.cityName ?? '-' }} ·
                                                    {{ currentOfficeText(selectedChief(level)!) }}
                                                </span>
                                                <span v-else>눌러서 장수를 선택하세요</span>
                                            </span>
                                            <span class="selection-trigger-chevron" aria-hidden="true">›</span>
                                        </button>
                                        <div v-if="selectedChief(level)" class="selected-general-stats">
                                            <span
                                                >통솔
                                                <strong>{{ selectedChief(level)?.stats.leadership }}</strong></span
                                            >
                                            <span
                                                >무력 <strong>{{ selectedChief(level)?.stats.strength }}</strong></span
                                            >
                                            <span
                                                >지력
                                                <strong>{{ selectedChief(level)?.stats.intelligence }}</strong></span
                                            >
                                            <span
                                                >소속 <strong>{{ selectedChief(level)?.belong }}년</strong></span
                                            >
                                        </div>
                                        <button type="button" class="appointment-submit" @click="appointChief(level)">
                                            {{ formatOfficerLevelText(level, nationLevel) }} 임명
                                        </button>
                                    </template>
                                    <div v-else class="appointment-readonly">
                                        <span
                                            v-if="chiefAssignments[level]"
                                            class="selection-trigger-portrait"
                                            :style="{ backgroundImage: imageBackground(chiefAssignments[level]) }"
                                            aria-hidden="true"
                                        />
                                        <span v-else class="selection-trigger-empty" aria-hidden="true">－</span>
                                        <span>
                                            <strong>{{ chiefAssignments[level]?.name ?? '공석' }}</strong>
                                            <small>{{ chiefAssignments[level]?.cityName ?? '임명된 장수 없음' }}</small>
                                        </span>
                                    </div>
                                </article>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="4" class="legend">
                            ※ 장수 선택 창에서 현재 임명 중인 장수, 다른 관직 재직자와 일반 장수를 구분하고 주요
                            능력치·소재지·부대 정보를 함께 확인할 수 있습니다.
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
                    <tr>
                        <td colspan="5" class="spacer" />
                    </tr>
                    <template v-if="canManage">
                        <tr>
                            <td colspan="5" class="section-title orange-bg">도 시 관 직 임 명</td>
                        </tr>
                        <tr>
                            <td colspan="5" class="appointment-workspace-cell">
                                <div class="city-appointment-grid">
                                    <article
                                        v-for="level in cityOfficerLevels"
                                        :key="level"
                                        class="appointment-card city-appointment-card"
                                    >
                                        <header class="appointment-card-header">
                                            <span>{{ officerLabels[level] }}</span>
                                            <small>도시 관직</small>
                                        </header>
                                        <button
                                            type="button"
                                            class="selection-trigger compact"
                                            :aria-label="`${officerLabels[level]} 도시 선택`"
                                            aria-haspopup="dialog"
                                            @click="selectionContext = { kind: 'city', level }"
                                        >
                                            <span class="selection-trigger-city" aria-hidden="true">城</span>
                                            <span class="selection-trigger-copy">
                                                <small>임명 도시</small>
                                                <strong>{{ selectedCity(level)?.name ?? '도시 선택' }}</strong>
                                                <span v-if="selectedCity(level)">
                                                    {{ regionMap[selectedCity(level)?.region ?? 0] ?? '-' }} ·
                                                    {{ cityLevelMap[selectedCity(level)?.level ?? 0] ?? '-' }}도시
                                                </span>
                                            </span>
                                            <span class="selection-trigger-chevron" aria-hidden="true">›</span>
                                        </button>
                                        <button
                                            type="button"
                                            class="selection-trigger compact"
                                            :aria-label="`${officerLabels[level]} 장수 선택`"
                                            aria-haspopup="dialog"
                                            @click="selectionContext = { kind: 'city-general', level }"
                                        >
                                            <span
                                                v-if="selectedCityGeneral(level)"
                                                class="selection-trigger-portrait"
                                                :style="{
                                                    backgroundImage: imageBackground(selectedCityGeneral(level)),
                                                }"
                                                aria-hidden="true"
                                            />
                                            <span v-else class="selection-trigger-empty" aria-hidden="true">＋</span>
                                            <span class="selection-trigger-copy">
                                                <small>임명 대상</small>
                                                <strong>{{
                                                    selectedCityGeneral(level)?.name ?? '공석으로 두기'
                                                }}</strong>
                                                <span v-if="selectedCityGeneral(level)">
                                                    {{ selectedCityGeneral(level)?.cityName ?? '-' }} ·
                                                    {{ currentOfficeText(selectedCityGeneral(level)!) }}
                                                </span>
                                            </span>
                                            <span class="selection-trigger-chevron" aria-hidden="true">›</span>
                                        </button>
                                        <div v-if="selectedCityGeneral(level)" class="selected-general-stats compact">
                                            <span
                                                >통
                                                <strong>{{
                                                    selectedCityGeneral(level)?.stats.leadership
                                                }}</strong></span
                                            >
                                            <span
                                                >무
                                                <strong>{{ selectedCityGeneral(level)?.stats.strength }}</strong></span
                                            >
                                            <span
                                                >지
                                                <strong>{{
                                                    selectedCityGeneral(level)?.stats.intelligence
                                                }}</strong></span
                                            >
                                        </div>
                                        <button
                                            type="button"
                                            class="appointment-submit"
                                            :disabled="!selectedCity(level)"
                                            @click="appointCityOfficer(level)"
                                        >
                                            {{ officerLabels[level] }} 임명
                                        </button>
                                    </article>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="5" class="legend">
                                ※ 도시의 지역·규모·현재 재직자와 장수의 능력치·현재 관직을 확인한 뒤 임명할 수 있습니다.
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
                            <td colspan="5" class="region-spacer" />
                        </tr>
                        <tr v-if="index === 0 || data.cityAssignments[index - 1]?.region !== city.region">
                            <td colspan="5" class="region-heading">【 {{ regionMap[city.region] ?? '-' }} 】</td>
                        </tr>
                        <tr>
                            <td
                                class="nation-city"
                                :style="{
                                    backgroundColor: data.nation.color,
                                    color: legacyNationTextColor(data.nation.color),
                                }"
                            >
                                【{{ cityLevelMap[city.level] ?? '-' }}】
                            </td>
                            <td
                                class="nation-city city-name"
                                :style="{
                                    backgroundColor: data.nation.color,
                                    color: legacyNationTextColor(data.nation.color),
                                }"
                            >
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

            <table class="legacy-table kick-table">
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
                        </td>
                    </tr>
                </tbody>
            </table>

            <table class="legacy-table footer-table">
                <tbody>
                    <tr>
                        <td><button class="legacy-button" type="button" @click="router.push('/')">돌아가기</button></td>
                    </tr>
                    <tr>
                        <td class="legacy-banner">
                            삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                            HideD(hided62@gmail.com) /
                            <a href="https://sam.hided.net/wiki/hidche/credit" target="_blank" rel="noreferrer"
                                >Credit</a
                            >
                        </td>
                    </tr>
                </tbody>
            </table>
        </template>
    </main>

    <PersonnelSelectionDialog
        :open="selectionContext !== null"
        :title="selectionTitle"
        :description="selectionDescription"
        :items="selectionItems"
        :selected-id="selectionId"
        :search-placeholder="
            selectionContext?.kind === 'city' ? '도시명·지역·재직자 검색' : '장수명·도시·관직·특성 검색'
        "
        :vacancy-label="selectionContext?.kind === 'city' ? null : '공석으로 두기'"
        @cancel="selectionContext = null"
        @select="applySelection"
    />
</template>

<style scoped>
.legacy-office {
    width: 1000px;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font: 14px/1.3 var(--sammo-font-sans);
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
.region-spacer {
    height: 3px;
    background-image: var(--sammo-texture-green);
}
.legacy-banner a {
    color: #fff;
    text-decoration: underline;
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
.appointment-workspace-cell {
    padding: 12px !important;
    background: linear-gradient(rgb(7 9 7 / 72%), rgb(7 9 7 / 72%)), var(--sammo-texture-walnut);
}
.appointment-card-grid,
.city-appointment-grid {
    display: grid;
    gap: 12px;
}
.appointment-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}
.city-appointment-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}
.appointment-card {
    min-width: 0;
    padding: 12px;
    background: linear-gradient(145deg, rgb(36 40 31 / 96%), rgb(16 18 15 / 98%));
    border: 1px solid #555845;
    border-radius: 10px;
    box-shadow: 0 7px 18px rgb(0 0 0 / 28%);
}
.appointment-card-header {
    display: flex;
    gap: 8px;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 9px;
    color: #e4cc8a;
}
.appointment-card-header > span {
    font-size: 17px;
    font-weight: 800;
}
.appointment-card-header small {
    color: #aaa99f;
}
.appointment-card-header .appointment-lock {
    color: #e6aa45;
}
.selection-trigger,
.appointment-readonly {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 18px;
    gap: 9px;
    align-items: center;
    width: 100%;
    min-width: 0;
    min-height: 70px;
    border: 1px solid #5a5e4d;
    border-radius: 8px;
    padding: 8px;
    color: #f7f4eb;
    background: #10120f;
    text-align: left;
}
.selection-trigger {
    cursor: pointer;
}
.selection-trigger:hover {
    filter: none;
    background: #1d211a;
    border-color: #9f9063;
}
.selection-trigger:focus-visible {
    outline: 2px solid #f0cf75;
    outline-offset: 2px;
}
.selection-trigger.compact {
    grid-template-columns: 42px minmax(0, 1fr) 16px;
    min-height: 62px;
    margin-top: 7px;
}
.selection-trigger-portrait,
.selection-trigger-empty,
.selection-trigger-city {
    width: 48px;
    height: 48px;
    border: 1px solid #5e6251;
    border-radius: 8px;
    background-color: #060706;
}
.selection-trigger-portrait {
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
}
.selection-trigger-empty,
.selection-trigger-city {
    display: grid;
    place-items: center;
    color: #d9bf78;
    background: radial-gradient(circle at 50% 30%, #363828, #0d0f0c 75%);
    font: 700 22px/1 var(--sammo-font-sans);
}
.compact .selection-trigger-portrait,
.compact .selection-trigger-empty,
.compact .selection-trigger-city {
    width: 42px;
    height: 42px;
}
.selection-trigger-copy,
.appointment-readonly > span:last-child {
    display: grid;
    min-width: 0;
}
.selection-trigger-copy small,
.appointment-readonly small {
    color: #aaa99f;
    font-size: 10px;
}
.selection-trigger-copy strong,
.appointment-readonly strong {
    overflow: hidden;
    color: #fff;
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.selection-trigger-copy > span:last-child {
    overflow: hidden;
    color: #c0c0b8;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.selection-trigger-chevron {
    color: #cdb56e;
    font-size: 26px;
    text-align: center;
}
.appointment-readonly {
    grid-template-columns: 48px minmax(0, 1fr);
    color: #bbb;
    background: #0d0e0c;
}
.selected-general-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
    margin-top: 7px;
}
.selected-general-stats.compact {
    grid-template-columns: repeat(3, 1fr);
}
.selected-general-stats > span {
    display: flex;
    gap: 4px;
    justify-content: center;
    padding: 4px 3px;
    color: #aaa99f;
    background: rgb(0 0 0 / 32%);
    border-radius: 5px;
    font-size: 10px;
}
.selected-general-stats strong {
    color: #ead27f;
}
.appointment-submit {
    width: 100%;
    margin-top: 8px;
    border-color: #4f7959;
    color: #fff;
    background: #376846;
    font-weight: 800;
}
.appointment-submit:hover {
    filter: brightness(1.15);
}
.city-appointment-card {
    padding: 10px;
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
@media (max-width: 1000px) {
    .legacy-office {
        margin: 0;
    }
}
</style>
