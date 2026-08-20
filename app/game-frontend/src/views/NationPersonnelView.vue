<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
    { kind: 'chief-general'; level: number } | { kind: 'city-general'; level: OfficerLevel; cityId: number };

const officerLabels: Record<OfficerLevel, string> = { 4: '태수', 3: '군사', 2: '종사' };
const cityOfficerLevels: OfficerLevel[] = [4, 3, 2];
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<PersonnelResponse | null>(null);
const selectionContext = ref<SelectionContext | null>(null);
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
const kickCandidates = computed(() =>
    (data.value?.generals ?? []).filter((general) => general.id !== data.value?.me.id)
);
const awardText = (entries: PersonnelResponse['awards']['tigers']): string =>
    entries.map((entry) => `${entry.name}【${entry.value.toLocaleString('ko-KR')}】`).join(', ');

const initializePermissions = () => {
    if (!data.value) return;
    ambassadorSelection.value = data.value.permissionCandidates.ambassadors
        .filter((candidate) => candidate.permission === 'ambassador')
        .map((candidate) => candidate.id);
    auditorSelection.value = data.value.permissionCandidates.auditors
        .filter((candidate) => candidate.permission === 'auditor')
        .map((candidate) => candidate.id);
};
watch(data, initializePermissions);

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

const appointChief = async (level: number, targetId: number) => {
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

const appointCityOfficer = async (level: OfficerLevel, cityId: number, targetId: number) => {
    const city = data.value?.cityAssignments.find((entry) => entry.id === cityId);
    const target = generalMap.value.get(targetId);
    const prompt = target
        ? `${JosaUtil.put(target.name, '을')} ${city?.name ?? ''} ${officerLabels[level]}직에 임명하시겠습니까?`
        : `${city?.name ?? ''} ${officerLabels[level]}직을 비우시겠습니까?`;
    if (!window.confirm(prompt)) return;
    await runMutation(
        () =>
            trpc.nation.appoint.mutate({
                destGeneralId: targetId,
                destCityId: cityId,
                officerLevel: level,
            }),
        target ? `${JosaUtil.put(target.name, '을')} 임명했습니다.` : '관직을 비웠습니다.'
    );
};

const generalSelectionItem = (general: GeneralEntry, currentGeneralId: number): SelectionDialogItem => {
    const isCurrent = general.id === currentGeneralId;
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

const selectionTitle = computed(() => {
    const context = selectionContext.value;
    if (!context) return '';
    if (context.kind === 'chief-general') {
        return `${formatOfficerLevelText(context.level, nationLevel.value)} 임명 대상 선택`;
    }
    const city = data.value?.cityAssignments.find((entry) => entry.id === context.cityId);
    return `${city?.name ?? ''} ${officerLabels[context.level]} 변경`;
});
const selectionDescription = computed(() => {
    const context = selectionContext.value;
    if (!context) return '';
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
        const currentGeneralId = chiefAssignments.value[context.level]?.id ?? 0;
        return chiefCandidates(context.level).map((general) => generalSelectionItem(general, currentGeneralId));
    }
    const city = data.value?.cityAssignments.find((entry) => entry.id === context.cityId);
    const currentGeneralId = city?.officers[context.level]?.id ?? 0;
    return cityCandidates(context.level).map((general) => generalSelectionItem(general, currentGeneralId));
});
const selectionId = computed(() => {
    const context = selectionContext.value;
    if (!context) return 0;
    if (context.kind === 'chief-general') return chiefAssignments.value[context.level]?.id ?? 0;
    return data.value?.cityAssignments.find((entry) => entry.id === context.cityId)?.officers[context.level]?.id ?? 0;
});
const applySelection = async (id: number): Promise<void> => {
    const context = selectionContext.value;
    if (!context) return;
    selectionContext.value = null;
    if (context.kind === 'chief-general') await appointChief(context.level, id);
    else await appointCityOfficer(context.level, context.cityId, id);
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
                            <td colspan="3" class="chief-entry-cell">
                                <div class="chief-entry" :class="{ locked: chiefLocked(level) }">
                                    <span class="chief-entry-role">{{
                                        formatOfficerLevelText(level, nationLevel)
                                    }}</span>
                                    <span
                                        class="general-icon"
                                        :style="{ backgroundImage: imageBackground(chiefAssignments[level]) }"
                                        aria-hidden="true"
                                    />
                                    <span class="chief-entry-copy">
                                        <strong>{{ chiefAssignments[level]?.name ?? '공석' }}</strong>
                                        <small>
                                            {{ chiefAssignments[level]?.belong ?? '-' }}년 ·
                                            {{ chiefAssignments[level]?.cityName ?? '소재지 없음' }}
                                        </small>
                                    </span>
                                    <button
                                        v-if="canManage && level !== 12 && !chiefLocked(level)"
                                        type="button"
                                        class="personnel-change-button"
                                        :aria-label="`${formatOfficerLevelText(level, nationLevel)} 변경하기`"
                                        aria-haspopup="dialog"
                                        @click="selectionContext = { kind: 'chief-general', level }"
                                    >
                                        변경하기
                                    </button>
                                    <small v-else-if="chiefLocked(level)" class="personnel-lock-label">변경 잠금</small>
                                </div>
                            </td>
                        </template>
                    </tr>
                    <tr>
                        <td class="green-cell award-label" colspan="2">
                            <span class="award-label-full">오호장군【승전】</span>
                            <span class="award-label-compact">오호장군</span>
                        </td>
                        <td colspan="4">{{ awardText(data.awards.tigers) }}</td>
                    </tr>
                    <tr>
                        <td class="green-cell award-label" colspan="2">
                            <span class="award-label-full">건안칠자【계략】</span>
                            <span class="award-label-compact">건안칠자</span>
                        </td>
                        <td colspan="4">{{ awardText(data.awards.eagles) }}</td>
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
                    <tr class="city-header">
                        <td colspan="2">도 시</td>
                        <td v-for="level in cityOfficerLevels" :key="level">
                            <span class="city-header-full">{{ officerLabels[level] }} (사관) 【현재도시】</span>
                            <span class="city-header-compact">{{ officerLabels[level] }}</span>
                        </td>
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
                                colspan="2"
                                class="nation-city city-identity"
                                :style="{
                                    backgroundColor: data.nation.color,
                                    color: legacyNationTextColor(data.nation.color),
                                }"
                            >
                                <small>【{{ cityLevelMap[city.level] ?? '-' }}】</small>
                                <strong>{{ city.name }}</strong>
                            </td>
                            <td
                                v-for="level in cityOfficerLevels"
                                :key="level"
                                class="city-officer-cell"
                                :class="{ locked: cityOfficerLocked(city, level) }"
                            >
                                <div class="city-officer-entry">
                                    <span class="city-officer-copy">
                                        <strong>{{ city.officers[level]?.name ?? '공석' }}</strong>
                                        <small v-if="city.officers[level]">
                                            {{ city.officers[level]?.belong }}년 ·
                                            {{ city.officers[level]?.cityName ?? '-' }}
                                        </small>
                                    </span>
                                    <button
                                        v-if="canManage && !cityOfficerLocked(city, level)"
                                        type="button"
                                        class="personnel-change-button city-change-button"
                                        :aria-label="`${city.name} ${officerLabels[level]} 변경하기`"
                                        aria-haspopup="dialog"
                                        @click="selectionContext = { kind: 'city-general', level, cityId: city.id }"
                                    >
                                        변경하기
                                    </button>
                                    <small v-else-if="cityOfficerLocked(city, level)" class="personnel-lock-label">
                                        변경 잠금
                                    </small>
                                </div>
                            </td>
                        </tr>
                    </template>
                    <tr>
                        <td colspan="5" class="legend">
                            ※ 각 수뇌·도시 관직의 변경 버튼에서 후보 정보 확인과 임명을 한 번에 진행합니다.
                            <span class="orange">노란색</span>은 변경 불가능 관직입니다.
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
        search-placeholder="장수명·도시·관직·특성 검색"
        vacancy-label="공석으로 두기"
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
.chief-entry-cell {
    padding: 6px !important;
}
.chief-entry {
    display: grid;
    grid-template-areas: 'role icon copy action';
    grid-template-columns: 82px 64px minmax(0, 1fr) 78px;
    gap: 8px;
    align-items: center;
    min-width: 0;
}
.chief-entry-role {
    grid-area: role;
    border: 1px solid #507d5b;
    padding: 7px 4px;
    color: #fff;
    background: #24472e;
    text-align: center;
    font-size: 17px;
    font-weight: 700;
}
.general-icon {
    grid-area: icon;
    width: 64px;
    height: 64px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: 64px 64px;
}
.chief-entry-copy {
    display: grid;
    grid-area: copy;
    min-width: 0;
}
.chief-entry-copy strong {
    overflow: hidden;
    font-size: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chief-entry-copy small {
    overflow: hidden;
    color: #c8c5bc;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.personnel-change-button {
    grid-area: action;
    min-height: 34px;
    border-color: #557d5e;
    padding: 4px 8px;
    background: #315b3d;
    font-weight: 700;
}
.personnel-change-button:hover {
    filter: none;
    background: #3c704a;
    border-color: #7ba286;
}
.personnel-lock-label {
    grid-area: action;
    color: #e7b64c;
    text-align: center;
    font-size: 11px;
}
.award-label {
    text-align: center;
}
.award-label-compact {
    display: none;
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
.permission-label {
    width: 98px;
    text-align: right;
}
.legend {
    line-height: 18px;
}
.red {
    color: red;
}
.orange,
.city-officer-cell.locked {
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
.city-header-compact {
    display: none;
}
.city-header td:first-child {
    width: 158px;
}
.region-heading {
    height: 29px;
    color: skyblue;
    font-size: 18px;
}
.city-identity {
    display: table-cell;
    width: 158px;
    text-align: center;
    font-size: 16.8px;
}
.city-identity small,
.city-identity strong {
    display: block;
}
.city-identity small {
    font-size: 10px;
}
.city-officer-cell {
    padding: 5px !important;
    vertical-align: middle;
}
.city-officer-entry,
.city-officer-copy {
    display: grid;
    min-width: 0;
}
.city-officer-entry {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 7px;
    align-items: center;
}
.city-officer-copy strong,
.city-officer-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.city-officer-copy small {
    color: #c9c6bd;
    font-size: 10px;
}
.city-change-button {
    min-width: 70px;
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
@media (max-width: 620px) {
    .legacy-office,
    .legacy-table,
    .feedback,
    .loading {
        width: min(500px, 100vw);
    }
    .heading-table {
        margin-bottom: 10px;
    }
    .nation-heading {
        font-size: 18px;
    }
    .chief-entry-cell {
        padding: 4px !important;
    }
    .chief-entry {
        grid-template-areas:
            'icon copy'
            'role action';
        grid-template-columns: 48px minmax(0, 1fr);
        gap: 5px 7px;
    }
    .chief-entry-role {
        padding: 5px 2px;
        font-size: 12px;
    }
    .general-icon {
        width: 48px;
        height: 48px;
        background-size: 48px 48px;
    }
    .chief-entry-copy strong {
        font-size: 15px;
    }
    .chief-entry-copy small {
        font-size: 9px;
    }
    .personnel-change-button {
        min-height: 30px;
        padding: 3px 5px;
        font-size: 11px;
        line-height: 18px;
    }
    .personnel-lock-label {
        font-size: 10px;
    }
    .award-label {
        font-size: 11px;
        white-space: nowrap;
    }
    .award-label-full {
        display: none;
    }
    .award-label-compact {
        display: inline;
    }
    select[multiple] {
        width: calc(100% - 58px);
        min-width: 0;
    }
    .city-header td {
        height: 26px;
        font-size: 13px;
    }
    .city-header-full {
        display: none;
    }
    .city-header-compact {
        display: inline;
    }
    .region-heading {
        height: 25px;
        font-size: 14px;
    }
    .city-identity {
        width: 16%;
        font-size: 13px;
    }
    .city-identity small {
        font-size: 8px;
    }
    .city-officer-cell {
        padding: 4px !important;
    }
    .city-officer-entry {
        grid-template-columns: 1fr;
        gap: 4px;
    }
    .city-officer-copy strong {
        font-size: 12px;
    }
    .city-officer-copy small {
        font-size: 9px;
    }
    .city-change-button {
        width: 100%;
        min-width: 0;
    }
    .legend {
        font-size: 10px;
    }
    .kick-label {
        width: auto;
    }
    .footer-table {
        margin-top: 10px;
    }
}
</style>
