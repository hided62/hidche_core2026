<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { useRouter } from 'vue-router';
import { trpc } from '../utils/trpc';
import { resolveGeneralIconUrl } from '../utils/generalIcon';
import { formatSeoulDateTime } from '../utils/legacyDateTime';

type DiplomacyResponse = Awaited<ReturnType<typeof trpc.diplomacy.getLetters.query>>;
type DiplomacyLetter = DiplomacyResponse['letters'][number];

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const data = ref<DiplomacyResponse | null>(null);
const historyOpen = ref<Record<number, boolean>>({});
const router = useRouter();

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

const formatDate = (value: string) => formatSeoulDateTime(value);

const stateLabelMap: Record<DiplomacyLetter['state'], string> = {
    PROPOSED: '제안됨',
    ACTIVATED: '승인됨',
    CANCELLED: '거부됨',
    REPLACED: '대체됨',
};

const stateOptionLabelMap: Record<string, string> = {
    try_destroy_src: '송신측의 파기 요청',
    try_destroy_dest: '수신측의 파기 요청',
};

const targetNation = (letter: DiplomacyLetter) =>
    letter.src.nationId === data.value?.myNationId ? letter.dest : letter.src;

const isBrightColor = (color: string): boolean => {
    const normalized = color.trim().replace(/^#/u, '');
    if (!/^[0-9a-f]{6}$/iu.test(normalized)) return false;
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 170;
};

const nationStyle = (color: string) => ({
    backgroundColor: color || '#315f86',
    color: isBrightColor(color) ? '#000' : '#fff',
});

const signerIcon = (signer: DiplomacyLetter['src'] | DiplomacyLetter['dest']): string | null => {
    if (signer.generalIcon) return signer.generalIcon;
    if (!signer.generalPicture) return null;
    return resolveGeneralIconUrl(
        { picture: signer.generalPicture, imageServer: signer.generalImageServer },
        { legacyBaseUrl: '/image/general' }
    );
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
        <table class="legacy-layout-table legacy-bg0 page-header">
            <tbody>
                <tr>
                    <td>
                        외 교 부<br /><button class="legacy-button" type="button" @click="router.push('/')">
                            돌아가기
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <section v-if="editable" id="new-letter" class="panel new-letter">
            <div class="panel-header">
                <h2>새 외교 문서 작성</h2>
            </div>
            <label class="document-row select-row">
                <span class="row-label">이전 문서</span>
                <span class="row-content">
                    <select v-model.number="selectedPrevId" @change="applyPrevLetter">
                        <option :value="null">-새 문서-</option>
                        <option v-for="letter in prevOptions" :key="letter.id" :value="letter.id">
                            #{{ letter.id }} &lt;{{ targetNation(letter).nationName }}&gt;
                        </option>
                    </select>
                </span>
            </label>
            <label class="document-row select-row">
                <span class="row-label">대상 국가</span>
                <span class="row-content">
                    <select v-model.number="selectedDestNationId">
                        <option v-for="nation in data?.nations ?? []" :key="nation.id" :value="nation.id">
                            {{ nation.name }}
                        </option>
                    </select>
                </span>
            </label>
            <div class="document-row editor-row">
                <div class="row-label">내용(국가 내 공개)</div>
                <div class="row-content editor-content">
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
                        <button type="button" @click="briefEditor?.chain().focus().toggleBulletList().run()">
                            목록
                        </button>
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
            </div>
            <div class="document-row editor-row">
                <div class="row-label">내용(외교권자 전용)</div>
                <div class="row-content editor-content">
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
                        <button type="button" @click="detailEditor?.chain().focus().toggleBulletList().run()">
                            목록
                        </button>
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
            </div>
            <div class="document-row action-row">
                <div class="row-label">동작</div>
                <div class="row-content">
                    <button type="button" @click="sendLetter">전송</button>
                </div>
            </div>
            <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onSelectImage" />
        </section>

        <template v-if="data && !editable">
            <table class="legacy-hidden-template" aria-hidden="true">
                <thead>
                    <tr>
                        <td colspan="2"></td>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th></th>
                        <td>
                            <select>
                                <option></option>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th></th>
                        <td>
                            <select>
                                <option></option>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th></th>
                        <td><textarea></textarea></td>
                    </tr>
                    <tr>
                        <th></th>
                        <td><textarea></textarea></td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <th></th>
                        <td><button type="button"></button></td>
                    </tr>
                </tfoot>
            </table>
            <div class="legacy-hidden-template" aria-hidden="true">
                <table>
                    <thead>
                        <tr>
                            <td colspan="2"></td>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th></th>
                            <td></td>
                        </tr>
                        <tr>
                            <th></th>
                            <td></td>
                        </tr>
                        <tr>
                            <th></th>
                            <td></td>
                        </tr>
                        <tr>
                            <th></th>
                            <td></td>
                        </tr>
                        <tr>
                            <th></th>
                            <td></td>
                        </tr>
                    </tbody>
                    <tfoot>
                        <tr>
                            <th></th>
                            <td><img alt="" width="64" height="64" /><img alt="" width="64" height="64" /></td>
                        </tr>
                        <tr>
                            <th></th>
                            <td>
                                <button type="button"></button><button type="button"></button
                                ><button type="button"></button><button type="button"></button
                                ><button type="button"></button>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </template>

        <section class="letter-list">
            <article v-for="letter in data?.letters ?? []" :key="letter.id" class="letter-card">
                <header class="letter-header" :style="nationStyle(targetNation(letter).nationColor)">
                    <h3>{{ targetNation(letter).nationName }}국과의 외교 문서</h3>
                    <time>{{ formatDate(letter.date) }}</time>
                </header>
                <div class="letter-body">
                    <div class="document-row compact-row">
                        <div class="row-label">문서 번호</div>
                        <div class="row-content">#{{ letter.id }}</div>
                    </div>
                    <div class="document-row compact-row">
                        <div class="row-label">이전 문서</div>
                        <div class="row-content">
                            <button
                                v-if="letter.prevId"
                                type="button"
                                class="text-button"
                                @click="toggleHistory(letter.id)"
                            >
                                #{{ letter.prevId }}
                            </button>
                            <span v-else>신규</span>
                        </div>
                    </div>
                    <div class="document-row compact-row">
                        <div class="row-label">상태</div>
                        <div class="row-content">
                            {{ stateLabelMap[letter.state] }}
                            <span v-if="letter.stateOpt"
                                >({{ stateOptionLabelMap[letter.stateOpt] ?? letter.stateOpt }})</span
                            >
                        </div>
                    </div>
                    <div class="document-row text-row">
                        <div class="row-label">내용(국가 내 공개)</div>
                        <div class="row-content letter-text" v-html="letter.brief" />
                    </div>
                    <div class="document-row text-row">
                        <div class="row-label">내용(외교권자 전용)</div>
                        <div class="row-content letter-text" v-html="letter.detail" />
                    </div>
                    <div v-if="letter.prevId && historyOpen[letter.id]" class="document-row history-row">
                        <div class="row-label">이전 문서 내용</div>
                        <div class="row-content history-panel">
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
                    <div class="document-row signer-row">
                        <div class="row-label">서명인</div>
                        <div class="row-content signer-plate">
                            <div class="signer-card">
                                <div class="signer-image">
                                    <img
                                        v-if="signerIcon(letter.src)"
                                        :src="signerIcon(letter.src)!"
                                        width="64"
                                        height="64"
                                        alt=""
                                    />
                                </div>
                                <div :style="nationStyle(letter.src.nationColor)">{{ letter.src.nationName }}</div>
                                <div :style="nationStyle(letter.src.nationColor)">
                                    {{ letter.src.generalName ?? ' ' }}
                                </div>
                            </div>
                            <div class="signer-card">
                                <div class="signer-image">
                                    <img
                                        v-if="signerIcon(letter.dest)"
                                        :src="signerIcon(letter.dest)!"
                                        width="64"
                                        height="64"
                                        alt=""
                                    />
                                </div>
                                <div :style="nationStyle(letter.dest.nationColor)">{{ letter.dest.nationName }}</div>
                                <div :style="nationStyle(letter.dest.nationColor)">
                                    {{ letter.dest.generalName ?? ' ' }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <footer class="document-row letter-actions">
                    <div class="row-label">동작</div>
                    <div class="row-content">
                        <button v-if="canRespond(letter)" type="button" @click="respondLetter(letter.id, true)">
                            승인
                        </button>
                        <button
                            v-if="canRespond(letter)"
                            type="button"
                            @click="respondLetter(letter.id, false, '거부')"
                        >
                            거부
                        </button>
                        <button v-if="canRollback(letter)" type="button" @click="rollbackLetter(letter.id)">
                            회수
                        </button>
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
                    </div>
                </footer>
            </article>
        </section>

        <div v-if="loading" class="loading">불러오는 중...</div>
        <table class="legacy-layout-table legacy-bg0 page-footer">
            <tbody>
                <tr>
                    <td>
                        <button class="legacy-button" type="button" @click="router.push('/')">돌아가기</button
                        ><br /><br />
                        삼국지 모의전투 PHP HiDCHe - unknown / KOEI의 이미지를 사용, 응용하였습니다 / 제작 :
                        HideD(hided62@gmail.com) /
                        <a href="https://github.com/hided/SamK" target="_blank" rel="noopener noreferrer">Credit</a>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.diplomacy-view {
    width: 1000px;
    min-width: 1000px;
    margin: 0 auto;
    padding: 0;
    background-color: transparent;
    color: #fff;
    overflow-x: clip;
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
}

.legacy-layout-table {
    width: 1000px;
    margin: 0 auto;
    border-collapse: collapse;
    background-color: transparent;
}

.legacy-layout-table td {
    border: 1px solid #808080;
    padding: 0;
    text-align: left;
}

.legacy-button {
    min-height: 34px;
    padding: 5px 10px;
    border: 1px solid #2d5d7f;
    border-radius: 4px;
    background: #315f86;
    color: #fff;
    font-weight: 700;
    text-decoration: none;
}

.panel {
    width: 1000px;
    margin: 10px auto;
    border: 1px solid #666;
    background-image: var(--sammo-texture-walnut);
}

.panel-header {
    height: 18px;
    text-align: center;
}

.panel-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
}

.document-row {
    display: grid;
    grid-template-columns: 200px 800px;
    min-height: 18px;
}

.row-label {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
    font-weight: 700;
    text-align: center;
}

.row-content {
    min-width: 0;
    text-align: left;
}

.select-row .row-content,
.action-row .row-content,
.compact-row .row-content,
.letter-actions .row-content {
    text-align: center;
}

.select-row select {
    width: 300px;
    min-height: 34px;
    border: 1px solid #aaa;
    border-radius: 4px;
    background: #505050;
    color: #fff;
    text-align: center;
}

.editor-content {
    position: relative;
    min-height: 54px;
}

.editor-toolbar {
    position: absolute;
    z-index: 2;
    top: 2px;
    right: 4px;
    display: flex;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms linear;
}

.editor-content:focus-within .editor-toolbar {
    opacity: 1;
    pointer-events: auto;
}

.editor-toolbar button,
.diplomacy-view button {
    border: 1px solid #aaa;
    border-radius: 0;
    background: #666;
    color: #fff;
    font: inherit;
    cursor: pointer;
}

.diplomacy-view .legacy-button {
    border: 0;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    background-color: rgb(55 90 127);
    color: #fff;
    font-weight: 700;
    line-height: 21px;
}

.editor-toolbar button.active {
    background: #315f86;
}

.editor-content :deep(.letter-editor) {
    min-height: 54px;
    padding: 2px 4px;
    border: 0;
    outline: 0;
    background: transparent;
    color: #fff;
}

.editor-content :deep(.letter-editor img),
.letter-text :deep(img) {
    max-width: 100%;
    height: auto;
}

.letter-card {
    width: 1000px;
    margin: 10px auto;
    border: 1px solid #666;
    background-image: var(--sammo-texture-walnut);
}

.letter-header {
    position: relative;
    min-height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.letter-header h3 {
    margin: 0;
    font-size: 28px;
    font-weight: 400;
}

.letter-header time {
    position: absolute;
    right: 10px;
    bottom: 3px;
    font-size: 14px;
}

.letter-text {
    min-height: 18px;
    padding: 0;
    line-height: 1.3;
}

.letter-text :deep(p) {
    margin: 0;
}

.history-panel {
    padding: 4px;
}

.text-button {
    padding: 0;
    border: 0 !important;
    background: transparent !important;
    color: #9cf !important;
    text-decoration: underline;
}

.signer-plate {
    display: flex;
    justify-content: center;
    gap: 20px;
    padding: 4px 0;
}

.signer-card {
    width: 110px;
    border: 1px solid #888;
    text-align: center;
}

.signer-image {
    height: 64px;
    background: #fff;
}

.signer-card > div + div {
    min-height: 18px;
    border-top: 1px solid #888;
}

.letter-actions .row-content {
    padding: 2px 0;
}

.page-footer {
    min-height: 74px;
}

.page-footer a {
    color: inherit;
}

.legacy-hidden-template {
    display: none;
}

.hidden {
    display: none;
}

.hint {
    color: #9aa3b8;
}

.error-text {
    color: #f87171;
    border: 1px solid #a33;
    padding: 4px;
}

.loading {
    color: #9aa3b8;
}

@media (max-width: 1000px) {
    .diplomacy-view {
        margin: 0;
    }
}
</style>
