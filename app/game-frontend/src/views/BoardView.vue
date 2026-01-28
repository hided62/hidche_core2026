<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

import { trpc } from '../utils/trpc';

type BoardComment = {
    id: number;
    authorName: string;
    content: string;
    createdAt: string;
};

type BoardArticle = {
    id: number;
    title: string;
    contentHtml: string;
    authorName: string;
    createdAt: string;
    comments: BoardComment[];
};

const route = useRoute();
const isSecretBoard = computed(() => route.name === 'board-secret');
const title = computed(() => (isSecretBoard.value ? '기밀실' : '회의실'));
const toggleBoardLabel = computed(() => (isSecretBoard.value ? '회의실로' : '기밀실로'));
const toggleBoardPath = computed(() => (isSecretBoard.value ? '/board' : '/board/secret'));

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const articles = ref<BoardArticle[]>([]);

const draftTitle = ref('');
const commentDrafts = reactive<Record<number, string>>({});

const editor = useEditor({
    extensions: [
        StarterKit,
        Underline,
        Link.configure({ openOnClick: false }),
        Image.configure({ inline: false }),
        Placeholder.configure({ placeholder: '내용을 입력하세요.' }),
    ],
    content: '',
    editorProps: {
        attributes: {
            class: 'board-editor',
        },
    },
});

const refreshArticles = async () => {
    if (loading.value) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        const result = await trpc.board.getArticles.query({ isSecret: isSecretBoard.value });
        articles.value = result;
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '게시판을 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const submitArticle = async () => {
    const contentHtml = editor.value?.getHTML().trim() ?? '';
    const titleValue = draftTitle.value.trim();
    if (!titleValue && !contentHtml) return;
    errorMessage.value = null;
    try {
        await trpc.board.writeArticle.mutate({
            isSecret: isSecretBoard.value,
            title: titleValue,
            contentHtml,
        });
        draftTitle.value = '';
        editor.value?.commands.setContent('');
        await refreshArticles();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '게시물 등록에 실패했습니다.';
    }
};

const submitComment = async (postId: number) => {
    const content = (commentDrafts[postId] ?? '').trim();
    if (!content) return;
    errorMessage.value = null;
    try {
        await trpc.board.writeComment.mutate({ postId, content });
        commentDrafts[postId] = '';
        await refreshArticles();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '댓글 등록에 실패했습니다.';
    }
};

const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadBusy = ref(false);

const addLink = () => {
    const url = window.prompt('링크 주소를 입력하세요');
    if (!url) return;
    editor.value?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
};

const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('이미지를 읽을 수 없습니다.'));
            }
        };
        reader.onerror = () => reject(new Error('이미지를 읽는 중 오류가 발생했습니다.'));
        reader.readAsDataURL(file);
    });

const onSelectImage = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || uploadBusy.value) return;
    uploadBusy.value = true;
    errorMessage.value = null;
    try {
        const dataUrl = await readFileAsDataUrl(file);
        const result = await trpc.board.uploadImage.mutate({ dataUrl });
        editor.value?.chain().focus().setImage({ src: result.url, alt: file.name }).run();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.';
    } finally {
        uploadBusy.value = false;
        if (input) {
            input.value = '';
        }
    }
};

const formatDate = (value: string) => new Date(value).toLocaleString('ko-KR');

watch(isSecretBoard, () => {
    refreshArticles();
});

onMounted(() => {
    refreshArticles();
});

onBeforeUnmount(() => {
    editor.value?.destroy();
});
</script>

<template>
    <div class="board-view">
        <header class="board-header">
            <div>
                <h1>{{ title }}</h1>
                <span class="board-subtitle">새 게시물 작성</span>
            </div>
            <div class="header-actions">
                <RouterLink class="ghost" to="/">메인으로</RouterLink>
                <RouterLink class="ghost" :to="toggleBoardPath">{{ toggleBoardLabel }}</RouterLink>
            </div>
        </header>

        <section class="board-editor-card">
            <div class="field-row">
                <label class="field-label">제목</label>
                <input v-model="draftTitle" class="field-input" type="text" maxlength="250" placeholder="제목" />
            </div>

            <div class="editor-toolbar">
                <button type="button" @click="editor?.chain().focus().toggleBold().run()" :class="{ active: editor?.isActive('bold') }">
                    굵게
                </button>
                <button
                    type="button"
                    @click="editor?.chain().focus().toggleItalic().run()"
                    :class="{ active: editor?.isActive('italic') }"
                >
                    기울임
                </button>
                <button
                    type="button"
                    @click="editor?.chain().focus().toggleUnderline().run()"
                    :class="{ active: editor?.isActive('underline') }"
                >
                    밑줄
                </button>
                <button type="button" @click="addLink">링크</button>
                <button type="button" @click="editor?.chain().focus().toggleBulletList().run()">
                    목록
                </button>
                <button type="button" @click="editor?.chain().focus().toggleOrderedList().run()">
                    번호 목록
                </button>
                <button type="button" @click="fileInputRef?.click()" :disabled="uploadBusy">
                    이미지 업로드
                </button>
                <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onSelectImage" />
            </div>

            <EditorContent v-if="editor" :editor="editor" />

            <div class="submit-row">
                <button type="button" class="primary" @click="submitArticle">등록</button>
            </div>
        </section>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <section class="board-list">
            <div v-if="loading" class="empty-text">불러오는 중...</div>
            <div v-else-if="!articles.length" class="empty-text">게시물이 없습니다.</div>
            <article v-else v-for="article in articles" :key="article.id" class="board-article">
                <header class="article-header">
                    <h2>{{ article.title || '제목 없음' }}</h2>
                    <div class="article-meta">
                        <span>{{ article.authorName }}</span>
                        <span>{{ formatDate(article.createdAt) }}</span>
                    </div>
                </header>
                <div class="article-content" v-html="article.contentHtml" />

                <section class="comment-list">
                    <div v-if="!article.comments.length" class="comment-empty">댓글이 없습니다.</div>
                    <div v-for="comment in article.comments" :key="comment.id" class="comment-item">
                        <div class="comment-meta">
                            <span>{{ comment.authorName }}</span>
                            <span>{{ formatDate(comment.createdAt) }}</span>
                        </div>
                        <p class="comment-content">{{ comment.content }}</p>
                    </div>
                </section>

                <div class="comment-form">
                    <textarea
                        v-model="commentDrafts[article.id]"
                        rows="3"
                        placeholder="댓글을 입력하세요."
                    />
                    <button type="button" @click="submitComment(article.id)">댓글 등록</button>
                </div>
            </article>
        </section>
    </div>
</template>

<style scoped>
.board-view {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px;
    color: #e6e8ef;
    background: #0f1118;
    min-height: 100vh;
}

.board-header h1 {
    font-size: 28px;
    margin: 0 0 6px;
}

.header-actions {
    display: flex;
    gap: 12px;
}

.header-actions .ghost {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #2b2f3f;
    color: #c7d0e0;
    text-decoration: none;
    background: #141826;
}

.header-actions .ghost:hover {
    background: #1b2233;
}

.board-subtitle {
    font-size: 14px;
    color: #a8afc5;
}

.board-editor-card {
    background: #181b26;
    padding: 20px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
}

.field-row {
    display: flex;
    gap: 12px;
    align-items: center;
}

.field-label {
    min-width: 52px;
    font-weight: 600;
    color: #c9d0e5;
}

.field-input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #2b2f3f;
    background: #11131a;
    color: #f2f4f8;
}

.editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.editor-toolbar button {
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #2b2f3f;
    background: #1e2232;
    color: #d8dff0;
    cursor: pointer;
}

.editor-toolbar button.active {
    background: #3b425c;
}

.editor-toolbar button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.hidden {
    display: none;
}

.board-editor {
    min-height: 220px;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #2b2f3f;
    background: #0f1118;
    color: #f5f6fa;
}

.board-editor :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
}

.submit-row {
    display: flex;
    justify-content: flex-end;
}

.submit-row .primary {
    padding: 10px 20px;
    border-radius: 8px;
    border: none;
    background: #3b82f6;
    color: #fff;
    cursor: pointer;
}

.error-text {
    color: #f87171;
}

.board-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.board-article {
    background: #161a24;
    border-radius: 12px;
    padding: 18px;
    border: 1px solid #202638;
}

.article-header h2 {
    margin: 0 0 6px;
    font-size: 20px;
}

.article-meta {
    font-size: 12px;
    color: #9aa3b8;
    display: flex;
    gap: 8px;
}

.article-content {
    margin-top: 12px;
    line-height: 1.6;
}

.comment-list {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.comment-item {
    background: #11131a;
    border-radius: 8px;
    padding: 10px 12px;
}

.comment-meta {
    font-size: 11px;
    color: #8e96aa;
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
}

.comment-content {
    margin: 0;
    white-space: pre-wrap;
}

.comment-form {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.comment-form textarea {
    background: #0f1118;
    border: 1px solid #2b2f3f;
    border-radius: 8px;
    padding: 8px 10px;
    color: #e6e8ef;
}

.comment-form button {
    align-self: flex-end;
    padding: 6px 14px;
    border-radius: 6px;
    border: none;
    background: #334155;
    color: #fff;
    cursor: pointer;
}

.empty-text {
    color: #9aa3b8;
}
</style>