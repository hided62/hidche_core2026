<script setup lang="ts">
import { computed } from 'vue';
import type { GeneralIconSource } from '../../utils/generalIcon';
import GeneralIdentity from '../ui/GeneralIdentity.vue';

type StandingParticipant = {
    name: string;
    picture?: GeneralIconSource['picture'];
    imageServer?: GeneralIconSource['imageServer'];
    leadership: number;
    strength: number;
    intel: number;
    npcState?: number;
    win?: number;
    draw?: number;
    lose?: number;
    gl?: number;
};

const props = defineProps<{
    groupName: string;
    rows: StandingParticipant[];
    rowCount: number;
    statLabel: string;
    tournamentType: number;
}>();

const slots = computed(() =>
    Array.from({ length: props.rowCount }, (_, index) => ({ rank: index + 1, participant: props.rows[index] }))
);
const statOf = (participant: StandingParticipant): number => {
    if (props.tournamentType === 0) return participant.leadership + participant.strength + participant.intel;
    if (props.tournamentType === 1) return participant.leadership;
    if (props.tournamentType === 2) return participant.strength;
    return participant.intel;
};
const gamesOf = (participant: StandingParticipant): number =>
    (participant.win ?? 0) + (participant.draw ?? 0) + (participant.lose ?? 0);
const pointsOf = (participant: StandingParticipant): number => (participant.win ?? 0) * 3 + (participant.draw ?? 0);
</script>

<template>
    <section class="tournament-group-card" :aria-label="`${groupName}조 순위`">
        <h3>{{ groupName }}조</h3>
        <ol class="standing-list">
            <li
                v-for="slot in slots"
                :key="slot.rank"
                class="standing-row"
                :class="{ 'standing-row--empty': !slot.participant }"
                :data-empty="!slot.participant"
            >
                <span class="standing-rank" :aria-label="`${slot.rank}위`">{{ slot.rank }}</span>
                <GeneralIdentity
                    v-if="slot.participant"
                    :name="slot.participant.name"
                    :picture="slot.participant.picture"
                    :image-server="slot.participant.imageServer"
                    :npc-state="slot.participant.npcState"
                >
                    <template #details>
                        <span class="standing-summary">
                            <span class="standing-summary-line">
                                <strong>{{ statLabel }} {{ statOf(slot.participant) }}</strong>
                                <span>· {{ gamesOf(slot.participant) }}경기</span>
                            </span>
                            <span class="standing-summary-line standing-summary-line--record">
                                {{ slot.participant.win ?? 0 }}승 · {{ slot.participant.draw ?? 0 }}무 ·
                                {{ slot.participant.lose ?? 0 }}패
                            </span>
                            <span class="standing-summary-line">
                                <strong>{{ pointsOf(slot.participant) }}점</strong>
                                <span>· 득실 {{ slot.participant.gl ?? 0 }}</span>
                            </span>
                        </span>
                    </template>
                </GeneralIdentity>
                <GeneralIdentity v-else name="빈 자리" placeholder />
            </li>
        </ol>
    </section>
</template>

<style scoped>
.tournament-group-card {
    min-width: 0;
    border: 1px solid #555;
    text-align: left;
}
.tournament-group-card h3 {
    margin: 0;
    padding: 3px;
    background: #000;
    color: #fff;
    font-size: 14px;
    font-weight: 400;
    text-align: center;
}
.standing-list {
    margin: 0;
    padding: 0;
    list-style: none;
}
.standing-row {
    display: grid;
    min-width: 0;
    min-height: 68px;
    grid-template-columns: 24px minmax(0, 1fr);
    align-items: center;
    border-top: 1px solid #555;
}
.standing-rank {
    align-self: stretch;
    display: grid;
    place-items: center;
    border-right: 1px solid #555;
    background: rgb(0 0 0 / 16%);
    color: #d6cbc6;
    font-variant-numeric: tabular-nums;
    text-align: center;
}
.general-identity {
    width: 100%;
    padding-right: 5px;
    justify-content: flex-start;
}
.standing-summary {
    display: flex;
    min-width: 0;
    flex-direction: column;
    color: #d8cfca;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 14px;
    white-space: nowrap;
}
.standing-summary-line {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 8px;
}
.standing-summary-line strong {
    color: #fff;
    font-weight: 400;
}
.standing-summary-line--record {
    color: #b9d8ed;
}
.standing-row--empty .general-identity {
    min-height: 64px;
}

@media (max-width: 800px) {
    .standing-row {
        grid-template-columns: 28px minmax(0, 1fr);
    }
    .standing-summary {
        font-size: 12px;
        line-height: 15px;
    }
}
</style>
