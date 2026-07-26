<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import DefaultLayout from '../layouts/DefaultLayout.vue';
import { trpc } from '../utils/trpc';
import { sealPassword } from '../utils/passwordEnvelope';

type Account = Awaited<ReturnType<typeof trpc.account.get.query>>;

const router = useRouter();
const account = ref<Account | null>(null);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const newPasswordConfirm = ref('');
const deletePassword = ref('');
const iconData = ref('');
const iconFilename = ref('');

const sessionToken = (): string | null => window.localStorage.getItem('sammo-session-token');

const gradeLabel = computed(() => {
    if (!account.value) return '-';
    if (account.value.roles.some((role) => role.includes('admin') || role === 'superuser')) return '관리자';
    return '일반회원';
});

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

const changeIcon = async (): Promise<void> => {
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        if (!iconData.value) throw new Error('아이콘 파일을 선택해주세요.');
        const result = await trpc.account.changeIcon.mutate({ sessionToken: token, imageData: iconData.value });
        if (account.value) account.value = { ...account.value, iconUrl: result.iconUrl };
        iconData.value = '';
        iconFilename.value = '';
        successMessage.value = '전용 아이콘을 변경했습니다.';
    });
};

const deleteIcon = async (): Promise<void> => {
    await runAction(async () => {
        const token = sessionToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        await trpc.account.deleteIcon.mutate({ sessionToken: token });
        if (account.value) account.value = { ...account.value, iconUrl: null };
        successMessage.value = '전용 아이콘을 제거했습니다.';
    });
};

onMounted(() => {
    void loadAccount();
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
                            <img v-if="account.iconUrl" :src="account.iconUrl" width="64" height="64" alt="현재 아이콘" />
                            <span v-else>기본 아이콘</span>
                            <img v-if="iconData" :src="iconData" width="64" height="64" alt="새 아이콘 미리보기" />
                        </td>
                        <td class="icon-actions" colspan="3">
                            <input class="skin-input filename" :value="iconFilename" readonly aria-label="선택한 아이콘" />
                            <label class="skin-button file-button">
                                찾아보기
                                <input
                                    type="file"
                                    accept=".avif,.webp,.jpg,.jpeg,.png,.gif"
                                    @change="selectIcon"
                                />
                            </label>
                            <button class="skin-button half-button" type="button" :disabled="busy" @click="changeIcon">
                                아이콘 변경
                            </button>
                            <button class="skin-button half-button" type="button" :disabled="busy" @click="deleteIcon">
                                아이콘 제거
                            </button>
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
                            <p class="warning">탈퇴시 1개월간 정보가 보존되며, 1개월간 재가입이 불가능합니다.</p>
                        </td>
                    </tr>
                </tfoot>
            </table>
            <p v-if="successMessage" class="feedback success" role="status">{{ successMessage }}</p>
            <p v-if="errorMessage" class="feedback error" role="alert">{{ errorMessage }}</p>
        </div>
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
    background-image: url('/image/game/back_walnut.jpg');
}

.legacy-bg1 {
    background-color: #14241b;
    background-image: url('/image/game/back_green.jpg');
}

.legacy-bg2 {
    background-color: #172a52;
    background-image: url('/image/game/back_blue.jpg');
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

@media (max-width: 600px) {
    #account-container {
        margin-left: 0;
    }
}
</style>
