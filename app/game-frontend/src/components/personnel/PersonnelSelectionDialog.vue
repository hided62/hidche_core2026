<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

type SelectionMetric = {
    label: string;
    value: string;
};

type SelectionItem = {
    id: number;
    name: string;
    subtitle: string;
    searchText: string;
    accent?: 'current' | 'assigned' | 'available';
    iconBackground?: string;
    badges?: string[];
    stats?: SelectionMetric[];
    details?: SelectionMetric[];
};

const props = withDefaults(
    defineProps<{
        open: boolean;
        title: string;
        description: string;
        items: SelectionItem[];
        selectedId: number;
        searchPlaceholder?: string;
        vacancyLabel?: string | null;
    }>(),
    {
        searchPlaceholder: '이름이나 조건으로 검색',
        vacancyLabel: null,
    }
);

const emit = defineEmits<{
    cancel: [];
    select: [id: number];
}>();

const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const dialogPanel = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;
let previousBodyOverflow = '';

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase('ko-KR'));
const filteredItems = computed(() => {
    const keyword = normalizedQuery.value;
    if (!keyword) return props.items;
    return props.items.filter((item) => item.searchText.toLocaleLowerCase('ko-KR').includes(keyword));
});

const close = (): void => emit('cancel');
const select = (id: number): void => emit('select', id);

const restorePage = (): void => {
    document.body.style.overflow = previousBodyOverflow;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
};

watch(
    () => props.open,
    async (open, previous) => {
        if (open && !previous) {
            query.value = '';
            returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            previousBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            await nextTick();
            searchInput.value?.focus();
            return;
        }
        if (!open && previous) restorePage();
    },
    { flush: 'post' }
);

const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
    }
    if (event.key !== 'Tab' || !dialogPanel.value) return;
    const focusable = [
        ...dialogPanel.value.querySelectorAll<HTMLElement>(
            'input:not(:disabled), button:not(:disabled), [tabindex="0"]'
        ),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
    }
};

onBeforeUnmount(() => {
    if (props.open) restorePage();
});
</script>

<template>
    <Teleport to="body">
        <Transition name="personnel-picker">
            <div v-if="open" class="personnel-picker-backdrop" @click.self="close">
                <section
                    ref="dialogPanel"
                    class="personnel-picker"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="personnel-picker-title"
                    aria-describedby="personnel-picker-description"
                    data-testid="personnel-selection-dialog"
                    @keydown="handleKeydown"
                >
                    <header class="personnel-picker-header">
                        <div>
                            <p class="personnel-picker-eyebrow">인사부 선택 도우미</p>
                            <h2 id="personnel-picker-title">{{ title }}</h2>
                            <p id="personnel-picker-description">{{ description }}</p>
                        </div>
                        <button type="button" class="personnel-picker-close" aria-label="선택 창 닫기" @click="close">
                            ×
                        </button>
                    </header>

                    <label class="personnel-picker-search">
                        <span class="sr-only">{{ searchPlaceholder }}</span>
                        <span aria-hidden="true">⌕</span>
                        <input ref="searchInput" v-model="query" type="search" :placeholder="searchPlaceholder" />
                    </label>

                    <div class="personnel-picker-results" aria-label="선택 후보">
                        <button
                            v-if="vacancyLabel"
                            type="button"
                            class="personnel-picker-card vacancy-card"
                            :class="{ selected: selectedId === 0 }"
                            :aria-pressed="selectedId === 0"
                            @click="select(0)"
                        >
                            <span class="vacancy-icon" aria-hidden="true">＋</span>
                            <span>
                                <strong>{{ vacancyLabel }}</strong>
                                <small>현재 관직을 비우려면 선택하세요.</small>
                            </span>
                            <span v-if="selectedId === 0" class="selection-check">선택됨</span>
                        </button>

                        <button
                            v-for="item in filteredItems"
                            :key="item.id"
                            type="button"
                            class="personnel-picker-card"
                            :class="[
                                item.accent ? `personnel-picker-card--${item.accent}` : '',
                                { selected: selectedId === item.id },
                            ]"
                            :aria-pressed="selectedId === item.id"
                            @click="select(item.id)"
                        >
                            <span
                                v-if="item.iconBackground"
                                class="personnel-picker-portrait"
                                :style="{ backgroundImage: item.iconBackground }"
                                aria-hidden="true"
                            />
                            <span v-else class="personnel-picker-city-icon" aria-hidden="true">城</span>

                            <span class="personnel-picker-card-body">
                                <span class="personnel-picker-card-title">
                                    <span>
                                        <strong>{{ item.name }}</strong>
                                        <small>{{ item.subtitle }}</small>
                                    </span>
                                    <span v-if="selectedId === item.id" class="selection-check">선택됨</span>
                                </span>

                                <span v-if="item.badges?.length" class="personnel-picker-badges">
                                    <span v-for="badge in item.badges" :key="badge">{{ badge }}</span>
                                </span>

                                <span v-if="item.stats?.length" class="personnel-picker-stats">
                                    <span v-for="stat in item.stats" :key="stat.label">
                                        <small>{{ stat.label }}</small>
                                        <strong>{{ stat.value }}</strong>
                                    </span>
                                </span>

                                <span v-if="item.details?.length" class="personnel-picker-details">
                                    <span v-for="detail in item.details" :key="detail.label">
                                        <small>{{ detail.label }}</small>
                                        <span>{{ detail.value }}</span>
                                    </span>
                                </span>
                            </span>
                        </button>

                        <p v-if="filteredItems.length === 0" class="personnel-picker-empty">
                            검색 조건에 맞는 후보가 없습니다.
                        </p>
                    </div>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.personnel-picker-backdrop {
    position: fixed;
    z-index: 2050;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgb(0 0 0 / 78%);
    backdrop-filter: blur(3px);
}
.personnel-picker {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    width: min(780px, calc(100vw - 36px));
    max-height: min(760px, calc(100vh - 36px));
    overflow: hidden;
    color: #f6f2e8;
    background: #121411;
    border: 1px solid #78653d;
    border-radius: 14px;
    box-shadow: 0 24px 70px rgb(0 0 0 / 78%);
    font: 14px/1.45 var(--sammo-font-sans);
}
.personnel-picker-header {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px 22px 16px;
    background: #29281f;
    border-bottom: 1px solid #53482f;
}
.personnel-picker-eyebrow {
    margin: 0 0 3px;
    color: #cbb171;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.13em;
}
.personnel-picker h2 {
    margin: 0;
    font-size: 22px;
    line-height: 1.25;
}
.personnel-picker-header p:last-child {
    margin: 7px 0 0;
    color: #c9c8c2;
}
.personnel-picker-close {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    border: 1px solid #6d634d;
    border-radius: 999px;
    padding: 0;
    color: #ddd7ca;
    background: rgb(0 0 0 / 28%);
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
}
.personnel-picker-search {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    align-items: center;
    margin: 14px 16px 10px;
    padding: 0 12px;
    color: #cbb171;
    background: #080a08;
    border: 1px solid #555949;
    border-radius: 9px;
}
.personnel-picker-search input {
    min-width: 0;
    height: 42px;
    border: 0;
    outline: 0;
    color: #fff;
    background: transparent;
    font: inherit;
}
.personnel-picker-search:focus-within {
    border-color: #c7a85e;
    box-shadow: 0 0 0 2px rgb(199 168 94 / 28%);
}
.personnel-picker-results {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    min-height: 160px;
    padding: 6px 16px 18px;
    overflow-y: auto;
    overscroll-behavior: contain;
}
.personnel-picker-card {
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    min-width: 0;
    padding: 12px;
    color: #f4f1e8;
    background: #1a1d18;
    border: 1px solid #474b3d;
    border-left: 4px solid #6f7560;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
}
.personnel-picker-card:hover {
    background: #24291f;
    border-color: #8d835f;
    transform: translateY(-1px);
}
.personnel-picker-card:focus,
.personnel-picker-card:focus-visible,
.personnel-picker-close:focus,
.personnel-picker-close:focus-visible {
    outline: 2px solid #f3d27d;
    outline-offset: 2px;
}
.personnel-picker-card.selected {
    background: #252919;
    border-color: #d2b45f;
    box-shadow: inset 0 0 0 1px rgb(210 180 95 / 45%);
}
.personnel-picker-card--current {
    border-left-color: #e36060;
}
.personnel-picker-card--assigned {
    border-left-color: #d7a83f;
}
.personnel-picker-card--available {
    border-left-color: #65a978;
}
.personnel-picker-portrait,
.personnel-picker-city-icon,
.vacancy-icon {
    width: 58px;
    height: 58px;
    border: 1px solid #5c5f50;
    border-radius: 10px;
    background-color: #0b0c0a;
}
.personnel-picker-portrait {
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
}
.personnel-picker-city-icon,
.vacancy-icon {
    display: grid;
    place-items: center;
    color: #d8be79;
    background: #25271f;
    font: 700 24px/1 var(--sammo-font-sans);
}
.personnel-picker-card-body,
.personnel-picker-card-title,
.personnel-picker-card-title > span:first-child {
    display: grid;
    min-width: 0;
}
.personnel-picker-card-title {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
}
.personnel-picker-card-title strong,
.vacancy-card strong {
    font-size: 16px;
}
.personnel-picker-card-title small,
.vacancy-card small {
    color: #b8b8b2;
}
.selection-check {
    align-self: start;
    padding: 2px 6px;
    color: #13150f;
    background: #d5bb6f;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
}
.personnel-picker-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
}
.personnel-picker-badges span {
    padding: 2px 6px;
    color: #ddd5c0;
    background: #32352d;
    border: 1px solid #555948;
    border-radius: 999px;
    font-size: 10px;
}
.personnel-picker-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
    margin-top: 9px;
}
.personnel-picker-stats > span {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 4px 6px;
    background: #0e100d;
    border-radius: 5px;
}
.personnel-picker-stats small,
.personnel-picker-details small {
    color: #aaa99f;
    font-size: 10px;
}
.personnel-picker-stats strong {
    color: #f1d47e;
}
.personnel-picker-details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px 10px;
    margin-top: 8px;
}
.personnel-picker-details > span {
    display: flex;
    gap: 5px;
    min-width: 0;
}
.personnel-picker-details > span > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vacancy-card {
    grid-template-columns: 58px minmax(0, 1fr) auto;
    align-items: center;
}
.vacancy-card > span:nth-child(2) {
    display: grid;
}
.personnel-picker-empty {
    grid-column: 1 / -1;
    margin: 40px 0;
    color: #bdbbb2;
    text-align: center;
}
.sr-only {
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
.personnel-picker-enter-active,
.personnel-picker-leave-active {
    transition: opacity 150ms ease;
}
.personnel-picker-enter-active .personnel-picker,
.personnel-picker-leave-active .personnel-picker {
    transition:
        transform 150ms ease,
        opacity 150ms ease;
}
.personnel-picker-enter-from,
.personnel-picker-leave-to,
.personnel-picker-enter-from .personnel-picker,
.personnel-picker-leave-to .personnel-picker {
    opacity: 0;
}
.personnel-picker-enter-from .personnel-picker,
.personnel-picker-leave-to .personnel-picker {
    transform: translateY(10px) scale(0.985);
}
@media (max-width: 620px) {
    .personnel-picker-backdrop {
        align-items: end;
        padding: 0;
    }
    .personnel-picker {
        width: 100vw;
        max-height: min(88vh, calc(100vh - env(safe-area-inset-top)));
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: 16px 16px 0 0;
    }
    .personnel-picker-header {
        padding: 16px;
    }
    .personnel-picker-results {
        grid-template-columns: 1fr;
        padding-bottom: max(18px, env(safe-area-inset-bottom));
    }
}
@media (prefers-reduced-motion: reduce) {
    .personnel-picker-enter-active,
    .personnel-picker-leave-active,
    .personnel-picker-enter-active .personnel-picker,
    .personnel-picker-leave-active .personnel-picker {
        transition: none;
    }
}
</style>
