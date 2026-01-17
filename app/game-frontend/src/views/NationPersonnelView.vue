<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';
import {
    cityLevelMap,
    formatOfficerLevelText,
    getNationChiefLevel,
    regionMap,
} from '../utils/nationFormat';

type PersonnelResponse = Awaited<ReturnType<typeof trpc.nation.getPersonnelInfo.query>>;

type GeneralEntry = PersonnelResponse['generals'][number];

type OfficerLevel = 2 | 3 | 4;

const officerLabels: Record<OfficerLevel, string> = {
    4: '태수',
    3: '군사',
    2: '종사',
};

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<PersonnelResponse | null>(null);

const chiefAppointmentDraft = reactive<Record<number, number>>({});
const selectedCityId = ref<number>(0);
const selectedOfficerLevel = ref<OfficerLevel>(4);
const selectedGeneralId = ref<number>(0);
const kickTargetId = ref<number>(0);
const ambassadorSelection = ref<number[]>([]);
const auditorSelection = ref<number[]>([]);

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const loadPersonnel = async () => {
    if (loading.value) {
        return;
    }
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
const canAssign = computed(() => (data.value?.me.officerLevel ?? 0) >= 5);
const isLeader = computed(() => (data.value?.me.officerLevel ?? 0) >= 12);

const chiefLevels = computed(() => {
    if (!data.value) {
        return [] as number[];
    }
    const minLevel = getNationChiefLevel(data.value.nation.level);
    const levels: number[] = [];
    for (let level = 12; level >= minLevel; level -= 1) {
        levels.push(level);
    }
    return levels;
});

const cityNameMap = computed(() => {
    const map = new Map<number, string>();
    for (const city of data.value?.cityAssignments ?? []) {
        map.set(city.id, city.name);
    }
    return map;
});

const generalMap = computed(() => {
    const map = new Map<number, GeneralEntry>();
    for (const general of data.value?.generals ?? []) {
        map.set(general.id, general);
    }
    return map;
});

const chiefAssignments = computed(() => data.value?.chiefAssignments ?? {});

const formatCandidateLabel = (general: GeneralEntry): string => {
    const cityName = cityNameMap.value.get(general.cityId);
    const role = general.officerLevel >= 5 ? '수뇌' : general.officerLevel >= 2 ? '관직' : '일반';
    return `${general.name}${cityName ? ` (${cityName})` : ''} · ${role}`;
};

const chiefCandidates = (level: number): GeneralEntry[] => {
    const minStat = data.value?.chiefStatMin ?? 0;
    const list = data.value?.generals ?? [];
    if (level === 11) {
        return list;
    }
    if (level % 2 === 0) {
        return list.filter((general) => general.stats.strength >= minStat);
    }
    return list.filter((general) => general.stats.intelligence >= minStat);
};

const cityCandidatesByLevel = computed(() => {
    const minStat = data.value?.chiefStatMin ?? 0;
    const base = (data.value?.generals ?? []).filter((general) => general.officerLevel !== 12);
    return {
        4: base.filter((general) => general.stats.strength >= minStat),
        3: base.filter((general) => general.stats.intelligence >= minStat),
        2: base,
    } as Record<OfficerLevel, GeneralEntry[]>;
});

const currentCityOfficer = computed(() => {
    const city = data.value?.cityAssignments.find((entry) => entry.id === selectedCityId.value);
    if (!city) {
        return null;
    }
    return city.officers[selectedOfficerLevel.value] ?? null;
});

const initializeDrafts = () => {
    if (!data.value) {
        return;
    }
    for (const key of Object.keys(chiefAppointmentDraft)) {
        delete chiefAppointmentDraft[Number(key)];
    }
    for (const level of chiefLevels.value) {
        chiefAppointmentDraft[level] = chiefAssignments.value[level]?.id ?? 0;
    }

    selectedCityId.value = data.value.cityAssignments[0]?.id ?? 0;
    selectedOfficerLevel.value = 4;
    selectedGeneralId.value = currentCityOfficer.value?.id ?? 0;
    kickTargetId.value = 0;

    ambassadorSelection.value = data.value.permissionCandidates.ambassadors
        .filter((candidate) => candidate.permission === 'ambassador')
        .map((candidate) => candidate.id);
    auditorSelection.value = data.value.permissionCandidates.auditors
        .filter((candidate) => candidate.permission === 'auditor')
        .map((candidate) => candidate.id);
};

watch(
    () => data.value,
    (value) => {
        if (value) {
            initializeDrafts();
        }
    }
);

watch([selectedCityId, selectedOfficerLevel], () => {
    selectedGeneralId.value = currentCityOfficer.value?.id ?? 0;
});

const appointChief = async (level: number) => {
    if (!data.value) {
        return;
    }
    const generalId = chiefAppointmentDraft[level] ?? 0;
    const general = generalMap.value.get(generalId);
    const title = formatOfficerLevelText(level, nationLevel.value);
    const message =
        generalId === 0
            ? `${title} 자리를 비우시겠습니까?`
            : `${general?.name ?? '선택 장수'}을(를) ${title}로 임명하시겠습니까?`;

    if (!window.confirm(message)) {
        return;
    }

    try {
        await trpc.nation.appoint.mutate({
            destGeneralId: generalId,
            destCityId: 0,
            officerLevel: level,
        });
        await loadPersonnel();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const appointCityOfficer = async () => {
    if (!data.value || !selectedCityId.value) {
        return;
    }
    const city = data.value.cityAssignments.find((entry) => entry.id === selectedCityId.value);
    const general = generalMap.value.get(selectedGeneralId.value);
    const officerLabel = officerLabels[selectedOfficerLevel.value];
    const message =
        selectedGeneralId.value === 0
            ? `${city?.name ?? ''} ${officerLabel} 자리를 비우시겠습니까?`
            : `${general?.name ?? '선택 장수'}을(를) ${city?.name ?? ''} ${officerLabel}로 임명하시겠습니까?`;

    if (!window.confirm(message)) {
        return;
    }

    try {
        await trpc.nation.appoint.mutate({
            destGeneralId: selectedGeneralId.value,
            destCityId: selectedCityId.value,
            officerLevel: selectedOfficerLevel.value,
        });
        await loadPersonnel();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const kickGeneral = async () => {
    const general = generalMap.value.get(kickTargetId.value);
    if (!general) {
        return;
    }
    if (!window.confirm(`${general.name}을(를) 추방하시겠습니까?`)) {
        return;
    }

    try {
        await trpc.nation.kick.mutate({ destGeneralId: general.id });
        await loadPersonnel();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const enforceLimit = (list: number[], id: number) => {
    if (list.length <= 2) {
        return;
    }
    const idx = list.indexOf(id);
    if (idx >= 0) {
        list.splice(idx, 1);
    }
    alert('최대 2명까지 설정 가능합니다.');
};

const enforceAmbassadorLimit = (id: number) => {
    enforceLimit(ambassadorSelection.value, id);
};

const enforceAuditorLimit = (id: number) => {
    enforceLimit(auditorSelection.value, id);
};

const changePermissions = async (isAmbassador: boolean) => {
    const selection = isAmbassador ? ambassadorSelection.value : auditorSelection.value;
    if (!window.confirm('권한을 변경하시겠습니까?')) {
        return;
    }

    try {
        await trpc.nation.changePermission.mutate({
            isAmbassador,
            targetGeneralIds: selection,
        });
        await loadPersonnel();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const kickCandidates = computed(() => {
    const list = data.value?.generals ?? [];
    const myId = data.value?.me.id ?? 0;
    return list.filter((general) => general.id !== myId);
});

onMounted(() => {
    void loadPersonnel();
});
</script>

<template>
    <main class="nation-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">인사부</h1>
                <p class="page-subtitle">수뇌 임명과 도시 관직 관리</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인</RouterLink>
                <RouterLink class="ghost" to="/nation/cities">세력 도시</RouterLink>
                <RouterLink class="ghost" to="/nation/generals">세력 장수</RouterLink>
                <button class="ghost" @click="loadPersonnel">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>

        <SkeletonLines v-if="loading" :lines="6" />

        <section v-else class="panel-grid">
            <PanelCard title="수뇌 현황" subtitle="현재 수뇌 배치">
                <div class="chief-grid">
                    <div v-for="level in chiefLevels" :key="level" class="chief-item">
                        <div class="chief-title">{{ formatOfficerLevelText(level, nationLevel) }}</div>
                        <div class="chief-name">
                            {{ chiefAssignments[level]?.name ?? '-' }}
                        </div>
                        <div v-if="chiefAssignments[level]" class="chief-meta">
                            {{ chiefAssignments[level]?.officerCityName ?? chiefAssignments[level]?.cityName ?? '-' }}
                        </div>
                    </div>
                </div>
            </PanelCard>

            <PanelCard v-if="canAssign" title="수뇌부 임명" subtitle="수뇌 관직 임명 및 해임">
                <div class="chief-appoint">
                    <div v-for="level in chiefLevels" :key="level" class="appoint-row">
                        <div class="appoint-label">{{ formatOfficerLevelText(level, nationLevel) }}</div>
                        <select v-model.number="chiefAppointmentDraft[level]" class="select-input">
                            <option :value="0">공석</option>
                            <option v-for="candidate in chiefCandidates(level)" :key="candidate.id" :value="candidate.id">
                                {{ formatCandidateLabel(candidate) }}
                            </option>
                        </select>
                        <button class="ghost" @click="appointChief(level)">임명</button>
                    </div>
                </div>
            </PanelCard>

            <PanelCard v-if="canAssign" title="도시 관직 빠른 임명" subtitle="도시별 관직을 신속하게 배치합니다">
                <div class="fast-appoint">
                    <div class="appoint-row">
                        <div class="appoint-label">도시</div>
                        <select v-model.number="selectedCityId" class="select-input">
                            <option v-for="city in data?.cityAssignments ?? []" :key="city.id" :value="city.id">
                                {{ regionMap[city.region] ?? '-' }} · {{ cityLevelMap[city.level] ?? '-' }} {{ city.name }}
                            </option>
                        </select>
                    </div>
                    <div class="appoint-row">
                        <div class="appoint-label">관직</div>
                        <select v-model.number="selectedOfficerLevel" class="select-input">
                            <option :value="4">태수</option>
                            <option :value="3">군사</option>
                            <option :value="2">종사</option>
                        </select>
                    </div>
                    <div class="appoint-row">
                        <div class="appoint-label">장수</div>
                        <select v-model.number="selectedGeneralId" class="select-input">
                            <option :value="0">공석</option>
                            <option
                                v-for="candidate in cityCandidatesByLevel[selectedOfficerLevel]"
                                :key="candidate.id"
                                :value="candidate.id"
                            >
                                {{ formatCandidateLabel(candidate) }}
                            </option>
                        </select>
                    </div>
                    <div class="current-officer">
                        현재 임명: {{ currentCityOfficer?.name ?? '-' }}
                    </div>
                    <button class="ghost" @click="appointCityOfficer">임명</button>
                </div>
            </PanelCard>

            <PanelCard title="도시 관직 현황" subtitle="도시별 관직 배치">
                <div class="table-scroll">
                    <table class="nation-table">
                        <thead>
                            <tr>
                                <th>도시</th>
                                <th>태수</th>
                                <th>군사</th>
                                <th>종사</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="city in data?.cityAssignments ?? []" :key="city.id">
                                <td>{{ city.name }}</td>
                                <td>{{ city.officers[4]?.name ?? '-' }}</td>
                                <td>{{ city.officers[3]?.name ?? '-' }}</td>
                                <td>{{ city.officers[2]?.name ?? '-' }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </PanelCard>

            <PanelCard v-if="isLeader" title="외교 권한" subtitle="외교권자/조언자 임명">
                <div class="permission-grid">
                    <div>
                        <div class="permission-title">외교권자 (최대 2명)</div>
                        <div class="permission-list">
                            <label
                                v-for="candidate in data?.permissionCandidates.ambassadors ?? []"
                                :key="candidate.id"
                                class="permission-item"
                            >
                                <input
                                    v-model="ambassadorSelection"
                                    type="checkbox"
                                    :value="candidate.id"
                                    @change="enforceAmbassadorLimit(candidate.id)"
                                />
                                {{ candidate.name }}
                            </label>
                        </div>
                        <button class="ghost" @click="changePermissions(true)">변경</button>
                    </div>
                    <div>
                        <div class="permission-title">조언자 (최대 2명)</div>
                        <div class="permission-list">
                            <label
                                v-for="candidate in data?.permissionCandidates.auditors ?? []"
                                :key="candidate.id"
                                class="permission-item"
                            >
                                <input
                                    v-model="auditorSelection"
                                    type="checkbox"
                                    :value="candidate.id"
                                    @change="enforceAuditorLimit(candidate.id)"
                                />
                                {{ candidate.name }}
                            </label>
                        </div>
                        <button class="ghost" @click="changePermissions(false)">변경</button>
                    </div>
                </div>
            </PanelCard>

            <PanelCard v-if="canAssign" title="추방" subtitle="국가에서 장수를 추방합니다">
                <div class="kick-panel">
                    <select v-model.number="kickTargetId" class="select-input">
                        <option :value="0">장수 선택</option>
                        <option v-for="general in kickCandidates" :key="general.id" :value="general.id">
                            {{ general.name }}
                        </option>
                    </select>
                    <button class="ghost" :disabled="kickTargetId === 0" @click="kickGeneral">추방</button>
                </div>
            </PanelCard>
        </section>
    </main>
</template>

<style scoped>
.nation-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.page-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
    padding-bottom: 12px;
}

.page-title {
    font-size: 1.6rem;
    font-weight: 600;
}

.page-subtitle {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.ghost {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
    cursor: pointer;
    text-decoration: none;
    color: inherit;
    background: rgba(16, 16, 16, 0.6);
}

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.panel-grid {
    display: grid;
    gap: 16px;
}

.chief-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
}

.chief-item {
    border: 1px solid rgba(201, 164, 90, 0.2);
    padding: 8px;
}

.chief-title {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.chief-name {
    font-size: 0.9rem;
    font-weight: 600;
}

.chief-meta {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.chief-appoint,
.fast-appoint {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.appoint-row {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
}

.appoint-label {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.7);
}

.select-input {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(16, 16, 16, 0.8);
    color: rgba(232, 221, 196, 0.9);
    padding: 6px 8px;
    font-size: 0.75rem;
}

.current-officer {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.6);
}

.table-scroll {
    overflow-x: auto;
    max-height: 320px;
    overflow-y: auto;
}

.nation-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
}

.nation-table th,
.nation-table td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.2);
    text-align: left;
    white-space: nowrap;
}

.nation-table thead th {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.permission-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
}

.permission-title {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.7);
    margin-bottom: 6px;
}

.permission-list {
    display: grid;
    gap: 6px;
    margin-bottom: 8px;
}

.permission-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
}

.kick-panel {
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
