<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { trpc } from '../utils/trpc';

type StratFinanResult = Awaited<ReturnType<typeof trpc.nation.getStratFinan.query>>;

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const editable = ref(false);

const scoutMsg = ref('');
const originalScoutMsg = ref('');
const editing = ref(false);

const editor = useEditor({
    extensions: [
        StarterKit,
        Underline,
        Link.configure({ openOnClick: false }),
        Image.configure({ inline: false }),
        Placeholder.configure({ placeholder: '임관 권유 메시지를 입력하세요.' }),
    ],
    editable: false,
    content: scoutMsg.value,
    editorProps: {
        attributes: {
            class: 'scout-editor',
        },
    },
    onUpdate({ editor }) {
        scoutMsg.value = editor.getHTML();
    },
});

const fileInputRef = ref<HTMLInputElement | null>(null);
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

const addLink = () => {
    const url = window.prompt('링크 주소를 입력하세요');
    if (!url) return;
    editor.value?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
};

const loadData = async () => {
    if (loading.value) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        const result: StratFinanResult = await trpc.nation.getStratFinan.query();
        editable.value = result.editable;
        scoutMsg.value = result.scoutMsg ?? '';
        originalScoutMsg.value = result.scoutMsg ?? '';
        if (!editing.value) {
            editor.value?.commands.setContent(scoutMsg.value || '');
        }
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '임관 권유 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const startEdit = () => {
    if (!editable.value) return;
    editing.value = true;
    editor.value?.setEditable(true);
};

const cancelEdit = () => {
    editing.value = false;
    scoutMsg.value = originalScoutMsg.value;
    editor.value?.commands.setContent(originalScoutMsg.value || '');
    editor.value?.setEditable(false);
};

const saveScoutMsg = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setScoutMsg.mutate({ msg: scoutMsg.value });
        originalScoutMsg.value = scoutMsg.value;
        editing.value = false;
        editor.value?.setEditable(false);
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '임관 권유 저장에 실패했습니다.';
    }
};

watch(
    () => editing.value,
    (value) => {
        editor.value?.setEditable(value);
    }
);

onMounted(() => {
    loadData();
});

onBeforeUnmount(() => {
    editor.value?.destroy();
});
</script>

<template>
    <div class="scout-view">
        <header class="page-header">
            <div>
                <h1>임관 권유</h1>
                <p class="subtitle">장수 모집 화면에 표시되는 메시지입니다.</p>
            </div>
            <div class="header-actions">
                <button type="button" class="ghost" @click="loadData">수동 갱신</button>
                <RouterLink class="ghost" to="/nation/affairs">내무부로</RouterLink>
            </div>
        </header>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <section class="panel">
            <div class="panel-header">
                <h2>임관 권유문</h2>
                <div class="panel-actions">
                    <button v-if="editable && !editing" type="button" @click="startEdit">수정</button>
                    <button v-if="editable && editing" type="button" @click="saveScoutMsg">저장</button>
                    <button v-if="editable && editing" type="button" @click="cancelEdit">취소</button>
                </div>
            </div>

            <div v-if="editing" class="editor-toolbar">
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
                <button type="button" @click="editor?.chain().focus().toggleBulletList().run()">목록</button>
                <button type="button" @click="editor?.chain().focus().toggleOrderedList().run()">번호 목록</button>
                <button type="button" @click="fileInputRef?.click()" :disabled="uploadBusy">이미지 업로드</button>
                <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onSelectImage" />
            </div>

            <div class="scout-editor-frame">
                <EditorContent v-if="editor" :editor="editor" />
            </div>
            <p v-if="!editable" class="hint">편집 권한은 군주/수뇌에게만 제공됩니다.</p>
        </section>

        <div v-if="loading" class="loading">불러오는 중...</div>
    </div>
</template>

<style scoped>
.scout-view {
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
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.scout-editor {
    min-height: 200px;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #2b2f3f;
    background: #0f1118;
    color: #f5f6fa;
}

.scout-editor-frame {
    max-width: 870px;
    max-height: 200px;
    overflow: hidden;
}

.editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
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

.hidden {
    display: none;
}

.hint {
    color: #9aa3b8;
    margin-top: 8px;
}

.error-text {
    color: #f87171;
}

.loading {
    color: #9aa3b8;
}
</style>