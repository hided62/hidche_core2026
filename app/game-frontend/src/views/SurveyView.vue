<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import { trpc } from '../utils/trpc';

type VoteListResponse = Awaited<ReturnType<typeof trpc.vote.getVoteList.query>>;
type VoteDetailResponse = Awaited<ReturnType<typeof trpc.vote.getVoteDetail.query>>;

type RevealMode = 'after_vote' | 'after_end';

type PollSummary = VoteListResponse['polls'][number];

type VoteDetail = VoteDetailResponse;

type VoteResultEntry = VoteDetail['votes'][number];

const loading = ref(false);
const detailLoading = ref(false);
const error = ref<string | null>(null);
const polls = ref<PollSummary[]>([]);
const voteReward = ref(0);
const activeVoteId = ref<number | null>(null);
const voteDetail = ref<VoteDetail | null>(null);
const adminEnabled = ref(false);

const selectionSingle = ref<number | null>(null);
const selectionMulti = ref<number[]>([]);
const commentDraft = ref('');
const actionMessage = ref<string | null>(null);

const newPollTitle = ref('');
const newPollBody = ref('');
const newPollOptionsText = ref('');
const newPollMultipleOptions = ref(1);
const newPollEndAt = ref('');
const newPollRevealMode = ref<RevealMode>('after_vote');
const newPollClosePrevious = ref(true);

const updateTitle = ref('');
const updateBody = ref('');
const updateOptionsText = ref('');
const updateMultipleOptions = ref<number | null>(null);
const updateEndAt = ref('');
const updateRevealMode = ref<RevealMode>('after_vote');

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const formatDate = (value: string | null): string => {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString('ko-KR');
};

const parseOptionsText = (text: string): string[] =>
    text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

const resolveDateInput = (value: string): string | undefined => {
    if (!value) {
        return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed.toISOString();
};

const isPollEnded = (poll: { endAt: string | null; closedAt: string | null }): boolean => {
    if (poll.closedAt) {
        return true;
    }
    if (!poll.endAt) {
        return false;
    }
    const endDate = new Date(poll.endAt);
    if (Number.isNaN(endDate.getTime())) {
        return false;
    }
    return endDate <= new Date();
};

const currentPoll = computed(() => {
    if (!polls.value.length) {
        return null;
    }
    const selected = polls.value.find((poll) => poll.id === activeVoteId.value);
    return selected ?? polls.value[0] ?? null;
});

const revealLabel = computed(() => {
    if (!voteDetail.value) {
        return '';
    }
    return voteDetail.value.voteInfo.revealMode === 'after_vote' ? '투표 후 공개' : '종료 후 공개';
});

const pollEnded = computed(() => {
    if (!voteDetail.value) {
        return false;
    }
    return isPollEnded({
        endAt: voteDetail.value.voteInfo.endAt,
        closedAt: voteDetail.value.voteInfo.closedAt,
    });
});

const canVote = computed(() => {
    if (!voteDetail.value) {
        return false;
    }
    if (voteDetail.value.myVote) {
        return false;
    }
    return !pollEnded.value;
});

const canReveal = computed(() => {
    if (!voteDetail.value) {
        return false;
    }
    if (voteDetail.value.voteInfo.revealMode === 'after_vote') {
        return Boolean(voteDetail.value.myVote) || pollEnded.value;
    }
    return pollEnded.value;
});

const isSingleChoice = computed(() => voteDetail.value?.voteInfo.multipleOptions === 1);

const voteDistribution = computed(() => {
    if (!voteDetail.value) {
        return [] as number[];
    }
    const optionCount = voteDetail.value.voteInfo.options.length;
    const counts = Array.from({ length: optionCount }, () => 0);
    for (const entry of voteDetail.value.votes as VoteResultEntry[]) {
        for (const index of entry.selection) {
            if (index >= 0 && index < counts.length) {
                counts[index] += entry.count;
            }
        }
    }
    return counts;
});

const voteTotal = computed(() =>
    (voteDetail.value?.votes ?? []).reduce((sum, entry) => sum + entry.count, 0)
);

const selectPoll = (pollId: number) => {
    if (activeVoteId.value === pollId) {
        return;
    }
    activeVoteId.value = pollId;
};

const loadVoteList = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    error.value = null;
    try {
        const result = await trpc.vote.getVoteList.query();
        polls.value = result.polls;
        voteReward.value = result.voteReward ?? 0;
        if (!activeVoteId.value || !result.polls.some((poll) => poll.id === activeVoteId.value)) {
            const openPoll = result.polls.find((poll) => !isPollEnded(poll));
            activeVoteId.value = openPoll?.id ?? result.polls[0]?.id ?? null;
        }
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const loadVoteDetail = async (voteId: number) => {
    if (detailLoading.value) {
        return;
    }
    detailLoading.value = true;
    error.value = null;
    actionMessage.value = null;
    try {
        const result = await trpc.vote.getVoteDetail.query({ voteId });
        voteDetail.value = result;
        if (result.myVote && result.myVote.length > 0) {
            if (result.voteInfo.multipleOptions === 1) {
                selectionSingle.value = result.myVote[0] ?? null;
                selectionMulti.value = [...result.myVote];
            } else {
                selectionSingle.value = null;
                selectionMulti.value = [...result.myVote];
            }
        } else {
            selectionSingle.value = null;
            selectionMulti.value = [];
        }
        commentDraft.value = '';
        updateTitle.value = result.voteInfo.title;
        updateBody.value = result.voteInfo.body;
        updateMultipleOptions.value = result.voteInfo.multipleOptions;
        updateRevealMode.value = result.voteInfo.revealMode;
        updateEndAt.value = result.voteInfo.endAt ? result.voteInfo.endAt.slice(0, 16) : '';
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        detailLoading.value = false;
    }
};

const refreshAll = async () => {
    await loadVoteList();
    if (activeVoteId.value) {
        await loadVoteDetail(activeVoteId.value);
    }
};

const submitVote = async () => {
    if (!voteDetail.value) {
        return;
    }
    const optionLimit = voteDetail.value.voteInfo.multipleOptions;
    const selected = isSingleChoice.value
        ? selectionSingle.value !== null
            ? [selectionSingle.value]
            : []
        : [...selectionMulti.value];

    if (selected.length === 0) {
        actionMessage.value = '선택한 항목이 없습니다.';
        return;
    }

    if (optionLimit >= 1 && selected.length > optionLimit) {
        actionMessage.value = '선택한 항목이 너무 많습니다.';
        return;
    }

    actionMessage.value = null;
    try {
        const result = await trpc.vote.submitVote.mutate({
            voteId: voteDetail.value.voteInfo.id,
            selection: selected,
        });
        actionMessage.value = result.wonLottery
            ? '투표 완료! 유니크 추첨에 당첨되었습니다.'
            : '투표가 완료되었습니다.';
        await refreshAll();
    } catch (err) {
        actionMessage.value = resolveErrorMessage(err);
    }
};

const submitComment = async () => {
    if (!voteDetail.value) {
        return;
    }
    const text = commentDraft.value.trim();
    if (!text) {
        return;
    }
    actionMessage.value = null;
    try {
        await trpc.vote.addComment.mutate({
            voteId: voteDetail.value.voteInfo.id,
            text,
        });
        commentDraft.value = '';
        await loadVoteDetail(voteDetail.value.voteInfo.id);
    } catch (err) {
        actionMessage.value = resolveErrorMessage(err);
    }
};

const createPoll = async () => {
    const options = parseOptionsText(newPollOptionsText.value);
    const endAt = resolveDateInput(newPollEndAt.value);
    actionMessage.value = null;
    try {
        await trpc.vote.createPoll.mutate({
            title: newPollTitle.value.trim(),
            body: newPollBody.value.trim(),
            options,
            multipleOptions: newPollMultipleOptions.value,
            endAt,
            revealMode: newPollRevealMode.value,
            closePrevious: newPollClosePrevious.value,
        });
        newPollTitle.value = '';
        newPollBody.value = '';
        newPollOptionsText.value = '';
        newPollMultipleOptions.value = 1;
        newPollEndAt.value = '';
        newPollRevealMode.value = 'after_vote';
        newPollClosePrevious.value = true;
        await refreshAll();
    } catch (err) {
        actionMessage.value = resolveErrorMessage(err);
    }
};

const updatePoll = async () => {
    if (!voteDetail.value) {
        return;
    }
    const appendOptions = parseOptionsText(updateOptionsText.value);
    const endAt = resolveDateInput(updateEndAt.value);
    actionMessage.value = null;
    try {
        await trpc.vote.updatePoll.mutate({
            voteId: voteDetail.value.voteInfo.id,
            title: updateTitle.value.trim() || undefined,
            body: updateBody.value.trim() || undefined,
            appendOptions: appendOptions.length > 0 ? appendOptions : undefined,
            multipleOptions: updateMultipleOptions.value ?? undefined,
            endAt,
            revealMode: updateRevealMode.value,
        });
        updateOptionsText.value = '';
        await refreshAll();
    } catch (err) {
        actionMessage.value = resolveErrorMessage(err);
    }
};

const closePoll = async () => {
    if (!voteDetail.value) {
        return;
    }
    actionMessage.value = null;
    try {
        await trpc.vote.closePoll.mutate({ voteId: voteDetail.value.voteInfo.id });
        await refreshAll();
    } catch (err) {
        actionMessage.value = resolveErrorMessage(err);
    }
};

onMounted(() => {
    void refreshAll();
    void trpc.vote.getAdminStatus.query().then((result) => {
        adminEnabled.value = Boolean(result?.ok);
    }).catch(() => {
        adminEnabled.value = false;
    });
});

watch(activeVoteId, (voteId) => {
    if (voteId) {
        void loadVoteDetail(voteId);
    }
});
</script>

<template>
    <main class="survey-view">
        <header class="page-header">
            <div>
                <h1 class="page-title">설문조사</h1>
                <p class="page-subtitle">투표 참여 보상과 유니크 추첨이 함께 진행됩니다.</p>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인으로</RouterLink>
                <button class="ghost" @click="refreshAll" :disabled="loading">새로고침</button>
            </div>
        </header>

        <div v-if="error" class="error">{{ error }}</div>
        <div v-if="actionMessage" class="notice">{{ actionMessage }}</div>

        <section class="survey-grid">
            <div class="survey-main">
                <PanelCard title="보상 안내">
                    <div class="reward-block">
                        <div>투표 참여 보상: <strong>{{ voteReward }}</strong> 금</div>
                        <div>추첨 보상: 유니크 장비 1종</div>
                    </div>
                </PanelCard>

                <PanelCard title="현재 설문" :subtitle="currentPoll?.title ?? '설문 정보 없음'">
                    <SkeletonLines v-if="loading || detailLoading" :lines="6" />
                    <div v-else-if="!voteDetail" class="placeholder">설문 정보가 없습니다.</div>
                    <div v-else class="poll-detail">
                        <div class="poll-meta">
                            <div><strong>제목</strong> {{ voteDetail.voteInfo.title }}</div>
                            <div v-if="voteDetail.voteInfo.body"><strong>본문</strong> {{ voteDetail.voteInfo.body }}</div>
                            <div><strong>작성자</strong> {{ voteDetail.voteInfo.openerName }}</div>
                            <div>
                                <strong>선택 제한</strong>
                                {{
                                    voteDetail.voteInfo.multipleOptions === 0
                                        ? '제한 없음'
                                        : voteDetail.voteInfo.multipleOptions === 1
                                            ? '1개 선택'
                                            : `${voteDetail.voteInfo.multipleOptions}개 선택`
                                }}
                            </div>
                            <div><strong>공개 정책</strong> {{ revealLabel }}</div>
                            <div><strong>시작</strong> {{ formatDate(voteDetail.voteInfo.startAt) }}</div>
                            <div><strong>종료</strong> {{ formatDate(voteDetail.voteInfo.endAt) }}</div>
                            <div><strong>닫힘</strong> {{ formatDate(voteDetail.voteInfo.closedAt) }}</div>
                        </div>

                        <div class="poll-options">
                            <div
                                v-for="(option, idx) in voteDetail.voteInfo.options"
                                :key="`${voteDetail.voteInfo.id}-${idx}`"
                                class="poll-option"
                            >
                                <label>
                                    <input
                                        v-if="isSingleChoice"
                                        type="radio"
                                        :value="idx"
                                        v-model="selectionSingle"
                                        :disabled="!canVote"
                                    />
                                    <input
                                        v-else
                                        type="checkbox"
                                        :value="idx"
                                        v-model="selectionMulti"
                                        :disabled="!canVote"
                                    />
                                    <span>{{ option }}</span>
                                </label>
                            </div>
                        </div>

                        <div class="poll-actions">
                            <button class="ghost" @click="submitVote" :disabled="!canVote">투표하기</button>
                            <span v-if="voteDetail.myVote" class="muted">이미 투표했습니다.</span>
                            <span v-else-if="pollEnded" class="muted">설문이 종료되었습니다.</span>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="결과">
                    <SkeletonLines v-if="detailLoading" :lines="4" />
                    <div v-else-if="!voteDetail" class="placeholder">설문 결과가 없습니다.</div>
                    <div v-else-if="!canReveal" class="placeholder">
                        결과는 {{ revealLabel }}됩니다.
                    </div>
                    <div v-else class="poll-results">
                        <div class="result-summary">
                            참여 인원 {{ voteTotal }} / {{ voteDetail.userCnt }}
                        </div>
                        <div v-for="(option, idx) in voteDetail.voteInfo.options" :key="`result-${idx}`" class="result-row">
                            <div class="result-option">{{ option }}</div>
                            <div class="result-count">{{ voteDistribution[idx] ?? 0 }}명</div>
                            <div class="result-percent">
                                {{
                                    voteTotal > 0
                                        ? ((voteDistribution[idx] ?? 0) / voteTotal * 100).toFixed(1)
                                        : '0.0'
                                }}%
                            </div>
                        </div>
                    </div>
                </PanelCard>

                <PanelCard title="댓글">
                    <SkeletonLines v-if="detailLoading" :lines="4" />
                    <div v-else-if="!voteDetail" class="placeholder">댓글을 불러오는 중입니다.</div>
                    <div v-else>
                        <div v-if="voteDetail.comments.length === 0" class="placeholder">아직 댓글이 없습니다.</div>
                        <div v-else class="comment-list">
                            <div v-for="comment in voteDetail.comments" :key="comment.id" class="comment-item">
                                <div class="comment-header">
                                    <span>{{ comment.nationName }}</span>
                                    <span>{{ comment.generalName }}</span>
                                    <span class="comment-date">{{ formatDate(comment.createdAt) }}</span>
                                </div>
                                <div class="comment-text">{{ comment.text }}</div>
                            </div>
                        </div>
                        <div class="comment-form">
                            <input
                                v-model="commentDraft"
                                type="text"
                                maxlength="200"
                                placeholder="댓글을 입력하세요"
                            />
                            <button class="ghost" @click="submitComment">댓글 등록</button>
                        </div>
                    </div>
                </PanelCard>
            </div>

            <div class="survey-side">
                <PanelCard title="설문 목록">
                    <SkeletonLines v-if="loading" :lines="4" />
                    <div v-else class="poll-list">
                        <div v-if="polls.length === 0" class="placeholder">등록된 설문이 없습니다.</div>
                        <button
                            v-for="poll in polls"
                            :key="poll.id"
                            class="poll-list-item"
                            :class="{ active: poll.id === currentPoll?.id }"
                            @click="selectPoll(poll.id)"
                        >
                            <div class="poll-title">{{ poll.title }}</div>
                            <div class="poll-meta-row">
                                <span>{{ formatDate(poll.startAt) }}</span>
                                <span>{{ isPollEnded(poll) ? '종료됨' : '진행중' }}</span>
                            </div>
                        </button>
                    </div>
                </PanelCard>

                <PanelCard v-if="adminEnabled" title="관리자 패널">
                    <div class="admin-section">
                        <h3>새 설문 생성</h3>
                        <label>
                            제목
                            <input v-model="newPollTitle" type="text" />
                        </label>
                        <label>
                            본문
                            <textarea v-model="newPollBody" rows="3" />
                        </label>
                        <label>
                            항목 (줄바꿈 구분)
                            <textarea v-model="newPollOptionsText" rows="4" />
                        </label>
                        <label>
                            동시 응답 수 (0=제한 없음)
                            <input v-model.number="newPollMultipleOptions" type="number" min="0" />
                        </label>
                        <label>
                            종료 시각
                            <input v-model="newPollEndAt" type="datetime-local" />
                        </label>
                        <label>
                            공개 정책
                            <select v-model="newPollRevealMode">
                                <option value="after_vote">투표 후 공개</option>
                                <option value="after_end">종료 후 공개</option>
                            </select>
                        </label>
                        <label class="checkbox">
                            <input v-model="newPollClosePrevious" type="checkbox" />
                            기존 설문 종료
                        </label>
                        <button class="ghost" @click="createPoll">설문 생성</button>
                    </div>

                    <div class="admin-section" v-if="voteDetail">
                        <h3>설문 수정</h3>
                        <p class="muted">응답 0건일 때만 수정 가능합니다.</p>
                        <label>
                            제목
                            <input v-model="updateTitle" type="text" />
                        </label>
                        <label>
                            본문
                            <textarea v-model="updateBody" rows="3" />
                        </label>
                        <label>
                            항목 추가 (줄바꿈 구분)
                            <textarea v-model="updateOptionsText" rows="3" />
                        </label>
                        <label>
                            동시 응답 수
                            <input v-model.number="updateMultipleOptions" type="number" min="0" />
                        </label>
                        <label>
                            종료 시각
                            <input v-model="updateEndAt" type="datetime-local" />
                        </label>
                        <label>
                            공개 정책
                            <select v-model="updateRevealMode">
                                <option value="after_vote">투표 후 공개</option>
                                <option value="after_end">종료 후 공개</option>
                            </select>
                        </label>
                        <div class="admin-actions">
                            <button class="ghost" @click="updatePoll">수정 적용</button>
                            <button class="ghost" @click="closePoll">설문 종료</button>
                        </div>
                    </div>
                </PanelCard>
            </div>
        </section>
    </main>
</template>

<style scoped>
.survey-view {
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
    color: #ff8080;
}

.notice {
    color: rgba(232, 221, 196, 0.8);
}

.survey-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
}

.survey-main,
.survey-side {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.reward-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.poll-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.poll-meta {
    display: grid;
    gap: 6px;
    font-size: 0.9rem;
}

.poll-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.poll-option {
    display: flex;
    gap: 8px;
    align-items: center;
}

.poll-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}

.poll-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.result-summary {
    font-size: 0.9rem;
    color: rgba(232, 221, 196, 0.8);
}

.result-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 12px;
    align-items: center;
    font-size: 0.9rem;
}

.result-count,
.result-percent {
    text-align: right;
    white-space: nowrap;
}

.comment-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.comment-item {
    padding: 10px 12px;
    border: 1px solid rgba(201, 164, 90, 0.3);
    border-radius: 8px;
    background: rgba(16, 16, 16, 0.5);
}

.comment-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.8);
}

.comment-date {
    opacity: 0.7;
}

.comment-text {
    margin-top: 6px;
}

.comment-form {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.comment-form input {
    flex: 1;
    padding: 6px 8px;
    background: rgba(16, 16, 16, 0.6);
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: inherit;
}

.poll-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.poll-list-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid rgba(201, 164, 90, 0.3);
    background: rgba(16, 16, 16, 0.5);
    text-align: left;
    cursor: pointer;
    color: inherit;
}

.poll-list-item.active {
    border-color: rgba(255, 214, 140, 0.8);
    background: rgba(32, 24, 12, 0.8);
}

.poll-meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.placeholder {
    color: rgba(232, 221, 196, 0.7);
}

.muted {
    color: rgba(232, 221, 196, 0.6);
}

.admin-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
}

.admin-section h3 {
    margin: 0;
    font-size: 1rem;
}

.admin-section label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
}

.admin-section input,
.admin-section textarea,
.admin-section select {
    padding: 6px 8px;
    background: rgba(16, 16, 16, 0.6);
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: inherit;
}

.admin-section .checkbox {
    flex-direction: row;
    align-items: center;
    gap: 8px;
}

.admin-actions {
    display: flex;
    gap: 8px;
}

@media (max-width: 1024px) {
    .survey-grid {
        grid-template-columns: 1fr;
    }

    .comment-form {
        flex-direction: column;
    }
}
</style>
