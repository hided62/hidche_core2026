<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { trpc } from '../utils/trpc';
import { formatSeoulDateTime } from '../utils/legacyDateTime';
import { resolveGeneralIconUrl, useDefaultGeneralIcon } from '../utils/generalIcon';
import SortableStringList from '../components/ui/SortableStringList';
import { useGameFeedback } from '../composables/useGameFeedback';
import { applyCustomCss, CUSTOM_CSS_KEY } from '../utils/customCss';
import {
    DEFAULT_MOBILE_MAIN_PANEL_ORDER,
    loadMobileMainPanelOrder,
    MOBILE_MAIN_PANEL_DEFINITIONS,
    moveMobileMainPanel,
    saveMobileMainPanelOrder,
    type MobileMainPanelId,
} from '../utils/mobileMainPanelOrder';
import {
    normalizeScreenMode,
    SCREEN_MODE_CHANGE_EVENT,
    SCREEN_MODE_KEY,
    type ScreenMode,
} from '../utils/screenModeViewport';

const { success: showSuccessToast, error: showErrorToast } = useGameFeedback();
type MyGeneralResponse = Awaited<ReturnType<typeof trpc.general.me.query>>;
const data = ref<MyGeneralResponse | null>(null);
const selectedIconId = ref('');
const iconLoading = ref(false);
const iconSaving = ref(false);
const iconError = ref<string | null>(null);
const iconChoices = computed(() => data.value?.iconChoices ?? []);
const selectedIcon = computed(() => iconChoices.value.find((icon) => icon.id === selectedIconId.value) ?? null);
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const loadIcons = async () => {
    iconLoading.value = true;
    iconError.value = null;
    try {
        const general = await trpc.general.me.query();
        data.value = general;
        selectedIconId.value =
            iconChoices.value.find((icon) => icon.picture === general?.general.picture)?.id ??
            iconChoices.value[0]?.id ??
            '';
    } catch (cause) {
        iconError.value = errorText(cause);
    } finally {
        iconLoading.value = false;
    }
};

const changeGeneralIcon = async () => {
    if (!selectedIconId.value || iconSaving.value) return;
    if (!confirm('선택한 전용 아이콘으로 바꿀까요? 변경 후 24시간 동안 다시 바꿀 수 없습니다.')) return;
    iconSaving.value = true;
    try {
        await trpc.general.adjustIcon.mutate({
            iconId: selectedIconId.value,
            clientRequestId: crypto.randomUUID(),
        });
        showSuccessToast('전용 아이콘을 변경했습니다.');
        await loadIcons();
    } catch (cause) {
        showErrorToast(`전용 아이콘 변경에 실패했습니다: ${errorText(cause)}`);
    } finally {
        iconSaving.value = false;
    }
};

const screenMode = ref<ScreenMode>('auto');
const customCss = ref('');
const cssSaving = ref(false);
const mobileLayoutDialog = ref<HTMLDialogElement | null>(null);
const mobileLayoutOrder = ref<MobileMainPanelId[]>(loadMobileMainPanelOrder());
let cssTimer: number | null = null;

const mobileLayoutLabels: Readonly<Record<string, string>> = Object.fromEntries(
    MOBILE_MAIN_PANEL_DEFINITIONS.map(({ id, label }) => [id, label])
);

const openMobileLayoutDialog = () => {
    mobileLayoutOrder.value = loadMobileMainPanelOrder();
    mobileLayoutDialog.value?.showModal();
    window.requestAnimationFrame(() => mobileLayoutDialog.value?.querySelector<HTMLButtonElement>('button')?.focus());
};

const moveMobileLayoutItem = (fromIndex: number, toIndex: number) => {
    mobileLayoutOrder.value = moveMobileMainPanel(mobileLayoutOrder.value, fromIndex, toIndex);
};

const resetMobileLayoutOrder = () => {
    mobileLayoutOrder.value = [...DEFAULT_MOBILE_MAIN_PANEL_ORDER];
};

const applyMobileLayoutOrder = () => {
    mobileLayoutOrder.value = saveMobileMainPanelOrder(mobileLayoutOrder.value);
    mobileLayoutDialog.value?.close();
    showSuccessToast('모바일 메인 레이아웃 순서를 저장했습니다.');
};

watch(screenMode, (mode) => {
    window.localStorage.setItem(SCREEN_MODE_KEY, mode);
    document.dispatchEvent(new CustomEvent(SCREEN_MODE_CHANGE_EVENT));
});

watch(customCss, (text) => {
    if (cssTimer !== null) window.clearTimeout(cssTimer);
    cssSaving.value = true;
    cssTimer = window.setTimeout(() => {
        window.localStorage.setItem(CUSTOM_CSS_KEY, text);
        applyCustomCss(text);
        cssSaving.value = false;
        cssTimer = null;
    }, 500);
});

onMounted(() => {
    void loadIcons();
    screenMode.value = normalizeScreenMode(window.localStorage.getItem(SCREEN_MODE_KEY));
    customCss.value = window.localStorage.getItem(CUSTOM_CSS_KEY) ?? '';
});

onBeforeUnmount(() => {
    if (cssTimer === null) return;
    window.clearTimeout(cssTimer);
    window.localStorage.setItem(CUSTOM_CSS_KEY, customCss.value);
    applyCustomCss(customCss.value);
});
</script>

<template>
    <main id="interface-settings" class="legacy-page bg0 interface-settings-page">
        <div class="title-row">
            <span>환 경 설 정</span>
            <RouterLink class="legacy-button legacy-button--navigation" to="/">돌아가기</RouterLink>
        </div>

        <section class="settings-grid">
            <article class="settings-column">
                <h2 class="section-title">화면 크기와 배치</h2>
                <div class="settings-content">
                    <div class="screen-mode-row">
                        <span>500px/1000px 모드<br /><small>모바일 화면 폭을 즉시 바꿉니다.</small></span>
                        <div class="button-group" role="radiogroup" aria-label="화면 폭 모드">
                            <label><input v-model="screenMode" type="radio" value="auto" />자동</label>
                            <label><input v-model="screenMode" type="radio" value="500px" />500px</label>
                            <label><input v-model="screenMode" type="radio" value="1000px" />1000px</label>
                        </div>
                    </div>

                    <div class="mobile-layout-setting-row">
                        <span>
                            모바일 메인 레이아웃<br />
                            <small>500px 메인 화면의 패널 순서를 이 기기에 저장합니다.</small>
                        </span>
                        <button
                            class="legacy-button legacy-button--primary mobile-layout-open"
                            type="button"
                            @click="openMobileLayoutDialog"
                        >
                            순서 바꾸기
                        </button>
                    </div>
                </div>
            </article>

            <article class="settings-column">
                <h2 class="section-title">개인용 CSS</h2>
                <div class="settings-content">
                    <label class="custom-css">
                        브라우저에 적용할 CSS <span aria-live="polite">{{ cssSaving ? '(저장 중)' : '' }}</span>
                        <textarea id="custom_css" v-model="customCss" aria-label="개인용 CSS" />
                    </label>
                    <p class="css-hint">변경 사항은 이 기기에 자동 저장됩니다.</p>
                </div>
            </article>
            <article
                v-if="iconLoading || iconError || (data?.canChangeIcon && iconChoices.length)"
                class="settings-column"
            >
                <h2 class="section-title">전용 아이콘</h2>
                <p v-if="iconLoading" class="settings-content" role="status">아이콘 목록을 불러오는 중입니다.</p>
                <div v-else-if="iconError" class="settings-content" role="alert">
                    <p>{{ iconError }}</p>
                    <button class="legacy-button legacy-button--secondary" type="button" @click="loadIcons">
                        다시 불러오기
                    </button>
                </div>
                <div v-else-if="data?.canChangeIcon && iconChoices.length" class="settings-content general-icon-action">
                    전용 아이콘 변경 (24시간에 1회)<br />
                    <span v-if="data.iconChangeAvailableAt" class="css-hint">
                        다음 변경 가능: {{ formatSeoulDateTime(data.iconChangeAvailableAt) }}
                    </span>
                    <div v-if="selectedIcon" class="selected-general-icon" aria-live="polite">
                        <img
                            :src="resolveGeneralIconUrl(selectedIcon)"
                            width="64"
                            height="64"
                            alt=""
                            @error="useDefaultGeneralIcon"
                        />
                        <strong>{{ data.general.name }}</strong>
                    </div>
                    <div class="general-icon-list" role="radiogroup" aria-label="장수 전용 아이콘 선택">
                        <label v-for="icon in iconChoices" :key="icon.id" class="general-icon-choice">
                            <input v-model="selectedIconId" type="radio" :value="icon.id" />
                            <img
                                :src="resolveGeneralIconUrl(icon)"
                                width="64"
                                height="64"
                                alt=""
                                @error="useDefaultGeneralIcon"
                            />
                        </label>
                    </div>
                    <button
                        class="legacy-button legacy-button--primary"
                        type="button"
                        :disabled="iconSaving || iconLoading"
                        @click="changeGeneralIcon"
                    >
                        아이콘 변경
                    </button>
                </div>
            </article>
        </section>

        <footer class="legacy-credit">
            삼국지 모의전투 HiDCHe / KOEI의 이미지를 사용, 응용하였습니다 / 제작: HideD / Credit
        </footer>
    </main>

    <dialog ref="mobileLayoutDialog" class="mobile-layout-dialog" aria-labelledby="mobile-layout-dialog-title">
        <div class="mobile-layout-dialog__header">
            <h2 id="mobile-layout-dialog-title">모바일 레이아웃 순서 바꾸기</h2>
            <form method="dialog">
                <button
                    class="legacy-button legacy-button--secondary"
                    type="submit"
                    aria-label="모바일 레이아웃 순서 창 닫기"
                >
                    ×
                </button>
            </form>
        </div>
        <p>항목을 끌어 놓거나 위·아래 버튼으로 상대 순서를 바꿉니다.</p>
        <SortableStringList v-model:list="mobileLayoutOrder" tag="ol" class="mobile-layout-list">
            <template #item="{ element: panelId, index }">
                <li :data-mobile-layout-id="panelId">
                    <span class="mobile-layout-handle" aria-hidden="true">≡</span>
                    <span class="mobile-layout-label">
                        <span class="mobile-layout-position">{{ index + 1 }}</span>
                        {{ mobileLayoutLabels[panelId] }}
                    </span>
                    <span class="mobile-layout-move-buttons">
                        <button
                            class="legacy-button legacy-button--secondary"
                            type="button"
                            :aria-label="`${mobileLayoutLabels[panelId]} 위로`"
                            :disabled="index === 0"
                            @click="moveMobileLayoutItem(index, index - 1)"
                        >
                            ↑
                        </button>
                        <button
                            class="legacy-button legacy-button--secondary"
                            type="button"
                            :aria-label="`${mobileLayoutLabels[panelId]} 아래로`"
                            :disabled="index === mobileLayoutOrder.length - 1"
                            @click="moveMobileLayoutItem(index, index + 1)"
                        >
                            ↓
                        </button>
                    </span>
                </li>
            </template>
        </SortableStringList>
        <div class="mobile-layout-dialog__actions">
            <button class="legacy-button legacy-button--secondary" type="button" @click="resetMobileLayoutOrder">
                기본값
            </button>
            <form method="dialog">
                <button class="legacy-button legacy-button--secondary" type="submit">취소</button>
            </form>
            <button
                class="legacy-button legacy-button--primary mobile-layout-apply"
                type="button"
                @click="applyMobileLayoutOrder"
            >
                적용
            </button>
        </div>
    </dialog>
</template>

<style scoped>
.legacy-page {
    box-sizing: border-box;
    width: 100%;
    max-width: 1000px;
    min-height: 0;
    margin: 0 auto;
    padding: 0;
    color: #fff;
    background-color: transparent;
    background-image: var(--sammo-texture-walnut);
    font-family: var(--sammo-font-sans);
    font-size: 14px;
    line-height: 1.3;
}
.title-row {
    min-height: 54px;
    display: flex;
    align-content: flex-start;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    border: 1px solid #666;
    background: transparent;
}
.title-row > span {
    flex-basis: 100%;
    height: 18px;
}
.title-row .legacy-button {
    min-width: 90px;
}
.css-hint {
    margin: 0;
    color: orange;
}
.settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}
.settings-column {
    border: 1px solid #666;
    background-image: var(--sammo-texture-walnut);
}
.section-title {
    min-height: 34px;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #666;
    background-color: #14241b;
    background-image: var(--sammo-texture-green);
    color: skyblue;
    font-size: 1.25em;
    font-weight: 500;
}
.settings-content {
    padding: 10px 18px;
}
.screen-mode-row,
.mobile-layout-setting-row {
    display: grid;
    align-items: center;
    gap: 8px;
    margin: 8px 0 14px;
}
.screen-mode-row {
    grid-template-columns: 160px 1fr;
}
.mobile-layout-setting-row {
    grid-template-columns: minmax(0, 1fr) 128px;
}
.screen-mode-row small,
.mobile-layout-setting-row small,
.css-hint {
    color: orange;
}
.button-group {
    display: flex;
}
.button-group label {
    padding: 5px 8px;
    border: 1px solid #666;
    background: #26384d;
}
.button-group input {
    margin-right: 4px;
}
.mobile-layout-open {
    min-height: 34px;
    font-weight: 700;
}
.custom-css {
    display: block;
}
.custom-css textarea {
    box-sizing: border-box;
    display: block;
    width: 420px;
    max-width: 100%;
    height: 150px;
    border: 1px solid #777;
    border-radius: 0;
    color: #fff;
    background: #000;
    font: inherit;
}
.css-hint {
    margin-top: 6px;
}
.legacy-credit {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
}
.mobile-layout-dialog {
    box-sizing: border-box;
    width: min(460px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    margin: auto;
    overflow: auto;
    border: 1px solid #777;
    border-radius: 4px;
    padding: 12px;
    background: #171717 var(--sammo-texture-walnut);
    color: #fff;
    font: 14px/1.3 var(--sammo-font-sans);
}
.mobile-layout-dialog::backdrop {
    background: rgb(0 0 0 / 72%);
}
.mobile-layout-dialog__header,
.mobile-layout-dialog__actions,
.mobile-layout-move-buttons {
    display: flex;
    align-items: center;
}
.mobile-layout-dialog__header {
    justify-content: space-between;
    gap: 12px;
}
.mobile-layout-dialog__header h2,
.mobile-layout-dialog p {
    margin: 0 0 10px;
}
.mobile-layout-dialog__header h2 {
    color: skyblue;
    font-size: 18px;
}
.mobile-layout-dialog__header form,
.mobile-layout-dialog__actions form {
    margin: 0;
}
.mobile-layout-dialog__header button {
    min-width: 32px;
    min-height: 32px;
    font-size: 20px;
}
.mobile-layout-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}
.mobile-layout-list > li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    min-height: 44px;
    align-items: center;
    border: 1px solid #777;
    background: #172a52 var(--sammo-texture-blue);
    cursor: grab;
}
.mobile-layout-list > li:active {
    cursor: grabbing;
}
.mobile-layout-handle {
    color: #aaa;
    text-align: center;
    font-size: 20px;
}
.mobile-layout-label {
    min-width: 0;
    font-weight: 700;
}
.mobile-layout-position {
    display: inline-grid;
    width: 22px;
    height: 22px;
    place-items: center;
    margin-right: 4px;
    border: 1px solid #7186a7;
    border-radius: 50%;
    font-size: 12px;
}
.mobile-layout-move-buttons {
    gap: 4px;
    padding-right: 5px;
}
.mobile-layout-move-buttons button {
    width: 36px;
    min-height: 34px;
    font-weight: 700;
}
.mobile-layout-dialog__actions {
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
}
.mobile-layout-dialog__actions button {
    min-height: 34px;
    padding: 4px 10px;
}
.mobile-layout-dialog__actions .mobile-layout-apply {
    font-weight: 700;
}
.general-icon-list {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin: 6px 0;
}
.selected-general-icon {
    display: flex;
    max-width: 260px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin: 8px auto;
    padding: 6px 10px;
    border: 1px solid #666;
    background: rgb(23 42 82 / 70%);
}
.selected-general-icon img {
    flex: 0 0 var(--sammo-general-icon-size);
    width: var(--sammo-general-icon-size);
    height: var(--sammo-general-icon-size);
    object-fit: cover;
}
.general-icon-choice {
    display: flex;
    align-items: center;
    gap: 2px;
}
.general-icon-action {
    text-align: center;
}
@media (max-width: 939.98px) {
    .settings-grid {
        grid-template-columns: 1fr;
    }
}
@media (max-width: 600px) {
    .screen-mode-row,
    .mobile-layout-setting-row {
        grid-template-columns: 1fr;
    }
    .button-group {
        overflow-x: auto;
    }
    .mobile-layout-open,
    .custom-css textarea {
        width: 100%;
    }
}
</style>
