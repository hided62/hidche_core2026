<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useGameFeedback } from '../composables/useGameFeedback';
import { useSessionStore } from '../stores/session';
import { formatSeoulDateTime } from '../utils/legacyDateTime';
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import { trpc } from '../utils/trpc';

type JoinConfig = Awaited<ReturnType<typeof trpc.join.getConfig.query>>;
type Reservation = Awaited<ReturnType<typeof trpc.join.getSelectionPool.mutate>>;
type Candidate = Reservation['candidates'][number];
type Nation = JoinConfig['nations'][number];
type PendingSelectionAction = {
    operation: 'create' | 'reselect';
    uniqueName: string;
    personality?: string;
    iconId?: string;
    clientRequestId: string;
};

const router = useRouter();
const session = useSessionStore();
const { error: showErrorToast, showDialog } = useGameFeedback();

const config = ref<JoinConfig | null>(null);
const reservation = ref<Reservation | null>(null);
const selectedUniqueName = ref<string | null>(null);
const nations = ref<Nation[]>([]);
const personality = ref('Random');
const selectedIconId = ref('');
const loading = ref(true);
const submitting = ref(false);
const error = ref('');
const now = ref(Date.now());
let timer: number | null = null;
const pendingActionStorageKey = 'sammo-select-pool-pending-action';

const candidates = computed(() => reservation.value?.candidates ?? []);
const selectedCandidate = computed(
    () => candidates.value.find((candidate) => candidate.uniqueName === selectedUniqueName.value) ?? null
);
const hasGeneral = computed(() => reservation.value?.hasGeneral ?? config.value?.selectionPool.hasGeneral ?? false);
const allowPersonality = computed(() => config.value?.selectionPool.allowOptions.includes('ego') ?? false);
const personalities = computed(() => config.value?.personalities ?? []);
const serverInfo = computed(() => config.value?.serverInfo ?? null);
const validUntil = computed(() => {
    const value = reservation.value?.validUntil;
    return value ? new Date(value).getTime() : 0;
});
const expired = computed(() => validUntil.value > 0 && now.value > validUntil.value);
const validUntilColor = computed(() => {
    const remaining = validUntil.value - now.value;
    if (remaining <= 0 || remaining > 30_000) {
        return '#fff';
    }
    const channel = Math.max(0, Math.round((255 * remaining) / 30_000));
    return `rgb(255, ${channel}, ${channel})`;
});

const errorText = (value: unknown): string =>
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'unknown_error';

const readPendingAction = (): PendingSelectionAction | null => {
    try {
        const raw = window.sessionStorage.getItem(pendingActionStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<PendingSelectionAction>;
        if (
            (value.operation !== 'create' && value.operation !== 'reselect') ||
            typeof value.uniqueName !== 'string' ||
            typeof value.clientRequestId !== 'string' ||
            (value.iconId !== undefined && typeof value.iconId !== 'string')
        ) {
            return null;
        }
        return value as PendingSelectionAction;
    } catch {
        return null;
    }
};

const getPendingAction = (
    operation: PendingSelectionAction['operation'],
    uniqueName: string,
    requestedPersonality?: string,
    requestedIconId?: string
): PendingSelectionAction => {
    const current = readPendingAction();
    if (
        current?.operation === operation &&
        current.uniqueName === uniqueName &&
        current.personality === requestedPersonality &&
        current.iconId === requestedIconId
    ) {
        return current;
    }
    const next: PendingSelectionAction = {
        operation,
        uniqueName,
        ...(requestedPersonality ? { personality: requestedPersonality } : {}),
        ...(requestedIconId ? { iconId: requestedIconId } : {}),
        clientRequestId: crypto.randomUUID(),
    };
    window.sessionStorage.setItem(pendingActionStorageKey, JSON.stringify(next));
    return next;
};

const clearPendingAction = (action: PendingSelectionAction): void => {
    if (readPendingAction()?.clientRequestId === action.clientRequestId) {
        window.sessionStorage.removeItem(pendingActionStorageKey);
    }
};

const isIndeterminateTimeout = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || !('data' in value)) return false;
    const data = value.data;
    return Boolean(data && typeof data === 'object' && 'code' in data && data.code === 'TIMEOUT');
};

const formatDateTime = (value: string | null | undefined): string => {
    if (!value) return '';
    return formatSeoulDateTime(value);
};

const shuffleNations = (source: Nation[]): Nation[] => {
    const shuffled = [...source];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        const swapIndex = random[0]! % (index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return shuffled;
};

const imageUrl = (candidate: Candidate): string => resolveGeneralIconUrl(candidate);

const personalityName = (key: string | null): string | null => {
    if (!key) return null;
    return personalities.value.find((entry) => entry.key === key)?.name ?? key;
};
const personalityInfo = (key: string | null): string =>
    key ? (personalities.value.find((entry) => entry.key === key)?.info ?? '') : '';

const lightTextNationColors = new Set([
    '',
    '#330000',
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#6495ED',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#800080',
    '#A9A9A9',
    '#000000',
]);
const nationTextColor = (color: string): string =>
    lightTextNationColors.has(color.toUpperCase()) ? '#FFFFFF' : '#000000';

const selectCandidate = async (candidate: Candidate): Promise<void> => {
    if (!hasGeneral.value) {
        selectedUniqueName.value = candidate.uniqueName;
        return;
    }
    if (!confirm(`이 장수를 선택할까요? : ${candidate.generalName}`)) {
        return;
    }
    submitting.value = true;
    const pending = getPendingAction('reselect', candidate.uniqueName);
    try {
        await trpc.join.reselectPoolGeneral.mutate({
            uniqueName: candidate.uniqueName,
            clientRequestId: pending.clientRequestId,
        });
        clearPendingAction(pending);
        await showDialog({ kind: 'success', message: '선택한 장수로 변경했습니다.' });
        await session.refreshGeneralStatus();
        await router.push('/');
    } catch (cause) {
        console.error(cause);
        if (!isIndeterminateTimeout(cause)) {
            clearPendingAction(pending);
        }
        showErrorToast(`장수 변경에 실패했습니다: ${errorText(cause)}`);
        await loadPage();
    } finally {
        submitting.value = false;
    }
};

const createGeneral = async (): Promise<void> => {
    const candidate = selectedCandidate.value;
    if (!candidate) {
        showErrorToast('장수를 선택해주세요.');
        return;
    }
    if (!confirm('이 장수로 생성할까요?')) {
        return;
    }
    submitting.value = true;
    const pending = getPendingAction('create', candidate.uniqueName, personality.value, selectedIconId.value);
    try {
        await trpc.join.selectPoolGeneral.mutate({
            uniqueName: candidate.uniqueName,
            personality: personality.value,
            ...(selectedIconId.value ? { iconId: selectedIconId.value } : {}),
            clientRequestId: pending.clientRequestId,
        });
        clearPendingAction(pending);
        await showDialog({ kind: 'success', message: '선택한 장수로 생성했습니다.' });
        await session.refreshGeneralStatus();
        await router.push('/');
    } catch (cause) {
        console.error(cause);
        if (!isIndeterminateTimeout(cause)) {
            clearPendingAction(pending);
        }
        showErrorToast(`장수 생성에 실패했습니다: ${errorText(cause)}`);
        await loadPage();
    } finally {
        submitting.value = false;
    }
};

async function loadPage(): Promise<void> {
    loading.value = true;
    error.value = '';
    selectedUniqueName.value = null;
    try {
        const nextConfig = await trpc.join.getConfig.query();
        config.value = nextConfig;
        nations.value = shuffleNations(nextConfig.nations);
        if (!nextConfig.selectionPool.enabled) {
            await router.replace(nextConfig.selectionPool.hasGeneral ? '/' : '/join');
            return;
        }
        reservation.value = await trpc.join.getSelectionPool.mutate();
        now.value = Date.now();
    } catch (cause) {
        console.error(cause);
        error.value = errorText(cause);
        showErrorToast(`장수 선택 정보를 불러오지 못했습니다: ${error.value}`);
    } finally {
        loading.value = false;
    }
}

const goBack = (): void => {
    if (window.history.length > 1) {
        router.back();
        return;
    }
    void router.push(hasGeneral.value ? '/' : '/join');
};

onMounted(() => {
    timer = window.setInterval(() => {
        now.value = Date.now();
    }, 1_000);
    void loadPage();
});

onBeforeUnmount(() => {
    if (timer !== null) {
        window.clearInterval(timer);
    }
});
</script>

<template>
    <main class="select-pool-page legacy-bg0">
        <header class="page-title with-border">
            장 수 선 택<br />
            <button class="legacy-button" type="button" @click="goBack">돌아가기</button>
        </header>

        <table v-if="serverInfo" class="server-info-table legacy-bg0">
            <tbody>
                <tr>
                    <td>
                        현재 : {{ serverInfo.currentYear }}年 {{ serverInfo.currentMonth }}月 (<span class="cyan"
                            >{{ serverInfo.tickMinutes }}분 턴</span
                        >
                        서버)<br />
                        등록 장수 : 유저 {{ serverInfo.userGeneralCount }} / {{ serverInfo.maxGeneral }} 명 +
                        <span class="cyan">NPC {{ serverInfo.npcGeneralCount }} 명</span>
                    </td>
                </tr>
            </tbody>
        </table>

        <table class="invitation-table legacy-bg0">
            <thead>
                <tr>
                    <td colspan="2" class="legacy-bg1">임관 권유 메시지</td>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="nation in nations"
                    :key="nation.id"
                    :style="{
                        color: nationTextColor(nation.color),
                        backgroundColor: nation.color,
                    }"
                >
                    <td class="invitation-nation">{{ nation.name }}</td>
                    <td>
                        <div class="invitation-message">{{ nation.scoutMessage ?? '-' }}</div>
                    </td>
                </tr>
            </tbody>
        </table>

        <section class="selection-section">
            <h1 class="section-title legacy-bg1 with-border">장수 선택</h1>
            <div class="selection-body with-border">
                <div v-if="loading">불러오는 중...</div>
                <div v-else-if="error" class="error-text">{{ error }}</div>
                <template v-else-if="reservation">
                    <small v-if="!expired">
                        (<span :style="{ color: validUntilColor }">{{ formatDateTime(reservation.validUntil) }}</span
                        >까지 유효)
                    </small>
                    <small v-else class="expired-text">- 만료 -</small>
                    <br />
                    <div class="card-holder">
                        <article v-for="candidate in candidates" :key="candidate.uniqueName" class="general-card">
                            <h4 class="legacy-bg1 with-border">{{ candidate.generalName }}</h4>
                            <h4 class="portrait">
                                <img
                                    :src="imageUrl(candidate)"
                                    :alt="candidate.generalName"
                                    width="64"
                                    height="64"
                                    @error="useDefaultGeneralIcon"
                                />
                            </h4>
                            <p>
                                {{ candidate.leadership }} / {{ candidate.strength }} / {{ candidate.intel }}<br />
                                <span v-if="candidate.ego" class="trait-tooltip" tabindex="0">
                                    {{ personalityName(candidate.ego) }}
                                    <span role="tooltip">{{ personalityInfo(candidate.ego) }}</span>
                                </span>
                                <br v-if="candidate.ego" />
                                <span class="trait-tooltip" tabindex="0">
                                    {{ candidate.specialDomesticName }}
                                    <span role="tooltip">{{ candidate.specialDomesticInfo }}</span>
                                </span>
                                /
                                <span v-if="candidate.specialWarName" class="trait-tooltip" tabindex="0">
                                    {{ candidate.specialWarName }}
                                    <span role="tooltip">{{ candidate.specialWarInfo }}</span>
                                </span>
                                <span v-else>-</span><br /><br />
                                보병: {{ Math.trunc(candidate.dex[0] / 1000) }}K<br />
                                궁병: {{ Math.trunc(candidate.dex[1] / 1000) }}K<br />
                                기병: {{ Math.trunc(candidate.dex[2] / 1000) }}K<br />
                                귀병: {{ Math.trunc(candidate.dex[3] / 1000) }}K<br />
                                차병: {{ Math.trunc(candidate.dex[4] / 1000) }}K<br />
                            </p>
                            <button
                                class="select-button with-border"
                                type="button"
                                :disabled="submitting"
                                @click="selectCandidate(candidate)"
                            >
                                선택하기
                            </button>
                        </article>
                    </div>
                </template>
            </div>
        </section>

        <section v-if="reservation && !hasGeneral" class="create-section">
            <h1 class="section-title legacy-bg1 with-border">장수 생성</h1>
            <div class="create-body with-border">
                <div id="left-pad">
                    <article v-if="selectedCandidate" class="general-card selected-card">
                        <h4 class="legacy-bg1 with-border">{{ selectedCandidate.generalName }}</h4>
                        <h4 class="portrait">
                            <img
                                :src="imageUrl(selectedCandidate)"
                                :alt="selectedCandidate.generalName"
                                width="64"
                                height="64"
                                @error="useDefaultGeneralIcon"
                            />
                        </h4>
                        <p>
                            {{ selectedCandidate.leadership }} / {{ selectedCandidate.strength }} /
                            {{ selectedCandidate.intel }}<br />
                            <span v-if="selectedCandidate.ego" class="trait-tooltip" tabindex="0">
                                {{ personalityName(selectedCandidate.ego) }}
                                <span role="tooltip">{{ personalityInfo(selectedCandidate.ego) }}</span>
                            </span>
                            <br v-if="selectedCandidate.ego" />
                            <span class="trait-tooltip" tabindex="0">
                                {{ selectedCandidate.specialDomesticName }}
                                <span role="tooltip">{{ selectedCandidate.specialDomesticInfo }}</span>
                            </span>
                            /
                            <span v-if="selectedCandidate.specialWarName" class="trait-tooltip" tabindex="0">
                                {{ selectedCandidate.specialWarName }}
                                <span role="tooltip">{{ selectedCandidate.specialWarInfo }}</span>
                            </span>
                            <span v-else>-</span><br /><br />
                            보병: {{ Math.trunc(selectedCandidate.dex[0] / 1000) }}K<br />
                            궁병: {{ Math.trunc(selectedCandidate.dex[1] / 1000) }}K<br />
                            기병: {{ Math.trunc(selectedCandidate.dex[2] / 1000) }}K<br />
                            귀병: {{ Math.trunc(selectedCandidate.dex[3] / 1000) }}K<br />
                            차병: {{ Math.trunc(selectedCandidate.dex[4] / 1000) }}K<br />
                        </p>
                        <button class="select-button with-border" type="button">선택하기</button>
                    </article>
                    <template v-else>장수를<br />선택해주세요!</template>
                </div>
                <form class="custom-form" @submit.prevent="createGeneral">
                    <table>
                        <tbody>
                            <tr v-if="allowPersonality">
                                <th class="legacy-bg1">성격</th>
                                <td>
                                    <select v-model="personality">
                                        <option value="Random">????</option>
                                        <option
                                            v-for="entry in personalities.filter((item) => item.key !== 'Random')"
                                            :key="entry.key"
                                            :value="entry.key"
                                        >
                                            {{ entry.name }}
                                        </option>
                                    </select>
                                    <span>
                                        {{ personalities.find((entry) => entry.key === personality)?.info ?? '' }}
                                    </span>
                                </td>
                            </tr>
                            <tr v-if="config?.user.icons.length">
                                <th class="legacy-bg1">전콘 선택</th>
                                <td class="pool-icon-choice">
                                    <label>
                                        <input v-model="selectedIconId" type="radio" value="" /> 선택한 장수 전콘
                                    </label>
                                    <label v-for="icon in config.user.icons" :key="icon.id">
                                        <input v-model="selectedIconId" type="radio" :value="icon.id" />
                                        <img
                                            :src="resolveGeneralIconUrl(icon)"
                                            width="64"
                                            height="64"
                                            alt="내 전용 아이콘"
                                            @error="useDefaultGeneralIcon"
                                        />
                                    </label>
                                </td>
                            </tr>
                            <tr>
                                <td colspan="2" class="join-guidance">
                                    임의의 도시에서 재야로 시작하며 건국과 임관은 게임 내에서 실행합니다.
                                </td>
                            </tr>
                            <tr>
                                <td class="create-action">
                                    <button
                                        id="build-general"
                                        class="legacy-button"
                                        type="submit"
                                        :disabled="submitting"
                                    >
                                        장수생성
                                    </button>
                                </td>
                                <td>
                                    <button
                                        class="legacy-button"
                                        type="reset"
                                        :disabled="submitting"
                                        @click="personality = 'Random'"
                                    >
                                        다시입력
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </form>
            </div>
        </section>

        <footer class="page-footer">
            <div class="footer-back with-border">
                <button class="legacy-button" type="button" @click="goBack">돌아가기</button>
            </div>
            <div class="footer-banner with-border">
                <small>
                    삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작 : HideD /
                    <a href="https://sam.hided.net/wiki/hidche/credit" target="_blank" rel="noopener noreferrer"
                        >Credit</a
                    >
                </small>
            </div>
        </footer>
    </main>
</template>

<style scoped>
.select-pool-page {
    width: 1000px;
    min-width: 1000px;
    margin: 8px auto 0;
    color: #fff;
    line-height: 1.3;
    text-align: center;
    overflow: visible;
}
.with-border {
    border: solid 1px;
    border-top-color: gray;
    border-left-color: gray;
    border-right-color: #000;
    border-bottom-color: #000;
}
.page-title {
    padding: 0;
    text-align: left;
}
.page-title .legacy-button,
.footer-back .legacy-button {
    padding: 1px 6px;
    font-weight: 400;
    line-height: 1.3;
}
.server-info-table,
.invitation-table {
    border: 1px solid;
    border-collapse: collapse;
    border-top-color: gray;
    border-left-color: gray;
    border-right-color: #000;
    border-bottom-color: #000;
    border-spacing: 0;
    font-size: 14px;
    text-align: center;
    word-break: break-all;
}
.server-info-table {
    width: 100%;
}
.server-info-table td,
.invitation-table td {
    border: 1px solid gray;
    padding: 0;
}
.server-info-table td {
    padding: 1px 0;
}
.invitation-table {
    margin: 0 auto;
}
.invitation-nation {
    width: 130px;
}
.invitation-message {
    width: 870px;
    max-width: 870px;
    max-height: 200px;
    overflow: hidden;
}
.cyan {
    color: cyan;
}
.selection-section,
.create-section {
    margin: 0;
}
.section-title {
    margin: 0;
    padding: 0;
    color: inherit;
    font-size: 14px;
    font-weight: 700;
    line-height: 18.2px;
}
.selection-body {
    padding: 0;
}
.card-holder {
    text-align: center;
    white-space: normal;
}
.general-card {
    width: 125px;
    display: inline-block;
    box-sizing: content-box;
    border: solid 1px;
    border-top-color: gray;
    border-left-color: gray;
    border-right-color: #000;
    border-bottom-color: #000;
    vertical-align: top;
}
.general-card h4,
.general-card p {
    margin: 0;
}
.general-card h4 {
    padding: 0;
}
.portrait {
    text-align: center;
}
.portrait img {
    display: inline;
    width: 64px;
    height: 64px;
    vertical-align: baseline;
    object-fit: fill;
}
.select-button {
    width: 100%;
    height: 19px;
    padding: 0 4px;
    border-radius: 0;
    background: #191919;
    color: #fff;
    line-height: normal;
}
.expired-text,
.error-text {
    color: red;
}
.create-section {
    margin-top: 10px;
}
.create-body {
    display: flex;
    text-align: left;
}
#left-pad {
    flex: 1;
    padding-top: 8px;
    text-align: center;
}
.selected-card .select-button {
    display: none;
}
.custom-form {
    flex: 4;
}
.custom-form table {
    width: 100%;
    border-collapse: collapse;
}
.custom-form th,
.custom-form td {
    padding: 0;
    text-align: left;
}
.custom-form th {
    width: 200px;
    text-align: right;
}
.custom-form select {
    color: #fff;
    background: #000;
}
.custom-form .legacy-button {
    padding: 3px 6px;
    font-weight: 400;
}
.join-guidance {
    text-align: center;
}
.create-action {
    width: 200px;
    text-align: right;
}
.footer-back,
.footer-banner {
    text-align: left;
}
.footer-banner a {
    color: #fff;
    text-decoration: underline;
}
button:disabled {
    cursor: default;
    opacity: 0.55;
}
.select-button:disabled {
    background: #333;
}
.select-button:focus-visible,
.custom-form select:focus-visible,
.trait-tooltip:focus-visible {
    outline: auto 1px;
    outline-offset: 0;
}
.trait-tooltip {
    position: relative;
    cursor: help;
}
.trait-tooltip [role='tooltip'] {
    display: none;
    position: absolute;
    z-index: 20;
    left: 50%;
    bottom: calc(100% + 4px);
    width: 220px;
    padding: 5px 7px;
    transform: translateX(-50%);
    border: 1px solid #888;
    background: #202020;
    color: #fff;
    text-align: left;
    white-space: normal;
    word-break: keep-all;
}
.trait-tooltip:hover [role='tooltip'],
.trait-tooltip:focus [role='tooltip'] {
    display: block;
}
@media (max-width: 1000px) {
    .select-pool-page {
        margin-left: 8px;
        margin-right: 0;
    }
}
</style>
