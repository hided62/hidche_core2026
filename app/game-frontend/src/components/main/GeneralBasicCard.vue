<script setup lang="ts">
import { computed } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';
import LegacyProgressBar from '../ui/LegacyProgressBar.vue';
import { dexProgress, legacyExperiencePercent, ratioPercent } from '../../utils/legacyProgress';

interface GeneralStats {
    leadership: number;
    strength: number;
    intelligence: number;
}

interface GeneralProgression {
    experienceLevel: number;
    dedicationLevel: number;
    statExperience?: { leadership: number; strength: number; intelligence: number };
    statUpgradeLimit?: number;
    dex: number[];
}

interface GeneralInfo {
    id: number;
    name: string;
    npcState: number;
    officerLevel: number;
    stats: GeneralStats;
    gold: number;
    rice: number;
    crew: number;
    train: number;
    atmos: number;
    injury: number;
    experience: number;
    dedication: number;
    age?: number;
    turnTime?: string;
    crewTypeId?: number;
    traits?: { personal: string; specialWar: string; specialDomestic: string };
    progression?: GeneralProgression;
}

const props = defineProps<{
    general: GeneralInfo | null;
    loading: boolean;
}>();

const statRows = computed(() => {
    const general = props.general;
    if (!general) return [];
    const limit = general.progression?.statUpgradeLimit ?? 30;
    const accumulated = general.progression?.statExperience;
    return [
        {
            key: 'leadership',
            label: '통솔',
            value: general.stats.leadership,
            accumulated: accumulated?.leadership ?? 0,
        },
        { key: 'strength', label: '무력', value: general.stats.strength, accumulated: accumulated?.strength ?? 0 },
        {
            key: 'intelligence',
            label: '지력',
            value: general.stats.intelligence,
            accumulated: accumulated?.intelligence ?? 0,
        },
    ].map((entry) => ({ ...entry, limit, percent: ratioPercent(entry.accumulated, limit) }));
});

const dexRows = computed(() => {
    const dex = props.general?.progression?.dex ?? [];
    return ['보병', '궁병', '기병', '귀병', '차병'].map((label, index) => {
        const value = dex[index] ?? 0;
        return { label, value, progress: dexProgress(value) };
    });
});

const experiencePercent = computed(() =>
    legacyExperiencePercent(props.general?.experience ?? 0, props.general?.progression?.experienceLevel ?? 0)
);
</script>

<template>
    <div class="general-card">
        <div v-if="props.loading">
            <SkeletonLines :lines="5" />
        </div>
        <div v-else-if="!props.general" class="empty">장수 정보를 불러오지 못했습니다.</div>
        <div v-else class="general-body">
            <div class="general-title">
                {{ props.general.name }} · 관직 {{ props.general.officerLevel }} · {{ props.general.age ?? '-' }}세 ·
                다음 턴
                {{ props.general.turnTime?.slice(11, 16) ?? '-' }}
            </div>

            <div class="stat-progress-grid">
                <template v-for="stat of statRows" :key="stat.key">
                    <span class="cell-label">{{ stat.label }}</span>
                    <strong>{{ stat.value }}</strong>
                    <div class="bar-cell" :data-stat-progress="stat.key">
                        <LegacyProgressBar
                            :percent="stat.percent"
                            :label="`${stat.label} 성장 ${stat.accumulated} / ${stat.limit}`"
                        />
                    </div>
                </template>
            </div>

            <div class="legacy-grid">
                <span>자금</span><strong>{{ props.general.gold.toLocaleString() }}</strong> <span>군량</span
                ><strong>{{ props.general.rice.toLocaleString() }}</strong> <span>병력</span
                ><strong>{{ props.general.crew.toLocaleString() }}</strong> <span>훈련</span
                ><strong>{{ props.general.train }}</strong> <span>사기</span><strong>{{ props.general.atmos }}</strong>
                <span>부상</span><strong>{{ props.general.injury }}</strong> <span>병종</span
                ><strong>{{ props.general.crewTypeId || '-' }}</strong> <span>성격</span
                ><strong>{{ props.general.traits?.personal ?? '-' }}</strong> <span>전투특기</span
                ><strong>{{ props.general.traits?.specialWar ?? '-' }}</strong> <span>내정특기</span
                ><strong>{{ props.general.traits?.specialDomestic ?? '-' }}</strong> <span>계급</span
                ><strong>Lv {{ props.general.progression?.dedicationLevel ?? 0 }}</strong> <span>공헌</span
                ><strong>{{ props.general.dedication.toLocaleString() }}</strong>
            </div>

            <div class="experience-row">
                <span class="cell-label">Lv</span>
                <strong>{{ props.general.progression?.experienceLevel ?? 0 }}</strong>
                <div class="bar-cell" data-experience-progress>
                    <LegacyProgressBar
                        :percent="experiencePercent"
                        :label="`경험 레벨 진행 ${experiencePercent.toFixed(1)}%`"
                    />
                </div>
                <span class="experience-total">명성 {{ props.general.experience.toLocaleString() }}</span>
            </div>

            <div class="dex-title">숙 련 도</div>
            <div v-for="row of dexRows" :key="row.label" class="dex-row" :data-dex-progress="row.label">
                <span class="cell-label">{{ row.label }}</span>
                <strong :style="{ color: row.progress.color }">{{ row.progress.name }}</strong>
                <span class="dex-value">{{ (row.value / 1_000).toFixed(1) }}K</span>
                <div class="dex-bars">
                    <LegacyProgressBar
                        :percent="row.progress.overallPercent"
                        :label="`${row.label} 전체 ${row.value.toLocaleString()} / 1,275,975 (EX+)`"
                    />
                    <LegacyProgressBar
                        :height="7"
                        variant="grade"
                        :percent="row.progress.gradePercent"
                        :label="
                            row.progress.nextName
                                ? `${row.label} ${row.progress.name}에서 ${row.progress.nextName}까지 ${row.progress.remaining.toLocaleString()} 남음`
                                : `${row.label} EX+ 달성`
                        "
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.general-title {
    min-height: 20px;
    padding: 1px 6px;
    border-bottom: 1px solid #777;
    background: #173d27;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
}

.stat-progress-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(30px, 1fr) minmax(34px, 1fr) 45px);
    font-size: 12px;
}

.stat-progress-grid > *,
.legacy-grid > * {
    box-sizing: border-box;
    min-height: 22px;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 2px 4px;
    overflow: hidden;
    white-space: nowrap;
}

.cell-label,
.legacy-grid > span,
.dex-title {
    background: rgb(20 75 42 / 70%);
    text-align: center;
}

.stat-progress-grid > strong,
.legacy-grid > strong {
    text-align: right;
    font-weight: 400;
}

.bar-cell {
    display: grid;
    align-content: center;
    padding: 0 1px;
}

.legacy-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    font-size: 12px;
}

.experience-row {
    display: grid;
    grid-template-columns: 32px 38px minmax(120px, 1fr) 112px;
    min-height: 22px;
    border-bottom: 1px solid #666;
    font-size: 12px;
}

.experience-row > * {
    display: grid;
    align-content: center;
    box-sizing: border-box;
    border-right: 1px solid #666;
    padding: 1px 4px;
    text-align: center;
}

.dex-title {
    min-height: 20px;
    border-bottom: 1px solid #666;
    font-size: 12px;
    font-weight: 700;
    line-height: 20px;
}

.dex-row {
    display: grid;
    grid-template-columns: 64px 40px 60px minmax(0, 1fr);
    min-height: 26px;
    border-bottom: 1px solid #666;
    font-size: 12px;
}

.dex-row > * {
    display: grid;
    align-content: center;
    box-sizing: border-box;
    border-right: 1px solid #666;
    padding: 0 3px;
    text-align: center;
}

.dex-row > strong {
    font-weight: 400;
}

.dex-value {
    text-align: right;
}

.dex-bars {
    gap: 1px;
    padding: 1px;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
