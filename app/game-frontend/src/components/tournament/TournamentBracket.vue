<script setup lang="ts">
import { computed, ref } from 'vue';
import GeneralIdentity from '../ui/GeneralIdentity.vue';
import {
    buildTournamentBracket,
    type TournamentBracketMatch,
    type TournamentBracketParticipant,
} from '../../utils/tournamentBracket';

const props = defineProps<{
    participants: TournamentBracketParticipant[];
    matches: TournamentBracketMatch[];
    winnerId?: number;
    betTotals?: Record<number, number>;
    totalBet: number;
    showLegend?: boolean;
}>();

const bracket = computed(() => buildTournamentBracket(props.participants, props.matches, props.winnerId));
const activeMobileRound = ref(0);
const roundLabels = ['16강', '8강', '4강', '결승', '우승'];
const roundColumns = computed(() => [
    bracket.value.top16.slots,
    bracket.value.quarter.slots,
    bracket.value.semi.slots,
    bracket.value.final.slots,
    [bracket.value.champion],
]);
const desktopX = [110, 355, 600, 845, 1090];
const cardWidth = 190;
const slotY = (columnIndex: number, slotIndex: number) => {
    const slotHeight = 72 * 2 ** columnIndex;
    return slotHeight / 2 + slotIndex * slotHeight;
};
const connections = computed(() =>
    roundColumns.value.slice(0, -1).flatMap((column, columnIndex) => {
        const sourceX = desktopX[columnIndex]! + cardWidth / 2;
        const targetX = desktopX[columnIndex + 1]! - cardWidth / 2;
        const jointX = (sourceX + targetX) / 2;
        return Array.from({ length: column.length / 2 }, (_, pairIndex) => {
            const upper = column[pairIndex * 2]!;
            const lower = column[pairIndex * 2 + 1]!;
            const y1 = slotY(columnIndex, pairIndex * 2);
            const y2 = slotY(columnIndex, pairIndex * 2 + 1);
            return {
                id: `${columnIndex}-${pairIndex}`,
                sourceX,
                targetX,
                jointX,
                y1,
                y2,
                parentY: (y1 + y2) / 2,
                upperActive: upper.advanced,
                lowerActive: lower.advanced,
                parentActive: upper.advanced || lower.advanced,
            };
        });
    })
);

const odds = (id: number | null) => {
    if (id === null) return '0';
    const amount = props.betTotals?.[id] ?? 0;
    if (!amount) return '∞';
    return (props.totalBet / amount).toFixed(2);
};
const mobilePairs = computed(() => {
    const column = roundColumns.value[activeMobileRound.value] ?? [];
    if (activeMobileRound.value === roundColumns.value.length - 1) return column.map((slot) => [slot]);
    return Array.from({ length: column.length / 2 }, (_, index) => [column[index * 2]!, column[index * 2 + 1]!]);
});
</script>

<template>
    <section class="tournament-bracket" aria-label="토너먼트 대진표" tabindex="0">
        <div class="desktop-bracket">
            <div class="desktop-round-labels" aria-hidden="true">
                <strong v-for="label in roundLabels" :key="label">{{ label }}</strong>
            </div>
            <div class="desktop-bracket-canvas">
                <svg viewBox="0 0 1200 1152" aria-hidden="true">
                    <g v-for="connection in connections" :key="connection.id">
                        <path
                            class="bracket-connector"
                            :d="`M ${connection.sourceX} ${connection.y1} H ${connection.jointX} V ${connection.y2} M ${connection.sourceX} ${connection.y2} H ${connection.jointX} M ${connection.jointX} ${connection.parentY} H ${connection.targetX}`"
                        />
                        <path
                            v-if="connection.upperActive"
                            class="bracket-connector active"
                            :d="`M ${connection.sourceX} ${connection.y1} H ${connection.jointX} V ${connection.parentY}`"
                        />
                        <path
                            v-if="connection.lowerActive"
                            class="bracket-connector active"
                            :d="`M ${connection.sourceX} ${connection.y2} H ${connection.jointX} V ${connection.parentY}`"
                        />
                        <path
                            v-if="connection.parentActive"
                            class="bracket-connector active"
                            :d="`M ${connection.jointX} ${connection.parentY} H ${connection.targetX}`"
                        />
                    </g>
                </svg>
                <template v-for="(column, columnIndex) in roundColumns" :key="`round-${columnIndex}`">
                    <article
                        v-for="(slot, slotIndex) in column"
                        :key="`${columnIndex}-${slot.id ?? 'empty'}-${slotIndex}`"
                        class="desktop-bracket-name"
                        :class="{ advanced: slot.advanced }"
                        :data-general-id="slot.id ?? undefined"
                        :style="{
                            left: `${(desktopX[columnIndex]! / 1200) * 100}%`,
                            top: `${slotY(columnIndex, slotIndex)}px`,
                        }"
                    >
                        <GeneralIdentity :name="slot.name" :picture="slot.picture" :image-server="slot.imageServer" />
                        <small v-if="columnIndex === 0" class="bracket-odds">배당 {{ odds(slot.id) }}</small>
                    </article>
                </template>
            </div>
        </div>

        <div class="mobile-bracket">
            <div class="mobile-round-tabs" role="tablist" aria-label="토너먼트 라운드 선택">
                <button
                    v-for="(label, index) in roundLabels"
                    :key="label"
                    type="button"
                    role="tab"
                    :aria-selected="activeMobileRound === index"
                    :class="{ active: activeMobileRound === index }"
                    @click="activeMobileRound = index"
                >
                    {{ label }}
                </button>
            </div>
            <section class="mobile-round-list" role="tabpanel" :aria-label="`${roundLabels[activeMobileRound]} 대진`">
                <article v-for="(pair, pairIndex) in mobilePairs" :key="`pair-${activeMobileRound}-${pairIndex}`">
                    <div
                        v-for="(slot, slotIndex) in pair"
                        :key="`${slot.id ?? 'empty'}-${slotIndex}`"
                        class="mobile-bracket-name"
                        :class="{ advanced: slot.advanced }"
                        :data-general-id="slot.id ?? undefined"
                    >
                        <GeneralIdentity :name="slot.name" :picture="slot.picture" :image-server="slot.imageServer" />
                        <small v-if="activeMobileRound === 0" class="bracket-odds">배당 {{ odds(slot.id) }}</small>
                    </div>
                    <strong v-if="pair.length === 2" class="versus" aria-hidden="true">VS</strong>
                </article>
            </section>
        </div>

        <p v-if="showLegend !== false">
            배당률이 낮을수록 베팅된 금액이 많고 유저들이 우승후보로 많이 선택한 장수입니다.
        </p>
    </section>
</template>

<style scoped>
.tournament-bracket {
    overflow-x: hidden;
    padding: 10px 0;
}
.desktop-bracket {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
}
.desktop-round-labels {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    min-height: 30px;
    align-items: center;
    color: #ffd25e;
}
.desktop-bracket-canvas {
    position: relative;
    width: 100%;
    height: 1152px;
}
.desktop-bracket-canvas svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}
.bracket-connector {
    fill: none;
    stroke: #fff;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}
.bracket-connector.active {
    stroke: #ff4b4b;
}
.desktop-bracket-name {
    position: absolute;
    z-index: 1;
    display: grid;
    box-sizing: border-box;
    width: clamp(140px, 16vw, 190px);
    min-height: 68px;
    align-items: center;
    overflow: hidden;
    transform: translate(-50%, -50%);
    border: 1px solid #555;
    background: rgb(58 33 24 / 94%);
    color: #fff;
    padding: 1px 3px;
}
.desktop-bracket-name.advanced,
.mobile-bracket-name.advanced {
    border-color: #ff4b4b;
    color: #ff4b4b;
}
.desktop-bracket-name :deep(.general-identity),
.mobile-bracket-name :deep(.general-identity) {
    width: 100%;
    justify-content: flex-start;
}
.bracket-odds {
    display: block;
    color: skyblue;
    font-size: 11px;
    line-height: 12px;
    text-align: right;
}
.mobile-bracket {
    display: none;
}
.mobile-round-tabs {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    padding: 6px;
}
.mobile-round-tabs button {
    min-width: 0;
    height: 34px;
    margin: 0;
    border: 1px solid #666;
    border-radius: 3px;
    background: #444;
    color: #fff;
}
.mobile-round-tabs button.active {
    border-color: #f39c12;
    background: #8a5b13;
}
.mobile-round-list {
    display: grid;
    gap: 8px;
    padding: 8px;
}
.mobile-round-list > article {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 22px;
}
.mobile-round-list > article:has(> :only-child) {
    grid-template-columns: minmax(0, 1fr);
}
.mobile-bracket-name {
    box-sizing: border-box;
    min-width: 0;
    min-height: 68px;
    overflow: hidden;
    border: 1px solid #555;
    background: rgb(58 33 24 / 94%);
    padding: 1px 3px;
}
.versus {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #ffd25e;
    font-size: 11px;
}
.tournament-bracket > p {
    margin: 8px 0 0;
    color: skyblue;
    font-size: 18px;
}
@media (max-width: 800px) {
    .desktop-bracket {
        display: none;
    }
    .mobile-bracket {
        display: block;
    }
    .tournament-bracket > p {
        padding: 0 8px;
        font-size: 13px;
    }
}
</style>
