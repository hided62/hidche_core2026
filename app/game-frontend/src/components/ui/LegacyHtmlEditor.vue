<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';

const props = withDefaults(defineProps<{ modelValue: string; maxLength?: number }>(), { maxLength: 16384 });
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();

const editor = useEditor({
    content: props.modelValue,
    extensions: [StarterKit, Underline, Link.configure({ openOnClick: false })],
    editorProps: {
        attributes: { class: 'legacy-html-editor__content', 'aria-label': 'HTML 편집기' },
    },
    onUpdate: ({ editor: instance }) => {
        const html = instance.getHTML();
        if (html.length <= props.maxLength) emit('update:modelValue', html);
    },
});

watch(
    () => props.modelValue,
    (value) => {
        if (editor.value && editor.value.getHTML() !== value) {
            editor.value.commands.setContent(value || '', { emitUpdate: false });
        }
    }
);

const setLink = () => {
    const previous = editor.value?.getAttributes('link').href as string | undefined;
    const href = window.prompt('링크 주소', previous ?? 'https://');
    if (href === null || !editor.value) return;
    if (!href.trim()) editor.value.chain().focus().unsetLink().run();
    else editor.value.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
};

onBeforeUnmount(() => editor.value?.destroy());
</script>

<template>
    <div class="legacy-html-editor">
        <div class="legacy-html-editor__toolbar" role="toolbar" aria-label="서식">
            <button
                type="button"
                :class="{ active: editor?.isActive('bold') }"
                @click="editor?.chain().focus().toggleBold().run()"
            >
                <b>굵게</b>
            </button>
            <button
                type="button"
                :class="{ active: editor?.isActive('italic') }"
                @click="editor?.chain().focus().toggleItalic().run()"
            >
                <i>기울임</i>
            </button>
            <button
                type="button"
                :class="{ active: editor?.isActive('underline') }"
                @click="editor?.chain().focus().toggleUnderline().run()"
            >
                <u>밑줄</u>
            </button>
            <button
                type="button"
                :class="{ active: editor?.isActive('bulletList') }"
                @click="editor?.chain().focus().toggleBulletList().run()"
            >
                목록
            </button>
            <button type="button" :class="{ active: editor?.isActive('link') }" @click="setLink">링크</button>
            <button type="button" @click="editor?.chain().focus().unsetAllMarks().clearNodes().run()">
                서식 지우기
            </button>
        </div>
        <EditorContent :editor="editor" />
    </div>
</template>

<style scoped>
.legacy-html-editor {
    border: 1px solid #777;
    background: #fff;
    color: #111;
}
.legacy-html-editor__toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    border-bottom: 1px solid #aaa;
    padding: 3px;
    background: #ddd;
}
.legacy-html-editor__toolbar button {
    border: 1px solid #777;
    border-radius: 2px;
    padding: 2px 7px;
    background: #f5f5f5;
    color: #111;
    cursor: pointer;
}
.legacy-html-editor__toolbar button.active {
    background: #b9d4f0;
}
:deep(.legacy-html-editor__content) {
    min-height: 110px;
    padding: 6px;
    outline: none;
    overflow-wrap: anywhere;
}
:deep(.legacy-html-editor__content p) {
    margin: 0 0 0.4em;
}
</style>
