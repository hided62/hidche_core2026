<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useGameFeedback } from '../composables/useGameFeedback';
import { trpc } from '../utils/trpc';

type VoteListResponse = Awaited<ReturnType<typeof trpc.vote.getVoteList.query>>;
type VoteDetail = Awaited<ReturnType<typeof trpc.vote.getVoteDetail.query>>;
type PollSummary = VoteListResponse['polls'][number];

const polls = ref<PollSummary[]>([]);
const voteReward = ref(0);
const currentVoteId = ref<number | null>(null);
const currentVote = ref<VoteDetail | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const isVoteAdmin = ref(false);
const showNewVote = ref(false);
const loadError = ref('');
const mySinglePick = ref(0);
const myMultiPick = ref<number[]>([]);
const myComment = ref('');
const newVoteTitle = ref('');
const newVoteOptionsText = ref('');
const newVoteMultipleOptions = ref(1);
const router = useRouter();
const { success: showSuccessToast, error: showErrorToast } = useGameFeedback();

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : '요청을 처리하지 못했습니다.';
};

const isEnded = (poll: { endAt: string | null; closedAt: string | null }): boolean => {
    if (poll.closedAt) {
        return true;
    }
    return poll.endAt ? new Date(poll.endAt).getTime() < Date.now() : false;
};

const canVote = computed(
    () => Boolean(currentVote.value) && !currentVote.value?.myVote && !isEnded(currentVote.value!.voteInfo)
);

const voteTotal = computed(() => (currentVote.value?.votes ?? []).reduce((total, vote) => total + vote.count, 0));

const voteDistribution = computed(() => {
    const result = Array.from({ length: currentVote.value?.voteInfo.options.length ?? 0 }, () => 0);
    for (const vote of currentVote.value?.votes ?? []) {
        for (const selection of vote.selection) {
            if (selection >= 0 && selection < result.length) {
                result[selection] += vote.count;
            }
        }
    }
    return result;
});

const newVoteOptions = computed(() => newVoteOptionsText.value.split('\n').filter((option) => option.length > 0));

const percentage = (count: number, total: number): string => ((count / Math.max(1, total)) * 100).toFixed(1);

const formatStartDate = (value: string): string => formatServerDateTime(value, { format: 'date' });

const formatCommentDate = (value: string): string => formatServerDateTime(value, { format: 'monthDayTime' });

const voteColor = (index: number): string =>
    ['#ff0000', '#ffa500', '#ffff00', '#008000', '#0000ff', '#000080', '#800080'][index % 7]!;

const voteColorText = (index: number): string => ([1, 2].includes(index % 7) ? '#000' : '#fff');

const loadVoteDetail = async (voteId: number) => {
    detailLoading.value = true;
    loadError.value = '';
    try {
        const detail = await trpc.vote.getVoteDetail.query({ voteId });
        currentVote.value = detail;
        currentVoteId.value = voteId;
        mySinglePick.value = detail.myVote?.[0] ?? 0;
        myMultiPick.value = detail.myVote ? [...detail.myVote] : [];
        myComment.value = '';
    } catch (error) {
        loadError.value = getErrorMessage(error);
    } finally {
        detailLoading.value = false;
    }
};

const reloadVote = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    loadError.value = '';
    try {
        const result = await trpc.vote.getVoteList.query();
        polls.value = result.polls;
        voteReward.value = result.voteReward;
        const nextVoteId =
            (currentVoteId.value && result.polls.some((poll) => poll.id === currentVoteId.value)
                ? currentVoteId.value
                : result.polls[0]?.id) ?? null;
        if (nextVoteId) {
            await loadVoteDetail(nextVoteId);
        } else {
            currentVoteId.value = null;
            currentVote.value = null;
        }
    } catch (error) {
        loadError.value = getErrorMessage(error);
    } finally {
        loading.value = false;
    }
};

const selectVote = (voteId: number) => {
    if (voteId !== currentVoteId.value) {
        void loadVoteDetail(voteId);
    }
};

const changeMultiPick = (index: number, checked: boolean) => {
    const limit = currentVote.value?.voteInfo.multipleOptions ?? 0;
    if (checked && limit > 0 && myMultiPick.value.length > limit) {
        myMultiPick.value = myMultiPick.value.filter((value) => value !== index);
        showErrorToast(`${limit}개까지만 선택할 수 있습니다.`);
    }
};

const submitVote = async () => {
    if (!currentVote.value) {
        return;
    }
    const selection = currentVote.value.voteInfo.multipleOptions === 1 ? [mySinglePick.value] : [...myMultiPick.value];
    if (selection.length === 0) {
        showErrorToast('선택한 항목이 없습니다.');
        return;
    }
    try {
        const result = await trpc.vote.submitVote.mutate({
            voteId: currentVote.value.voteInfo.id,
            selection,
        });
        showSuccessToast(result.wonLottery ? '특별한 설문 보상이 제공되었습니다!' : '설문을 마쳤습니다.');
        await loadVoteDetail(currentVote.value.voteInfo.id);
    } catch (error) {
        showErrorToast(getErrorMessage(error));
    }
};

const submitComment = async () => {
    if (!currentVote.value || myComment.value.length === 0) {
        return;
    }
    try {
        await trpc.vote.addComment.mutate({
            voteId: currentVote.value.voteInfo.id,
            text: myComment.value,
        });
        myComment.value = '';
        showSuccessToast('댓글을 달았습니다.');
        await loadVoteDetail(currentVote.value.voteInfo.id);
    } catch (error) {
        showErrorToast(getErrorMessage(error));
    }
};

const submitNewVote = async () => {
    try {
        await trpc.vote.createPoll.mutate({
            title: newVoteTitle.value,
            body: '',
            options: newVoteOptions.value,
            multipleOptions: newVoteMultipleOptions.value,
            revealMode: 'after_vote',
            closePrevious: true,
        });
        showSuccessToast('설문 조사가 생성되었습니다.');
        newVoteTitle.value = '';
        newVoteOptionsText.value = '';
        newVoteMultipleOptions.value = 1;
        showNewVote.value = false;
        await reloadVote();
    } catch (error) {
        showErrorToast(getErrorMessage(error));
    }
};

onMounted(() => {
    void reloadVote();
    void trpc.vote.getAdminStatus
        .query()
        .then((result) => {
            isVoteAdmin.value = result.ok === true;
        })
        .catch(() => {
            isVoteAdmin.value = false;
        });
});
</script>

<template>
    <main id="container" class="pageVote bg0">
        <header class="back_bar bg0">
            <button
                class="legacy-button legacy-button--navigation legacy-button--fixed-height back_btn"
                type="button"
                @click="router.push('/')"
            >
                창 닫기
            </button>
            <button
                class="legacy-button legacy-button--navigation legacy-button--fixed-height reload_btn"
                type="button"
                :disabled="loading"
                @click="reloadVote"
            >
                갱신
            </button>
            <h2 class="title"></h2>
            <div>&nbsp;</div>
            <div></div>
        </header>

        <div v-if="loadError" class="vote-notice error" role="alert">{{ loadError }}</div>
        <div id="vote-title" class="bg2">설문 조사({{ voteReward }}금과 추첨으로 유니크템 증정!)</div>

        <div v-if="detailLoading && !currentVote" class="loading">불러오는 중...</div>
        <table v-if="currentVote" id="vote-result">
            <colgroup>
                <col class="vote-idx" />
                <col class="vote-count" />
                <col class="vote-percent" />
                <col class="vote-option" />
            </colgroup>
            <thead>
                <tr>
                    <th colspan="3" class="text-end bg1">설문 제목</th>
                    <th id="vote-detail-title">
                        {{ currentVote.voteInfo.title }}
                        <template v-if="currentVote.voteInfo.multipleOptions !== 1">
                            ({{
                                currentVote.voteInfo.multipleOptions === 0
                                    ? currentVote.voteInfo.options.length
                                    : currentVote.voteInfo.multipleOptions
                            }}개 선택 가능 )
                        </template>
                    </th>
                </tr>
                <tr>
                    <th colspan="3" class="text-end bg1">게시자</th>
                    <th id="vote-detail-opener">{{ currentVote.voteInfo.openerName || '[SYSTEM]' }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(option, index) in currentVote.voteInfo.options" :key="index">
                    <td v-if="canVote" class="text-center">
                        <input
                            v-if="currentVote.voteInfo.multipleOptions === 1"
                            :id="`v-vote-${index}`"
                            v-model="mySinglePick"
                            class="form-check-input"
                            type="radio"
                            :value="index"
                        />
                        <input
                            v-else
                            :id="`v-vote-${index}`"
                            v-model="myMultiPick"
                            class="form-check-input"
                            type="checkbox"
                            :value="index"
                            @change="changeMultiPick(index, ($event.target as HTMLInputElement).checked)"
                        />
                    </td>
                    <td
                        v-else
                        class="text-end f_tnum"
                        :style="{ backgroundColor: voteColor(index), color: voteColorText(index) }"
                    >
                        {{ index + 1 }}.
                    </td>
                    <td class="text-end f_tnum vote-count">
                        <label :for="`v-vote-${index}`">{{ voteDistribution[index] }}명</label>
                    </td>
                    <td class="text-end f_tnum vote-percent">
                        <label :for="`v-vote-${index}`">
                            ({{ percentage(voteDistribution[index] ?? 0, voteTotal) }}%)
                        </label>
                    </td>
                    <td>
                        <label :for="`v-vote-${index}`">{{ option }}</label>
                    </td>
                </tr>
            </tbody>
            <tfoot>
                <tr>
                    <template v-if="canVote">
                        <td class="text-center">투표</td>
                        <td colspan="2">
                            <button class="legacy-button legacy-button--secondary vote-submit" @click="submitVote">
                                투표
                            </button>
                        </td>
                    </template>
                    <td v-else colspan="3" class="text-center">결산</td>
                    <td>
                        투표율: {{ voteTotal }} / {{ currentVote.userCnt }} ({{
                            percentage(voteTotal, currentVote.userCnt)
                        }}%)
                    </td>
                </tr>
            </tfoot>
        </table>

        <form v-if="currentVote" @submit.prevent="submitComment">
            <table id="vote-comment">
                <colgroup>
                    <col class="comment-idx" />
                    <col class="comment-name" />
                    <col class="comment-text" />
                    <col class="comment-date" />
                </colgroup>
                <thead>
                    <tr class="bg1 text-center">
                        <th>#</th>
                        <th><span>국가명</span><span>장수명</span></th>
                        <th>댓글</th>
                        <th>일시</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(comment, index) in currentVote.comments" :key="comment.id">
                        <td class="comment-idx f_tnum">{{ index + 1 }}.</td>
                        <td class="comment-name">
                            <span>{{ comment.nationName }}</span
                            ><span>{{ comment.generalName }}</span>
                        </td>
                        <td>{{ comment.text }}</td>
                        <td class="comment-date f_tnum">{{ formatCommentDate(comment.createdAt) }}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td></td>
                        <td>
                            <button class="legacy-button legacy-button--secondary comment-submit" type="submit">
                                댓글 달기
                            </button>
                        </td>
                        <td colspan="2">
                            <input v-model="myComment" class="form-control" maxlength="200" aria-label="댓글" />
                        </td>
                    </tr>
                </tfoot>
            </table>
        </form>

        <div id="vote-old-title" class="bg2">이전 설문 조사</div>
        <div id="vote-old-list">
            <div v-for="poll in polls" :key="poll.id" class="vote-old-item">
                <a href="#" @click.prevent="selectVote(poll.id)">{{ poll.title }}</a>
                ({{ formatStartDate(poll.startAt) }})
            </div>
        </div>

        <div v-if="isVoteAdmin" id="vote-new-panel">
            <div><a href="#" @click.prevent="showNewVote = !showNewVote">새 설문 조사 열기</a></div>
            <template v-if="showNewVote">
                <div class="admin-row">
                    <div>설문 제목</div>
                    <div><input v-model="newVoteTitle" class="form-control" type="text" /></div>
                </div>
                <div class="admin-row">
                    <div>설문 대상(엔터로 구분) ({{ newVoteOptions.length }}건)</div>
                    <div>
                        <textarea
                            v-model="newVoteOptionsText"
                            class="form-control"
                            :rows="newVoteOptions.length + 1"
                        ></textarea>
                    </div>
                </div>
                <div class="admin-row">
                    <div>동시 응답 수(0=모두)</div>
                    <div>
                        <input
                            v-model.number="newVoteMultipleOptions"
                            class="form-control"
                            type="number"
                            min="0"
                            :max="newVoteOptions.length"
                        />
                    </div>
                </div>
                <div class="admin-submit">
                    <button class="legacy-button legacy-button--secondary" type="button" @click="submitNewVote">
                        제출
                    </button>
                </div>
            </template>
        </div>

        <footer class="bottom_bar bg0">
            <button class="legacy-button legacy-button--navigation back_btn" type="button" @click="router.push('/')">
                창 닫기
            </button>
        </footer>
    </main>
</template>

<style scoped>
.pageVote {
    margin: 0 auto;
    color: #fff;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.5;
}

.bg0 {
    background-image: var(--sammo-texture-walnut);
}

.bg1 {
    background-image: var(--sammo-texture-green);
}

.bg2 {
    background-image: var(--sammo-texture-blue);
}

.back_bar {
    width: 100%;
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
}

.back_bar .title {
    margin: 0;
}

.back_btn,
.reload_btn {
    --legacy-button-height: 32px;
    margin-right: 2px;
    font-weight: 600;
}

.back_bar .back_btn,
.back_bar .reload_btn {
    width: 88px;
}

#vote-title {
    font-size: 1.8em;
    line-height: 1.5;
    text-align: center;
}

#vote-old-title {
    font-size: 1.5em;
    line-height: 1.5;
    text-align: center;
}

#vote-result,
#vote-comment {
    width: 100%;
    border-collapse: collapse;
}

#vote-result th,
#vote-result td,
#vote-comment th,
#vote-comment td {
    padding-right: 1ch;
    padding-left: 1ch;
}

#vote-result label {
    display: block;
}

#vote-result .vote-idx {
    width: 5ch;
}

#vote-result .vote-count {
    width: 55px;
    padding-right: 0;
}

#vote-result .vote-percent {
    width: 70px;
    padding-left: 0;
}

.vote-submit {
    width: 100%;
}

#vote-comment .comment-idx {
    width: 5ch;
    text-align: end;
}

#vote-comment .comment-name {
    width: 110px;
    text-align: center;
}

#vote-comment .comment-name span,
#vote-comment thead th:nth-child(2) span {
    display: inline-block;
    width: 50%;
}

#vote-comment tbody tr {
    border-top: 1px solid gray;
}

.comment-submit {
    width: 50%;
    margin-left: 50%;
}

.form-control {
    width: 100%;
    min-height: 35.5px;
    box-sizing: border-box;
    padding: 5.25px 10.5px;
    border: 1px solid #6c757d;
    border-radius: 5.25px;
    color: #fff;
    background: #212529;
    font: inherit;
}

.form-check-input {
    width: 1em;
    height: 1em;
    margin: 0;
    accent-color: #0d6efd;
}

.text-end {
    text-align: end;
}

.text-center {
    text-align: center;
}

.f_tnum {
    font-variant-numeric: tabular-nums;
}

#vote-old-list,
#vote-new-panel {
    padding: 0 7px;
}

.vote-old-item a,
#vote-new-panel a {
    color: #6ea8fe;
}

.admin-row {
    display: grid;
    grid-template-columns: 25% 75%;
}

.admin-row > div {
    padding: 2px 0;
}

.admin-submit {
    width: 20%;
    margin-left: 80%;
    display: grid;
}

.bottom_bar {
    height: 55.5px;
    padding-top: 20px;
    box-sizing: border-box;
}

.bottom_bar .back_btn {
    display: inline-block;
    width: auto;
}

.vote-notice {
    padding: 5px 10px;
    border: 1px solid #477a47;
    color: #d8f5d8;
}

.vote-notice.error {
    border-color: #9b4848;
    color: #ffd0d0;
}

.loading {
    padding: 12px;
    text-align: center;
}

@media (min-width: 501px) {
    .pageVote {
        width: 1000px;
    }

    #vote-comment .comment-name {
        width: 260px;
    }

    #vote-comment .comment-date {
        width: 98px;
        padding-right: 0.5ch;
        padding-left: 0.5ch;
        text-align: center;
    }
}

@media (max-width: 500px) {
    .pageVote {
        width: 500px;
    }

    #vote-comment .comment-name {
        width: 130px;
    }

    #vote-comment .comment-date {
        width: 50px;
        padding-right: 0.5ch;
        padding-left: 0.5ch;
        text-align: center;
    }

    .admin-row {
        grid-template-columns: 100%;
    }
}
</style>
