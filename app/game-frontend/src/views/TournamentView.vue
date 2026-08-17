<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common';
import { computed, onMounted, ref } from 'vue';
import TournamentBracket from '../components/tournament/TournamentBracket.vue';
import TournamentPageHeader from '../components/tournament/TournamentPageHeader.vue';
import GeneralIdentity from '../components/ui/GeneralIdentity.vue';
import { trpc } from '../utils/trpc';
import { resolveTournamentStageName } from '../utils/tournamentStatus';

type Snapshot = Awaited<ReturnType<typeof trpc.tournament.getSnapshot.query>>;

const snapshot = ref<Snapshot | null>(null);
const betting = ref<Awaited<ReturnType<typeof trpc.tournament.getBettingSummary.query>> | null>(null);
const myGeneralId = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const adminEnabled = ref(false);
const activeFinalGroup = ref(0);
const activePreliminaryGroup = ref(0);

const typeNames = ['전력전', '통솔전', '일기토', '설전'];
const typeStatNames = ['종합', '통솔', '무력', '지력'];
const errorText = (value: unknown) => (value instanceof Error ? value.message : String(value));

const load = async () => {
    loading.value = true;
    error.value = null;
    try {
        const [nextSnapshot, nextBetting, me, admin] = await Promise.all([
            trpc.tournament.getSnapshot.query(),
            trpc.tournament.getBettingSummary.query(),
            trpc.general.me.query(),
            trpc.tournament.getAdminStatus.query().catch(() => null),
        ]);
        snapshot.value = nextSnapshot;
        betting.value = nextBetting;
        myGeneralId.value = me?.general?.id ?? 0;
        adminEnabled.value = !!admin?.ok;
    } catch (value) {
        error.value = errorText(value);
    } finally {
        loading.value = false;
    }
};

onMounted(() => void load());

const participantsById = computed(
    () => new Map((snapshot.value?.participants ?? []).map((participant) => [participant.id, participant]))
);
const matchesAt = (stage: number) =>
    (snapshot.value?.matches ?? [])
        .filter((match) => match.stage === stage)
        .sort((a, b) => a.roundIndex - b.roundIndex);
const nameOf = (id?: number) => (id ? (participantsById.value.get(id)?.name ?? `#${id}`) : '-');
const totalBet = computed(() => betting.value?.totalAmount ?? 0);
const openingTime = computed(() =>
    formatServerDateTime(snapshot.value?.state?.nextAt, { format: 'hourMinute', fallback: '--:--' })
);
const betTotals = computed(() => betting.value?.totals as Record<number, number> | undefined);
const myBetTotals = computed(() => betting.value?.myTotals as Record<number, number> | undefined);
const isParticipant = computed(() =>
    (snapshot.value?.participants ?? []).some((participant) => participant.id === myGeneralId.value)
);
const groups = computed(() =>
    Array.from({ length: 8 }, (_, index) =>
        (snapshot.value?.participants ?? [])
            .filter((participant) => participant.groupId === index + 10)
            .sort((a, b) => (a.finalRank ?? 99) - (b.finalRank ?? 99) || (a.groupNo ?? 99) - (b.groupNo ?? 99))
    )
);
const preliminaryGroups = computed(() =>
    Array.from({ length: 8 }, (_, index) =>
        (snapshot.value?.participants ?? [])
            .filter((participant) => {
                const groupId =
                    participant.preliminaryGroupId ??
                    (participant.groupId !== undefined && participant.groupId < 8 ? participant.groupId : undefined);
                return groupId === index;
            })
            .map((participant) => ({
                ...participant,
                groupNo: participant.preliminaryGroupNo ?? participant.groupNo,
                win: participant.preliminaryWin ?? participant.win,
                draw: participant.preliminaryDraw ?? participant.draw,
                lose: participant.preliminaryLose ?? participant.lose,
                gl: participant.preliminaryGl ?? participant.gl,
            }))
            .sort(
                (a, b) =>
                    (a.preliminaryRank ?? a.seedRank ?? 99) - (b.preliminaryRank ?? b.seedRank ?? 99) ||
                    (a.groupNo ?? 99) - (b.groupNo ?? 99)
            )
    )
);
const groupNames = ['一', '二', '三', '四', '五', '六', '七', '八'];
const statOf = (participant: Snapshot['participants'][number] | undefined): number | '' => {
    if (!participant) return '';
    const type = snapshot.value?.state?.type ?? 0;
    if (type === 0) return participant.leadership + participant.strength + participant.intel;
    if (type === 1) return participant.leadership;
    if (type === 2) return participant.strength;
    return participant.intel;
};
const gamesOf = (participant: Snapshot['participants'][number] | undefined): number | '' =>
    participant ? (participant.win ?? 0) + (participant.draw ?? 0) + (participant.lose ?? 0) : '';
const pointsOf = (participant: Snapshot['participants'][number] | undefined): number | '' =>
    participant ? (participant.win ?? 0) * 3 + (participant.draw ?? 0) : '';
const currentMatch = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage < 7 || state.stage > 10) return null;
    return matchesAt(state.stage).find((match) => !match.winnerId) ?? matchesAt(state.stage)[state.phase] ?? null;
});

const join = async () => {
    actionMessage.value = null;
    try {
        await trpc.tournament.join.mutate();
        actionMessage.value = '참가 신청이 반영되었습니다.';
    } catch (value) {
        actionMessage.value = errorText(value);
    } finally {
        await load();
    }
};

const cancel = async () => {
    try {
        await trpc.tournament.cancel.mutate();
        actionMessage.value = '토너먼트가 중단되었습니다.';
        await load();
    } catch (value) {
        actionMessage.value = errorText(value);
    }
};

const start = async () => {
    const now = new Date();
    try {
        await trpc.tournament.setState.mutate({
            stage: 1,
            phase: 0,
            type: 0,
            auto: true,
            openYear: snapshot.value?.state?.openYear ?? now.getUTCFullYear(),
            openMonth: snapshot.value?.state?.openMonth ?? now.getUTCMonth() + 1,
            termSeconds: snapshot.value?.state?.termSeconds ?? 60,
            nextAt: new Date(Date.now() + 60_000).toISOString(),
            bettingSettled: false,
            rewardSettled: false,
        });
        actionMessage.value = '토너먼트를 개최했습니다.';
        await load();
    } catch (value) {
        actionMessage.value = errorText(value);
    }
};
</script>

<template>
    <main id="tournament-container" class="legacy-page">
        <TournamentPageHeader class="bg0" active-page="tournament" title="삼모전 토너먼트" />

        <section class="toolbar bg0">
            <button type="button" @click="load">갱신</button>
            <button
                type="button"
                class="join-button"
                :disabled="snapshot?.state?.stage !== 1 || isParticipant"
                @click="join"
            >
                참가
            </button>
            <span v-if="loading">불러오는 중...</span>
            <span v-if="actionMessage" role="status">{{ actionMessage }}</span>
        </section>

        <section v-if="error" class="error-row bg0" role="alert">{{ error }}</section>
        <section class="operator-row bg0">운영자 메세지 : <span></span></section>
        <section class="state-row bg0">
            <span class="type">{{ typeNames[snapshot?.state?.type ?? 0] }}</span>
            ({{ resolveTournamentStageName(snapshot?.state?.stage ?? 0) }}, 개막시간 {{ openingTime }}, 경기당
            {{ snapshot?.state?.termSeconds ?? '-' }}초)
        </section>
        <section class="section-title bg2">16강 승자전</section>

        <TournamentBracket
            class="bg0"
            :participants="snapshot?.participants ?? []"
            :matches="snapshot?.matches ?? []"
            :winner-id="snapshot?.state?.winnerId"
            :bet-totals="betTotals"
            :my-bet-totals="myBetTotals"
            :total-bet="totalBet"
        />

        <section v-if="currentMatch" class="fight bg0">
            <h2>{{ nameOf(currentMatch.attackerId) }} vs {{ nameOf(currentMatch.defenderId) }}</h2>
            <p v-for="(line, index) in currentMatch.log ?? []" :key="index">{{ line }}</p>
        </section>

        <section class="section-title groups-title bg2">조별 본선 순위</section>
        <div class="group-tabs bg0" role="tablist" aria-label="본선 조 선택">
            <button
                v-for="(groupName, groupIndex) in groupNames"
                :key="`final-tab-${groupName}`"
                type="button"
                role="tab"
                :aria-selected="activeFinalGroup === groupIndex"
                :class="{ active: activeFinalGroup === groupIndex }"
                @click="activeFinalGroup = groupIndex"
            >
                {{ groupName }}조
            </button>
        </div>
        <section class="group-grid bg0">
            <table
                v-for="(group, groupIndex) in groups"
                :key="groupIndex"
                :class="{ 'mobile-active': activeFinalGroup === groupIndex }"
            >
                <caption>
                    {{
                        groupNames[groupIndex]
                    }}조
                </caption>
                <thead>
                    <tr>
                        <th>순</th>
                        <th>장수</th>
                        <th>{{ typeStatNames[snapshot?.state?.type ?? 0] }}</th>
                        <th>경</th>
                        <th>승</th>
                        <th>무</th>
                        <th>패</th>
                        <th>점</th>
                        <th>득</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="rowIndex in 4" :key="rowIndex">
                        <td>{{ rowIndex }}</td>
                        <td class="general-cell">
                            <GeneralIdentity
                                v-if="group[rowIndex - 1]"
                                :name="group[rowIndex - 1]!.name"
                                :picture="group[rowIndex - 1]!.picture"
                                :image-server="group[rowIndex - 1]!.imageServer"
                            />
                        </td>
                        <td>{{ statOf(group[rowIndex - 1]) }}</td>
                        <td>{{ gamesOf(group[rowIndex - 1]) }}</td>
                        <td>{{ group[rowIndex - 1]?.win ?? '' }}</td>
                        <td>{{ group[rowIndex - 1]?.draw ?? '' }}</td>
                        <td>{{ group[rowIndex - 1]?.lose ?? '' }}</td>
                        <td>{{ pointsOf(group[rowIndex - 1]) }}</td>
                        <td>{{ group[rowIndex - 1]?.gl ?? '' }}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section class="section-title groups-title bg2">조별 예선 순위</section>
        <div class="group-tabs bg0" role="tablist" aria-label="예선 조 선택">
            <button
                v-for="(groupName, groupIndex) in groupNames"
                :key="`preliminary-tab-${groupName}`"
                type="button"
                role="tab"
                :aria-selected="activePreliminaryGroup === groupIndex"
                :class="{ active: activePreliminaryGroup === groupIndex }"
                @click="activePreliminaryGroup = groupIndex"
            >
                {{ groupName }}조
            </button>
        </div>
        <section class="group-grid preliminary-grid bg0">
            <table
                v-for="(group, groupIndex) in preliminaryGroups"
                :key="`preliminary-${groupIndex}`"
                :class="{ 'mobile-active': activePreliminaryGroup === groupIndex }"
            >
                <caption>
                    {{
                        groupNames[groupIndex]
                    }}조
                </caption>
                <thead>
                    <tr>
                        <th>순</th>
                        <th>장수</th>
                        <th>{{ typeStatNames[snapshot?.state?.type ?? 0] }}</th>
                        <th>경</th>
                        <th>승</th>
                        <th>무</th>
                        <th>패</th>
                        <th>점</th>
                        <th>득</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="rowIndex in 8" :key="rowIndex">
                        <td>{{ rowIndex }}</td>
                        <td class="general-cell">
                            <GeneralIdentity
                                v-if="group[rowIndex - 1]"
                                :name="group[rowIndex - 1]!.name"
                                :picture="group[rowIndex - 1]!.picture"
                                :image-server="group[rowIndex - 1]!.imageServer"
                            />
                        </td>
                        <td>{{ statOf(group[rowIndex - 1]) }}</td>
                        <td>{{ gamesOf(group[rowIndex - 1]) }}</td>
                        <td>{{ group[rowIndex - 1]?.win ?? '' }}</td>
                        <td>{{ group[rowIndex - 1]?.draw ?? '' }}</td>
                        <td>{{ group[rowIndex - 1]?.lose ?? '' }}</td>
                        <td>{{ pointsOf(group[rowIndex - 1]) }}</td>
                        <td>{{ group[rowIndex - 1]?.gl ?? '' }}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <div class="legacy-bracket-table-signature" hidden>
            <table v-for="(rowCount, tableIndex) in [11, 11, 11, 10]" :key="tableIndex">
                <tbody>
                    <tr v-for="rowIndex in rowCount" :key="rowIndex">
                        <td></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <section class="tournament-guide bg0">
            ㆍ예선은 홈&amp;어웨이 풀리그로 진행됩니다. (총 14경기)<br />
            ㆍ상위 4명이 본선에 진출하게 되며 조추첨을 통해 조가 배정됩니다.<br />
            ㆍ각 조1위가 시드1로 랜덤하게 조에 배정되며, 역시 각 조2위가 시드2로 랜덤하게 조에 배정됩니다.<br />
            ㆍ그후 남은 3, 4위는 완전 랜덤하게 모든 조에 랜덤하게 배정됩니다.<br />
            ㆍ본선은 개인당 3경기를 치르게 되며 승점(승3, 무1, 패0), 득실, 참가순서(시드)에 따라 순위를 매깁니다.<br />
            ㆍ각 조 1, 2위는 16강에 지정된 위치에 배정됩니다.<br />
            ㆍ16강부터는 1경기 토너먼트로 진행됩니다.<br />
            ㆍ참가비는 금20~140이며, 성적에 따라 금과 약간의 명성이 포상으로 주어집니다.<br />
            ㆍ16강자 100, 8강자 300, 4강자 600, 준우승자 1200, 우승자 2000 (220년 기준)<br />
            ㆍ즐거운 삼토!
        </section>
        <input type="hidden" name="tournamentAction" value="join" />
        <footer class="tournament-footer bg0">
            <RouterLink v-slot="{ navigate }" custom to="/">
                <button class="close-button" type="button" @click="navigate">창 닫기</button>
            </RouterLink>
            <small>
                삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD(hided62@gmail.com) / Credit
            </small>
        </footer>

        <section v-if="adminEnabled" class="admin-row bg0">
            <strong>관리자 메뉴</strong>
            <button type="button" @click="start">개최</button>
            <button type="button" @click="cancel">중단</button>
        </section>
    </main>
</template>

<style scoped>
.legacy-page {
    width: 100%;
    max-width: 1200px;
    min-width: 0;
    min-height: 100vh;
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
    text-align: center;
}
.tournament-guide,
.tournament-footer {
    text-align: left;
}
.tournament-guide {
    font-size: 12px;
    line-height: 14px;
}
.tournament-footer {
    padding-top: 10px;
}
.tournament-footer small {
    display: block;
}
.legacy-page,
.legacy-page * {
    box-sizing: border-box;
}
.bg0 {
    background: #3a2118 var(--sammo-texture-walnut);
}
.bg2 {
    background: #142b42 var(--sammo-texture-blue);
}
.toolbar {
    min-height: 46px;
    padding: 1px;
}
.toolbar button {
    min-width: 72px;
    height: 44px;
    padding: 10px 16px;
    font-size: 14px;
}
.operator-row,
.state-row,
.error-row,
.admin-row {
    min-height: 32px;
    padding: 5px;
}
button {
    height: 35.5px;
    margin: 0 2px;
    border: 1px solid #666;
    border-radius: 5.25px;
    background: #444;
    color: #fff;
    cursor: pointer;
}
button:hover,
button:focus {
    filter: brightness(1.25);
}
button:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}
.join-button {
    background: #8a5b13;
}
.operator-row span {
    color: orange;
    font-size: 24px;
}
.state-row {
    font-size: 24px;
}
.state-row .type {
    color: cyan;
}
.section-title {
    min-height: 38px;
    padding: 5px;
    color: magenta;
    font-size: 24px;
}
.fight {
    padding: 8px;
    text-align: left;
}
.fight h2 {
    margin: 0;
    text-align: center;
    color: orange;
    font-size: 18px;
}
.fight p {
    margin: 2px 10px;
}
.groups-title {
    color: orange;
}
.group-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: start;
    gap: 8px;
    padding: 8px;
}
table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}
caption {
    padding: 3px;
    background: #000;
    color: #fff;
}
th {
    background: #154b2a var(--sammo-texture-green);
    font-weight: 400;
}
th,
td {
    height: 30px;
    border: 1px solid #555;
    padding: 1px 3px;
}
.group-grid th:first-child,
.group-grid td:first-child {
    width: 24px;
}
.group-grid th:nth-child(2),
.group-grid td:nth-child(2) {
    width: 130px;
}
.general-cell {
    overflow: hidden;
    text-align: left;
}
.group-grid tbody tr:has(.general-identity) td {
    height: 66px;
}
.group-tabs {
    display: none;
}
.admin-row {
    text-align: left;
}
.error-row {
    color: #ff8080;
}
@media (max-width: 800px) {
    .legacy-page {
        max-width: 100%;
        font-size: 13px;
    }
    .state-row {
        font-size: 18px;
    }
    .section-title {
        font-size: 20px;
    }
    .group-tabs {
        display: grid;
        grid-template-columns: repeat(8, minmax(44px, 1fr));
        overflow-x: auto;
        padding: 6px;
        gap: 4px;
    }
    .group-tabs button {
        min-width: 44px;
        height: 34px;
        margin: 0;
        border-radius: 3px;
    }
    .group-tabs button.active {
        border-color: #f39c12;
        background: #8a5b13;
        color: #fff;
    }
    .group-grid {
        display: block;
        overflow-x: auto;
        padding: 6px 0;
    }
    .group-grid table {
        display: none;
        min-width: 370px;
    }
    .group-grid table.mobile-active {
        display: table;
    }
    .group-grid th,
    .group-grid td {
        height: 31px;
        padding: 1px;
        font-size: 11px;
    }
    .group-grid th:first-child,
    .group-grid td:first-child {
        width: 22px;
    }
    .group-grid th:nth-child(2),
    .group-grid td:nth-child(2) {
        width: 138px;
    }
    .tournament-guide {
        padding: 10px;
        font-size: 11px;
        line-height: 16px;
    }
    .tournament-footer {
        padding: 10px 0 0;
    }
    .tournament-footer small {
        white-space: normal;
    }
}
</style>
