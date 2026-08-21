<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useGameFeedback } from '../composables/useGameFeedback';
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import { trpc } from '../utils/trpc';

type BoardArticle = Awaited<ReturnType<typeof trpc.board.getArticles.query>>[number];

const route = useRoute();
const router = useRouter();
const { error: showErrorToast } = useGameFeedback();
const isSecretBoard = computed(() => route.name === 'board-secret');
const title = computed(() => (isSecretBoard.value ? '기밀실' : '회의실'));
const closeBoard = () => router.push('/');

const loading = ref(false);
const accessChecked = ref(false);
const canAccess = ref(false);
const errorMessage = ref('');
const articles = ref<BoardArticle[]>([]);
const draftTitle = ref('');
const draftText = ref('');
const articleTextArea = ref<HTMLTextAreaElement | null>(null);
const commentDrafts = reactive<Record<number, string>>({});

const errorText = (error: unknown, fallback: string): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : fallback;
};

const resizeTextArea = (element: HTMLTextAreaElement | null) => {
    if (!element) {
        return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, 42)}px`;
};

const formatDate = (value: string): string => formatServerDateTime(value, { format: 'monthDayTime' });

const iconPath = (article: BoardArticle): string =>
    resolveGeneralIconUrl({
        picture: article.authorPicture,
        imageServer: article.authorImageServer,
    });

const refreshArticles = async () => {
    if (loading.value) {
        return;
    }
    loading.value = true;
    errorMessage.value = '';
    accessChecked.value = false;
    try {
        const access = await trpc.board.getAccess.query();
        canAccess.value = isSecretBoard.value ? access.canSecret : access.canMeeting;
        accessChecked.value = true;
        if (!canAccess.value) {
            errorMessage.value = isSecretBoard.value
                ? '권한이 부족합니다. 수뇌부가 아닙니다.'
                : '국가에 소속되어있지 않습니다.';
            articles.value = [];
            return;
        }
        articles.value = await trpc.board.getArticles.query({ isSecret: isSecretBoard.value });
    } catch (error) {
        accessChecked.value = true;
        canAccess.value = false;
        errorMessage.value = errorText(error, '게시판을 불러오지 못했습니다.');
    } finally {
        loading.value = false;
    }
};

const submitArticle = async () => {
    const titleValue = draftTitle.value.trim();
    const content = draftText.value.trim();
    if (!titleValue && !content) {
        return;
    }
    try {
        await trpc.board.writeArticle.mutate({
            isSecret: isSecretBoard.value,
            title: titleValue,
            content,
        });
        draftTitle.value = '';
        draftText.value = '';
        await nextTick();
        resizeTextArea(articleTextArea.value);
        await refreshArticles();
    } catch (error) {
        showErrorToast(`게시물 등록에 실패했습니다: ${errorText(error, '게시물 등록에 실패했습니다.')}`);
    }
};

const submitComment = async (postId: number) => {
    const content = (commentDrafts[postId] ?? '').trim();
    if (!content) {
        return;
    }
    try {
        await trpc.board.writeComment.mutate({ postId, content });
        commentDrafts[postId] = '';
        await refreshArticles();
    } catch (error) {
        showErrorToast(`댓글 등록에 실패했습니다: ${errorText(error, '댓글 등록에 실패했습니다.')}`);
    }
};

watch(isSecretBoard, () => {
    void refreshArticles();
});

onMounted(() => {
    void refreshArticles();
});
</script>

<template>
    <div v-if="accessChecked && !canAccess" class="legacy-raw-access-error" role="alert">{{ errorMessage }}</div>
    <main v-else id="container" class="legacy-board-page">
        <header class="top-back-bar bg0">
            <button class="legacy-button back-button" type="button" @click="closeBoard">돌아가기</button>
            <div></div>
            <h1>{{ title }}</h1>
            <div></div>
            <div></div>
        </header>

        <div v-if="loading && !accessChecked" class="board-state bg0">불러오는 중...</div>
        <template v-else-if="canAccess">
            <section id="newArticle" class="bg0">
                <div class="new-article-header bg2 center">새 게시물 작성</div>
                <div class="form-row">
                    <label class="form-label bg1 center" for="board-title">제목</label>
                    <input
                        id="board-title"
                        v-model="draftTitle"
                        class="title-input"
                        type="text"
                        maxlength="250"
                        placeholder="제목"
                    />
                </div>
                <div class="form-row content-row">
                    <label class="form-label bg1 center" for="board-content">내용</label>
                    <textarea
                        id="board-content"
                        ref="articleTextArea"
                        v-model="draftText"
                        class="content-input"
                        placeholder="내용"
                        @input="resizeTextArea(articleTextArea)"
                    />
                </div>
                <div class="article-submit-row">
                    <div></div>
                    <button
                        id="submitArticle"
                        class="legacy-button legacy-button--secondary"
                        type="button"
                        @click="submitArticle"
                    >
                        등록
                    </button>
                </div>
            </section>

            <section id="board">
                <template v-if="articles.length">
                    <article v-for="article in articles" :key="article.id" class="article-frame bg0">
                        <header class="article-header bg1">
                            <div class="author-name center">{{ article.authorName }}</div>
                            <div class="article-title center">{{ article.title }}</div>
                            <time class="date center" :datetime="article.createdAt">{{
                                formatDate(article.createdAt)
                            }}</time>
                        </header>
                        <div class="article-body border-bottom">
                            <div class="author-icon center">
                                <img
                                    class="general-icon"
                                    width="64"
                                    height="64"
                                    :src="iconPath(article)"
                                    :alt="`${article.authorName} 아이콘`"
                                    @error="useDefaultGeneralIcon"
                                />
                            </div>
                            <div class="article-text">{{ article.content }}</div>
                        </div>
                        <div class="comment-list">
                            <div
                                v-for="comment in article.comments"
                                :key="comment.id"
                                class="comment-row border-bottom"
                            >
                                <div class="author-name center">{{ comment.authorName }}</div>
                                <div class="comment-text">{{ comment.content }}</div>
                                <time class="date center" :datetime="comment.createdAt">{{
                                    formatDate(comment.createdAt)
                                }}</time>
                            </div>
                        </div>
                        <div class="comment-form">
                            <label class="input-comment-header bg2 center" :for="`comment-${article.id}`"
                                >댓글 달기</label
                            >
                            <input
                                :id="`comment-${article.id}`"
                                v-model.trim="commentDrafts[article.id]"
                                class="comment-input"
                                type="text"
                                maxlength="250"
                                placeholder="새 댓글 내용"
                                @keyup.enter="submitComment(article.id)"
                            />
                            <button
                                class="legacy-button submit-comment"
                                type="button"
                                @click="submitComment(article.id)"
                            >
                                등록
                            </button>
                        </div>
                    </article>
                </template>
                <div v-else-if="!loading" class="empty-board">게시물이 없습니다.</div>
            </section>

            <footer class="bottom-bar bg0">
                <button class="legacy-button back-button" type="button" @click="closeBoard">돌아가기</button>
            </footer>
        </template>
    </main>
</template>

<style scoped>
.legacy-raw-access-error {
    position: fixed;
    z-index: 1000;
    inset: 0;
    box-sizing: border-box;
    min-width: 100vw;
    min-height: 100vh;
    padding: 8px;
    color: #000;
    background: #fff;
    font: 16px/normal var(--sammo-font-sans);
}

.legacy-board-page {
    width: 500px;
    margin: 0 auto;
    color: #fff;
    background: transparent;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
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

.center {
    text-align: center;
}

.top-back-bar {
    width: 100%;
    height: 32px;
    display: grid;
    grid-template-columns: 90px 90px 1fr 90px 90px;
}

.top-back-bar h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 500;
    line-height: 32px;
    text-align: center;
}

.legacy-button {
    min-height: 31px;
    box-sizing: border-box;
    border: 1px solid #3d3d3d;
    border-radius: 4px;
    padding: 4px 12px;
    color: #fff;
    background: #444;
    font: inherit;
    font-weight: 600;
    line-height: 1.5;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
}

.legacy-button:hover {
    border-color: #3d3d3d;
    background: #444;
}

.legacy-button:focus-visible {
    outline: none;
}

.legacy-button:active {
    border-color: #3d3d3d;
    background: #444;
}

.back-button {
    height: 32px;
    margin-right: 2px;
    border-color: #004f28;
    background: #00582c;
}

.back-button:hover,
.back-button:focus {
    border-color: #004523;
    background: #004a25;
}

.board-state {
    margin-top: 14px;
    padding: 10px;
    text-align: center;
}

.access-error {
    color: #fff;
    text-align: left;
}

#newArticle {
    margin-top: 14px;
}

.new-article-header {
    min-height: 18px;
}

.form-row {
    min-height: 22.1875px;
    display: flex;
}

.form-label {
    width: 16.6667%;
    flex: 0 0 auto;
    display: grid;
    align-content: center;
}

.title-input,
.content-input,
.comment-input {
    min-width: 0;
    box-sizing: border-box;
    border: 0;
    color: #fff;
    background: transparent;
    font: inherit;
}

.title-input {
    width: calc(83.3333% - 10px);
    margin: 1px 5px;
}

.content-row {
    align-items: stretch;
    min-height: 46.1875px;
}

.content-input {
    width: 83.3333%;
    min-height: 42px;
    padding: 1px 5px;
    resize: none;
    overflow: hidden;
}

.title-input:focus-visible,
.content-input:focus-visible,
.comment-input:focus-visible {
    outline: 2px solid #8ab4f8;
    outline-offset: -2px;
}

.article-submit-row {
    display: grid;
    grid-template-columns: 66.6667% 33.3333%;
    margin-right: -10.5px;
    margin-left: -10.5px;
}

.article-submit-row .legacy-button {
    width: auto;
    min-height: 35.5px;
    margin-right: 10.5px;
    margin-left: 10.5px;
    transition: none;
}

.article-submit-row .legacy-button:hover,
.article-submit-row .legacy-button:focus,
.article-submit-row .legacy-button:active {
    border-color: transparent;
}

.article-frame {
    margin: 20px auto;
}

.article-header,
.article-body,
.comment-row,
.comment-form {
    display: flex;
}

.author-name,
.author-icon,
.input-comment-header {
    width: 120px;
    flex: 0 0 auto;
}

.article-header {
    min-height: 18px;
    align-items: stretch;
}

.article-header > *,
.comment-row > * {
    display: grid;
    align-content: center;
}

.article-title,
.article-text,
.comment-text {
    min-width: 0;
    flex: 1 1 auto;
}

.date {
    width: 83.333px;
    flex: 0 0 auto;
    font-size: 0.9em;
}

.article-body {
    min-height: 64px;
}

.author-icon {
    display: grid;
    align-content: center;
    justify-content: center;
}

.general-icon {
    object-fit: contain;
}

.article-text,
.comment-text {
    padding: 1px 5px;
    text-align: left;
    white-space: pre;
}

.border-bottom {
    border-bottom: 1px solid gray;
}

.comment-row {
    min-height: 21.1875px;
}

.comment-form {
    min-height: 29.375px;
}

.input-comment-header {
    display: grid;
    align-content: center;
}

.comment-input {
    flex: 1 1 auto;
    padding: 1px 5px;
}

.submit-comment {
    width: 83.333px;
    min-height: 29.375px;
    padding-top: 2px;
    padding-bottom: 2px;
    flex: 0 0 auto;
}

.empty-board {
    min-height: 18px;
}

.bottom-bar {
    padding-top: 20px;
}

.bottom-bar .back-button {
    display: inline-block;
    width: 71px;
    height: 35.5px;
    margin: 0;
    padding-right: 6px;
    padding-left: 6px;
    white-space: nowrap;
}

@media (min-width: 940px) {
    .legacy-board-page {
        width: 1000px;
    }

    .form-label {
        width: 8.3333%;
    }

    .title-input {
        width: calc(91.6667% - 10px);
    }

    .content-input {
        width: 91.6667%;
    }

    .article-submit-row {
        grid-template-columns: 83.3333% 16.6667%;
    }
}

@media (max-width: 500px) {
    .article-body {
        flex-wrap: wrap;
    }

    .article-text {
        flex-basis: 100%;
        white-space: pre-wrap;
    }
}
</style>
