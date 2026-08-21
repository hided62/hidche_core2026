<script setup lang="ts">
import GeneralBasicCard, { type GeneralBasicCardData } from './GeneralBasicCard.vue';
import GeneralBattleSummary, { type GeneralBattleSummaryData } from './GeneralBattleSummary.vue';
import LegacyGeneralProgress from '../ui/LegacyGeneralProgress.vue';

type BasicProgression = NonNullable<GeneralBasicCardData['progression']>;

export type GeneralInformationPanelData = GeneralBasicCardData & {
    progression: BasicProgression & {
        statExperience: NonNullable<BasicProgression['statExperience']>;
        statUpgradeLimit: number;
        dex: number[];
    };
};

const props = withDefaults(
    defineProps<{
        general: GeneralInformationPanelData | null;
        summary: GeneralBattleSummaryData | null;
        loading: boolean;
        nationColor?: string | null;
        defenceText?: string | null;
        killTurn?: number | null;
        remainingMinutes?: number | null;
        troopText?: string | null;
        penaltyText?: string | number | null;
    }>(),
    {
        nationColor: '#173d27',
        defenceText: null,
        killTurn: null,
        remainingMinutes: null,
        troopText: null,
        penaltyText: null,
    }
);
</script>

<template>
    <GeneralBasicCard
        data-general-information-panel
        :general="props.general"
        :loading="props.loading"
        :nation-color="props.nationColor"
        :defence-text="props.defenceText"
        :kill-turn="props.killTurn"
        :remaining-minutes="props.remainingMinutes"
        :troop-text="props.troopText"
        :penalty-text="props.penaltyText"
    >
        <template v-if="props.general" #details>
            <GeneralBattleSummary v-if="props.summary" :summary="props.summary" show-win-rate />
            <LegacyGeneralProgress :general="props.general" :show-primary="false" />
        </template>
    </GeneralBasicCard>
</template>
