<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useGameFeedback } from '../composables/useGameFeedback';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import MapViewer from '../components/main/MapViewer.vue';
import { trpc } from '../utils/trpc';
import { useSessionStore } from '../stores/session';
import { cityLevelMap, formatOfficerLevelText, regionMap } from '../utils/nationFormat';
import { getNpcColor } from '../utils/npcColor';
import { formatSeoulDateTime } from '../utils/legacyDateTime';
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import { abilityLeadint, abilityLeadpow, abilityPowint, abilityRand, type GeneralStats } from '../utils/generalStats';
import { legacyLuminanceTextColor } from '../utils/legacyNationColor';

type JoinConfig = Awaited<ReturnType<typeof trpc.join.getConfig.query>>;
type JoinInput = Parameters<typeof trpc.join.createGeneral.mutate>[0];
type PossessReservation = Awaited<ReturnType<typeof trpc.join.listPossessCandidates.mutate>>;
type PossessCandidate = PossessReservation['candidates'][number];
type NpcGeneralList = Awaited<ReturnType<typeof trpc.public.getNpcList.query>>;
type PublicMap = Awaited<ReturnType<typeof trpc.public.getCachedMap.query>>;
type MapLayout = Awaited<ReturnType<typeof trpc.public.getMapLayout.query>>;
type PublicGeneral = Awaited<ReturnType<typeof trpc.public.getGeneralList.query>>[number];
type NpcGeneralRow = NpcGeneralList['generals'][number] & {
    reservationState: 0 | 1 | 2;
    keepCount: number | null;
};
type JoinForm = Omit<JoinInput, 'inheritBonusStat' | 'clientRequestId'> & {
    inheritBonusStat: [number, number, number];
};
type PendingJoinAction = {
    ownerUserId: string;
    input: JoinForm;
    clientRequestId: string;
};
type PendingPossessAction = {
    ownerUserId: string;
    generalId: number;
    tokenNonce: number;
    clientRequestId: string;
};

const router = useRouter();
const route = useRoute();
const session = useSessionStore();
const { error: showErrorToast, showDialog } = useGameFeedback();

const loading = ref(true);
const error = ref<string | null>(null);
const submitting = ref(false);

const joinConfig = ref<JoinConfig | null>(null);
const accountIcons = computed(() => joinConfig.value?.user.icons ?? []);
const activeTab = ref<'create' | 'possess'>('create');
const contextTab = ref<'invitation' | 'map' | 'generals'>('invitation');
const inheritOpen = ref(false);
const pendingJoinStorageKey = 'sammo-join-create-pending-action';
const pendingPossessStorageKey = 'sammo-npc-possess-pending-action';

const form = ref<JoinForm>({
    name: '',
    leadership: 0,
    strength: 0,
    intel: 0,
    character: 'Random',
    pic: false,
    iconId: undefined,
    inheritBonusStat: [0, 0, 0],
});

const readPendingJoin = (): PendingJoinAction | null => {
    try {
        const raw = window.sessionStorage.getItem(pendingJoinStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<PendingJoinAction>;
        if (
            !value.input ||
            typeof value.input !== 'object' ||
            typeof value.ownerUserId !== 'string' ||
            typeof value.clientRequestId !== 'string'
        ) {
            return null;
        }
        return value as PendingJoinAction;
    } catch {
        return null;
    }
};

const cloneJoinInput = (): JoinForm => JSON.parse(JSON.stringify(form.value)) as JoinForm;

const getPendingJoin = (): PendingJoinAction => {
    const input = cloneJoinInput();
    const current = readPendingJoin();
    const ownerUserId = joinConfig.value?.user.id ?? '';
    if (current && current.ownerUserId === ownerUserId && JSON.stringify(current.input) === JSON.stringify(input)) {
        return current;
    }
    const pending: PendingJoinAction = {
        ownerUserId,
        input,
        clientRequestId: crypto.randomUUID(),
    };
    window.sessionStorage.setItem(pendingJoinStorageKey, JSON.stringify(pending));
    return pending;
};

const clearPendingJoin = (pending: PendingJoinAction): void => {
    if (readPendingJoin()?.clientRequestId === pending.clientRequestId) {
        window.sessionStorage.removeItem(pendingJoinStorageKey);
    }
};

const readPendingPossess = (): PendingPossessAction | null => {
    try {
        const raw = window.sessionStorage.getItem(pendingPossessStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<PendingPossessAction>;
        if (
            typeof value.ownerUserId !== 'string' ||
            typeof value.generalId !== 'number' ||
            typeof value.tokenNonce !== 'number' ||
            typeof value.clientRequestId !== 'string'
        ) {
            return null;
        }
        return value as PendingPossessAction;
    } catch {
        return null;
    }
};

const getPendingPossess = (generalId: number, tokenNonce: number): PendingPossessAction => {
    const ownerUserId = joinConfig.value?.user.id ?? '';
    const current = pendingPossessAction.value ?? readPendingPossess();
    if (
        current &&
        current.ownerUserId === ownerUserId &&
        current.generalId === generalId &&
        current.tokenNonce === tokenNonce
    ) {
        return current;
    }
    const pending: PendingPossessAction = {
        ownerUserId,
        generalId,
        tokenNonce,
        clientRequestId: crypto.randomUUID(),
    };
    window.sessionStorage.setItem(pendingPossessStorageKey, JSON.stringify(pending));
    pendingPossessAction.value = pending;
    return pending;
};

const clearPendingPossess = (pending: PendingPossessAction): void => {
    if (readPendingPossess()?.clientRequestId === pending.clientRequestId) {
        window.sessionStorage.removeItem(pendingPossessStorageKey);
    }
    if (pendingPossessAction.value?.clientRequestId === pending.clientRequestId) {
        pendingPossessAction.value = null;
    }
};

const isIndeterminateTimeout = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || !('data' in value)) return false;
    const data = value.data;
    return Boolean(data && typeof data === 'object' && 'code' in data && data.code === 'TIMEOUT');
};

const isTrpcBusinessError = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || !('data' in value)) return false;
    const data = value.data;
    return Boolean(data && typeof data === 'object' && 'code' in data && typeof data.code === 'string');
};

const npcImageUrl = (candidate: { picture: string | null; imageServer: number }): string =>
    resolveGeneralIconUrl(candidate);

const npcReservation = ref<PossessReservation | null>(null);
const npcLoading = ref(false);
const npcError = ref<string | null>(null);
const keptNpcIds = ref<number[]>([]);
const nowMs = ref(Date.now());
const npcPickMoreAvailableAtMs = ref(0);
const pendingPossessAction = ref<PendingPossessAction | null>(null);
const npcGeneralList = ref<NpcGeneralList | null>(null);
const npcGeneralListLoading = ref(false);
const npcGeneralListError = ref('');
const npcGeneralListVisibleCount = ref(50);
const publicMap = ref<PublicMap | null>(null);
const mapLayout = ref<MapLayout | null>(null);
const mapLoaded = ref(false);
const mapLoading = ref(false);
const mapError = ref('');
const publicGenerals = ref<PublicGeneral[]>([]);
const publicGeneralsLoaded = ref(false);
const publicGeneralsLoading = ref(false);
const publicGeneralsError = ref('');
const publicGeneralFilter = ref('');
let npcTimer: number | null = null;

const npcCandidates = computed<PossessCandidate[]>(() => npcReservation.value?.candidates ?? []);
const npcValidUntilMs = computed(() => {
    const value = npcReservation.value?.validUntil;
    return value ? new Date(value).getTime() : 0;
});
const npcExpired = computed(() => npcValidUntilMs.value > 0 && npcValidUntilMs.value < nowMs.value);
const npcPickMoreSeconds = computed(() =>
    Math.max(0, Math.ceil((npcPickMoreAvailableAtMs.value - nowMs.value) / 1000))
);
const hasPendingPossession = computed(
    () => pendingPossessAction.value !== null && pendingPossessAction.value.ownerUserId === joinConfig.value?.user.id
);
const isPendingPossessCandidate = (candidate: PossessCandidate): boolean => {
    const pending = pendingPossessAction.value;
    return Boolean(
        pending &&
        pending.ownerUserId === joinConfig.value?.user.id &&
        pending.generalId === candidate.id &&
        pending.tokenNonce === npcReservation.value?.tokenNonce
    );
};
const npcGeneralRows = computed<NpcGeneralRow[]>(() => {
    const list = npcGeneralList.value;
    if (!list) {
        return [];
    }
    return list.generals
        .map((general) => {
            const keepCount = list.tokenKeepCounts[String(general.id)];
            return {
                ...general,
                reservationState: general.npcState < 2 ? 2 : keepCount !== undefined ? 1 : 0,
                keepCount: keepCount ?? null,
            } as NpcGeneralRow;
        })
        .sort(
            (left, right) =>
                right.reservationState - left.reservationState ||
                right.statTotal - left.statTotal ||
                // Ref select_npc.ts has this asymmetric comparator. Keep it because the visible order is contractual.
                right.leadership - left.statTotal ||
                (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
        );
});
const visibleNpcGeneralRows = computed(() => npcGeneralRows.value.slice(0, npcGeneralListVisibleCount.value));
const filteredPublicGenerals = computed(() => {
    const keyword = publicGeneralFilter.value.trim().toLocaleLowerCase('ko-KR');
    if (!keyword) {
        return publicGenerals.value;
    }
    return publicGenerals.value.filter(
        (general) =>
            general.name.toLocaleLowerCase('ko-KR').includes(keyword) ||
            general.nationName.toLocaleLowerCase('ko-KR').includes(keyword)
    );
});
const npcValidColor = computed(() => {
    const remaining = npcValidUntilMs.value - nowMs.value;
    if (remaining > 30_000) return '#ffffff';
    const channel = Math.max(0, Math.min(255, Math.round((remaining / 30_000) * 255)));
    return `rgb(255, ${channel}, ${channel})`;
});

const statRules = computed(() => joinConfig.value?.rules.stat ?? null);
const statTotal = computed(() => form.value.leadership + form.value.strength + form.value.intel);
const statErrors = computed(() => {
    const rules = statRules.value;
    if (!rules) {
        return [] as string[];
    }
    const errors: string[] = [];
    const values = [form.value.leadership, form.value.strength, form.value.intel];
    if (values.some((value) => value < rules.min || value > rules.max)) {
        errors.push(`능력치는 ${rules.min} ~ ${rules.max} 범위여야 합니다.`);
    }
    if (statTotal.value > rules.total) {
        errors.push(`능력치 합이 ${rules.total}을 넘을 수 없습니다.`);
    }
    return errors;
});

const canSubmit = computed(() => {
    if (!statRules.value) {
        return false;
    }
    if (!form.value.name.trim()) {
        return false;
    }
    if (statErrors.value.length > 0) {
        return false;
    }
    if (inheritErrors.value.length > 0) {
        return false;
    }
    return true;
});

const nationList = computed(() => joinConfig.value?.nations ?? []);
const personalities = computed(() => joinConfig.value?.personalities ?? []);
const inheritConfig = computed(() => joinConfig.value?.inherit ?? null);

const inheritTotalPoint = computed(() => inheritConfig.value?.totalPoint ?? 0);
const inheritCosts = computed(
    () =>
        inheritConfig.value?.costs ?? {
            inheritBornSpecialPoint: 0,
            inheritBornTurntimePoint: 0,
            inheritBornCityPoint: 0,
            inheritBornStatPoint: 0,
        }
);
const inheritRequiredPoint = computed(() => {
    let total = 0;
    if (form.value.inheritSpecial) {
        total += inheritCosts.value.inheritBornSpecialPoint;
    }
    if (form.value.inheritCity !== undefined) {
        total += inheritCosts.value.inheritBornCityPoint;
    }
    if (form.value.inheritTurntimeZone !== undefined) {
        total += inheritCosts.value.inheritBornTurntimePoint;
    }
    const bonus = form.value.inheritBonusStat ?? [0, 0, 0];
    const bonusSum = bonus.reduce((acc, value) => acc + value, 0);
    if (bonusSum > 0) {
        total += inheritCosts.value.inheritBornStatPoint;
    }
    return total;
});

const inheritBonusSum = computed(() => {
    const bonus = form.value.inheritBonusStat ?? [0, 0, 0];
    return bonus.reduce((acc, value) => acc + value, 0);
});

const inheritErrors = computed(() => {
    const errors: string[] = [];
    const bonus = form.value.inheritBonusStat ?? [0, 0, 0];
    const bonusSum = bonus.reduce((acc, value) => acc + value, 0);
    if (bonusSum !== 0 && (bonusSum < 3 || bonusSum > 5)) {
        errors.push('보너스 능력치는 합 3~5 사이여야 합니다.');
    }
    if (inheritRequiredPoint.value > inheritTotalPoint.value) {
        errors.push('보유한 유산 포인트가 부족합니다.');
    }
    return errors;
});

const inheritSpecialChoice = computed<string>({
    get: () => form.value.inheritSpecial ?? '',
    set: (value) => {
        form.value.inheritSpecial = value ? value : undefined;
    },
});

const inheritCityChoice = computed<string>({
    get: () => (form.value.inheritCity !== undefined ? String(form.value.inheritCity) : ''),
    set: (value) => {
        form.value.inheritCity = value ? Number(value) : undefined;
    },
});

const inheritTurntimeChoice = computed<string>({
    get: () => (form.value.inheritTurntimeZone !== undefined ? String(form.value.inheritTurntimeZone) : ''),
    set: (value) => {
        form.value.inheritTurntimeZone = value ? Number(value) : undefined;
    },
});

const applyBalancedStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    const base = Math.floor(rules.total / 3);
    form.value.leadership = rules.total - base * 2;
    form.value.strength = base;
    form.value.intel = base;
};

const applyStats = (stats: GeneralStats) => {
    [form.value.leadership, form.value.strength, form.value.intel] = stats;
};

const applyRandomStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    applyStats(abilityRand(rules));
};

const applyLeadpowStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    applyStats(abilityLeadpow(rules));
};

const applyLeadintStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    applyStats(abilityLeadint(rules));
};

const applyPowintStats = () => {
    const rules = statRules.value;
    if (!rules) {
        return;
    }
    applyStats(abilityPowint(rules));
};

const loadConfig = async () => {
    loading.value = true;
    error.value = null;
    try {
        const config = await trpc.join.getConfig.query();
        if (config.selectionPool.enabled) {
            await router.replace({ name: 'select-general' });
            return;
        }
        joinConfig.value = config;
        const storedPossession = readPendingPossess();
        pendingPossessAction.value = storedPossession?.ownerUserId === config.user.id ? storedPossession : null;
        if (route.query.tab === 'possess' && config.npcPossession.enabled && config.user.canCreateGeneral) {
            activeTab.value = 'possess';
        }
        const pending = readPendingJoin();
        if (pending?.ownerUserId === config.user.id) {
            form.value = pending.input;
        } else {
            form.value.name = config.rules.allowCustomName ? config.user.displayName || '' : '무작위';
            form.value.iconId = config.user.icons.find((icon) => icon.picture === config.user.preferredPicture)?.id;
            form.value.pic = form.value.iconId !== undefined;
            applyBalancedStats();
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'join_config_failed';
    } finally {
        loading.value = false;
    }
};

const loadNpcCandidates = async (refresh = false) => {
    npcLoading.value = true;
    npcError.value = null;
    try {
        const reservation = await trpc.join.listPossessCandidates.mutate({
            refresh,
            ...(refresh ? { keepIds: keptNpcIds.value } : {}),
        });
        npcReservation.value = reservation;
        keptNpcIds.value = [];
        const receivedAt = Date.now();
        nowMs.value = receivedAt;
        npcPickMoreAvailableAtMs.value = receivedAt + reservation.pickMoreSeconds * 1000;
    } catch (err) {
        npcError.value = err instanceof Error ? err.message : 'npc_list_failed';
        if (refresh) {
            if (isTrpcBusinessError(err)) {
                await showDialog({
                    kind: 'error',
                    title: '빙의 대상 갱신 실패',
                    message: `${npcError.value}\n확인 후 페이지를 새로고침합니다.`,
                });
                window.location.reload();
            } else {
                showErrorToast(`빙의 대상 갱신에 실패했습니다: ${npcError.value}`);
            }
        } else if (isTrpcBusinessError(err)) {
            await showDialog({ kind: 'error', title: '빙의 대상 확인 실패', message: npcError.value });
        } else {
            showErrorToast(`빙의 대상 확인에 실패했습니다: ${npcError.value}`);
        }
    } finally {
        npcLoading.value = false;
    }
};

const submitJoin = async () => {
    if (!canSubmit.value || submitting.value) {
        return;
    }
    submitting.value = true;
    error.value = null;
    const pending = getPendingJoin();
    try {
        await trpc.join.createGeneral.mutate({
            ...pending.input,
            clientRequestId: pending.clientRequestId,
        });
        clearPendingJoin(pending);
        await showDialog({ kind: 'success', message: '장수를 생성했습니다!' });
        await session.refreshGeneralStatus();
        if (session.hasGeneral) {
            await router.push({ name: 'home' });
        }
    } catch (err) {
        if (!isIndeterminateTimeout(err)) {
            clearPendingJoin(pending);
        }
        error.value = err instanceof Error ? err.message : 'join_failed';
    } finally {
        submitting.value = false;
    }
};

const submitPossession = async (pending: PendingPossessAction) => {
    if (submitting.value) {
        return;
    }
    submitting.value = true;
    error.value = null;
    try {
        await trpc.join.possessGeneral.mutate({
            generalId: pending.generalId,
            tokenNonce: pending.tokenNonce,
            clientRequestId: pending.clientRequestId,
        });
        clearPendingPossess(pending);
        await showDialog({ kind: 'success', message: '빙의에 성공했습니다.' });
        await session.refreshGeneralStatus();
        if (session.hasGeneral) {
            await router.push({ name: 'home' });
        }
    } catch (err) {
        if (!isIndeterminateTimeout(err)) {
            clearPendingPossess(pending);
        }
        error.value = err instanceof Error ? err.message : 'possess_failed';
        if (isTrpcBusinessError(err) && !isIndeterminateTimeout(err)) {
            await showDialog({
                kind: 'error',
                title: '빙의 실패',
                message: `${error.value}\n확인 후 페이지를 새로고침합니다.`,
            });
            window.location.reload();
        } else if (!isIndeterminateTimeout(err)) {
            showErrorToast(`빙의에 실패했습니다: ${error.value}`);
        }
    } finally {
        submitting.value = false;
    }
};

const possessGeneral = async (candidate: PossessCandidate) => {
    const reservation = npcReservation.value;
    if (
        submitting.value ||
        !reservation ||
        (hasPendingPossession.value && !isPendingPossessCandidate(candidate)) ||
        !window.confirm(`빙의할까요? : ${candidate.name}`)
    ) {
        return;
    }
    await submitPossession(getPendingPossess(candidate.id, reservation.tokenNonce));
};

const retryPendingPossession = async () => {
    const pending = pendingPossessAction.value;
    if (!pending || pending.ownerUserId !== joinConfig.value?.user.id) {
        return;
    }
    await submitPossession(pending);
};

const loadNpcGeneralList = async () => {
    if (npcGeneralListLoading.value) {
        return;
    }
    npcGeneralListLoading.value = true;
    npcGeneralListError.value = '';
    try {
        npcGeneralList.value = await trpc.public.getNpcList.query({ sort: 1, includeAllWithToken: true });
        npcGeneralListVisibleCount.value = 50;
    } catch (err) {
        npcGeneralListError.value = err instanceof Error ? err.message : 'npc_general_list_failed';
        showErrorToast(`NPC 장수 목록을 불러오지 못했습니다: ${npcGeneralListError.value}`);
    } finally {
        npcGeneralListLoading.value = false;
    }
};

const loadPublicMap = async () => {
    if (mapLoading.value || mapLoaded.value) {
        return;
    }
    mapLoading.value = true;
    mapError.value = '';
    try {
        const [map, layout] = await Promise.all([trpc.public.getCachedMap.query(), trpc.public.getMapLayout.query()]);
        publicMap.value = map;
        mapLayout.value = layout;
        mapLoaded.value = true;
    } catch (err) {
        mapError.value = err instanceof Error ? err.message : 'public_map_failed';
    } finally {
        mapLoading.value = false;
    }
};

const loadPublicGenerals = async () => {
    if (publicGeneralsLoading.value || publicGeneralsLoaded.value) {
        return;
    }
    publicGeneralsLoading.value = true;
    publicGeneralsError.value = '';
    try {
        publicGenerals.value = await trpc.public.getGeneralList.query();
        publicGeneralsLoaded.value = true;
    } catch (err) {
        publicGeneralsError.value = err instanceof Error ? err.message : 'public_general_list_failed';
    } finally {
        publicGeneralsLoading.value = false;
    }
};

const onInheritanceToggle = (event: Event) => {
    inheritOpen.value = (event.currentTarget as HTMLDetailsElement).open;
};

watch(activeTab, (value) => {
    if (value === 'possess' && !npcReservation.value) {
        void loadNpcCandidates(false);
    }
});

watch(contextTab, (value) => {
    if (value === 'map') {
        void loadPublicMap();
    } else if (value === 'generals') {
        void loadPublicGenerals();
    }
});

onMounted(() => {
    npcTimer = window.setInterval(() => {
        nowMs.value = Date.now();
    }, 250);
    void loadConfig();
});

onUnmounted(() => {
    if (npcTimer !== null) {
        window.clearInterval(npcTimer);
    }
});
</script>

<template>
    <main class="join-page">
        <header class="join-header">
            <div>
                <h1 class="join-title">장수 생성/빙의</h1>
                <p class="join-subtitle">로그인 완료, 아직 장수가 없는 상태입니다.</p>
            </div>
            <div class="join-tabs">
                <RouterLink class="simulator-link" to="/past-plays">내 지난 플레이</RouterLink>
                <RouterLink class="simulator-link" to="/battle-simulator">전투 시뮬레이터</RouterLink>
                <button
                    :class="{ active: activeTab === 'create' }"
                    :disabled="joinConfig?.user.canCreateGeneral === false"
                    @click="activeTab = 'create'"
                >
                    장수 생성
                </button>
                <button
                    v-if="joinConfig?.npcPossession.enabled"
                    :class="{ active: activeTab === 'possess' }"
                    :disabled="joinConfig?.user.canCreateGeneral === false"
                    @click="activeTab = 'possess'"
                >
                    NPC 빙의
                </button>
            </div>
        </header>

        <div v-if="error" class="join-error">{{ error }}</div>

        <div v-if="loading">
            <SkeletonLines :lines="4" />
        </div>

        <section v-else-if="activeTab === 'create'" class="join-flow">
            <PanelCard title="장수 기본 정보" subtitle="장수명과 성격, 통솔·무력·지력을 먼저 결정하세요.">
                <form class="create-form" @submit.prevent="submitJoin">
                    <div class="identity-grid">
                        <label class="form-field primary-field">
                            <span>장수명</span>
                            <input
                                v-if="joinConfig?.rules.allowCustomName"
                                v-model="form.name"
                                type="text"
                                class="form-input"
                            />
                            <span v-else>무작위</span>
                        </label>
                        <label class="form-field primary-field">
                            <span>성격</span>
                            <select v-model="form.character" class="form-input">
                                <option v-for="option in personalities" :key="option.key" :value="option.key">
                                    {{ option.name }}
                                </option>
                            </select>
                            <small class="muted">{{ personalities.find((p) => p.key === form.character)?.info }}</small>
                        </label>
                    </div>

                    <div class="stat-grid">
                        <label class="form-field primary-field">
                            <span>통솔</span>
                            <input v-model.number="form.leadership" type="number" class="form-input" />
                        </label>
                        <label class="form-field primary-field">
                            <span>무력</span>
                            <input v-model.number="form.strength" type="number" class="form-input" />
                        </label>
                        <label class="form-field primary-field">
                            <span>지력</span>
                            <input v-model.number="form.intel" type="number" class="form-input" />
                        </label>
                    </div>

                    <div class="stat-actions" role="group" aria-label="능력치 빠른 설정">
                        <button class="legacy-button legacy-button--navigation" type="button" @click="applyRandomStats">
                            랜덤형
                        </button>
                        <button
                            class="legacy-button legacy-button--navigation"
                            type="button"
                            @click="applyLeadpowStats"
                        >
                            통솔무력형
                        </button>
                        <button
                            class="legacy-button legacy-button--navigation"
                            type="button"
                            @click="applyLeadintStats"
                        >
                            통솔지력형
                        </button>
                        <button class="legacy-button legacy-button--navigation" type="button" @click="applyPowintStats">
                            무력지력형
                        </button>
                    </div>

                    <div v-if="accountIcons.length" class="icon-choice">
                        <div class="bonus-title">전용 아이콘 선택</div>
                        <label class="icon-option">
                            <input v-model="form.pic" type="checkbox" /> 전용 아이콘 사용
                        </label>
                        <div v-if="form.pic" class="icon-list" role="radiogroup" aria-label="전용 아이콘 선택">
                            <label v-for="icon in accountIcons" :key="icon.id" class="icon-card">
                                <input v-model="form.iconId" type="radio" :value="icon.id" />
                                <img
                                    :src="
                                        resolveGeneralIconUrl({ picture: icon.picture, imageServer: icon.imageServer })
                                    "
                                    width="64"
                                    height="64"
                                    alt=""
                                    @error="useDefaultGeneralIcon"
                                />
                            </label>
                        </div>
                    </div>

                    <div class="stat-summary">
                        <div>
                            <strong>능력치 합계: {{ statTotal }}</strong> / {{ statRules?.total ?? '-' }}
                        </div>
                        <div v-if="statErrors.length" class="stat-errors">
                            <div v-for="item in statErrors" :key="item">{{ item }}</div>
                        </div>
                    </div>

                    <div class="form-actions">
                        <button class="primary-action" type="submit" :disabled="!canSubmit || submitting">
                            {{ submitting ? '생성 중...' : '장수 생성' }}
                        </button>
                        <button type="button" class="ghost" @click="applyBalancedStats">능력치 초기화</button>
                    </div>
                </form>
            </PanelCard>

            <details class="advanced-options" :open="inheritOpen" @toggle="onInheritanceToggle">
                <summary>
                    <span class="advanced-title">
                        <strong>고급 옵션 · 유산 포인트</strong>
                        <small>시작 특기·도시·턴 시간과 보너스 능력치를 지정합니다.</small>
                    </span>
                    <span class="advanced-point-summary">
                        보유 {{ inheritTotalPoint }} · 사용 {{ inheritRequiredPoint }}
                    </span>
                </summary>
                <div v-if="!inheritConfig" class="advanced-body muted">유산 포인트 정보를 불러오지 못했습니다.</div>
                <div v-else class="advanced-body inherit-panel">
                    <div class="inherit-summary">
                        <div>보유 포인트: {{ inheritTotalPoint }}</div>
                        <div>필요 포인트: {{ inheritRequiredPoint }}</div>
                    </div>

                    <div class="inherit-options">
                        <label class="form-field">
                            <span>전투 특기 선택</span>
                            <select v-model="inheritSpecialChoice" class="form-input">
                                <option value="">선택 안함</option>
                                <option
                                    v-for="special in inheritConfig.availableSpecialWar"
                                    :key="special.key"
                                    :value="special.key"
                                >
                                    {{ special.name }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ inheritCosts.inheritBornSpecialPoint }} 포인트</small>
                        </label>

                        <label class="form-field">
                            <span>시작 도시 지정</span>
                            <select v-model="inheritCityChoice" class="form-input">
                                <option value="">랜덤 배치</option>
                                <option
                                    v-for="city in inheritConfig.availableCities"
                                    :key="city.id"
                                    :value="String(city.id)"
                                >
                                    {{ city.name }} · {{ cityLevelMap[city.level] ?? city.level }} ·
                                    {{ regionMap[city.region] ?? city.region }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ inheritCosts.inheritBornCityPoint }} 포인트</small>
                        </label>

                        <label class="form-field">
                            <span>턴 시간대 지정</span>
                            <select v-model="inheritTurntimeChoice" class="form-input">
                                <option value="">랜덤 배치</option>
                                <option
                                    v-for="(zone, index) in inheritConfig.turnTimeZones"
                                    :key="zone"
                                    :value="String(index)"
                                >
                                    {{ zone }}
                                </option>
                            </select>
                            <small class="muted">비용 {{ inheritCosts.inheritBornTurntimePoint }} 포인트</small>
                        </label>
                    </div>

                    <div class="inherit-bonus">
                        <div class="bonus-title">보너스 능력치</div>
                        <div class="bonus-grid">
                            <label class="form-field">
                                <span>통솔</span>
                                <input
                                    v-model.number="form.inheritBonusStat[0]"
                                    type="number"
                                    min="0"
                                    max="5"
                                    class="form-input"
                                />
                            </label>
                            <label class="form-field">
                                <span>무력</span>
                                <input
                                    v-model.number="form.inheritBonusStat[1]"
                                    type="number"
                                    min="0"
                                    max="5"
                                    class="form-input"
                                />
                            </label>
                            <label class="form-field">
                                <span>지력</span>
                                <input
                                    v-model.number="form.inheritBonusStat[2]"
                                    type="number"
                                    min="0"
                                    max="5"
                                    class="form-input"
                                />
                            </label>
                        </div>
                        <small class="muted">
                            보너스 합 {{ inheritBonusSum }} (0 또는 3~5) · 비용
                            {{ inheritCosts.inheritBornStatPoint }} 포인트
                        </small>
                    </div>

                    <div v-if="inheritErrors.length" class="inherit-errors">
                        <div v-for="item in inheritErrors" :key="item">{{ item }}</div>
                    </div>
                </div>
            </details>

            <PanelCard title="현재 정보" subtitle="임관할 국가를 고를 때 필요한 정보만 확인하세요.">
                <div class="context-tabs" role="tablist" aria-label="현재 정보 보기">
                    <button
                        id="context-tab-invitation"
                        type="button"
                        role="tab"
                        :class="{ active: contextTab === 'invitation' }"
                        :aria-selected="contextTab === 'invitation'"
                        aria-controls="context-panel-invitation"
                        @click="contextTab = 'invitation'"
                    >
                        임관 권유
                    </button>
                    <button
                        id="context-tab-map"
                        type="button"
                        role="tab"
                        :class="{ active: contextTab === 'map' }"
                        :aria-selected="contextTab === 'map'"
                        aria-controls="context-panel-map"
                        @click="contextTab = 'map'"
                    >
                        현재 지도
                    </button>
                    <button
                        id="context-tab-generals"
                        type="button"
                        role="tab"
                        :class="{ active: contextTab === 'generals' }"
                        :aria-selected="contextTab === 'generals'"
                        aria-controls="context-panel-generals"
                        @click="contextTab = 'generals'"
                    >
                        장수 목록
                    </button>
                </div>

                <div
                    v-if="contextTab === 'invitation'"
                    id="context-panel-invitation"
                    class="context-panel"
                    role="tabpanel"
                    aria-labelledby="context-tab-invitation"
                >
                    <div v-if="nationList.length === 0" class="muted">국가 정보가 아직 준비되지 않았습니다.</div>
                    <div v-else class="nation-list">
                        <article v-for="nation in nationList" :key="nation.id" class="nation-card">
                            <h3
                                class="nation-name"
                                :style="{
                                    backgroundColor: nation.color,
                                    color: legacyLuminanceTextColor(nation.color),
                                }"
                            >
                                {{ nation.name }}
                            </h3>
                            <p class="nation-message">{{ nation.scoutMessage ?? '권유문 없음' }}</p>
                        </article>
                    </div>
                </div>

                <div
                    v-else-if="contextTab === 'map'"
                    id="context-panel-map"
                    class="context-panel map-context"
                    role="tabpanel"
                    aria-labelledby="context-tab-map"
                >
                    <div v-if="mapError" class="context-error" role="alert">{{ mapError }}</div>
                    <MapViewer :map-data="publicMap" :map-layout="mapLayout" :loading="mapLoading" />
                </div>

                <div
                    v-else
                    id="context-panel-generals"
                    class="context-panel"
                    role="tabpanel"
                    aria-labelledby="context-tab-generals"
                >
                    <div class="general-list-head">
                        <label>
                            <span class="sr-only">장수 또는 국가 검색</span>
                            <input
                                v-model="publicGeneralFilter"
                                class="form-input"
                                type="search"
                                placeholder="장수명 또는 국가 검색"
                            />
                        </label>
                        <span>총 {{ filteredPublicGenerals.length }}명</span>
                    </div>
                    <div v-if="publicGeneralsError" class="context-error" role="alert">
                        {{ publicGeneralsError }}
                    </div>
                    <SkeletonLines v-if="publicGeneralsLoading" :lines="5" />
                    <div v-else class="general-list-scroll">
                        <table class="context-general-table">
                            <thead>
                                <tr>
                                    <th>장수명</th>
                                    <th>국가</th>
                                    <th>통솔</th>
                                    <th>무력</th>
                                    <th>지력</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="general in filteredPublicGenerals" :key="general.id">
                                    <td>
                                        <span v-if="general.npcState > 0" class="npc-badge">NPC</span>
                                        {{ general.name }}
                                    </td>
                                    <td>{{ general.nationName }}</td>
                                    <td>{{ general.leadership }}</td>
                                    <td>{{ general.strength }}</td>
                                    <td>{{ general.intelligence }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <div v-if="filteredPublicGenerals.length === 0" class="empty-list">표시할 장수가 없습니다.</div>
                    </div>
                </div>
            </PanelCard>
        </section>

        <section v-else class="npc-possession-section">
            <PanelCard title="장수 빙의">
                <div v-if="npcError" class="muted">{{ npcError }}</div>
                <div v-if="npcLoading && npcCandidates.length === 0">
                    <SkeletonLines :lines="3" />
                </div>
                <div v-else-if="npcCandidates.length === 0" class="muted">빙의 가능한 NPC가 없습니다.</div>
                <template v-else>
                    <div class="npc-token-status">
                        <span v-if="!npcExpired">
                            (<span :style="{ color: npcValidColor }">{{
                                npcReservation?.validUntil ? formatSeoulDateTime(npcReservation.validUntil) : ''
                            }}</span
                            >까지 유효)
                        </span>
                        <span v-else class="npc-token-expired">- 만료 -</span>
                    </div>
                    <form class="npc-card-holder" @submit.prevent>
                        <div v-for="npc in npcCandidates" :key="npc.id" class="npc-card">
                            <h4 class="npc-card-name">{{ npc.name }}</h4>
                            <h4>
                                <img
                                    class="npc-card-image"
                                    :src="npcImageUrl(npc)"
                                    :alt="`${npc.name} 얼굴`"
                                    width="64"
                                    height="64"
                                    @error="useDefaultGeneralIcon"
                                />
                            </h4>
                            <p>
                                {{ npc.stats.leadership }} / {{ npc.stats.strength }} / {{ npc.stats.intelligence
                                }}<br />
                                <span :style="{ color: npc.nation.color }">{{ npc.nation.name }}</span
                                ><br />
                                <span class="npc-tooltip" tabindex="0">
                                    {{ npc.personality.name }}
                                    <span role="tooltip">{{ npc.personality.info }}</span>
                                </span>
                                <br />
                                <span class="npc-tooltip" tabindex="0">
                                    {{ npc.specialDomestic.name }}
                                    <span role="tooltip">{{ npc.specialDomestic.info }}</span>
                                </span>
                                /
                                <span class="npc-tooltip" tabindex="0">
                                    {{ npc.specialWar.name }}
                                    <span role="tooltip">{{ npc.specialWar.info }}</span>
                                </span>
                            </p>
                            <button
                                class="npc-action"
                                type="button"
                                :disabled="submitting || (hasPendingPossession && !isPendingPossessCandidate(npc))"
                                @click="possessGeneral(npc)"
                            >
                                빙의하기
                            </button>
                            <label class="npc-keep">
                                <input
                                    v-model="keptNpcIds"
                                    type="checkbox"
                                    :value="npc.id"
                                    :disabled="npc.keepCount <= 0"
                                />
                                보관({{ npc.keepCount }}회)
                            </label>
                        </div>
                    </form>
                </template>
                <div class="npc-footer">
                    <button
                        id="btn-pick-more"
                        class="ghost"
                        type="button"
                        :disabled="npcLoading || npcPickMoreSeconds > 0 || submitting || hasPendingPossession"
                        @click="loadNpcCandidates(true)"
                    >
                        다른 장수 보기<span v-if="npcPickMoreSeconds > 0">({{ npcPickMoreSeconds }}초)</span>
                    </button>
                    <button
                        v-if="hasPendingPossession"
                        id="btn-retry-possession"
                        class="ghost"
                        type="button"
                        :disabled="submitting"
                        @click="retryPendingPossession"
                    >
                        접수 결과 다시 확인
                    </button>
                    <button
                        id="btn-load-general-list"
                        class="ghost npc-list-link"
                        type="button"
                        :disabled="npcGeneralListLoading"
                        @click="loadNpcGeneralList"
                    >
                        {{ npcGeneralListLoading ? '불러오는 중...' : '장수 목록 보기' }}
                    </button>
                </div>

                <div v-if="npcGeneralListError" class="npc-general-list-error" role="alert">
                    {{ npcGeneralListError }}
                </div>
                <div v-if="npcGeneralList" class="npc-general-list-wrap">
                    <table id="tb-general-list" class="npc-general-table">
                        <colgroup>
                            <col style="width: 64px" />
                            <col style="width: 140px" />
                            <col style="width: 40px" />
                            <col style="width: 40px" />
                            <col style="width: 80px" />
                            <col style="width: 45px" />
                            <col style="width: 140px" />
                            <col style="width: 50px" />
                            <col style="width: 50px" />
                            <col style="width: 75px" />
                            <col style="width: 60px" />
                            <col style="width: 45px" />
                            <col style="width: 45px" />
                            <col style="width: 45px" />
                            <col style="width: 45px" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th>얼 굴</th>
                                <th>이 름</th>
                                <th>연령</th>
                                <th>성격</th>
                                <th>특기</th>
                                <th>레 벨</th>
                                <th>국 가</th>
                                <th>명 성</th>
                                <th>계 급</th>
                                <th>관 직</th>
                                <th>종능</th>
                                <th>통솔</th>
                                <th>무력</th>
                                <th>지력</th>
                                <th>삭턴</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="general in visibleNpcGeneralRows"
                                :key="general.id"
                                :data-general-id="general.id"
                                :data-reservation-state="general.reservationState"
                            >
                                <td>
                                    <img
                                        class="npc-general-icon"
                                        :src="npcImageUrl(general)"
                                        :alt="`${general.name} 얼굴`"
                                        width="64"
                                        height="64"
                                        @error="useDefaultGeneralIcon"
                                    />
                                </td>
                                <td
                                    class="npc-general-name"
                                    :style="{
                                        color:
                                            general.reservationState === 1
                                                ? 'violet'
                                                : general.npcState > 0
                                                  ? getNpcColor(general.npcState)
                                                  : '',
                                    }"
                                >
                                    {{ general.name }}
                                    <template v-if="general.ownerName">
                                        <br /><small>({{ general.ownerName }})</small>
                                    </template>
                                    <template v-if="general.reservationState === 1">
                                        <br /><small>({{ general.keepCount }}회)</small>
                                    </template>
                                </td>
                                <td>{{ general.age }}세</td>
                                <td>
                                    <span v-if="general.personality" class="npc-tooltip" tabindex="0">
                                        {{ general.personality.name }}
                                        <span role="tooltip">{{ general.personality.info }}</span>
                                    </span>
                                    <span v-else>-</span>
                                </td>
                                <td>
                                    <span v-if="general.specialDomestic" class="npc-tooltip" tabindex="0">
                                        {{ general.specialDomestic.name }}
                                        <span role="tooltip">{{ general.specialDomestic.info }}</span>
                                    </span>
                                    <span v-else>-</span>
                                    /
                                    <span v-if="general.specialWar" class="npc-tooltip" tabindex="0">
                                        {{ general.specialWar.name }}
                                        <span role="tooltip">{{ general.specialWar.info }}</span>
                                    </span>
                                    <span v-else>-</span>
                                </td>
                                <td>Lv {{ general.level }}</td>
                                <td>{{ general.nationName }}</td>
                                <td>{{ general.experienceText }}</td>
                                <td>{{ general.dedicationText }}</td>
                                <td>{{ formatOfficerLevelText(general.officerLevel, general.nationLevel) }}</td>
                                <td>{{ general.statTotal }}</td>
                                <td>{{ general.leadership }}</td>
                                <td>{{ general.strength }}</td>
                                <td>{{ general.intelligence }}</td>
                                <td>{{ general.killturn }}</td>
                            </tr>
                        </tbody>
                        <tfoot v-if="visibleNpcGeneralRows.length < npcGeneralRows.length">
                            <tr>
                                <td colspan="15">
                                    <button
                                        id="btn-print-more-generals"
                                        type="button"
                                        @click="npcGeneralListVisibleCount += 50"
                                    >
                                        더 보기
                                    </button>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </PanelCard>
        </section>
    </main>
</template>

<style scoped>
.join-page {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

:global(#app:has(.join-page)) {
    min-width: 320px;
}

.join-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
    padding-bottom: 12px;
}

.join-title {
    font-size: 1.6rem;
    font-weight: 600;
}

.join-subtitle {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.7);
}

.join-tabs {
    display: flex;
    gap: 8px;
}

.join-tabs button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 10px;
    font-size: 0.8rem;
}

.simulator-link {
    border: 1px solid rgba(112, 170, 141, 0.55);
    padding: 6px 10px;
    color: #bfe2cd;
    font-size: 0.8rem;
    text-decoration: none;
}

.join-tabs button.active {
    background: rgba(201, 164, 90, 0.2);
}

.join-error {
    border: 1px solid rgba(240, 90, 90, 0.6);
    padding: 8px 10px;
    color: rgba(240, 150, 150, 0.9);
}

.join-flow {
    width: min(100%, 1000px);
    align-self: center;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.nation-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.nation-card {
    border: 1px solid rgba(201, 164, 90, 0.25);
    display: grid;
    grid-template-columns: 120px 1fr;
    align-items: stretch;
}

.nation-name {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    font-weight: 600;
    padding: 8px 6px;
    color: #101010;
    text-align: center;
}

.nation-message {
    margin: 0;
    padding: 8px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.create-form {
    display: flex;
    flex-direction: column;
}

.identity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    padding: 10px;
    border: 1px solid rgba(201, 164, 90, 0.2);
    background: rgba(0, 0, 0, 0.16);
}

.stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-top: 12px;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.75rem;
}

.primary-field > span:first-child {
    color: #f0d99e;
    font-size: 0.85rem;
    font-weight: 700;
}

.form-input {
    border: 1px solid rgba(201, 164, 90, 0.4);
    background: rgba(10, 10, 10, 0.8);
    padding: 6px 8px;
    color: inherit;
}

.primary-field > .form-input {
    min-height: 36px;
    font-size: 1rem;
}

.stat-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}

.stat-actions button {
    flex: 1 1 140px;
    height: 40px;
    min-height: 40px;
    padding: 8px 14px;
    font-size: 0.875rem;
    line-height: 1.2;
}

.stat-actions button:not(:disabled):hover {
    height: 39px;
    min-height: 39px;
}

.stat-actions button:not(:disabled):active {
    height: 38px;
    min-height: 38px;
}

.stat-summary {
    margin-top: 10px;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.stat-errors {
    margin-top: 4px;
    color: rgba(240, 150, 150, 0.9);
}

.form-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
}

.form-actions button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 12px;
    font-size: 0.8rem;
}

.form-actions .primary-action {
    min-width: 150px;
    border-color: rgba(226, 190, 112, 0.8);
    background: rgba(116, 81, 29, 0.75);
    color: #fff6dc;
    font-weight: 700;
}

.advanced-options {
    border: 1px solid gray;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
}

.advanced-options > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 10px;
    cursor: pointer;
    list-style: none;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
}

.advanced-options > summary::-webkit-details-marker {
    display: none;
}

.advanced-options > summary::before {
    content: '＋';
    flex: 0 0 auto;
    color: #dcbf7a;
    font-weight: 700;
}

.advanced-options[open] > summary::before {
    content: '－';
}

.advanced-title {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
}

.advanced-title small {
    color: #ccc;
    font-size: 0.7rem;
    font-weight: 400;
}

.advanced-point-summary {
    color: #ead8ac;
    font-size: 0.75rem;
    white-space: nowrap;
}

.advanced-body {
    padding: 12px;
    border-top: 1px solid gray;
}

.context-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-bottom: 1px solid rgba(201, 164, 90, 0.4);
}

.context-tabs button {
    min-height: 38px;
    border: 0;
    border-right: 1px solid rgba(201, 164, 90, 0.25);
    color: rgba(232, 221, 196, 0.68);
    font-size: 0.8rem;
}

.context-tabs button:last-child {
    border-right: 0;
}

.context-tabs button.active {
    background: rgba(201, 164, 90, 0.18);
    color: #fff2cf;
    box-shadow: inset 0 -2px #d3ad60;
    font-weight: 700;
}

.context-tabs button:focus-visible,
.advanced-options > summary:focus-visible,
.stat-actions button:focus-visible,
.form-actions button:focus-visible {
    outline: 2px solid #f0d58f;
    outline-offset: -2px;
}

.context-panel {
    padding-top: 10px;
}

.map-context {
    overflow-x: auto;
}

.general-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    color: rgba(232, 221, 196, 0.75);
    font-size: 0.75rem;
}

.general-list-head label {
    flex: 1;
}

.general-list-head input {
    width: min(100%, 320px);
}

.general-list-scroll {
    max-height: 420px;
    overflow: auto;
}

.context-general-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
}

.context-general-table th,
.context-general-table td {
    border: 1px solid rgba(201, 164, 90, 0.28);
    padding: 6px 8px;
    text-align: center;
}

.context-general-table th {
    position: sticky;
    z-index: 1;
    top: 0;
    background: #14241b;
}

.context-general-table td:first-child,
.context-general-table td:nth-child(2) {
    text-align: left;
}

.npc-badge {
    margin-right: 4px;
    padding: 1px 3px;
    background: rgba(111, 74, 141, 0.8);
    color: #fff;
    font-size: 0.6rem;
}

.context-error,
.empty-list {
    padding: 12px;
    color: rgba(240, 150, 150, 0.9);
    text-align: center;
    font-size: 0.75rem;
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.inherit-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.inherit-summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.85);
}

.inherit-options {
    display: grid;
    gap: 12px;
}

.inherit-bonus {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.bonus-title {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.8);
}

.bonus-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.inherit-errors {
    color: rgba(240, 150, 150, 0.9);
    font-size: 0.75rem;
}

.form-actions .ghost,
.join-tabs .ghost,
.npc-footer .ghost {
    background: transparent;
}

.npc-possession-section {
    width: 1000px;
    align-self: center;
}

.npc-token-status {
    min-height: 22px;
    text-align: center;
    font-size: 0.75rem;
}

.npc-token-expired {
    color: red;
}

.npc-card-holder {
    text-align: center;
    white-space: nowrap;
}

.npc-card {
    width: 125px;
    display: inline-flex;
    flex-direction: column;
    vertical-align: top;
    white-space: normal;
}

.npc-card h4,
.npc-card p {
    margin: 0;
}

.npc-card-name {
    min-height: 25px;
    border: 1px solid rgba(201, 164, 90, 0.3);
    font-size: 1rem;
    line-height: 23px;
}

.npc-card-image {
    width: 64px;
    height: 64px;
}

.npc-card p {
    min-height: 78px;
    font-size: 0.75rem;
    line-height: 1.3;
}

.npc-tooltip {
    position: relative;
    cursor: help;
}

.npc-tooltip [role='tooltip'] {
    display: none;
    position: absolute;
    z-index: 10;
    left: 50%;
    bottom: calc(100% + 4px);
    width: 220px;
    padding: 5px 7px;
    transform: translateX(-50%);
    border: 1px solid #888;
    background: #202020;
    color: #fff;
    text-align: left;
    word-break: keep-all;
}

.npc-tooltip:hover [role='tooltip'],
.npc-tooltip:focus [role='tooltip'] {
    display: block;
}

.npc-action {
    width: 100%;
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 4px 8px;
    font-size: 0.75rem;
}

.npc-keep {
    display: block;
    padding-left: 15px;
    text-indent: -15px;
    font-size: 0.75rem;
}

.npc-keep input {
    width: 13px;
    height: 13px;
    padding: 0;
    margin: 0;
    vertical-align: bottom;
    position: relative;
    top: -1px;
}

.npc-footer {
    margin-top: 8px;
    padding: 20px 0;
    text-align: center;
    display: flex;
    justify-content: center;
    gap: 2ch;
}

.npc-list-link {
    display: inline-block;
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 4px 8px;
    color: inherit;
    text-decoration: none;
}

.npc-general-list-error {
    margin-bottom: 8px;
    color: rgba(240, 150, 150, 0.9);
    text-align: center;
    font-size: 0.75rem;
}

.npc-general-list-wrap {
    width: 970px;
    margin: 0 auto 20px;
    overflow-x: auto;
}

.npc-general-table {
    width: 970px;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 12px;
    word-break: break-all;
}

.npc-general-table th,
.npc-general-table td {
    border: 1px solid gray;
    padding: 0;
    text-align: center;
}

.npc-general-table th {
    height: 24px;
    background: rgba(201, 164, 90, 0.15);
    font-weight: 600;
}

.npc-general-table tbody tr {
    height: 65px;
}

.npc-general-icon {
    display: block;
    width: 64px;
    height: 64px;
    max-width: none;
}

.npc-general-name small {
    font-size: 10px;
}

#btn-print-more-generals {
    width: 100%;
    min-height: 28px;
    border: 0;
}

.muted {
    color: rgba(232, 221, 196, 0.6);
    font-size: 0.75rem;
}

.ghost {
    background: transparent;
}

.icon-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
}

.icon-card {
    display: flex;
    align-items: center;
    gap: 3px;
}

@media (max-width: 700px) {
    .join-page {
        padding: 12px;
    }

    .join-header,
    .join-tabs {
        width: 100%;
    }

    .join-tabs {
        flex-wrap: wrap;
    }

    .join-tabs > * {
        flex: 1 1 auto;
        text-align: center;
    }

    .identity-grid {
        grid-template-columns: 1fr;
    }

    .stat-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }

    .form-actions {
        flex-direction: column;
    }

    .form-actions button {
        min-height: 40px;
    }

    .advanced-options > summary {
        align-items: flex-start;
        gap: 8px;
    }

    .advanced-point-summary {
        white-space: normal;
        text-align: right;
    }

    .nation-card {
        grid-template-columns: 90px 1fr;
    }

    .context-general-table {
        min-width: 520px;
    }
}
</style>
