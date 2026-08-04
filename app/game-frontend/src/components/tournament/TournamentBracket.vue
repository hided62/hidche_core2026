<script setup lang="ts">
import { computed } from 'vue';
import {
    buildTournamentBracket,
    type TournamentBracketMatch,
    type TournamentBracketParticipant,
    type TournamentBracketRound,
    type TournamentBracketSlot,
} from '../../utils/tournamentBracket';

const props = defineProps<{
    participants: TournamentBracketParticipant[];
    matches: TournamentBracketMatch[];
    winnerId?: number;
    betTotals?: Record<number, number>;
    totalBet: number;
    forceDesktop?: boolean;
    showLegend?: boolean;
}>();

const bracket = computed(() => buildTournamentBracket(props.participants, props.matches, props.winnerId));

const mobileColumns = computed(() => [
    bracket.value.top16.slots,
    bracket.value.quarter.slots,
    bracket.value.semi.slots,
    bracket.value.final.slots,
    [bracket.value.champion],
]);
const mobileX = [38, 118, 198, 278, 352];
const mobileY = (columnIndex: number, slotIndex: number) => {
    const slotHeight = 32 * 2 ** columnIndex;
    return 16 + slotHeight / 2 + slotIndex * slotHeight;
};
const mobileConnections = computed(() =>
    mobileColumns.value.slice(0, -1).flatMap((column, columnIndex) => {
        const sourceX = mobileX[columnIndex]! + 32;
        const targetX = mobileX[columnIndex + 1]! - 32;
        const jointX = (sourceX + targetX) / 2;
        return Array.from({ length: column.length / 2 }, (_, pairIndex) => {
            const left = column[pairIndex * 2]!;
            const right = column[pairIndex * 2 + 1]!;
            const y1 = mobileY(columnIndex, pairIndex * 2);
            const y2 = mobileY(columnIndex, pairIndex * 2 + 1);
            return {
                id: `${columnIndex}-${pairIndex}`,
                sourceX,
                targetX,
                jointX,
                y1,
                y2,
                parentY: (y1 + y2) / 2,
                leftActive: left.advanced,
                rightActive: right.advanced,
                parentActive: left.advanced || right.advanced,
            };
        });
    })
);

const roundStyle = (round: TournamentBracketRound) => ({ '--slot-count': round.slots.length });
const connectorGroups = (slots: TournamentBracketSlot[]) =>
    Array.from({ length: slots.length / 2 }, (_, index) => [slots[index * 2]!, slots[index * 2 + 1]!] as const);
const odds = (id: number | null) => {
    if (id === null) return '0';
    const amount = props.betTotals?.[id] ?? 0;
    if (!amount) return '∞';
    return (props.totalBet / amount).toFixed(2);
};
</script>

<template>
    <section
        class="tournament-bracket"
        :class="{ 'force-desktop': forceDesktop }"
        aria-label="토너먼트 대진표"
        tabindex="0"
    >
        <span class="legacy-connector-text">
            ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
            ┏━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━┓ ┏━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━┓ ┏━━━━━━━━━┻━━━━━━━━━┓
            ┏━━━━━━━━━┻━━━━━━━━━┓ ┏━━━━━━━━━┻━━━━━━━━━┓ ┏━━━━━━━━━┻━━━━━━━━━┓ ┏━━━━┻━━━━┓ ┏━━━━┻━━━━┓ ┏━━━━┻━━━━┓
            ┏━━━━┻━━━━┓ ┏━━━━┻━━━━┓ ┏━━━━┻━━━━┓ ┏━━━━┻━━━━┓ ┏━━━━┻━━━━┓
        </span>
        <div class="bracket-canvas">
            <div class="bracket-round bracket-champion" style="--slot-count: 1">
                <span
                    class="bracket-name"
                    :class="{ advanced: bracket.champion.advanced }"
                    :data-general-id="bracket.champion.id ?? undefined"
                >
                    {{ bracket.champion.name }}
                </span>
            </div>

            <div class="connector-row" style="--connector-count: 1">
                <span class="connector-segment">
                    <i class="stem" :class="{ active: bracket.champion.advanced }"></i>
                    <i class="arm left" :class="{ active: bracket.final.slots[0]?.advanced }"></i>
                    <i class="arm right" :class="{ active: bracket.final.slots[1]?.advanced }"></i>
                </span>
            </div>

            <template v-for="round in [bracket.final, bracket.semi, bracket.quarter]" :key="round.stage">
                <div class="bracket-round" :style="roundStyle(round)">
                    <span
                        v-for="(slot, index) in round.slots"
                        :key="`${round.stage}-${slot.id ?? 'empty'}-${index}`"
                        class="bracket-name"
                        :class="{ advanced: slot.advanced }"
                        :data-general-id="slot.id ?? undefined"
                    >
                        {{ slot.name }}
                    </span>
                </div>
                <div class="connector-row" :style="{ '--connector-count': round.slots.length }">
                    <span
                        v-for="(pair, index) in connectorGroups(
                            round.stage === 10
                                ? bracket.semi.slots
                                : round.stage === 9
                                  ? bracket.quarter.slots
                                  : bracket.top16.slots
                        )"
                        :key="`${round.stage}-connector-${index}`"
                        class="connector-segment"
                    >
                        <i class="stem" :class="{ active: pair[0].advanced || pair[1].advanced }"></i>
                        <i class="arm left" :class="{ active: pair[0].advanced }"></i>
                        <i class="arm right" :class="{ active: pair[1].advanced }"></i>
                    </span>
                </div>
            </template>

            <div class="bracket-round" :style="roundStyle(bracket.top16)">
                <span
                    v-for="(slot, index) in bracket.top16.slots"
                    :key="`7-${slot.id ?? 'empty'}-${index}`"
                    class="bracket-name"
                    :class="{ advanced: slot.advanced }"
                    :data-general-id="slot.id ?? undefined"
                >
                    {{ slot.name }}
                </span>
            </div>
            <div class="bracket-round bracket-odds" :style="roundStyle(bracket.top16)">
                <span
                    v-for="(slot, index) in bracket.top16.slots"
                    :key="`odds-${slot.id ?? 'empty'}-${index}`"
                    :data-candidate="slot.name"
                >
                    {{ odds(slot.id) }}
                </span>
            </div>
        </div>
        <div class="mobile-bracket" aria-label="모바일 토너먼트 대진">
            <svg viewBox="0 0 390 544" aria-hidden="true">
                <g v-for="connection in mobileConnections" :key="connection.id">
                    <path
                        class="mobile-connector"
                        :d="`M ${connection.sourceX} ${connection.y1} H ${connection.jointX} V ${connection.y2} M ${connection.sourceX} ${connection.y2} H ${connection.jointX} M ${connection.jointX} ${connection.parentY} H ${connection.targetX}`"
                    />
                    <path
                        v-if="connection.leftActive"
                        class="mobile-connector active"
                        :d="`M ${connection.sourceX} ${connection.y1} H ${connection.jointX} V ${connection.parentY}`"
                    />
                    <path
                        v-if="connection.rightActive"
                        class="mobile-connector active"
                        :d="`M ${connection.sourceX} ${connection.y2} H ${connection.jointX} V ${connection.parentY}`"
                    />
                    <path
                        v-if="connection.parentActive"
                        class="mobile-connector active"
                        :d="`M ${connection.jointX} ${connection.parentY} H ${connection.targetX}`"
                    />
                </g>
            </svg>
            <template v-for="(column, columnIndex) in mobileColumns" :key="`mobile-column-${columnIndex}`">
                <span
                    v-for="(slot, slotIndex) in column"
                    :key="`mobile-${columnIndex}-${slot.id ?? 'empty'}-${slotIndex}`"
                    class="mobile-bracket-name"
                    :class="{ advanced: slot.advanced }"
                    :style="{ left: `${mobileX[columnIndex]}px`, top: `${mobileY(columnIndex, slotIndex)}px` }"
                >
                    {{ slot.name }}
                </span>
            </template>
        </div>
        <p v-if="showLegend !== false">
            배당률이 낮을수록 베팅된 금액이 많고 유저들이 우승후보로 많이 선택한 장수입니다.
        </p>
    </section>
</template>

<style scoped>
.tournament-bracket {
    overflow-x: auto;
    padding: 10px 0;
    scrollbar-color: #777 #24140e;
}
.legacy-connector-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
}
.bracket-canvas {
    width: 2000px;
    min-width: 2000px;
    margin: 0 auto;
}
.mobile-bracket {
    position: relative;
    display: none;
    width: 390px;
    height: 544px;
    margin: 0 auto;
}
.mobile-bracket svg {
    position: absolute;
    inset: 0;
    width: 390px;
    height: 544px;
}
.mobile-connector {
    fill: none;
    stroke: #fff;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}
.mobile-connector.active {
    stroke: #ff4b4b;
}
.mobile-bracket-name {
    position: absolute;
    z-index: 1;
    width: 64px;
    overflow: hidden;
    transform: translate(-50%, -50%);
    border: 1px solid #555;
    background: rgb(58 33 24 / 92%);
    color: #fff;
    font-size: 12px;
    line-height: 22px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mobile-bracket-name.advanced {
    border-color: #ff4b4b;
    color: #ff4b4b;
}
.bracket-round,
.connector-row {
    display: grid;
    grid-template-columns: repeat(var(--slot-count, var(--connector-count)), minmax(0, 1fr));
    align-items: center;
}
.bracket-round {
    min-height: 24px;
}
.bracket-name {
    overflow: hidden;
    padding: 0 3px;
    color: #fff;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.bracket-name.advanced {
    color: #ff4b4b;
}
.connector-row {
    min-height: 24px;
}
.connector-segment {
    position: relative;
    display: block;
    height: 24px;
    color: #fff;
}
.connector-segment i {
    position: absolute;
    display: block;
    color: inherit;
    font-style: normal;
}
.connector-segment .stem {
    top: 0;
    left: 50%;
    height: 13px;
    border-left: 1px solid currentColor;
}
.connector-segment .arm {
    top: 12px;
    width: 25%;
    height: 12px;
    border-top: 1px solid currentColor;
}
.connector-segment .arm.left {
    left: 25%;
    border-left: 1px solid currentColor;
}
.connector-segment .arm.right {
    right: 25%;
    border-right: 1px solid currentColor;
}
.connector-segment .active {
    color: #ff4b4b;
}
.bracket-odds {
    color: skyblue;
}
.tournament-bracket p {
    margin: 0;
    color: skyblue;
    font-size: 18px;
}
@media (max-width: 800px) {
    .tournament-bracket {
        width: 100vw;
        max-width: 100vw;
        overflow-x: hidden;
    }
    .bracket-canvas {
        display: none;
    }
    .mobile-bracket {
        display: block;
    }
    .tournament-bracket.force-desktop {
        width: auto;
        max-width: none;
        overflow-x: auto;
    }
    .tournament-bracket.force-desktop .bracket-canvas {
        display: block;
    }
    .tournament-bracket.force-desktop .mobile-bracket {
        display: none;
    }
}
</style>
