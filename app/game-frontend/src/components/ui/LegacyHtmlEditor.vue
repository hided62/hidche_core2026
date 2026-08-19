<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { trpc } from '../../utils/trpc';

const props = withDefaults(
    defineProps<{ modelValue: string; maxLength?: number; ariaLabel?: string }>(),
    { maxLength: 16384, ariaLabel: 'HTML 편집기' }
);
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();

const fontFamilies = [
    { label: 'Pretendard', value: 'Pretendard, sans-serif' },
    { label: '맑은 고딕', value: 'Malgun Gothic, sans-serif' },
    { label: '궁서', value: 'Gungsuh, serif' },
    { label: '돋움', value: 'Dotum, sans-serif' },
];
const fontSizes = ['8px', '10px', '12px', '14px', '18px', '22px', '28px', '36px', '48px', '72px'];
const fileInput = ref<HTMLInputElement | null>(null);
const uploadBusy = ref(false);
const uploadError = ref<string | null>(null);

const editor = useEditor({
    content: props.modelValue,
    extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        Image.configure({ inline: false, allowBase64: false }),
        TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
        TextStyleKit,
    ],
    editorProps: {
        attributes: {
            class: 'legacy-html-editor__content',
            role: 'textbox',
            'aria-label': props.ariaLabel,
            'aria-multiline': 'true',
        },
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

const setFontFamily = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!editor.value) return;
    if (value) editor.value.chain().focus().setFontFamily(value).run();
    else editor.value.chain().focus().unsetFontFamily().run();
};

const setFontSize = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!editor.value) return;
    if (value) editor.value.chain().focus().setFontSize(value).run();
    else editor.value.chain().focus().unsetFontSize().run();
};

const setColor = (event: Event, kind: 'foreground' | 'background') => {
    const value = (event.target as HTMLInputElement).value;
    if (kind === 'foreground') editor.value?.chain().focus().setColor(value).run();
    else editor.value?.chain().focus().setBackgroundColor(value).run();
};

const clearColors = () => editor.value?.chain().focus().unsetColor().unsetBackgroundColor().run();

const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
            typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('이미지를 읽을 수 없습니다.'));
        reader.onerror = () => reject(new Error('이미지를 읽는 중 오류가 발생했습니다.'));
        reader.readAsDataURL(file);
    });

const uploadImage = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || uploadBusy.value) return;
    uploadBusy.value = true;
    uploadError.value = null;
    try {
        const dataUrl = await readFileAsDataUrl(file);
        const result = await trpc.board.uploadImage.mutate({ dataUrl });
        editor.value?.chain().focus().setImage({ src: result.url, alt: file.name }).run();
    } catch (error) {
        uploadError.value = error instanceof Error ? error.message : '이미지 업로드에 실패했습니다.';
    } finally {
        uploadBusy.value = false;
        input.value = '';
    }
};

onBeforeUnmount(() => editor.value?.destroy());
</script>

<template>
    <div class="legacy-html-editor">
        <div class="legacy-html-editor__toolbar" role="toolbar" aria-label="서식">
            <button type="button" title="되돌리기" aria-label="되돌리기" @click="editor?.chain().focus().undo().run()">
                ↶
            </button>
            <button type="button" title="재실행" aria-label="재실행" @click="editor?.chain().focus().redo().run()">
                ↷
            </button>
            <button
                type="button"
                title="굵게"
                aria-label="굵게"
                :class="{ active: editor?.isActive('bold') }"
                @click="editor?.chain().focus().toggleBold().run()"
            >
                <b>B</b>
            </button>
            <button
                type="button"
                title="기울임"
                aria-label="기울임"
                :class="{ active: editor?.isActive('italic') }"
                @click="editor?.chain().focus().toggleItalic().run()"
            >
                <i>I</i>
            </button>
            <button
                type="button"
                title="밑줄"
                aria-label="밑줄"
                :class="{ active: editor?.isActive('underline') }"
                @click="editor?.chain().focus().toggleUnderline().run()"
            >
                <u>U</u>
            </button>
            <button
                type="button"
                title="취소선"
                aria-label="취소선"
                :class="{ active: editor?.isActive('strike') }"
                @click="editor?.chain().focus().toggleStrike().run()"
            >
                <s>S</s>
            </button>
            <label class="legacy-html-editor__select">
                <span class="legacy-html-editor__sr-only">글꼴</span>
                <select aria-label="글꼴" @change="setFontFamily">
                    <option value="">글꼴</option>
                    <option v-for="font in fontFamilies" :key="font.value" :value="font.value" :style="{ fontFamily: font.value }">
                        {{ font.label }}
                    </option>
                </select>
            </label>
            <label class="legacy-html-editor__select">
                <span class="legacy-html-editor__sr-only">크기</span>
                <select aria-label="글꼴 크기" @change="setFontSize">
                    <option value="">크기</option>
                    <option v-for="size in fontSizes" :key="size" :value="size" :style="{ fontSize: size }">{{ size }}</option>
                </select>
            </label>
            <label class="legacy-html-editor__color" title="글자색">
                <span class="legacy-html-editor__sr-only">글자색</span>
                <input
                    type="color"
                    aria-label="글자색"
                    :value="editor?.getAttributes('textStyle').color ?? '#ffffff'"
                    @input="setColor($event, 'foreground')"
                />
            </label>
            <label class="legacy-html-editor__color" title="배경색">
                <span class="legacy-html-editor__sr-only">배경색</span>
                <input
                    type="color"
                    aria-label="배경색"
                    :value="editor?.getAttributes('textStyle').backgroundColor ?? '#000000'"
                    @input="setColor($event, 'background')"
                />
            </label>
            <button type="button" title="글자색과 배경색 지우기" aria-label="색상 지우기" @click="clearColors">
                ◇
            </button>
            <button
                type="button"
                title="글머리 기호 목록"
                aria-label="글머리 기호 목록"
                :class="{ active: editor?.isActive('bulletList') }"
                @click="editor?.chain().focus().toggleBulletList().run()"
            >
                •
            </button>
            <button
                type="button"
                title="번호 목록"
                aria-label="번호 목록"
                :class="{ active: editor?.isActive('orderedList') }"
                @click="editor?.chain().focus().toggleOrderedList().run()"
            >
                1.
            </button>
            <button
                type="button"
                title="링크"
                aria-label="링크"
                :class="{ active: editor?.isActive('link') }"
                @click="setLink"
            >
                ↗
            </button>
            <button
                type="button"
                title="왼쪽 정렬"
                aria-label="왼쪽 정렬"
                :class="{ active: editor?.isActive({ textAlign: 'left' }) }"
                @click="editor?.chain().focus().setTextAlign('left').run()"
            >
                ≡
            </button>
            <button
                type="button"
                title="가운데 정렬"
                aria-label="가운데 정렬"
                :class="{ active: editor?.isActive({ textAlign: 'center' }) }"
                @click="editor?.chain().focus().setTextAlign('center').run()"
            >
                ≡
            </button>
            <button
                type="button"
                title="오른쪽 정렬"
                aria-label="오른쪽 정렬"
                :class="{ active: editor?.isActive({ textAlign: 'right' }) }"
                @click="editor?.chain().focus().setTextAlign('right').run()"
            >
                ≡
            </button>
            <button
                type="button"
                title="구분선"
                aria-label="구분선"
                @click="editor?.chain().focus().setHorizontalRule().run()"
            >
                ―
            </button>
            <button
                type="button"
                :disabled="uploadBusy"
                title="이미지 업로드"
                aria-label="이미지"
                @click="fileInput?.click()"
            >
                {{ uploadBusy ? '…' : '▧' }}
            </button>
            <input
                ref="fileInput"
                class="legacy-html-editor__file"
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp,.avif"
                aria-label="업로드할 이미지"
                @change="uploadImage"
            />
            <button
                type="button"
                title="서식 지우기"
                aria-label="서식 지우기"
                @click="editor?.chain().focus().unsetAllMarks().clearNodes().run()"
            >
                Tx
            </button>
        </div>
        <EditorContent :editor="editor" />
        <p v-if="uploadError" class="legacy-html-editor__error" role="alert">{{ uploadError }}</p>
    </div>
</template>

<style scoped>
.legacy-html-editor {
    border: 0;
    background: transparent;
    color: inherit;
}
.legacy-html-editor__toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    border-bottom: 0;
    padding: 0;
    background: #303030;
}
.legacy-html-editor__toolbar button,
.legacy-html-editor__toolbar select {
    box-sizing: border-box;
    min-width: 37px;
    height: 35px;
    border: 1px solid transparent;
    border-radius: 0;
    padding: 5px 10px;
    background: #303030;
    color: #fff;
    cursor: pointer;
}
.legacy-html-editor__toolbar button:hover,
.legacy-html-editor__toolbar select:hover,
.legacy-html-editor__toolbar button:focus-visible,
.legacy-html-editor__toolbar select:focus-visible {
    border-color: #9dc8f0;
    outline: 1px solid #9dc8f0;
    background: #444;
}
.legacy-html-editor__toolbar button:disabled {
    cursor: wait;
    opacity: 0.65;
}
.legacy-html-editor__toolbar button.active {
    background: #555;
}
.legacy-html-editor__select,
.legacy-html-editor__color {
    display: inline-flex;
    align-items: center;
    gap: 0;
    color: inherit;
    font-size: 12px;
}
.legacy-html-editor__select select {
    min-width: 0;
    max-width: 118px;
    padding: 5px 6px;
}
.legacy-html-editor__color input {
    box-sizing: border-box;
    width: 42px;
    height: 35px;
    border: 1px solid transparent;
    padding: 4px;
    background: #303030;
    cursor: pointer;
}
.legacy-html-editor__file {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}
.legacy-html-editor__error {
    margin: 0;
    padding: 4px 6px;
    color: #ff9b9b;
    background: rgba(80, 0, 0, 0.45);
}
:deep(.legacy-html-editor__content) {
    min-height: 42px;
    padding: 0;
    outline: none;
    overflow-wrap: anywhere;
    background: transparent;
    color: inherit;
}
.legacy-html-editor__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
button[aria-label='왼쪽 정렬'] {
    text-align: left;
}
button[aria-label='가운데 정렬'] {
    text-align: center;
}
button[aria-label='오른쪽 정렬'] {
    text-align: right;
}
@media (max-width: 500px) {
    :deep(.legacy-html-editor__content) {
        min-height: 21px;
    }
}
:deep(.legacy-html-editor__content p) {
    margin: 0 0 0.4em;
}
</style>
