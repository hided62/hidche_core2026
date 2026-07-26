<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { trpc } from '../utils/trpc';

type DiplomacyResponse = Awaited<ReturnType<typeof trpc.diplomacy.getLetters.query>>;
type DiplomacyLetter = DiplomacyResponse['letters'][number];

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const data = ref<DiplomacyResponse | null>(null);
const historyOpen = ref<Record<number, boolean>>({});

const editable = computed(() => (data.value?.permission ?? 0) >= 4);

const selectedDestNationId = ref<number | null>(null);
const selectedPrevId = ref<number | null>(null);
const briefHtml = ref('');
const detailHtml = ref('');

const briefEditor = useEditor({
    extensions: [
        StarterKit,
        Underline,
        Link.configure({ openOnClick: false }),
        Image.configure({ inline: false }),
        Placeholder.configure({ placeholder: '국가 내 공개 내용을 입력하세요.' }),
    ],
    content: '',
    editorProps: {
        attributes: {
            class: 'letter-editor',
        },
    },
    onUpdate({ editor }) {
        briefHtml.value = editor.getHTML();
    },
});

const detailEditor = useEditor({
    extensions: [
        StarterKit,
        Underline,
        Link.configure({ openOnClick: false }),
        Image.configure({ inline: false }),
        Placeholder.configure({ placeholder: '외교 권한 전용 내용을 입력하세요.' }),
    ],
    content: '',
    editorProps: {
        attributes: {
            class: 'letter-editor',
        },
    },
    onUpdate({ editor }) {
        detailHtml.value = editor.getHTML();
    },
});

const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadTarget = ref<'brief' | 'detail'>('brief');
const uploadBusy = ref(false);

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
        const target = uploadTarget.value === 'brief' ? briefEditor.value : detailEditor.value;
        target?.chain().focus().setImage({ src: result.url, alt: file.name }).run();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.';
    } finally {
        uploadBusy.value = false;
        if (input) {
            input.value = '';
        }
    }
};

const addLink = (target: 'brief' | 'detail') => {
    const url = window.prompt('링크 주소를 입력하세요');
    if (!url) return;
    const editor = target === 'brief' ? briefEditor.value : detailEditor.value;
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
};

const loadLetters = async () => {
    if (loading.value) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        const result = await trpc.diplomacy.getLetters.query();
        data.value = result;
        if (!selectedDestNationId.value && result.nations.length) {
            selectedDestNationId.value = result.nations[0]?.id ?? null;
        }
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '외교 문서를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const resetForm = () => {
    selectedPrevId.value = null;
    briefEditor.value?.commands.setContent('');
    detailEditor.value?.commands.setContent('');
    briefHtml.value = '';
    detailHtml.value = '';
};

const applyPrevLetter = () => {
    if (!selectedPrevId.value || !data.value) {
        return;
    }
    const letter = data.value.letters.find((item) => item.id === selectedPrevId.value);
    if (!letter) return;
    briefEditor.value?.commands.setContent(letter.brief ?? '');
    detailEditor.value?.commands.setContent(letter.detail ?? '');
};

const sendLetter = async () => {
    if (!editable.value || !selectedDestNationId.value) return;
    errorMessage.value = null;
    try {
        await trpc.diplomacy.sendLetter.mutate({
            destNationId: selectedDestNationId.value,
            prevId: selectedPrevId.value,
            brief: briefHtml.value,
            detail: detailHtml.value,
        });
        resetForm();
        await loadLetters();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '문서 전송에 실패했습니다.';
    }
};

const respondLetter = async (letterId: number, agree: boolean, reason?: string) => {
    errorMessage.value = null;
    try {
        await trpc.diplomacy.respondLetter.mutate({ letterId, agree, reason });
        await loadLetters();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '요청 처리에 실패했습니다.';
    }
};

const rollbackLetter = async (letterId: number) => {
    errorMessage.value = null;
    try {
        await trpc.diplomacy.rollbackLetter.mutate({ letterId });
        await loadLetters();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '문서 회수에 실패했습니다.';
    }
};

const destroyLetter = async (letterId: number) => {
    errorMessage.value = null;
    try {
        await trpc.diplomacy.destroyLetter.mutate({ letterId });
        await loadLetters();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '파기 요청에 실패했습니다.';
    }
};

const prevOptions = computed(() => data.value?.letters.filter((letter) => letter.state !== 'CANCELLED') ?? []);

const formatDate = (value: string) => new Date(value).toLocaleString('ko-KR');

const stateLabelMap: Record<DiplomacyLetter['state'], string> = {
    PROPOSED: '제안',
    ACTIVATED: '승인',
    CANCELLED: '종료',
    REPLACED: '대체',
};

const toggleHistory = (letterId: number) => {
    historyOpen.value[letterId] = !historyOpen.value[letterId];
};

const getPrevLetter = (letter: DiplomacyLetter) =>
    data.value?.letters.find((item) => item.id === letter.prevId) ?? null;

const canRespond = (letter: DiplomacyLetter) =>
    editable.value && data.value?.myNationId === letter.dest.nationId && letter.state === 'PROPOSED';

const canRollback = (letter: DiplomacyLetter) =>
    editable.value && data.value?.myNationId === letter.src.nationId && letter.state === 'PROPOSED';

const canDestroy = (letter: DiplomacyLetter) =>
    editable.value &&
    letter.state === 'ACTIVATED' &&
    (data.value?.myNationId === letter.src.nationId || data.value?.myNationId === letter.dest.nationId);

const canRenew = (letter: DiplomacyLetter) => letter.state !== 'CANCELLED';

onMounted(() => {
    void loadLetters();
});

onBeforeUnmount(() => {
    briefEditor.value?.destroy();
    detailEditor.value?.destroy();
});
</script>

<template>
    <div class="diplomacy-view">
        <header class="page-header">
            <div>
                <h1>외교부</h1>
                <p class="subtitle">외교 문서를 작성하고 버전 기록을 확인합니다.</p>
            </div>
            <div class="header-actions">
                <button type="button" class="ghost" @click="loadLetters">수동 갱신</button>
            </div>
        </header>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <section class="panel" v-if="editable">
            <div class="panel-header">
                <h2>새 외교 문서 작성</h2>
            </div>
            <div class="form-grid">
                <label>
                    이전 문서
                    <select v-model.number="selectedPrevId" @change="applyPrevLetter">
                        <option :value="null">없음</option>
                        <option v-for="letter in prevOptions" :key="letter.id" :value="letter.id">
                            #{{ letter.id }} {{ letter.src.nationName }} ↔ {{ letter.dest.nationName }}
                        </option>
                    </select>
                </label>
                <label>
                    대상 국가
                    <select v-model.number="selectedDestNationId">
                        <option v-for="nation in data?.nations ?? []" :key="nation.id" :value="nation.id">
                            {{ nation.name }}
                        </option>
                    </select>
                </label>
            </div>
            <div class="editor-group">
                <div class="editor-label">내용(국가 내 공개)</div>
                <div class="editor-toolbar">
                    <button
                        type="button"
                        @click="briefEditor?.chain().focus().toggleBold().run()"
                        :class="{ active: briefEditor?.isActive('bold') }"
                    >
                        굵게
                    </button>
                    <button
                        type="button"
                        @click="briefEditor?.chain().focus().toggleItalic().run()"
                        :class="{ active: briefEditor?.isActive('italic') }"
                    >
                        기울임
                    </button>
                    <button
                        type="button"
                        @click="briefEditor?.chain().focus().toggleUnderline().run()"
                        :class="{ active: briefEditor?.isActive('underline') }"
                    >
                        밑줄
                    </button>
                    <button type="button" @click="addLink('brief')">링크</button>
                    <button type="button" @click="briefEditor?.chain().focus().toggleBulletList().run()">목록</button>
                    <button type="button" @click="briefEditor?.chain().focus().toggleOrderedList().run()">
                        번호 목록
                    </button>
                    <button
                        type="button"
                        @click="
                            uploadTarget = 'brief';
                            fileInputRef?.click();
                        "
                        :disabled="uploadBusy"
                    >
                        이미지 업로드
                    </button>
                </div>
                <EditorContent v-if="briefEditor" :editor="briefEditor" />
            </div>
            <div class="editor-group">
                <div class="editor-label">내용(외교권자 전용)</div>
                <div class="editor-toolbar">
                    <button
                        type="button"
                        @click="detailEditor?.chain().focus().toggleBold().run()"
                        :class="{ active: detailEditor?.isActive('bold') }"
                    >
                        굵게
                    </button>
                    <button
                        type="button"
                        @click="detailEditor?.chain().focus().toggleItalic().run()"
                        :class="{ active: detailEditor?.isActive('italic') }"
                    >
                        기울임
                    </button>
                    <button
                        type="button"
                        @click="detailEditor?.chain().focus().toggleUnderline().run()"
                        :class="{ active: detailEditor?.isActive('underline') }"
                    >
                        밑줄
                    </button>
                    <button type="button" @click="addLink('detail')">링크</button>
                    <button type="button" @click="detailEditor?.chain().focus().toggleBulletList().run()">목록</button>
                    <button type="button" @click="detailEditor?.chain().focus().toggleOrderedList().run()">
                        번호 목록
                    </button>
                    <button
                        type="button"
                        @click="
                            uploadTarget = 'detail';
                            fileInputRef?.click();
                        "
                        :disabled="uploadBusy"
                    >
                        이미지 업로드
                    </button>
                </div>
                <EditorContent v-if="detailEditor" :editor="detailEditor" />
            </div>
            <div class="submit-row">
                <button type="button" class="primary" @click="sendLetter">전송</button>
            </div>
            <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onSelectImage" />
        </section>

        <section v-if="!editable" class="panel">
            <p class="hint">문서 작성 권한은 군주/수뇌에게만 제공됩니다.</p>
        </section>

        <section class="letter-list">
            <article v-for="letter in data?.letters ?? []" :key="letter.id" class="letter-card">
                <header class="letter-header">
                    <h3>#{{ letter.id }} {{ letter.src.nationName }} ↔ {{ letter.dest.nationName }}</h3>
                    <div class="letter-meta">
                        <span class="state-badge" :data-state="letter.state">{{ stateLabelMap[letter.state] }}</span>
                        <span>{{ formatDate(letter.date) }}</span>
                    </div>
                </header>
                <div class="letter-body">
                    <div class="letter-section">
                        <h4>내용(국가 내 공개)</h4>
                        <div class="letter-text" v-html="letter.brief" />
                    </div>
                    <div class="letter-section">
                        <h4>내용(외교권자 전용)</h4>
                        <div class="letter-text" v-html="letter.detail" />
                    </div>
                    <div v-if="letter.prevId" class="letter-history">
                        <button type="button" class="ghost" @click="toggleHistory(letter.id)">
                            이전 문서 {{ historyOpen[letter.id] ? '접기' : '보기' }}
                        </button>
                        <div v-if="historyOpen[letter.id]" class="history-panel">
                            <template v-if="getPrevLetter(letter)">
                                <p>
                                    #{{ getPrevLetter(letter)?.id }} {{ getPrevLetter(letter)?.src.nationName }} ↔
                                    {{ getPrevLetter(letter)?.dest.nationName }}
                                </p>
                                <div class="letter-text" v-html="getPrevLetter(letter)?.brief" />
                            </template>
                            <p v-else class="hint">이전 문서를 찾을 수 없습니다.</p>
                        </div>
                    </div>
                </div>
                <footer class="letter-actions">
                    <button v-if="canRespond(letter)" type="button" @click="respondLetter(letter.id, true)">
                        승인
                    </button>
                    <button v-if="canRespond(letter)" type="button" @click="respondLetter(letter.id, false, '거부')">
                        거부
                    </button>
                    <button v-if="canRollback(letter)" type="button" @click="rollbackLetter(letter.id)">회수</button>
                    <button v-if="canDestroy(letter)" type="button" @click="destroyLetter(letter.id)">파기</button>
                    <button
                        v-if="canRenew(letter)"
                        type="button"
                        @click="
                            selectedPrevId = letter.id;
                            applyPrevLetter();
                        "
                    >
                        추가 문서 작성
                    </button>
                </footer>
            </article>
        </section>

        <div v-if="loading" class="loading">불러오는 중...</div>
    </div>
</template>

<style scoped>
.diplomacy-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    background: #0f1118;
    color: #e6e8ef;
    min-height: 100vh;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}

.subtitle {
    color: #9aa3b8;
    margin: 4px 0 0;
}

.header-actions {
    display: flex;
    gap: 10px;
}

.ghost {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #2b2f3f;
    background: #141826;
    color: #c7d0e0;
    text-decoration: none;
    cursor: pointer;
}

.panel {
    background: #181b26;
    border-radius: 12px;
    padding: 16px;
    border: 1px solid #23283a;
}

.panel-header {
    margin-bottom: 12px;
}

.form-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin-bottom: 12px;
}

.form-grid select {
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #2b2f3f;
    background: #0f1118;
    color: #f5f6fa;
}

.editor-group {
    margin-bottom: 16px;
}

.editor-label {
    margin-bottom: 6px;
    font-weight: 600;
}

.editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
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

.letter-editor {
    min-height: 160px;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #2b2f3f;
    background: #0f1118;
    color: #f5f6fa;
}

.letter-editor :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
}

.submit-row {
    display: flex;
    justify-content: flex-end;
}

.primary {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: #3b82f6;
    color: #fff;
    cursor: pointer;
}

.letter-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.letter-card {
    background: #161a24;
    border-radius: 12px;
    padding: 16px;
    border: 1px solid #202638;
}

.letter-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}

.letter-meta {
    display: flex;
    gap: 8px;
    color: #9aa3b8;
    font-size: 12px;
}

.state-badge {
    padding: 2px 6px;
    border-radius: 999px;
    font-weight: 600;
    text-transform: uppercase;
    background: #2b3348;
    color: #e6e8ef;
}

.state-badge[data-state='PROPOSED'] {
    background: #1d4ed8;
}

.state-badge[data-state='ACTIVATED'] {
    background: #16a34a;
}

.state-badge[data-state='REPLACED'] {
    background: #6b7280;
}

.state-badge[data-state='CANCELLED'] {
    background: #b91c1c;
}

.letter-section {
    margin-top: 12px;
}

.letter-text {
    padding: 8px 0;
    line-height: 1.6;
}

.letter-history {
    margin-top: 10px;
}

.history-panel {
    margin-top: 8px;
    padding: 8px;
    border-radius: 8px;
    background: #11131a;
}

.letter-actions {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.hidden {
    display: none;
}

.hint {
    color: #9aa3b8;
}

.error-text {
    color: #f87171;
}

.loading {
    color: #9aa3b8;
}
</style>
