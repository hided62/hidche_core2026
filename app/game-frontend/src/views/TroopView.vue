<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import { trpc } from '../utils/trpc';

type TroopList = Awaited<ReturnType<typeof trpc.troop.getList.query>>;
type Troop = TroopList['troops'][number];
type Member = Troop['members'][number];
type DialogKind = 'rename' | 'kick' | null;

const loading = ref(false);
const data = ref<TroopList | null>(null);
const errorMessage = ref('');
const noticeMessage = ref('');
const noticeKind = ref<'success' | 'error'>('success');
const createName = ref('');
const editName = ref('');
const kickTargetId = ref(0);
const dialogKind = ref<DialogKind>(null);
const dialogTroopId = ref(0);
const popupMember = ref<Member | null>(null);
const popupTop = ref(0);

const me = computed(() => data.value?.me ?? null);

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return '요청을 처리하지 못했습니다.';
};

const showNotice = (message: string, kind: 'success' | 'error') => {
    noticeMessage.value = message;
    noticeKind.value = kind;
};

const refresh = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    try {
        data.value = await trpc.troop.getList.query();
    } catch (error) {
        errorMessage.value = getErrorMessage(error);
    } finally {
        loading.value = false;
    }
};

const runAction = async (action: () => Promise<void>) => {
    errorMessage.value = '';
    try {
        await action();
        await refresh();
    } catch (error) {
        const message = getErrorMessage(error);
        errorMessage.value = message;
        showNotice(message, 'error');
    }
};

const makeTroop = async () => {
    const troopName = createName.value;
    await runAction(async () => {
        await trpc.troop.create.mutate({ troopName });
        createName.value = '';
        showNotice(`${troopName} 부대가 생성되었습니다.`, 'success');
    });
};

const joinTroop = async (troop: Troop) => {
    await runAction(async () => {
        await trpc.troop.join.mutate({ troopId: troop.id });
        showNotice(` ${troop.name} 부대에 가입했습니다.`, 'success');
    });
};

const exitTroop = async (troop: Troop) => {
    const isLeader = me.value?.id === troop.id;
    const prompt = isLeader ? `${troop.name} 부대를 해산하겠습니까?` : `${troop.name} 부대에서 탈퇴하겠습니까?`;
    if (!window.confirm(prompt)) {
        return;
    }
    await runAction(async () => {
        await trpc.troop.exit.mutate();
        showNotice(isLeader ? '부대를 해산했습니다.' : '부대에서 탈퇴했습니다.', 'success');
    });
};

const openRename = (troop: Troop) => {
    dialogKind.value = 'rename';
    dialogTroopId.value = troop.id;
    editName.value = troop.name;
};

const openKick = (troop: Troop) => {
    dialogKind.value = 'kick';
    dialogTroopId.value = troop.id;
    kickTargetId.value = troop.members.find((member) => member.id !== troop.id)?.id ?? 0;
};

const closeDialog = () => {
    dialogKind.value = null;
    dialogTroopId.value = 0;
};

const hasFinalConsonant = (value: string): boolean => {
    const last = Array.from(value.trim()).at(-1);
    if (!last) {
        return false;
    }
    const code = last.codePointAt(0);
    return code !== undefined && code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
};

const renameTroop = async (troop: Troop) => {
    const troopName = editName.value;
    const particle = hasFinalConsonant(troopName) ? '으로' : '로';
    if (!window.confirm(`${troop.name} 부대의 이름을 ${troopName}${particle} 바꾸시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.troop.rename.mutate({ troopId: troop.id, troopName });
        closeDialog();
        showNotice('부대명을 변경했습니다.', 'success');
    });
};

const kickMember = async (troop: Troop) => {
    const member = troop.members.find((candidate) => candidate.id === kickTargetId.value);
    if (!member) {
        showNotice('잘못된 접근입니다.', 'error');
        return;
    }
    const particle = hasFinalConsonant(member.name) ? '을' : '를';
    if (!window.confirm(`${troop.name} 부대에서 ${member.name}${particle} 추방하시겠습니까?`)) {
        return;
    }
    await runAction(async () => {
        await trpc.troop.kick.mutate({ troopId: troop.id, targetGeneralId: member.id });
        closeDialog();
        showNotice(`${member.name}${particle} 추방했습니다.`, 'success');
    });
};

const showMemberPopup = (event: MouseEvent, member: Member) => {
    const row = (event.currentTarget as HTMLElement).closest('.troopMembers') as HTMLElement | null;
    popupMember.value = member;
    popupTop.value = row ? row.offsetTop + row.offsetHeight : 0;
};

const hideMemberPopup = () => {
    popupMember.value = null;
};

const iconPath = (troop: Troop): string => resolveGeneralIconUrl(troop.leader ?? {});

const formatTurn = (turnTime: string | null): string => {
    if (!turnTime) {
        return '--:--';
    }
    return turnTime.slice(14, 19);
};

onMounted(() => {
    void refresh();
});
</script>

<template>
    <main id="container" class="legacy-troop-page">
        <header class="topBackBar bg0">
            <RouterLink class="legacy-button legacy-button--navigation legacyNavButton backLink" to="/"
                >돌아가기</RouterLink
            >
            <button
                class="legacy-button legacy-button--navigation legacyNavButton reloadButton"
                type="button"
                :disabled="loading"
                @click="refresh"
            >
                갱신
            </button>
            <h2>부대 편성</h2>
            <div></div>
            <div></div>
        </header>

        <div
            v-if="noticeMessage"
            class="notice"
            :class="noticeKind"
            :role="noticeKind === 'error' ? 'alert' : 'status'"
        >
            {{ noticeMessage }}
        </div>
        <div v-if="errorMessage && !noticeMessage" class="notice error" role="alert">{{ errorMessage }}</div>
        <div v-if="loading && !data" class="loading">불러오는 중...</div>

        <div v-if="data" id="troopList" class="bg0">
            <div v-for="troop in data.troops" :key="troop.id" class="troopItem" :data-troop-id="troop.id">
                <div class="troopInfo">
                    {{ troop.name }}<br />
                    【 {{ troop.leader?.cityName ?? '알 수 없음' }} 】
                </div>
                <div class="troopTurn">【턴】 {{ formatTurn(troop.turnTime) }}</div>
                <div class="troopLeaderIcon">
                    <img
                        height="64"
                        width="64"
                        :src="iconPath(troop)"
                        :alt="`${troop.leader?.name ?? '부대장'} 아이콘`"
                        @error="useDefaultGeneralIcon"
                    />
                </div>
                <div class="troopLeaderName">{{ troop.leader?.name ?? '알 수 없음' }}</div>
                <div class="troopReservedCommand">
                    <div v-for="(brief, index) in troop.reservedCommands" :key="`${troop.id}-${index}`">
                        {{ `${index + 1}: ${brief}` }}
                    </div>
                </div>
                <div class="troopMembers">
                    <template v-for="(member, index) in troop.members" :key="member.id">
                        <template v-if="index !== 0">, </template>
                        <span
                            class="troopMember"
                            :class="{
                                troopLeader: member.id === troop.id,
                                troopDiffCityMemeber: member.cityId !== troop.leader?.cityId,
                            }"
                            @mouseenter="showMemberPopup($event, member)"
                            @mouseleave="hideMemberPopup"
                        >
                            {{ member.name
                            }}<template v-if="member.cityId !== troop.leader?.cityId">
                                ({{ member.cityName }})</template
                            >
                        </span>
                    </template>
                    ({{ troop.members.length }}명)
                </div>

                <div class="troopAction">
                    <div v-if="dialogKind === null || dialogTroopId !== troop.id" class="actionButtons">
                        <button
                            v-if="data.me.troopId === 0"
                            class="legacy-button legacy-button--primary"
                            @click="joinTroop(troop)"
                        >
                            부대 탑승
                        </button>
                        <button
                            v-if="data.me.troopId === troop.id"
                            class="legacy-button"
                            :class="data.me.id === data.me.troopId ? 'legacy-button--danger' : 'legacy-button--primary'"
                            @click="exitTroop(troop)"
                        >
                            {{ data.me.id === data.me.troopId ? '부대 해산' : '부대 탈퇴' }}
                        </button>
                        <button
                            v-if="data.me.troopId === troop.id && data.me.id === data.me.troopId"
                            class="legacy-button legacy-button--secondary"
                            @click="openKick(troop)"
                        >
                            부대원 추방...
                        </button>
                        <button
                            v-if="data.permission >= 4"
                            class="legacy-button legacy-button--info"
                            @click="openRename(troop)"
                        >
                            부대명 변경...
                        </button>
                    </div>
                    <div v-else-if="dialogKind === 'rename'" class="subDialog renameDialog">
                        <div class="subTitle bg1 center"><span>부대명 변경</span></div>
                        <div class="subForm">
                            <input v-model.trim="editName" class="formControl" type="text" aria-label="새 부대명" />
                        </div>
                        <div class="subBtnCancel">
                            <button class="legacy-button legacy-button--secondary" @click="closeDialog">취소</button>
                        </div>
                        <div class="subBtnOK">
                            <button class="legacy-button legacy-button--primary" @click="renameTroop(troop)">
                                변경
                            </button>
                        </div>
                    </div>
                    <div v-else class="subDialog kickDialog">
                        <div class="subTitle bg1 center"><span>부대원 추방</span></div>
                        <div class="subForm">
                            <select v-model.number="kickTargetId" class="formControl" aria-label="추방할 부대원">
                                <option
                                    v-for="member in troop.members.filter((candidate) => candidate.id !== troop.id)"
                                    :key="member.id"
                                    :value="member.id"
                                >
                                    {{ member.name }}
                                </option>
                            </select>
                        </div>
                        <div class="subBtnCancel">
                            <button class="legacy-button legacy-button--secondary" @click="closeDialog">취소</button>
                        </div>
                        <div class="subBtnOK">
                            <button class="legacy-button legacy-button--primary" @click="kickMember(troop)">
                                추방
                            </button>
                        </div>
                    </div>
                </div>
                <div class="filler"><span class="dummy"></span></div>
            </div>
        </div>

        <div v-if="data" class="additionalTroopOptions">
            <div v-if="data.me.troopId === 0" class="makeNewTroop">
                <div class="makeTitle bg1 center">부대 창설</div>
                <input v-model.trim="createName" class="formControl troopNameField" type="text" aria-label="부대명" />
                <button class="legacy-button legacy-button--secondary createButton" @click="makeTroop">
                    부대 창설
                </button>
            </div>
        </div>

        <footer class="bottomBar bg0">
            <RouterLink class="legacy-button legacy-button--navigation legacyNavButton backLink" to="/"
                >돌아가기</RouterLink
            >
            <div></div>
        </footer>
        <div v-if="popupMember" id="generalPopup" :style="{ top: `${popupTop}px` }" role="tooltip">
            <strong>{{ popupMember.name }}</strong>
            <span>{{ popupMember.cityName }}</span>
        </div>
    </main>
</template>

<style scoped>
.legacy-troop-page {
    position: relative;
    margin: 0 auto;
    color: #fff;
    background: transparent;
    font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic';
    font-size: 14px;
    line-height: 1.5;
}

.bg0 {
    background-image: var(--sammo-texture-walnut);
}

.bg1 {
    background-image: var(--sammo-texture-green);
}

.center {
    text-align: center;
}

.topBackBar {
    width: 100%;
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
    position: relative;
}

.topBackBar h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 500;
    line-height: 32px;
    text-align: center;
}

.legacyNavButton {
    height: 32px;
    min-height: 32px;
    margin-right: 2px;
    font-weight: 600;
}

.notice {
    padding: 6px 10px;
    border: 1px solid #477a47;
    color: #d8f5d8;
}

.notice.error {
    border-color: #9b4848;
    color: #ffd0d0;
}

.loading {
    padding: 16px;
    text-align: center;
}

#generalPopup {
    position: absolute;
    z-index: 10;
    width: 500px;
    min-height: 58px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    border: 1px solid #999;
    background: #202020;
}

.additionalTroopOptions {
    margin-top: 1em;
}

.makeNewTroop {
    width: 250px;
    display: grid;
    grid-template-columns: 2fr 1fr;
    border: 1px solid gray;
}

.makeTitle {
    grid-column: 1/3;
    padding: 0.15em;
    font-size: 1.2em;
}

.troopDiffCityMemeber {
    color: red;
}

.troopLeader {
    font-weight: 700;
}

.troopMember {
    cursor: help;
}

.troopItem {
    display: grid;
    border-right: 1px solid gray;
}

.troopItem > div {
    border-top: 1px solid gray;
    border-left: 1px solid gray;
}

.troopInfo {
    grid-column: 1/3;
    grid-row: 1/2;
    display: grid;
    align-content: center;
    text-align: center;
}

.troopTurn {
    grid-column: 1/3;
    grid-row: 2/3;
    display: grid;
    align-content: center;
    justify-content: center;
}

.troopLeaderIcon {
    grid-column: 3/4;
    grid-row: 1/2;
    display: grid;
    align-content: center;
    justify-content: center;
}

.troopLeaderIcon img {
    object-fit: contain;
}

.troopLeaderName {
    grid-column: 3/4;
    grid-row: 2/3;
    display: grid;
    align-items: center;
    justify-content: center;
}

.troopReservedCommand {
    grid-column: 4/5;
    grid-row: 1/3;
    overflow: hidden;
    font-size: 85%;
    text-align: left;
}

.troopMembers {
    text-align: left;
    padding: 0.5em 0.7em;
}

.troopAction {
    grid-column: 6/7;
    grid-row: 1/3;
}

.formControl {
    width: 100%;
    min-height: 31px;
    box-sizing: border-box;
    border: 1px solid #777;
    border-radius: 4px;
    padding: 4px 8px;
    color: #eee;
    background: #1b1b1b;
    font: inherit;
}

.subForm,
.subBtnCancel,
.subBtnOK {
    display: grid;
}

.bottomBar {
    margin-top: 16px;
    padding-top: 20px;
}

.bottomBar .legacyNavButton {
    width: 70px;
    margin: 0;
    padding-right: 5px;
    padding-left: 5px;
    white-space: nowrap;
}

@media (min-width: 501px) {
    .legacy-troop-page {
        width: 1000px;
    }

    #generalPopup {
        left: 260px;
    }

    .troopItem {
        grid-template-rows: 65px 28px 34.5px;
        grid-template-columns: 65px 65px 130px 100px 1fr;
    }

    .troopMembers {
        grid-column: 5/6;
        grid-row: 1/3;
    }

    .troopItem:last-of-type {
        border-bottom: 1px solid gray;
    }

    .filler {
        grid-column: 1/2;
        grid-row: 3/4;
        display: grid;
        align-content: center;
        justify-content: right;
    }

    .dummy::after {
        content: '└';
        padding-right: 1.5ch;
    }

    .troopAction {
        grid-column: 2/7;
        grid-row: 3/4;
        border-left-color: transparent !important;
    }

    .actionButtons {
        display: grid;
        grid-template-columns: 110px 110px 110px;
        grid-template-rows: 33.5px;
    }

    .subDialog {
        display: grid;
        grid-template-columns: 90px 140px 50px 50px;
    }

    .subTitle {
        display: grid;
        align-content: center;
    }
}

@media (max-width: 500px) {
    .legacy-troop-page {
        width: 500px;
    }

    #generalPopup {
        left: 0;
    }

    .troopItem {
        grid-template-rows: 65px 28px auto;
        grid-template-columns: 65px 65px 130px 100px 0 140px;
    }

    .troopMembers {
        grid-column: 3/7;
        grid-row: 3/4;
    }

    .troopItem:last-of-type .troopMembers {
        border-bottom: 1px solid gray;
    }

    .filler {
        grid-column: 1/3;
        grid-row: 3/4;
        border-top: 1px solid gray;
    }

    .actionButtons {
        display: grid;
    }

    .subDialog {
        height: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr 1fr;
    }

    .subTitle,
    .subForm {
        grid-column: 1/3;
        display: grid;
        align-content: center;
    }

    .makeNewTroop {
        width: 250px;
    }
}
</style>
