<script setup lang="ts">
import { computed } from 'vue';

import { dexProgress, legacyExperiencePercent, ratioPercent } from '../../utils/legacyProgress';
import LegacyProgressBar from './LegacyProgressBar.vue';

type GeneralProgress = {
    stats: { leadership: number; strength: number; intelligence: number };
    experience: number;
    progression: {
        experienceLevel: number;
        statExperience: { leadership: number; strength: number; intelligence: number };
        statUpgradeLimit: number;
        dex: number[];
    };
};

const props = withDefaults(defineProps<{ general: GeneralProgress; showPrimary?: boolean }>(), {
    showPrimary: true,
});

const statRows = computed(() =>
    [
        ['leadership', '통솔', props.general.stats.leadership, props.general.progression.statExperience.leadership],
        ['strength', '무력', props.general.stats.strength, props.general.progression.statExperience.strength],
        [
            'intelligence',
            '지력',
            props.general.stats.intelligence,
            props.general.progression.statExperience.intelligence,
        ],
    ].map(([key, label, value, accumulated]) => ({
        key: String(key),
        label: String(label),
        value: Number(value),
        accumulated: Number(accumulated),
        percent: ratioPercent(Number(accumulated), props.general.progression.statUpgradeLimit),
    }))
);

const dexRows = computed(() =>
    ['보병', '궁병', '기병', '귀병', '차병'].map((label, index) => {
        const value = props.general.progression.dex[index] ?? 0;
        return { label, value, progress: dexProgress(value) };
    })
);

const experiencePercent = computed(() =>
    legacyExperiencePercent(props.general.experience, props.general.progression.experienceLevel)
);
</script>

<template>
    <div class="legacy-general-progress">
        <div v-if="props.showPrimary" class="stat-grid">
            <template v-for="stat of statRows" :key="stat.key">
                <span class="cell-label">{{ stat.label }}</span>
                <strong>{{ stat.value }}</strong>
                <LegacyProgressBar
                    :percent="stat.percent"
                    :label="`${stat.label} 성장 ${stat.accumulated} / ${props.general.progression.statUpgradeLimit}`"
                />
            </template>
        </div>
        <div v-if="props.showPrimary" class="experience-row">
            <span class="cell-label">Lv</span>
            <strong>{{ props.general.progression.experienceLevel }}</strong>
            <LegacyProgressBar
                :percent="experiencePercent"
                :label="`경험 레벨 진행 ${experiencePercent.toFixed(1)}%`"
            />
        </div>
        <div class="dex-title">숙 련 도</div>
        <div v-for="row of dexRows" :key="row.label" class="dex-row" :data-dex-progress="row.label">
            <span class="cell-label">{{ row.label }}</span>
            <strong :style="{ color: row.progress.color }">{{ row.progress.name }}</strong>
            <span>{{ (row.value / 1_000).toFixed(1) }}K</span>
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
</template>

<style scoped>
.legacy-general-progress {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    border-top: 1px solid #666;
    font-size: 12px;
}

.stat-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(3, minmax(30px, 1fr) minmax(34px, 1fr) minmax(42px, 1fr));
}

.stat-grid > *,
.experience-row > *,
.dex-row > * {
    box-sizing: border-box;
    min-width: 0;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 1px 3px;
    text-align: center;
}

.stat-grid > .legacy-progress,
.experience-row > .legacy-progress {
    align-self: center;
    padding: 0;
}

.cell-label,
.dex-title {
    background: rgb(20 75 42 / 70%);
}

.experience-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 40px 45px minmax(0, 1fr);
    min-height: 22px;
}

.dex-title {
    min-height: 20px;
    border-bottom: 1px solid #666;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
}

.dex-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 54px 40px 58px minmax(0, 1fr);
    min-height: 26px;
}

.dex-bars {
    display: grid;
    gap: 1px;
    padding: 1px;
}
</style>
