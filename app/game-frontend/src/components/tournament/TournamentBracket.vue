<script setup lang="ts">
import { computed, ref } from 'vue';
import GeneralIdentity from '../ui/GeneralIdentity.vue';
import {
    buildTournamentBracket,
    resolveTournamentCoreStat,
    type TournamentBracketMatch,
    type TournamentBracketParticipant,
    type TournamentBracketSlot,
} from '../../utils/tournamentBracket';

const props = withDefaults(
    defineProps<{
        participants: TournamentBracketParticipant[];
        matches: TournamentBracketMatch[];
        winnerId?: number;
        betTotals?: Record<number, number>;
        myBetTotals?: Record<number, number>;
        totalBet?: number;
        tournamentType?: number;
        showLegend?: boolean;
        bettingOpen?: boolean;
        bettingMode?: boolean;
    }>(),
    {
        winnerId: undefined,
        betTotals: undefined,
        myBetTotals: undefined,
        totalBet: 0,
        tournamentType: undefined,
        bettingMode: false,
    }
);

const emit = defineEmits<{
    requestBet: [slot: TournamentBracketSlot];
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
const desktopSlotHeight = 88;
const desktopCanvasHeight = computed(() => desktopSlotHeight * 16);
const slotY = (columnIndex: number, slotIndex: number) => {
    const slotHeight = desktopSlotHeight * 2 ** columnIndex;
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
    if (id === null || props.betTotals === undefined) return '-';
    const amount = props.betTotals?.[id] ?? 0;
    if (!amount) return '∞';
    return (props.totalBet / amount).toFixed(2);
};
const myBet = (id: number | null) => (id === null ? 0 : (props.myBetTotals?.[id] ?? 0));
const myExpectedReturn = (id: number | null): number | null => {
    if (id === null) return null;
    const invested = myBet(id);
    const targetTotal = props.betTotals?.[id] ?? 0;
    if (invested <= 0 || targetTotal <= 0) return null;
    return Math.round((invested * props.totalBet) / targetTotal);
};
const coreStat = (slot: (typeof bracket.value.top16.slots)[number]) =>
    resolveTournamentCoreStat(slot, props.tournamentType ?? 0);
const requestBet = (slot: TournamentBracketSlot) => {
    if (!props.bettingOpen || slot.id === null) return;
    emit('requestBet', slot);
};
const mobilePairs = computed(() => {
    const column = roundColumns.value[activeMobileRound.value] ?? [];
    if (activeMobileRound.value === roundColumns.value.length - 1) return column.map((slot) => [slot]);
    return Array.from({ length: column.length / 2 }, (_, index) => [column[index * 2]!, column[index * 2 + 1]!]);
});
</script>

<template>
    <section
        class="tournament-bracket"
        :class="{ 'inline-betting-bracket': bettingMode }"
        aria-label="토너먼트 대진표"
        tabindex="0"
    >
        <div v-if="!bettingMode" class="desktop-bracket">
            <div class="desktop-round-labels" aria-hidden="true">
                <strong v-for="label in roundLabels" :key="label">{{ label }}</strong>
            </div>
            <div class="desktop-bracket-canvas" :style="{ height: `${desktopCanvasHeight}px` }">
                <svg :viewBox="`0 0 1200 ${desktopCanvasHeight}`" aria-hidden="true">
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
                        :class="{
                            advanced: slot.advanced,
                            'betting-target': columnIndex === 0 && bettingOpen && slot.id !== null,
                        }"
                        :data-general-id="slot.id ?? undefined"
                        :style="{
                            left: `${(desktopX[columnIndex]! / 1200) * 100}%`,
                            top: `${slotY(columnIndex, slotIndex)}px`,
                        }"
                    >
                        <GeneralIdentity
                            class="bracket-info-identity"
                            :name="slot.name"
                            :picture="slot.picture"
                            :image-server="slot.imageServer"
                            :npc-state="slot.npcState"
                        >
                            <template v-if="slot.id !== null" #details>
                                <span v-if="coreStat(slot)" class="bracket-core-stat">
                                    {{ coreStat(slot)?.label }} {{ coreStat(slot)?.value }}
                                </span>
                                <span class="bracket-odds">배당 {{ odds(slot.id) }}</span>
                            </template>
                        </GeneralIdentity>
                        <slot
                            v-if="columnIndex === 0 && bettingOpen && slot.id !== null"
                            name="bet-controls"
                            :candidate="slot"
                        >
                            <button
                                type="button"
                                class="bracket-bet-button"
                                :aria-label="`${slot.name}에게 베팅하기`"
                                @click="requestBet(slot)"
                            >
                                베팅
                            </button>
                        </slot>
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
                        :class="{
                            advanced: slot.advanced,
                            'betting-target': activeMobileRound === 0 && bettingOpen && slot.id !== null,
                            'betting-candidate': activeMobileRound === 0 && bettingMode,
                        }"
                        :data-general-id="slot.id ?? undefined"
                    >
                        <GeneralIdentity
                            :class="{
                                'bracket-candidate-identity': activeMobileRound === 0 && bettingMode,
                                'bracket-info-identity': !bettingMode || activeMobileRound !== 0,
                            }"
                            :name="slot.name"
                            :picture="slot.picture"
                            :image-server="slot.imageServer"
                            :npc-state="slot.npcState"
                        >
                            <template v-if="slot.id !== null" #details>
                                <span v-if="coreStat(slot)" class="bracket-core-stat">
                                    {{ coreStat(slot)?.label }} {{ coreStat(slot)?.value }}
                                </span>
                                <span v-if="!bettingMode || activeMobileRound !== 0" class="bracket-odds">
                                    배당 {{ odds(slot.id) }}
                                </span>
                            </template>
                        </GeneralIdentity>
                        <div v-if="activeMobileRound === 0 && bettingMode" class="bracket-bet-summary">
                            <span class="bracket-total"
                                >현재 베팅 금{{ (betTotals?.[slot.id ?? 0] ?? 0).toLocaleString('ko-KR') }}</span
                            >
                            <span class="bracket-odds">배당 {{ odds(slot.id) }}</span>
                            <span class="bracket-my-bet">내 투자 금{{ myBet(slot.id).toLocaleString('ko-KR') }}</span>
                            <span class="bracket-return"
                                >예상 환수 금{{ (myExpectedReturn(slot.id) ?? 0).toLocaleString('ko-KR') }}</span
                            >
                        </div>
                        <slot
                            v-if="activeMobileRound === 0 && bettingOpen && slot.id !== null"
                            name="bet-controls"
                            :candidate="slot"
                        >
                            <button
                                type="button"
                                class="bracket-bet-button"
                                :aria-label="`${slot.name}에게 베팅하기`"
                                @click="requestBet(slot)"
                            >
                                베팅
                            </button>
                        </slot>
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
    min-height: 82px;
    align-items: center;
    overflow: hidden;
    transform: translate(-50%, -50%);
    border: 1px solid #555;
    background: rgb(58 33 24 / 94%);
    color: #fff;
    padding: 1px 3px;
}
.betting-target {
    position: absolute;
}
.mobile-bracket-name.betting-target {
    position: relative;
}
.bracket-bet-button {
    position: absolute;
    z-index: 2;
    top: 3px;
    right: 3px;
    min-width: 58px;
    height: 24px;
    margin: 0;
    padding: 2px 5px;
    border: 1px solid #9a7632;
    border-radius: 3px;
    color: #fff3cd;
    background: #59400e;
    font: 700 var(--sammo-font-size-bracket-bet-button)/1 var(--sammo-font-sans);
    cursor: pointer;
}
.bracket-bet-button:hover,
.bracket-bet-button:focus {
    filter: brightness(1.25);
}
.bracket-bet-button:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
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
    min-height: 82px;
    overflow: hidden;
    border: 1px solid #555;
    background: rgb(58 33 24 / 94%);
    padding: 1px 3px;
}
.mobile-bracket-name.betting-candidate {
    min-height: 140px;
    padding: 5px 6px;
}
.versus {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #ffd25e;
    font-size: var(--sammo-font-size-small);
}
.tournament-bracket > p {
    margin: 8px 0 0;
    color: skyblue;
    font-size: var(--sammo-font-size-emphasis);
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
        font-size: var(--sammo-font-size-small);
    }
}

/* Betting uses the same paired cards at every viewport; rounds remain selectable. */
.inline-betting-bracket {
    font-size: var(--sammo-font-size-normal);
}
.inline-betting-bracket .mobile-bracket {
    display: block;
}
.inline-betting-bracket .mobile-round-list {
    padding: 6px;
}
.inline-betting-bracket .mobile-round-list > article {
    gap: 18px;
    align-items: stretch;
}
.inline-betting-bracket .mobile-bracket-name {
    overflow: visible;
}
.inline-betting-bracket .mobile-bracket-name.betting-candidate {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 6px;
    padding: 6px;
}
.bracket-candidate-identity {
    display: grid;
    grid-template-columns: var(--sammo-general-icon-size) minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
    text-align: left;
}
.bracket-candidate-identity :deep(.general-identity-name) {
    font-size: var(--sammo-font-size-emphasis);
    font-weight: 700;
    white-space: normal;
    overflow-wrap: anywhere;
}
.bracket-core-stat {
    color: #fff;
    font-size: var(--sammo-font-size-normal);
}
.bracket-bet-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 6px;
    text-align: left;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
}
.bracket-total,
.bracket-odds {
    color: skyblue;
}
.bracket-my-bet {
    color: orange;
}
.bracket-return {
    color: cyan;
}
.inline-betting-bracket .betting-candidate > :last-child {
    margin-top: auto;
}
.inline-betting-bracket .mobile-round-tabs button {
    font-size: inherit;
}
@media (min-width: 940px) {
    .inline-betting-bracket .mobile-round-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 18px;
    }
}
.bracket-info-identity :deep(.general-identity-name) {
    font-size: var(--sammo-font-size-emphasis);
    line-height: 18px;
}
.bracket-info-identity :deep(.general-identity-details) {
    display: flex;
    flex-direction: column;
    font-size: var(--sammo-font-size-normal);
    line-height: 18px;
    text-align: left;
    overflow-wrap: anywhere;
}
</style>
