<script setup lang="ts">
import { computed } from 'vue';

import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';

export type GeneralBattleSummaryData = {
    available?: boolean;
    experience?: number | null;
    dedicationText?: string | null;
    bill?: number | null;
    warnum?: number | null;
    wins?: number | null;
    losses?: number | null;
    strategies?: number | null;
    serviceYears?: number | null;
    killCrew?: number | null;
    deathCrew?: number | null;
    winRate?: number | null;
    killRate?: number | null;
    recentWar?: string | null;
};

const props = withDefaults(
    defineProps<{
        summary: GeneralBattleSummaryData;
        showWinRate?: boolean;
        rateScale?: 'ratio' | 'percent';
    }>(),
    { showWinRate: false, rateScale: 'ratio' }
);

const numberText = (value: number | null | undefined): string =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : '-';

const rateText = (value: number): string => `${(props.rateScale === 'percent' ? value : value * 100).toFixed(2)}%`;

const winRate = computed(() => {
    if (typeof props.summary.winRate === 'number' && Number.isFinite(props.summary.winRate)) {
        return rateText(props.summary.winRate);
    }
    const battles = props.summary.warnum;
    const wins = props.summary.wins;
    if (typeof battles !== 'number' || battles <= 0 || typeof wins !== 'number') return '-';
    return `${((wins / battles) * 100).toFixed(2)}%`;
});

const killRate = computed(() => {
    if (typeof props.summary.killRate === 'number' && Number.isFinite(props.summary.killRate)) {
        return rateText(props.summary.killRate);
    }
    const killed = props.summary.killCrew;
    const lost = props.summary.deathCrew;
    if (typeof killed !== 'number' || typeof lost !== 'number' || lost <= 0) return '-';
    return `${((killed / lost) * 100).toFixed(2)}%`;
});
</script>

<template>
    <div class="battle-general-extra" data-general-battle-summary>
        <div v-if="summary.available === false" class="battle-summary-unavailable">
            전투 집계가 보존되지 않았습니다.
        </div>
        <template v-else>
            <span>명성</span><strong>{{ numberText(summary.experience) }}</strong> <span>계급</span
            ><strong>{{ summary.dedicationText || '-' }}</strong>
            <template v-if="summary.bill !== undefined">
                <span>봉급</span><strong>{{ numberText(summary.bill) }}</strong>
            </template>
            <template v-else>
                <span class="battle-general-extra__empty" aria-hidden="true"></span>
                <strong class="battle-general-extra__empty" aria-hidden="true"></strong>
            </template>
            <span>전투</span
            ><strong>{{ numberText(summary.warnum) }}<template v-if="summary.warnum != null">회</template></strong>
            <span>계략</span><strong>{{ numberText(summary.strategies) }}</strong>
            <template v-if="summary.serviceYears !== undefined">
                <span>사관</span
                ><strong
                    >{{ numberText(summary.serviceYears)
                    }}<template v-if="summary.serviceYears != null">년</template></strong
                >
            </template>
            <template v-else>
                <span class="battle-general-extra__empty" aria-hidden="true"></span>
                <strong class="battle-general-extra__empty" aria-hidden="true"></strong>
            </template>
            <template v-if="showWinRate">
                <span>승률</span><strong>{{ winRate }}</strong>
            </template>
            <template v-else>
                <span class="battle-general-extra__empty" aria-hidden="true"></span>
                <strong class="battle-general-extra__empty" aria-hidden="true"></strong>
            </template>
            <span>승리</span><strong>{{ numberText(summary.wins) }}</strong> <span>패배</span
            ><strong>{{ numberText(summary.losses) }}</strong>
            <template v-if="showWinRate">
                <span>살상률</span><strong>{{ killRate }}</strong>
            </template>
            <template v-else>
                <span class="battle-general-extra__empty" aria-hidden="true"></span>
                <strong class="battle-general-extra__empty" aria-hidden="true"></strong>
            </template>
            <span>사살</span><strong>{{ numberText(summary.killCrew) }}</strong> <span>피살</span
            ><strong>{{ numberText(summary.deathCrew) }}</strong>
            <span class="battle-general-extra__recent-label">최근 전투</span>
            <strong class="battle-general-extra__recent-value">
                {{ formatServerDateTime(summary.recentWar, { format: 'monthDayTime', fallback: '-' }) }}
            </strong>
        </template>
    </div>
</template>

<style scoped>
.battle-general-extra {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
}

.battle-general-extra > * {
    min-height: 24px;
    box-sizing: border-box;
    border-right: 1px solid #777;
    border-bottom: 1px solid #777;
    padding: 2px 5px;
}

.battle-general-extra > span {
    background-color: rgb(20 75 42 / 70%);
    text-align: center;
}

.battle-general-extra > strong {
    overflow: hidden;
    font-weight: 500;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.battle-general-extra > .battle-general-extra__empty {
    color: transparent;
}

.battle-general-extra > .battle-general-extra__recent-label {
    grid-column: 1;
}

.battle-general-extra > .battle-general-extra__recent-value {
    grid-column: 2 / -1;
    text-align: left;
}

.battle-summary-unavailable {
    grid-column: 1 / -1;
    color: #bbb;
    text-align: center;
}
</style>
