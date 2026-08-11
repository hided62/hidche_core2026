<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useToast } from '../composables/useToast';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import { createGameTrpc } from '../utils/gameTrpc';
import { trpc } from '../utils/trpc';
import { sealPassword } from '../utils/passwordEnvelope';

type Account = Awaited<ReturnType<typeof trpc.account.get.query>>;
type IconSyncProfile = Awaited<ReturnType<typeof trpc.account.changeIcon.mutate>>['profiles'][number];
type IconSyncState = 'idle' | 'pending' | 'success' | 'error';
type IconSyncRow = IconSyncProfile & {
    selected: boolean;
    state: IconSyncState;
    errorMessage: string;
};

const router = useRouter();
const account = ref<Account | null>(null);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const { success: showSuccessToast, error: showErrorToast } = useToast();

watch(successMessage, (value) => value && showSuccessToast(value), { flush: 'sync' });
watch(errorMessage, (value) => value && showErrorToast(value), { flush: 'sync' });
const currentPassword = ref('');
const newPassword = ref('');
const newPasswordConfirm = ref('');
const deletePassword = ref('');
const iconData = ref('');
const iconFilename = ref('');
const iconServerModalOpen = ref(false);
const iconServerBusy = ref(false);
const iconServerStaticFeedback = ref(false);
const iconServerMessage = ref('');
const iconServerRows = ref<IconSyncRow[]>([]);
const iconServerDialog = ref<HTMLElement | null>(null);
let iconServerReturnFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let iconServerStaticTimer: ReturnType<typeof setTimeout> | null = null;

const sessionToken = (): string | null => window.localStorage.getItem('sammo-session-token');

const gradeLabel = computed(() => {
    if (!account.value) return '-';
    if (account.value.roles.some((role) => role.includes('admin') || role === 'superuser')) return '관리자';
    return '일반회원';
});

const selectedIconServerCount = computed(
    () => iconServerRows.value.filter((row) => row.selected && row.state !== 'success').length
);
const failedIconServerCount = computed(() => iconServerRows.value.filter((row) => row.state === 'error').length);

const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    errorMessage.value = '';
    successMessage.value = '';
    try {
        await action();
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
    } finally {
        busy.value = false;
    }
};

const loadAccount = async (): Promise<void> => {
    const token = sessionToken();
    if (!token) {
        await router.replace('/');
        return;
    }
    try {
        account.value = await trpc.account.get.query({ sessionToken: token });
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '계정 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const changePassword = async (): Promise<void> => {
    if (newPassword.value !== newPasswordConfirm.value) {
        errorMessage.value = '새 비밀번호 확인이 일치하지 않습니다.';
        return;
    }
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        const [currentCredential, newCredential] = await Promise.all([
            sealPassword(currentPassword.value),
            sealPassword(newPassword.value),
        ]);
        await trpc.account.changePassword.mutate({
            sessionToken: token,
            currentCredential,
            newCredential,
        });
        currentPassword.value = '';
        newPassword.value = '';
        newPasswordConfirm.value = '';
        successMessage.value = '비밀번호를 변경했습니다.';
    });
};

const disallowThirdPartyUse = async (): Promise<void> => {
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        await trpc.account.disallowThirdPartyUse.mutate({ sessionToken: token });
        if (account.value) account.value = { ...account.value, thirdPartyUse: false };
        successMessage.value = '개인정보 제3자 제공 동의를 철회했습니다.';
    });
};

const scheduleDeletion = async (): Promise<void> => {
    if (!window.confirm('탈퇴를 신청하면 현재 세션이 종료됩니다. 계속하시겠습니까?')) return;
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        const currentCredential = await sealPassword(deletePassword.value);
        const result = await trpc.account.scheduleDeletion.mutate({
            sessionToken: token,
            currentCredential,
        });
        window.localStorage.removeItem('sammo-session-token');
        successMessage.value = `${new Date(result.deleteAfter).toLocaleDateString('ko-KR')}까지 정보가 보존됩니다.`;
        await router.replace('/');
    });
};

const focusIconServerModal = async (preferDialog = false): Promise<void> => {
    await nextTick();
    if (preferDialog) {
        iconServerDialog.value?.focus();
        return;
    }
    const target =
        iconServerDialog.value?.querySelector<HTMLElement>('input:not(:disabled)') ??
        iconServerDialog.value?.querySelector<HTMLElement>('button:not(:disabled)');
    (target ?? iconServerDialog.value)?.focus();
};

const handleIconServerFocusIn = (event: FocusEvent): void => {
    if (!iconServerModalOpen.value || !iconServerDialog.value) return;
    if (event.target instanceof Node && iconServerDialog.value.contains(event.target)) return;
    void focusIconServerModal(iconServerBusy.value);
};

const openIconServerModal = (profiles: IconSyncProfile[], returnFocus?: HTMLElement | null): void => {
    iconServerReturnFocus =
        returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    iconServerRows.value = profiles.map((profile) => ({
        ...profile,
        selected: true,
        state: 'idle',
        errorMessage: '',
    }));
    iconServerMessage.value = profiles.length === 0 ? '현재 아이콘을 적용할 수 있는 실행 중인 서버가 없습니다.' : '';
    iconServerModalOpen.value = true;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('focusin', handleIconServerFocusIn);
    void focusIconServerModal(true);
};

const closeIconServerModal = (): void => {
    if (iconServerBusy.value) return;
    iconServerModalOpen.value = false;
    document.removeEventListener('focusin', handleIconServerFocusIn);
    document.body.style.overflow = previousBodyOverflow;
    const returnFocus = iconServerReturnFocus;
    iconServerReturnFocus = null;
    void nextTick(() => returnFocus?.focus());
};

const showIconServerStaticFeedback = async (): Promise<void> => {
    if (iconServerStaticTimer) {
        clearTimeout(iconServerStaticTimer);
    }
    iconServerStaticFeedback.value = false;
    await nextTick();
    iconServerStaticFeedback.value = true;
    iconServerStaticTimer = setTimeout(() => {
        iconServerStaticFeedback.value = false;
        iconServerStaticTimer = null;
    }, 300);
};

const handleIconServerModalKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
        event.preventDefault();
        void showIconServerStaticFeedback();
        return;
    }
    if (event.key !== 'Tab' || !iconServerDialog.value) return;
    const focusable = Array.from(
        iconServerDialog.value.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
    );
    if (focusable.length === 0) {
        event.preventDefault();
        iconServerDialog.value.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (!iconServerDialog.value.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === iconServerDialog.value)
    ) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
};

const syncIconToServer = async (row: IconSyncRow, token: string): Promise<void> => {
    row.state = 'pending';
    row.errorMessage = '';
    try {
        const issued = await trpc.auth.issueGameSession.mutate({
            sessionToken: token,
            profile: row.profileName,
        });
        const publicGameTrpc = createGameTrpc(row.profile, row.apiPort);
        const exchanged = await publicGameTrpc.auth.exchangeGatewayToken.mutate({
            gatewayToken: issued.gameToken,
        });
        const gameTrpc = createGameTrpc(row.profile, row.apiPort, exchanged.accessToken);
        await gameTrpc.general.adjustIcon.mutate();
        row.state = 'success';
    } catch (error) {
        row.state = 'error';
        row.errorMessage = error instanceof Error ? error.message : '서버 적용에 실패했습니다.';
    }
};

const applyIconToSelectedServers = async (retryFailedOnly = false): Promise<void> => {
    if (iconServerBusy.value) return;
    const targets = iconServerRows.value.filter(
        (row) => row.selected && row.state !== 'success' && (!retryFailedOnly || row.state === 'error')
    );
    if (targets.length === 0) {
        iconServerMessage.value = retryFailedOnly ? '재시도할 실패 서버가 없습니다.' : '적용할 서버를 선택해 주세요.';
        return;
    }
    const token = sessionToken();
    if (!token) {
        iconServerMessage.value = '로그인이 필요합니다.';
        return;
    }
    iconServerBusy.value = true;
    iconServerMessage.value = '';
    await focusIconServerModal(true);
    try {
        await Promise.all(targets.map((row) => syncIconToServer(row, token)));
        const failed = targets.filter((row) => row.state === 'error').length;
        iconServerMessage.value =
            failed === 0
                ? '선택한 서버에 아이콘을 적용했습니다.'
                : `${failed}개 서버에 적용하지 못했습니다. 실패한 서버만 다시 시도할 수 있습니다.`;
    } finally {
        iconServerBusy.value = false;
        await focusIconServerModal(true);
    }
};

const selectIcon = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024) {
        errorMessage.value = '아이콘 파일은 50KB 이하여야 합니다.';
        input.value = '';
        return;
    }
    iconFilename.value = file.name;
    iconData.value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('아이콘 파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
    });
};

const changeIcon = async (event?: Event): Promise<void> => {
    const returnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        if (!iconData.value) throw new Error('아이콘 파일을 선택해주세요.');
        const result = await trpc.account.changeIcon.mutate({ sessionToken: token, imageData: iconData.value });
        if (account.value) account.value = { ...account.value, iconUrl: result.iconUrl };
        iconData.value = '';
        iconFilename.value = '';
        successMessage.value = result.flushPublished
            ? '전용 아이콘을 변경했습니다.'
            : '전용 아이콘을 변경했습니다. 로그인 갱신 알림은 지연될 수 있습니다.';
        await loadAccount();
        openIconServerModal(result.profiles, returnFocus);
    });
};

const setPreferredIcon = async (iconId: string): Promise<void> => {
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        await trpc.account.setPreferredIcon.mutate({ sessionToken: token, iconId });
        successMessage.value = '대표 전용 아이콘을 변경했습니다.';
        await loadAccount();
    });
};

const retireIcon = async (iconId: string): Promise<void> => {
    if (
        !window.confirm('목록에서 내린 아이콘은 다시 선택할 수 없습니다. 과거 기록의 이미지는 보존됩니다. 계속할까요?')
    ) {
        return;
    }
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        await trpc.account.retireIcon.mutate({ sessionToken: token, iconId });
        successMessage.value = '전용 아이콘을 목록에서 내렸습니다. 기존 URL과 과거 기록은 보존됩니다.';
        await loadAccount();
    });
};

const deleteIcon = async (event?: Event): Promise<void> => {
    const returnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!window.confirm('아이콘을 제거할까요?')) return;
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        const result = await trpc.account.deleteIcon.mutate({ sessionToken: token });
        if (account.value) account.value = { ...account.value, iconUrl: null };
        successMessage.value = result.flushPublished
            ? '전용 아이콘을 제거했습니다.'
            : '전용 아이콘을 제거했습니다. 로그인 갱신 알림은 지연될 수 있습니다.';
        openIconServerModal(result.profiles, returnFocus);
    });
};

const prepareIconSync = async (event?: Event): Promise<void> => {
    const returnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        const result = await trpc.account.prepareIconSync.query({ sessionToken: token });
        openIconServerModal(result.profiles, returnFocus);
    });
};

onMounted(() => {
    void loadAccount();
});

onBeforeUnmount(() => {
    document.removeEventListener('focusin', handleIconServerFocusIn);
    if (iconServerModalOpen.value) {
        document.body.style.overflow = previousBodyOverflow;
    }
    if (iconServerStaticTimer) {
        clearTimeout(iconServerStaticTimer);
    }
});
</script>

<template>
    <DefaultLayout>
        <div id="account-container">
            <table id="account-table" class="legacy-bg0">
                <caption class="section-title legacy-bg2">
                    계 정 관 리
                    <RouterLink class="skin-button back-button" to="/lobby">돌아가기</RouterLink>
                </caption>
                <colgroup>
                    <col class="label-column" />
                    <col span="5" />
                </colgroup>
                <thead>
                    <tr>
                        <th colspan="6" class="legacy-bg1">회 원 정 보</th>
                    </tr>
                </thead>
                <tbody v-if="account">
                    <tr>
                        <th class="legacy-bg1">ID</th>
                        <td colspan="5">{{ account.username }}</td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">닉네임</th>
                        <td colspan="5">{{ account.displayName }}</td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">등급</th>
                        <td colspan="2">{{ gradeLabel }}</td>
                        <td colspan="3">{{ account.roles.join(', ') || '-' }}</td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">가입일시</th>
                        <td colspan="2">{{ new Date(account.createdAt).toLocaleString('ko-KR') }}</td>
                        <td colspan="3">
                            개인정보 3자 제공 동의 : {{ account.thirdPartyUse ? '○' : '×' }}
                            <button
                                v-if="account.thirdPartyUse"
                                class="skin-button compact"
                                type="button"
                                :disabled="busy"
                                @click="disallowThirdPartyUse"
                            >
                                철회
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">인증 방식</th>
                        <td colspan="5">{{ account.oauthType }}</td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1"></th>
                        <th class="legacy-bg1" colspan="2">회원 탈퇴</th>
                        <th class="legacy-bg1" colspan="3">비밀번호 변경</th>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">정보<br />수정</th>
                        <td class="action-cell" colspan="2">
                            <form @submit.prevent="scheduleDeletion">
                                <label for="delete-password">현재 비밀번호</label>
                                <input
                                    id="delete-password"
                                    v-model="deletePassword"
                                    class="skin-input"
                                    type="password"
                                    autocomplete="current-password"
                                />
                                <button class="skin-button full-button" type="submit" :disabled="busy">탈퇴신청</button>
                            </form>
                        </td>
                        <td colspan="3">
                            <form class="password-form" @submit.prevent="changePassword">
                                <label for="current-password">현재 비밀번호</label>
                                <input
                                    id="current-password"
                                    v-model="currentPassword"
                                    class="skin-input"
                                    type="password"
                                    autocomplete="current-password"
                                />
                                <label for="new-password">새 비밀번호</label>
                                <input
                                    id="new-password"
                                    v-model="newPassword"
                                    class="skin-input"
                                    type="password"
                                    autocomplete="new-password"
                                />
                                <label for="confirm-password">비밀번호 확인</label>
                                <input
                                    id="confirm-password"
                                    v-model="newPasswordConfirm"
                                    class="skin-input"
                                    type="password"
                                    autocomplete="new-password"
                                />
                                <button class="skin-button full-button" type="submit" :disabled="busy">
                                    비밀번호 변경
                                </button>
                            </form>
                        </td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1"></th>
                        <th class="legacy-bg1" colspan="2">현재 / 신규</th>
                        <th class="legacy-bg1" colspan="3">전용 아이콘 변경</th>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">전용<br />아이콘</th>
                        <td class="icon-preview" colspan="2">
                            <img
                                v-if="account.iconUrl"
                                :src="account.iconUrl"
                                width="64"
                                height="64"
                                alt="현재 아이콘"
                            />
                            <span v-else>기본 아이콘</span>
                            <img v-if="iconData" :src="iconData" width="64" height="64" alt="새 아이콘 미리보기" />
                        </td>
                        <td class="icon-actions" colspan="3">
                            <input
                                class="skin-input filename"
                                :value="iconFilename"
                                readonly
                                aria-label="선택한 아이콘"
                            />
                            <label class="skin-button file-button">
                                찾아보기
                                <input type="file" accept=".avif,.webp,.jpg,.jpeg,.png,.gif" @change="selectIcon" />
                            </label>
                            <button
                                class="skin-button half-button"
                                type="button"
                                :disabled="busy || iconServerBusy"
                                @click="changeIcon"
                            >
                                아이콘 변경
                            </button>
                            <button
                                class="skin-button half-button"
                                type="button"
                                :disabled="busy || iconServerBusy"
                                @click="deleteIcon"
                            >
                                아이콘 제거
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <th class="legacy-bg1">전콘<br />목록</th>
                        <td colspan="5">
                            <div class="account-icon-library">
                                <div v-for="icon in account.icons" :key="icon.id" class="account-icon-card">
                                    <img :src="icon.url" width="64" height="64" alt="전용 아이콘" />
                                    <span v-if="icon.picture === account.preferredPicture" class="preferred-label"
                                        >대표</span
                                    >
                                    <button
                                        v-else
                                        class="skin-button compact"
                                        type="button"
                                        :disabled="busy"
                                        @click="setPreferredIcon(icon.id)"
                                    >
                                        대표로 설정
                                    </button>
                                    <button
                                        class="skin-button compact"
                                        type="button"
                                        :disabled="busy"
                                        @click="retireIcon(icon.id)"
                                    >
                                        목록에서 내리기
                                    </button>
                                </div>
                                <span v-if="account.icons.length === 0">등록한 전용 아이콘이 없습니다.</span>
                            </div>
                            <p class="icon-policy">
                                {{ account.icons.length }} / {{ account.maxActiveIcons }}개 · 업로드는 24시간에 1회 ·
                                목록에서 내리기는 7일에 1회
                            </p>
                        </td>
                    </tr>
                </tbody>
                <tbody v-else>
                    <tr>
                        <td colspan="6" class="status-cell">{{ loading ? '불러오는 중...' : '계정 정보 없음' }}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <th class="legacy-bg1">도움말</th>
                        <td colspan="5" class="help-cell">
                            <p>아이콘은 64 x 64픽셀 ~ 128 x 128픽셀 사이, 50KB 이하 파일만 가능합니다.</p>
                            <p>
                                <button
                                    class="skin-button"
                                    type="button"
                                    :disabled="busy || iconServerBusy"
                                    @click="prepareIconSync"
                                >
                                    현재 아이콘 서버 적용
                                </button>
                            </p>
                            <p class="warning">탈퇴시 1개월간 정보가 보존되며, 1개월간 재가입이 불가능합니다.</p>
                        </td>
                    </tr>
                </tfoot>
            </table>
            <p v-if="successMessage" class="feedback success" role="status">{{ successMessage }}</p>
            <p v-if="errorMessage" class="feedback error" role="alert">{{ errorMessage }}</p>
        </div>
        <Teleport to="body">
            <Transition name="icon-server-modal">
                <div
                    v-if="iconServerModalOpen"
                    class="icon-server-backdrop"
                    :class="{ 'is-static': iconServerStaticFeedback }"
                    data-testid="icon-server-modal"
                    @click.self="showIconServerStaticFeedback"
                    @keydown="handleIconServerModalKeydown"
                >
                    <section
                        ref="iconServerDialog"
                        class="icon-server-dialog"
                        role="dialog"
                        tabindex="-1"
                        :aria-busy="iconServerBusy"
                        aria-modal="true"
                        aria-labelledby="icon-server-title"
                    >
                        <header class="icon-server-header">
                            <h2 id="icon-server-title">완료되었습니다.<br />새 아이콘을 적용할 서버를 선택하세요.</h2>
                            <button
                                class="icon-server-dismiss"
                                type="button"
                                aria-label="닫기"
                                data-testid="icon-server-close"
                                :disabled="iconServerBusy"
                                @click="closeIconServerModal"
                            >
                                &times;
                            </button>
                        </header>
                        <div class="icon-server-body">
                            <form class="icon-server-form" @submit.prevent="applyIconToSelectedServers(false)">
                                <label
                                    v-for="(row, index) in iconServerRows"
                                    :key="row.profileName"
                                    class="icon-server-option"
                                    :for="`icon-server-${index}`"
                                >
                                    <input
                                        :id="`icon-server-${index}`"
                                        v-model="row.selected"
                                        type="checkbox"
                                        :disabled="iconServerBusy || row.state === 'success'"
                                        :data-testid="`icon-server-option-${row.profileName}`"
                                    />
                                    <span>{{ row.korName }}</span>
                                    <span
                                        class="icon-server-result"
                                        :class="`is-${row.state}`"
                                        :data-testid="`icon-server-result-${row.profileName}`"
                                    >
                                        <template v-if="row.state === 'pending'">적용 중...</template>
                                        <template v-else-if="row.state === 'success'">적용됨</template>
                                        <template v-else-if="row.state === 'error'">
                                            실패<span v-if="row.errorMessage">: {{ row.errorMessage }}</span>
                                        </template>
                                    </span>
                                </label>
                            </form>
                            <p
                                v-if="iconServerMessage"
                                class="icon-server-message"
                                :class="{ 'is-error': failedIconServerCount > 0 }"
                                role="status"
                            >
                                {{ iconServerMessage }}
                            </p>
                        </div>
                        <footer class="icon-server-footer">
                            <button
                                class="modal-button secondary"
                                type="button"
                                :disabled="iconServerBusy"
                                @click="closeIconServerModal"
                            >
                                닫기
                            </button>
                            <button
                                v-if="failedIconServerCount > 0"
                                class="modal-button retry"
                                type="button"
                                data-testid="icon-server-retry"
                                :disabled="iconServerBusy"
                                @click="applyIconToSelectedServers(true)"
                            >
                                실패 서버 재시도
                            </button>
                            <button
                                class="modal-button primary"
                                type="button"
                                data-testid="icon-server-apply"
                                :disabled="iconServerBusy || selectedIconServerCount === 0"
                                @click="applyIconToSelectedServers(false)"
                            >
                                {{ iconServerBusy ? '적용 중...' : '서버 적용' }}
                            </button>
                        </footer>
                    </section>
                </div>
            </Transition>
        </Teleport>
    </DefaultLayout>
</template>

<style scoped>
#account-container {
    width: 550px;
    min-height: 575px;
    margin: 106px auto 30px;
    color: #fff;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 14px;
}

#account-table {
    width: 100%;
    border: 1px solid gray;
    border-spacing: 0;
    table-layout: fixed;
    text-align: center;
}

.legacy-bg0 {
    background-color: #302016;
    background-image: var(--sammo-texture-walnut, url('https://sam-image.hided.net/game/back_walnut.jpg'));
}

.legacy-bg1 {
    background-color: #14241b;
    background-image: var(--sammo-texture-green, url('https://sam-image.hided.net/game/back_green.jpg'));
}

.legacy-bg2 {
    background-color: #172a52;
    background-image: var(--sammo-texture-blue, url('https://sam-image.hided.net/game/back_blue.jpg'));
}

#account-table caption {
    caption-side: top;
}

#account-table th,
#account-table td {
    border: 1px solid;
    border-color: gray #000 #000 gray;
    padding: 4px;
    font-size: 14px;
}

.label-column {
    width: 90px;
}

.section-title {
    position: relative;
    height: 50px;
    border: 1px solid gray;
    color: #fff;
    font-size: 30px;
    font-weight: 700;
    line-height: 50px;
    text-align: center;
}

.back-button {
    position: absolute;
    top: 6px;
    right: 6px;
    height: 40px;
    font-size: 14px;
    font-weight: 400;
    line-height: 38px;
}

.skin-button,
.skin-input {
    box-sizing: border-box;
    border: 1px solid;
    border-color: gray #000 #000 gray;
    background: #191919;
    color: #fff;
    font: inherit;
}

.skin-button {
    display: inline-block;
    padding: 0 4px;
    cursor: pointer;
    text-decoration: none;
}

.skin-button:hover,
.skin-button:focus {
    background: #303030;
}

.skin-button:focus-visible,
.skin-input:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}

.skin-button:disabled {
    cursor: default;
    opacity: 0.65;
}

.compact {
    width: 40px;
    margin-left: 10px;
}

.action-cell,
.icon-actions {
    position: relative;
}

.action-cell form {
    min-height: 76px;
}

.action-cell label {
    display: block;
}

.password-form {
    display: grid;
    grid-template-columns: 1fr 120px;
    justify-content: end;
    gap: 2px 6px;
    text-align: right;
}

.full-button {
    width: 100%;
    min-height: 26px;
}

.password-form .full-button {
    grid-column: 1 / -1;
}

.icon-preview {
    height: 72px;
}

.icon-preview img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    vertical-align: middle;
}

.icon-actions {
    height: 72px;
}

.filename {
    position: absolute;
    top: 12px;
    left: 10px;
    width: 130px;
    height: 22px;
}

.file-button {
    position: absolute;
    top: 12px;
    right: 10px;
    height: 22px;
    line-height: 20px;
}

.file-button input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
}

.half-button {
    position: absolute;
    bottom: 0;
    width: 50%;
    min-height: 26px;
}

.half-button:first-of-type {
    left: 0;
}

.half-button:last-of-type {
    right: 0;
}

.help-cell {
    padding: 8px !important;
    text-align: left;
}

.help-cell p {
    margin: 0;
    line-height: 1.2;
}

.help-cell .warning {
    margin-top: 1em;
    color: #f0f;
}

.status-cell {
    height: 280px;
}

.feedback {
    margin: 8px 0;
    padding: 8px;
    border: 1px solid gray;
    background: #191919;
    text-align: center;
}

.success {
    color: #9cff9c;
}

.error {
    color: #ff9c9c;
}

.icon-server-backdrop {
    position: fixed;
    z-index: 1050;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    background: rgb(0 0 0 / 50%);
    padding: 0 16px;
    transition: opacity 0.15s linear;
}

.icon-server-modal-enter-from,
.icon-server-modal-leave-to {
    opacity: 0;
}

.icon-server-dialog {
    width: 500px;
    max-width: calc(100vw - 32px);
    margin: 28px auto;
    border: 1px solid #444;
    border-radius: 8px;
    background: #303030;
    color: #fff;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic';
    font-size: 16px;
    line-height: 24px;
    text-align: left;
    transform: none;
    transition: transform 0.3s ease-out;
}

.icon-server-modal-enter-from .icon-server-dialog,
.icon-server-modal-leave-to .icon-server-dialog {
    transform: translateY(-50px);
}

.icon-server-backdrop.is-static .icon-server-dialog {
    transform: scale(1.02);
}

.icon-server-header {
    position: relative;
    display: flex;
    align-items: flex-start;
    border-bottom: 1px solid #444;
    padding: 16px;
}

.icon-server-header h2 {
    width: 297px;
    flex: 0 0 297px;
    margin: 0;
    font-size: 20px;
    font-weight: 500;
    line-height: 1.5;
    white-space: nowrap;
}

.icon-server-dismiss {
    width: 26px;
    height: 30px;
    margin: auto 0 auto auto;
    border: 2px outset #fff;
    border-radius: 0;
    background: #6b6b6b;
    padding: 1px 6px;
    color: #fff;
    font: inherit;
    font-weight: 400;
    line-height: 24px;
    opacity: 1;
}

.icon-server-dismiss:disabled {
    cursor: default;
    opacity: 0.2;
}

.icon-server-body {
    padding: 16px;
}

.icon-server-form {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
}

.icon-server-option {
    display: inline-flex;
    align-items: flex-start;
    gap: 5px;
    margin-right: 7px;
    cursor: pointer;
    line-height: 24px;
}

.icon-server-option input {
    width: 16px;
    height: 16px;
    margin: 3px 0 0;
}

.icon-server-option:has(input:disabled) {
    cursor: default;
}

.icon-server-result {
    max-width: 260px;
    color: #aaa;
    font-size: 13px;
    line-height: 22px;
}

.icon-server-result.is-success {
    color: #9cff9c;
}

.icon-server-result.is-error,
.icon-server-message.is-error {
    color: #ff9c9c;
}

.icon-server-message {
    margin: 14px 0 0;
    color: #ddd;
    font-size: 14px;
}

.icon-server-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid #444;
    padding: 16px;
}

.modal-button {
    border: 1px solid transparent;
    min-height: 40px;
    border-radius: 6px;
    padding: 6px 12px;
    color: #fff;
    font: inherit;
    font-weight: 700;
    line-height: 1.5;
    white-space: nowrap;
    transition:
        color 0.15s ease-in-out,
        background-color 0.15s ease-in-out,
        border-color 0.15s ease-in-out,
        box-shadow 0.15s ease-in-out;
}

.modal-button.secondary {
    width: 54px;
    border-color: #3d3d3d;
    background: #444;
}

.modal-button.primary {
    width: 86px;
    border-color: #325172;
    background: #375a7f;
}

.modal-button.retry {
    border-color: #a65f00;
    background: #a65f00;
}

.modal-button:disabled {
    cursor: default;
    opacity: 0.65;
}

.modal-button:focus,
.icon-server-dismiss:focus,
.icon-server-option input:focus {
    outline: 0;
}

.account-icon-library {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
}

.account-icon-card {
    display: grid;
    width: 104px;
    justify-items: center;
    gap: 4px;
}

.preferred-label {
    color: #ffbf00;
    font-weight: 700;
}

.icon-policy {
    margin: 0 8px 8px;
}

@media (max-width: 600px) {
    #account-container {
        margin-left: 0;
    }

    .icon-server-backdrop {
        padding-right: 8px;
        padding-left: 8px;
    }

    .icon-server-dialog {
        max-width: calc(100vw - 16px);
        margin: 8px auto;
    }

    .icon-server-footer {
        flex-wrap: wrap;
    }

    .icon-server-header h2 {
        width: auto;
        min-width: 0;
        flex: 1 1 auto;
        white-space: normal;
    }

    .icon-server-dismiss {
        flex: 0 0 26px;
    }

    .icon-server-result,
    .icon-server-message {
        min-width: 0;
        overflow-wrap: anywhere;
    }
}
</style>
