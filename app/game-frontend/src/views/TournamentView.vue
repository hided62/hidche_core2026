<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';

type TournamentSnapshot = Awaited<ReturnType<typeof trpc.tournament.getSnapshot.query>>;
type TournamentBettingSummary = Awaited<ReturnType<typeof trpc.tournament.getBettingSummary.query>>;
type GeneralMe = Awaited<ReturnType<typeof trpc.general.me.query>>;

const isMobile = useMediaQuery('(max-width: 1024px)');

const loading = ref(false);
const error = ref<string | null>(null);
const snapshot = ref<TournamentSnapshot | null>(null);
const bettingSummary = ref<TournamentBettingSummary | null>(null);
const myGeneral = ref<GeneralMe | null>(null);
const lastActionMessage = ref<string | null>(null);
const adminEnabled = ref(false);

const mobileTabs = [
    { key: 'status', label: '상태' },
    { key: 'bracket', label: '대진' },
    { key: 'betting', label: '베팅' },
] as const;

type MobileTabKey = (typeof mobileTabs)[number]['key'];
const mobileTab = ref<MobileTabKey>('status');

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const loadTournament = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;
    lastActionMessage.value = null;

    try {
        const [snapshotResult, bettingResult, generalResult, adminResult] = await Promise.all([
            trpc.tournament.getSnapshot.query(),
            trpc.tournament.getBettingSummary.query(),
            trpc.general.me.query(),
            trpc.tournament.getAdminStatus.query().catch(() => null),
        ]);
        snapshot.value = snapshotResult;
        bettingSummary.value = bettingResult;
        myGeneral.value = generalResult;
        adminEnabled.value = !!adminResult?.ok;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

onMounted(() => {
    void loadTournament();
});

const stageLabelMap: Record<number, string> = {
    0: '경기 없음',
    1: '참가 모집중',
    2: '예선 진행중',
    3: '본선 추첨중',
    4: '본선 진행중',
    5: '16강 배정중',
    6: '베팅 진행중',
    7: '16강 진행중',
    8: '8강 진행중',
    9: '4강 진행중',
    10: '결승 진행중',
};

const typeLabelMap: Record<number, string> = {
    0: '전력전',
    1: '통솔전',
    2: '일기토',
    3: '설전',
};

const stageLabel = computed(() => {
    const state = snapshot.value?.state;
    if (!state) {
        return '토너먼트 정보를 불러오는 중';
    }
    if (state.stage === 2 || state.stage === 4) {
        return `예선 진행중(페이즈 ${state.phase + 1})`;
    }
    return stageLabelMap[state.stage] ?? '토너먼트 상태 확인 중';
});

const bettingCloseLabel = computed(() => {
    const closeAt = snapshot.value?.state?.bettingCloseAt;
    if (!closeAt) {
        return null;
    }
    const date = new Date(closeAt);
    if (!Number.isFinite(date.getTime())) {
        return null;
    }
    return `${date.toLocaleString('ko-KR')} 마감`;
});

const bracketEntries = computed(() => {
    const matches = snapshot.value?.matches ?? [];
    const participants = snapshot.value?.participants ?? [];
    const nameMap = new Map(participants.map((entry) => [entry.id, entry.name]));

    return matches.map((match) => ({
        ...match,
        attackerName: nameMap.get(match.attackerId) ?? `#${match.attackerId}`,
        defenderName: nameMap.get(match.defenderId) ?? `#${match.defenderId}`,
        winnerName: match.winnerId ? nameMap.get(match.winnerId) ?? `#${match.winnerId}` : null,
    }));
});

const stageMatches = (stage: number) => bracketEntries.value.filter((match) => match.stage === stage);

const currentMatch = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage < 7 || state.stage > 10) {
        return null;
    }
    const matches = stageMatches(state.stage).sort((lhs, rhs) => lhs.roundIndex - rhs.roundIndex);
    if (matches.length === 0) {
        return null;
    }
    const fallbackIndex = Math.min(state.phase, matches.length - 1);
    return matches[fallbackIndex] ?? matches.find((match) => !match.winnerId) ?? matches[0];
});

const currentEnergy = computed(() => {
    const match = currentMatch.value;
    if (!match) {
        return null;
    }
    if (match.lastEnergy) {
        return match.lastEnergy;
    }
    const lastEntry = match.logEntries?.[match.logEntries.length - 1];
    if (lastEntry) {
        return { attacker: lastEntry.attackerEnergy, defender: lastEntry.defenderEnergy };
    }
    return null;
});

const currentEnergyStats = computed(() => {
    const match = currentMatch.value;
    if (!match) {
        return null;
    }
    const lastEnergy = currentEnergy.value;
    if (!lastEnergy) {
        return null;
    }
    let maxAttacker = lastEnergy.attacker;
    let maxDefender = lastEnergy.defender;
    if (match.logEntries && match.logEntries.length > 0) {
        for (const entry of match.logEntries) {
            if (entry.attackerEnergy > maxAttacker) {
                maxAttacker = entry.attackerEnergy;
            }
            if (entry.defenderEnergy > maxDefender) {
                maxDefender = entry.defenderEnergy;
            }
        }
    }
    return {
        attacker: lastEnergy.attacker,
        defender: lastEnergy.defender,
        maxAttacker: Math.max(1, maxAttacker),
        maxDefender: Math.max(1, maxDefender),
    };
});

const attackerEnergyPercent = computed(() => {
    const stats = currentEnergyStats.value;
    if (!stats) {
        return 0;
    }
    return Math.max(0, Math.min(100, (stats.attacker / stats.maxAttacker) * 100));
});

const defenderEnergyPercent = computed(() => {
    const stats = currentEnergyStats.value;
    if (!stats) {
        return 0;
    }
    return Math.max(0, Math.min(100, (stats.defender / stats.maxDefender) * 100));
});
const formattedLogs = computed(() => currentMatch.value?.log ?? []);

const finalists = computed(() => {
    const matches = stageMatches(7);
    const ids = new Set<number>();
    for (const match of matches) {
        ids.add(match.attackerId);
        ids.add(match.defenderId);
    }
    return Array.from(ids);
});

const finalistOptions = computed(() => {
    const participants = snapshot.value?.participants ?? [];
    const nameMap = new Map(participants.map((entry) => [entry.id, entry.name]));
    return finalists.value.map((id) => ({ id, name: nameMap.get(id) ?? `#${id}` }));
});

const myGeneralId = computed(() => myGeneral.value?.general?.id ?? 0);
const isParticipant = computed(() => {
    if (!myGeneralId.value) {
        return false;
    }
    return (snapshot.value?.participants ?? []).some((entry) => entry.id === myGeneralId.value);
});

const showJoinButton = computed(() => snapshot.value?.state?.stage === 1);
const joinLockedAt = computed(() => snapshot.value?.state?.participantsLockedAt ?? null);

const betTargetId = ref<number>(0);
const betAmount = ref<number>(0);

const isBettingOpen = computed(() => {
    const state = snapshot.value?.state;
    if (!state || state.stage !== 6) {
        return false;
    }
    if (!state.bettingCloseAt) {
        return true;
    }
    const closeAt = new Date(state.bettingCloseAt).getTime();
    return Number.isFinite(closeAt) ? Date.now() < closeAt : true;
});

const placeBet = async () => {
    if (!betTargetId.value || betAmount.value <= 0) {
        lastActionMessage.value = '베팅 대상과 금액을 입력하세요.';
        return;
    }
    try {
        await trpc.tournament.placeBet.mutate({ targetId: betTargetId.value, amount: betAmount.value });
        lastActionMessage.value = '베팅이 등록되었습니다.';
        await loadTournament();
    } catch (err) {
        lastActionMessage.value = resolveErrorMessage(err);
    }
};

const toggleJoin = async () => {
    try {
        await trpc.tournament.join.mutate();
        lastActionMessage.value = '참가 신청이 반영되었습니다.';
        await loadTournament();
    } catch (err) {
        lastActionMessage.value = resolveErrorMessage(err);
    }
};

const bettingTotals = computed<Record<number, number>>(() => bettingSummary.value?.totals ?? {});
const bettingMine = computed<Record<number, number>>(() => bettingSummary.value?.myTotals ?? {});
const totalBetAmount = computed(() => bettingSummary.value?.totalAmount ?? 0);
const myBetAmount = computed(() => bettingSummary.value?.myAmount ?? 0);

const progressSummary = computed(() => {
    return {
        participants: snapshot.value?.participants?.length ?? 0,
        matches: snapshot.value?.matches?.length ?? 0,
        bets: snapshot.value?.bets?.length ?? 0,
        nextAt: snapshot.value?.state?.nextAt ?? null,
        lockedAt: snapshot.value?.state?.participantsLockedAt ?? null,
    };
});

const adminMessage = ref<string | null>(null);

const adminStopTournament = async () => {
    try {
        await trpc.tournament.cancel.mutate();
        adminMessage.value = '토너먼트가 취소되었습니다.';
        await loadTournament();
    } catch (err) {
        adminMessage.value = resolveErrorMessage(err);
    }
};

const adminStartTournament = async () => {
    const current = snapshot.value?.state;
    if (!current) {
        adminMessage.value = '토너먼트 상태를 찾을 수 없습니다.';
        return;
    }
    try {
        await Promise.all([
            trpc.tournament.setParticipants.mutate([]),
            trpc.tournament.setMatches.mutate([]),
            trpc.tournament.setBettingEntries.mutate([]),
        ]);
        await trpc.tournament.setState.mutate({
            ...current,
            stage: 1,
            phase: 0,
            auto: true,
            nextAt: new Date().toISOString(),
            bettingId: undefined,
            bettingCloseAt: undefined,
            winnerId: undefined,
            bettingSettled: false,
            rewardSettled: false,
            participantsLockedAt: undefined,
        });
        adminMessage.value = '임의 개최가 시작되었습니다.';
        await loadTournament();
    } catch (err) {
        adminMessage.value = resolveErrorMessage(err);
    }
};
</script>

<template>
    <main class="tournament-page">
        <header class="page-header">
            <div>
                <h1 class="page-title">토너먼트</h1>
                <p class="page-subtitle">{{ stageLabel }}</p>
            </div>
            <div class="header-actions">
                <button class="ghost" @click="loadTournament">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>
        <div v-if="lastActionMessage" class="notice">{{ lastActionMessage }}</div>

        <section v-if="isMobile" class="layout-mobile">
            <div class="mobile-tabs">
                <button
                    v-for="tab in mobileTabs"
                    :key="tab.key"
                    :class="{ active: mobileTab === tab.key }"
                    @click="mobileTab = tab.key"
                >
                    {{ tab.label }}
                </button>
            </div>

            <div v-if="mobileTab === 'status'" class="mobile-panel">
                <PanelCard title="토너먼트 상태" :subtitle="bettingCloseLabel ?? undefined">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else class="status-grid">
                        <div>종목: {{ typeLabelMap[snapshot?.state?.type ?? 0] }}</div>
                        <div>개최: {{ snapshot?.state?.openYear ?? '-' }}년 {{ snapshot?.state?.openMonth ?? '-' }}월</div>
                        <div>페이즈: {{ snapshot?.state?.phase ?? '-' }}</div>
                        <div>자동 진행: {{ snapshot?.state?.auto ? 'ON' : 'OFF' }}</div>
                    </div>
                    <div class="status-actions">
                        <button
                            v-if="showJoinButton"
                            class="ghost"
                            :disabled="isParticipant"
                            @click="toggleJoin"
                        >
                            {{ isParticipant ? '참가 완료' : '참가 신청' }}
                        </button>
                        <span v-else class="muted">참가 신청 기간이 아닙니다.</span>
                        <span v-if="joinLockedAt" class="muted">
                            접수 종료: {{ new Date(joinLockedAt).toLocaleString('ko-KR') }}
                        </span>
                    </div>
                </PanelCard>

                <PanelCard v-if="adminEnabled" title="관리자 진행 상황">
                    <div class="status-grid">
                        <div>참가자: {{ progressSummary.participants }}</div>
                        <div>대진: {{ progressSummary.matches }}</div>
                        <div>베팅: {{ progressSummary.bets }}</div>
                        <div>다음 진행: {{ progressSummary.nextAt ? new Date(progressSummary.nextAt).toLocaleString('ko-KR') : '-' }}</div>
                        <div>접수 종료: {{ progressSummary.lockedAt ? new Date(progressSummary.lockedAt).toLocaleString('ko-KR') : '-' }}</div>
                    </div>
                    <div class="status-actions">
                        <button class="ghost" @click="adminStopTournament">중지</button>
                        <button class="ghost" @click="adminStartTournament">임의 개최</button>
                        <span v-if="adminMessage" class="muted">{{ adminMessage }}</span>
                    </div>
                </PanelCard>

                <PanelCard title="현재 전투 정보">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else>
                        <div v-if="currentMatch" class="match-summary">
                            <div class="match-title">
                                {{ currentMatch.attackerName }} vs {{ currentMatch.defenderName }}
                            </div>
                            <div class="match-meta">
                                남은 체력: {{ currentEnergy?.attacker ?? '-' }} / {{ currentEnergy?.defender ?? '-' }}
                            </div>
                            <div v-if="currentEnergyStats" class="energy-bars">
                                <div class="energy-row">
                                    <span class="energy-label">공격</span>
                                    <div class="energy-track">
                                        <div class="energy-fill attacker" :style="{ width: `${attackerEnergyPercent}%` }" />
                                    </div>
                                    <span class="energy-value">{{ currentEnergyStats.attacker }}</span>
                                </div>
                                <div class="energy-row">
                                    <span class="energy-label">수비</span>
                                    <div class="energy-track">
                                        <div class="energy-fill defender" :style="{ width: `${defenderEnergyPercent}%` }" />
                                    </div>
                                    <span class="energy-value">{{ currentEnergyStats.defender }}</span>
                                </div>
                            </div>
                            <div class="log-box">
                                <div
                                    v-for="(entry, idx) in formattedLogs"
                                    :key="idx"
                                    class="log-line"
                                    v-text="entry"
                                />
                            </div>
                        </div>
                        <div v-else class="placeholder">현재 진행 중인 전투가 없습니다.</div>
                    </div>
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'bracket'" class="mobile-panel">
                <PanelCard title="토너먼트 진출 정보" subtitle="16강 기준">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="candidate-list">
                        <div
                            v-for="entry in stageMatches(7)"
                            :key="entry.id"
                            class="match-row"
                        >
                            <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                            <span class="vs">vs</span>
                            <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="토너먼트 진행">
                    <div class="bracket-section">
                        <h3>8강</h3>
                        <div v-if="stageMatches(8).length === 0" class="placeholder">진행 대기</div>
                        <div v-else>
                            <div v-for="entry in stageMatches(8)" :key="entry.id" class="match-row">
                                <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                                <span class="vs">vs</span>
                                <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="bracket-section">
                        <h3>4강</h3>
                        <div v-if="stageMatches(9).length === 0" class="placeholder">진행 대기</div>
                        <div v-else>
                            <div v-for="entry in stageMatches(9)" :key="entry.id" class="match-row">
                                <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                                <span class="vs">vs</span>
                                <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="bracket-section">
                        <h3>결승</h3>
                        <div v-if="stageMatches(10).length === 0" class="placeholder">진행 대기</div>
                        <div v-else>
                            <div v-for="entry in stageMatches(10)" :key="entry.id" class="match-row">
                                <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                                <span class="vs">vs</span>
                                <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                            </div>
                        </div>
                    </div>
                </PanelCard>
            </div>

            <div v-if="mobileTab === 'betting'" class="mobile-panel">
                <PanelCard title="베팅 현황" :subtitle="bettingCloseLabel ?? undefined">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else>
                        <div class="status-grid">
                            <div>전체 베팅: {{ totalBetAmount.toLocaleString('ko-KR') }}</div>
                            <div>내 베팅: {{ myBetAmount.toLocaleString('ko-KR') }}</div>
                        </div>
                        <div class="betting-grid">
                            <div v-for="entry in finalistOptions" :key="entry.id" class="betting-row">
                                <span>{{ entry.name }}</span>
                                <span class="muted">전체 {{ (bettingTotals[entry.id] ?? 0).toLocaleString('ko-KR') }}</span>
                                <span class="muted">내 {{ (bettingMine[entry.id] ?? 0).toLocaleString('ko-KR') }}</span>
                            </div>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="베팅하기">
                    <div v-if="!isBettingOpen" class="placeholder">베팅 기간이 아닙니다.</div>
                    <div v-else class="bet-form">
                        <label>
                            대상
                            <select v-model.number="betTargetId">
                                <option :value="0">선택</option>
                                <option v-for="entry in finalistOptions" :key="entry.id" :value="entry.id">
                                    {{ entry.name }}
                                </option>
                            </select>
                        </label>
                        <label>
                            금액
                            <input v-model.number="betAmount" type="number" min="1" />
                        </label>
                        <button class="ghost" @click="placeBet">베팅 등록</button>
                    </div>
                </PanelCard>
            </div>
        </section>

        <section v-else class="layout-desktop">
            <div class="stack">
                <PanelCard title="토너먼트 상태" :subtitle="bettingCloseLabel ?? undefined">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else class="status-grid">
                        <div>종목: {{ typeLabelMap[snapshot?.state?.type ?? 0] }}</div>
                        <div>개최: {{ snapshot?.state?.openYear ?? '-' }}년 {{ snapshot?.state?.openMonth ?? '-' }}월</div>
                        <div>페이즈: {{ snapshot?.state?.phase ?? '-' }}</div>
                        <div>자동 진행: {{ snapshot?.state?.auto ? 'ON' : 'OFF' }}</div>
                    </div>
                    <div class="status-actions">
                        <button
                            v-if="showJoinButton"
                            class="ghost"
                            :disabled="isParticipant"
                            @click="toggleJoin"
                        >
                            {{ isParticipant ? '참가 완료' : '참가 신청' }}
                        </button>
                        <span v-else class="muted">참가 신청 기간이 아닙니다.</span>
                        <span v-if="joinLockedAt" class="muted">
                            접수 종료: {{ new Date(joinLockedAt).toLocaleString('ko-KR') }}
                        </span>
                    </div>
                </PanelCard>

                <PanelCard v-if="adminEnabled" title="관리자 진행 상황">
                    <div class="status-grid">
                        <div>참가자: {{ progressSummary.participants }}</div>
                        <div>대진: {{ progressSummary.matches }}</div>
                        <div>베팅: {{ progressSummary.bets }}</div>
                        <div>다음 진행: {{ progressSummary.nextAt ? new Date(progressSummary.nextAt).toLocaleString('ko-KR') : '-' }}</div>
                        <div>접수 종료: {{ progressSummary.lockedAt ? new Date(progressSummary.lockedAt).toLocaleString('ko-KR') : '-' }}</div>
                    </div>
                    <div class="status-actions">
                        <button class="ghost" @click="adminStopTournament">중지</button>
                        <button class="ghost" @click="adminStartTournament">임의 개최</button>
                        <span v-if="adminMessage" class="muted">{{ adminMessage }}</span>
                    </div>
                </PanelCard>

                <PanelCard title="현재 전투 정보">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else>
                        <div v-if="currentMatch" class="match-summary">
                            <div class="match-title">
                                {{ currentMatch.attackerName }} vs {{ currentMatch.defenderName }}
                            </div>
                            <div class="match-meta">
                                남은 체력: {{ currentEnergy?.attacker ?? '-' }} / {{ currentEnergy?.defender ?? '-' }}
                            </div>
                            <div v-if="currentEnergyStats" class="energy-bars">
                                <div class="energy-row">
                                    <span class="energy-label">공격</span>
                                    <div class="energy-track">
                                        <div class="energy-fill attacker" :style="{ width: `${attackerEnergyPercent}%` }" />
                                    </div>
                                    <span class="energy-value">{{ currentEnergyStats.attacker }}</span>
                                </div>
                                <div class="energy-row">
                                    <span class="energy-label">수비</span>
                                    <div class="energy-track">
                                        <div class="energy-fill defender" :style="{ width: `${defenderEnergyPercent}%` }" />
                                    </div>
                                    <span class="energy-value">{{ currentEnergyStats.defender }}</span>
                                </div>
                            </div>
                            <div class="log-box">
                                <div
                                    v-for="(entry, idx) in formattedLogs"
                                    :key="idx"
                                    class="log-line"
                                    v-text="entry"
                                />
                            </div>
                        </div>
                        <div v-else class="placeholder">현재 진행 중인 전투가 없습니다.</div>
                    </div>
                </PanelCard>

                <PanelCard title="예선 참가자" subtitle="간단 목록">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="participant-grid">
                        <div v-for="entry in snapshot?.participants ?? []" :key="entry.id" class="participant-item">
                            <div class="participant-name">{{ entry.name }}</div>
                            <div class="muted">통{{ entry.leadership }} / 무{{ entry.strength }} / 지{{ entry.intel }}</div>
                        </div>
                    </div>
                </PanelCard>
            </div>

            <div class="stack">
                <PanelCard title="토너먼트 진출 정보" subtitle="16강 기준">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="candidate-list">
                        <div
                            v-for="entry in stageMatches(7)"
                            :key="entry.id"
                            class="match-row"
                        >
                            <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                            <span class="vs">vs</span>
                            <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="토너먼트 진행">
                    <div class="bracket-section">
                        <h3>8강</h3>
                        <div v-if="stageMatches(8).length === 0" class="placeholder">진행 대기</div>
                        <div v-else>
                            <div v-for="entry in stageMatches(8)" :key="entry.id" class="match-row">
                                <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                                <span class="vs">vs</span>
                                <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="bracket-section">
                        <h3>4강</h3>
                        <div v-if="stageMatches(9).length === 0" class="placeholder">진행 대기</div>
                        <div v-else>
                            <div v-for="entry in stageMatches(9)" :key="entry.id" class="match-row">
                                <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                                <span class="vs">vs</span>
                                <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="bracket-section">
                        <h3>결승</h3>
                        <div v-if="stageMatches(10).length === 0" class="placeholder">진행 대기</div>
                        <div v-else>
                            <div v-for="entry in stageMatches(10)" :key="entry.id" class="match-row">
                                <span :class="{ winner: entry.winnerId === entry.attackerId }">{{ entry.attackerName }}</span>
                                <span class="vs">vs</span>
                                <span :class="{ winner: entry.winnerId === entry.defenderId }">{{ entry.defenderName }}</span>
                            </div>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="베팅 현황" :subtitle="bettingCloseLabel ?? undefined">
                    <SkeletonLines v-if="loading" :lines="3" />
                    <div v-else>
                        <div class="status-grid">
                            <div>전체 베팅: {{ totalBetAmount.toLocaleString('ko-KR') }}</div>
                            <div>내 베팅: {{ myBetAmount.toLocaleString('ko-KR') }}</div>
                        </div>
                        <div class="betting-grid">
                            <div v-for="entry in finalistOptions" :key="entry.id" class="betting-row">
                                <span>{{ entry.name }}</span>
                                <span class="muted">전체 {{ (bettingTotals[entry.id] ?? 0).toLocaleString('ko-KR') }}</span>
                                <span class="muted">내 {{ (bettingMine[entry.id] ?? 0).toLocaleString('ko-KR') }}</span>
                            </div>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="베팅하기">
                    <div v-if="!isBettingOpen" class="placeholder">베팅 기간이 아닙니다.</div>
                    <div v-else class="bet-form">
                        <label>
                            대상
                            <select v-model.number="betTargetId">
                                <option :value="0">선택</option>
                                <option v-for="entry in finalistOptions" :key="entry.id" :value="entry.id">
                                    {{ entry.name }}
                                </option>
                            </select>
                        </label>
                        <label>
                            금액
                            <input v-model.number="betAmount" type="number" min="1" />
                        </label>
                        <button class="ghost" @click="placeBet">베팅 등록</button>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.tournament-page {
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
    background: rgba(16, 16, 16, 0.6);
    color: inherit;
}

.ghost:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.notice {
    color: #f5d08a;
    font-size: 0.85rem;
}

.layout-desktop {
    display: grid;
    grid-template-columns: minmax(320px, 1.2fr) minmax(320px, 1fr);
    gap: 16px;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.layout-mobile {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.mobile-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
}

.mobile-tabs button {
    padding: 6px 4px;
    border: 1px solid rgba(201, 164, 90, 0.4);
    font-size: 0.75rem;
    cursor: pointer;
    background: rgba(16, 16, 16, 0.6);
    color: inherit;
}

.mobile-tabs button.active {
    background: rgba(201, 164, 90, 0.2);
}

.mobile-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
}

.status-actions {
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.muted {
    color: rgba(232, 221, 196, 0.7);
    font-size: 0.85rem;
}

.match-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.match-title {
    font-weight: 600;
}

.match-meta {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.energy-bars {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.energy-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
}

.energy-label {
    width: 36px;
    color: rgba(232, 221, 196, 0.7);
}

.energy-track {
    height: 8px;
    background: rgba(201, 164, 90, 0.15);
    border-radius: 999px;
    overflow: hidden;
}

.energy-fill {
    height: 100%;
    border-radius: 999px;
}

.energy-fill.attacker {
    background: linear-gradient(90deg, rgba(245, 184, 101, 0.9), rgba(245, 184, 101, 0.4));
}

.energy-fill.defender {
    background: linear-gradient(90deg, rgba(120, 170, 255, 0.9), rgba(120, 170, 255, 0.4));
}

.energy-value {
    width: 40px;
    text-align: right;
    color: rgba(232, 221, 196, 0.8);
}

.log-box {
    padding: 8px;
    border: 1px solid rgba(201, 164, 90, 0.2);
    background: rgba(12, 12, 12, 0.6);
    max-height: 240px;
    overflow: auto;
}

.log-line {
    font-size: 0.8rem;
    line-height: 1.4;
}

.candidate-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.match-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.9rem;
}

.match-row .vs {
    color: rgba(232, 221, 196, 0.6);
}

.winner {
    color: #f5d08a;
    font-weight: 600;
}

.bracket-section {
    margin-bottom: 12px;
}

.bracket-section h3 {
    font-size: 0.9rem;
    margin-bottom: 6px;
}

.participant-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
}

.participant-item {
    border: 1px solid rgba(201, 164, 90, 0.2);
    padding: 8px;
    background: rgba(12, 12, 12, 0.5);
}

.participant-name {
    font-weight: 600;
}

.betting-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
}

.betting-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    font-size: 0.85rem;
}

.bet-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.bet-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
}

.bet-form input,
.bet-form select {
    padding: 6px;
    background: rgba(16, 16, 16, 0.6);
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: inherit;
}

.placeholder {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}
</style>