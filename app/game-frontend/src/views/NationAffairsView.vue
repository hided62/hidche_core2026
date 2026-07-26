<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { trpc } from '../utils/trpc';

type StratFinanResult = Awaited<ReturnType<typeof trpc.nation.getStratFinan.query>>;

type TabKey = 'policy' | 'finance';

const activeTab = ref<TabKey>('policy');
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const data = ref<StratFinanResult | null>(null);

const editable = computed(() => data.value?.editable ?? false);

const nationMsg = ref('');
const originalNationMsg = ref('');
const editingNationMsg = ref(false);

const policyDraft = ref({
    rate: 0,
    bill: 0,
    secretLimit: 0,
    blockWar: false,
    blockScout: false,
});

const updateFromData = (payload: StratFinanResult) => {
    nationMsg.value = payload.nationMsg ?? '';
    originalNationMsg.value = payload.nationMsg ?? '';
    policyDraft.value = {
        rate: payload.policy.rate,
        bill: payload.policy.bill,
        secretLimit: payload.policy.secretLimit,
        blockWar: payload.policy.blockWar,
        blockScout: payload.policy.blockScout,
    };
    if (!editingNationMsg.value) {
        editor.value?.commands.setContent(nationMsg.value || '');
    }
};

const loadData = async () => {
    if (loading.value) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        const result = await trpc.nation.getStratFinan.query();
        data.value = result;
        updateFromData(result);
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '내무부 정보를 불러오지 못했습니다.';
    } finally {
        loading.value = false;
    }
};

const editor = useEditor({
    extensions: [
        StarterKit,
        Underline,
        Link.configure({ openOnClick: false }),
        Image.configure({ inline: false }),
        Placeholder.configure({ placeholder: '국가 방침을 입력하세요.' }),
    ],
    editable: false,
    content: nationMsg.value,
    editorProps: {
        attributes: {
            class: 'policy-editor',
        },
    },
    onUpdate({ editor }) {
        nationMsg.value = editor.getHTML();
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

const startEditNationMsg = () => {
    if (!editable.value) return;
    editingNationMsg.value = true;
    editor.value?.setEditable(true);
};

const cancelEditNationMsg = () => {
    editingNationMsg.value = false;
    nationMsg.value = originalNationMsg.value;
    editor.value?.commands.setContent(originalNationMsg.value || '');
    editor.value?.setEditable(false);
};

const saveNationMsg = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setNotice.mutate({ msg: nationMsg.value });
        originalNationMsg.value = nationMsg.value;
        editingNationMsg.value = false;
        editor.value?.setEditable(false);
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '국가 방침 저장에 실패했습니다.';
    }
};

const setRate = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setRate.mutate({ amount: policyDraft.value.rate });
        await loadData();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '세율 변경에 실패했습니다.';
    }
};

const setBill = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setBill.mutate({ amount: policyDraft.value.bill });
        await loadData();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '지급률 변경에 실패했습니다.';
    }
};

const setSecretLimit = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setSecretLimit.mutate({ amount: policyDraft.value.secretLimit });
        await loadData();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '기밀 권한 변경에 실패했습니다.';
    }
};

const setBlockWar = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setBlockWar.mutate({ value: policyDraft.value.blockWar });
        await loadData();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '전쟁 금지 설정에 실패했습니다.';
        policyDraft.value.blockWar = !policyDraft.value.blockWar;
    }
};

const setBlockScout = async () => {
    if (!editable.value) return;
    errorMessage.value = null;
    try {
        await trpc.nation.setBlockScout.mutate({ value: policyDraft.value.blockScout });
        await loadData();
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : '임관 권유 설정에 실패했습니다.';
        policyDraft.value.blockScout = !policyDraft.value.blockScout;
    }
};

const incomeGoldCity = computed(() => {
    if (!data.value) return 0;
    return (data.value.income.gold.city * policyDraft.value.rate) / 100;
});

const incomeGold = computed(() => {
    if (!data.value) return 0;
    return incomeGoldCity.value + data.value.income.gold.war;
});

const incomeRiceCity = computed(() => {
    if (!data.value) return 0;
    return (data.value.income.rice.city * policyDraft.value.rate) / 100;
});

const incomeRiceWall = computed(() => {
    if (!data.value) return 0;
    return (data.value.income.rice.wall * policyDraft.value.rate) / 100;
});

const incomeRice = computed(() => incomeRiceCity.value + incomeRiceWall.value);

const outcomeByBill = computed(() => {
    if (!data.value) return 0;
    return (data.value.outcome * policyDraft.value.bill) / 100;
});

watch(
    () => editingNationMsg.value,
    (value) => {
        editor.value?.setEditable(value);
    }
);

onMounted(() => {
    void loadData();
});

onBeforeUnmount(() => {
    editor.value?.destroy();
});
</script>

<template>
    <div class="affairs-view">
        <header class="page-header">
            <div>
                <h1>내무부</h1>
                <p class="subtitle">국가 방침 및 정책 조정</p>
            </div>
            <div class="header-actions">
                <button type="button" class="ghost" @click="loadData">수동 갱신</button>
                <RouterLink class="ghost" to="/nation/recruit-message">임관 권유 편집</RouterLink>
            </div>
        </header>

        <nav class="tab-bar">
            <button type="button" :class="{ active: activeTab === 'policy' }" @click="activeTab = 'policy'">
                국가 방침
            </button>
            <button type="button" :class="{ active: activeTab === 'finance' }" @click="activeTab = 'finance'">
                세율 · 재정 · 전쟁
            </button>
        </nav>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <section v-if="activeTab === 'policy'" class="panel">
            <div class="panel-header">
                <h2>국가 방침</h2>
                <div class="panel-actions">
                    <button v-if="editable && !editingNationMsg" type="button" @click="startEditNationMsg">수정</button>
                    <button v-if="editable && editingNationMsg" type="button" @click="saveNationMsg">저장</button>
                    <button v-if="editable && editingNationMsg" type="button" @click="cancelEditNationMsg">취소</button>
                </div>
            </div>
            <div v-if="editingNationMsg" class="editor-toolbar">
                <button
                    type="button"
                    @click="editor?.chain().focus().toggleBold().run()"
                    :class="{ active: editor?.isActive('bold') }"
                >
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
            <div class="policy-editor-frame">
                <EditorContent v-if="editor" :editor="editor" />
            </div>
            <p v-if="!editable" class="hint">편집 권한은 군주/수뇌에게만 제공됩니다.</p>
        </section>

        <section v-if="activeTab === 'finance' && data" class="panel grid">
            <div class="panel-card">
                <h3>자금 예산</h3>
                <dl>
                    <div>
                        <dt>현재</dt>
                        <dd>{{ data.gold.toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>단기 수입</dt>
                        <dd>{{ data.income.gold.war.toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>세금</dt>
                        <dd>{{ Math.floor(incomeGoldCity).toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>수입/지출</dt>
                        <dd>
                            +{{ Math.floor(incomeGold).toLocaleString() }} /
                            {{ Math.floor(-outcomeByBill).toLocaleString() }}
                        </dd>
                    </div>
                    <div>
                        <dt>국고 예산</dt>
                        <dd>{{ Math.floor(data.gold + incomeGold - outcomeByBill).toLocaleString() }}</dd>
                    </div>
                </dl>
            </div>
            <div class="panel-card">
                <h3>군량 예산</h3>
                <dl>
                    <div>
                        <dt>현재</dt>
                        <dd>{{ data.rice.toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>둔전 수입</dt>
                        <dd>{{ Math.floor(incomeRiceWall).toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>세금</dt>
                        <dd>{{ Math.floor(incomeRiceCity).toLocaleString() }}</dd>
                    </div>
                    <div>
                        <dt>수입/지출</dt>
                        <dd>
                            +{{ Math.floor(incomeRice).toLocaleString() }} /
                            {{ Math.floor(-outcomeByBill).toLocaleString() }}
                        </dd>
                    </div>
                    <div>
                        <dt>국고 예산</dt>
                        <dd>{{ Math.floor(data.rice + incomeRice - outcomeByBill).toLocaleString() }}</dd>
                    </div>
                </dl>
            </div>
            <div class="panel-card">
                <h3>세율</h3>
                <div class="input-row">
                    <input v-model.number="policyDraft.rate" type="number" min="5" max="30" :disabled="!editable" />
                    <span>%</span>
                    <button type="button" @click="setRate" :disabled="!editable">변경</button>
                </div>
            </div>
            <div class="panel-card">
                <h3>지급률</h3>
                <div class="input-row">
                    <input v-model.number="policyDraft.bill" type="number" min="20" max="200" :disabled="!editable" />
                    <span>%</span>
                    <button type="button" @click="setBill" :disabled="!editable">변경</button>
                </div>
            </div>
            <div class="panel-card">
                <h3>기밀 권한</h3>
                <div class="input-row">
                    <input
                        v-model.number="policyDraft.secretLimit"
                        type="number"
                        min="1"
                        max="99"
                        :disabled="!editable"
                    />
                    <span>년</span>
                    <button type="button" @click="setSecretLimit" :disabled="!editable">변경</button>
                </div>
            </div>
            <div class="panel-card">
                <h3>전쟁 금지 설정</h3>
                <div class="toggle-row">
                    <label>
                        <input
                            type="checkbox"
                            v-model="policyDraft.blockWar"
                            :disabled="!editable"
                            @change="setBlockWar"
                        />
                        전쟁 금지
                    </label>
                    <span class="hint"
                        >잔여 {{ data.warSettingCnt.remain }}회 (월 +{{ data.warSettingCnt.inc }}회)</span
                    >
                </div>
            </div>
            <div class="panel-card">
                <h3>임관 권유 설정</h3>
                <div class="toggle-row">
                    <label>
                        <input
                            type="checkbox"
                            v-model="policyDraft.blockScout"
                            :disabled="!editable"
                            @change="setBlockScout"
                        />
                        임관 권유 허용
                    </label>
                </div>
            </div>
        </section>

        <div v-if="loading" class="loading">불러오는 중...</div>
    </div>
</template>

<style scoped>
.affairs-view {
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

.tab-bar {
    display: flex;
    gap: 8px;
}

.tab-bar button {
    border: 1px solid #2b2f3f;
    background: #141826;
    color: #c7d0e0;
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
}

.tab-bar button.active {
    background: #2b3348;
    color: #fff;
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

.panel-actions button {
    margin-left: 8px;
}

.policy-editor {
    min-height: 220px;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #2b2f3f;
    background: #0f1118;
    color: #f5f6fa;
}

.policy-editor-frame {
    max-width: 1000px;
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

.panel.grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.panel-card {
    background: #131722;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #23283a;
}

.panel-card h3 {
    margin: 0 0 8px;
}

.panel-card dl {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
}

.panel-card dl div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
}

.input-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.input-row input {
    width: 90px;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #2b2f3f;
    background: #0f1118;
    color: #f5f6fa;
}

.toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
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
