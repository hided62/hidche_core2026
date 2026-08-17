<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import CommandArgumentForm from '../main/CommandArgumentForm.vue';
import CommandSelectForm from '../main/CommandSelectForm.vue';
import { commandArgumentPresentation } from './commandArgumentPresentation';
import DragSelect from './DragSelect.vue';
import RecruitmentCommandForm from './RecruitmentCommandForm.vue';
import {
    amplifyPattern,
    CommandStorage,
    extractPattern,
    moveQueueRange,
    normalizedSelection,
    selectStep,
} from './commandQueue';
import type {
    CommandAvailability,
    CommandMapData,
    CommandMapLayout,
    CommandPatternEntry,
    CommandTable,
    ReservedCommandRow,
} from './types';

const props = withDefaults(
    defineProps<{
        scope: 'general' | 'nation';
        rows: ReservedCommandRow[];
        commandTable: CommandTable | null;
        loading: boolean;
        storageKey: string;
        maxPushTurn?: number;
        compact?: boolean;
        mobile?: boolean;
        title?: string;
        name?: string | null;
        currentTime?: string;
        mapData?: CommandMapData | null;
        mapLayout?: CommandMapLayout | null;
    }>(),
    {
        maxPushTurn: 6,
        compact: false,
        mobile: false,
        title: '',
        name: null,
        currentTime: '--:--:--',
        mapData: null,
        mapLayout: null,
    }
);

const emit = defineEmits<{
    (event: 'reserve-bulk', entries: CommandPatternEntry[]): void;
    (event: 'shift', amount: number): void;
    (event: 'repeat', amount: number): void;
}>();

const storage = shallowRef<CommandStorage | null>(null);
const editMode = ref(false);
const activeCategory = ref('');
const selected = ref(new Set<number>());
const previousSelected = ref(new Set<number>([0]));
const dragKind = ref<'replace' | 'toggle' | null>(null);
const quickTarget = ref<number | null>(null);
const pickerOpen = ref(false);
const selectedCommand = ref<CommandAvailability | null>(null);
const commandArgs = ref<Record<string, unknown>>({});
const commandArgsValid = ref(false);
const expanded = ref(false);
const menuRevision = ref(0);
const pendingReservation = ref<CommandPatternEntry | null>(null);
const pickerElement = ref<HTMLElement | null>(null);
const collapsedRowCount = 15;

const loadStorage = (key: string) => {
    storage.value = new CommandStorage(key);
    editMode.value = storage.value.editMode;
    activeCategory.value = storage.value.activeCategory;
};

onMounted(() => {
    loadStorage(props.storageKey);
});

watch(
    () => props.storageKey,
    (key, previousKey) => {
        if (key !== previousKey) loadStorage(key);
    }
);

watch([editMode, activeCategory], () => {
    if (!storage.value) return;
    storage.value.editMode = editMode.value;
    storage.value.activeCategory = activeCategory.value;
    storage.value.saveState();
    if (editMode.value) quickTarget.value = null;
});

watch(
    () => props.rows,
    (rows) => {
        const pending = pendingReservation.value;
        if (!pending) return;
        const saved = pending.turnList.every((index) => {
            const row = rows[index];
            return row?.action === pending.action && JSON.stringify(row.args ?? {}) === JSON.stringify(pending.args);
        });
        if (!saved) return;
        storage.value?.pushRecent({ ...pending, turnList: [0] });
        pendingReservation.value = null;
        releaseSelection();
        closePicker();
    },
    { deep: true }
);

const scopedTable = computed<CommandTable | null>(() => {
    if (!props.commandTable) return null;
    return {
        ...props.commandTable,
        general: props.scope === 'general' ? props.commandTable.general : [],
        nation: props.scope === 'nation' ? props.commandTable.nation : [],
    };
});
const labelMap = computed(() => {
    const map = new Map<string, string>([['휴식', '휴식']]);
    const groups = props.commandTable?.[props.scope] ?? [];
    for (const group of groups) for (const command of group.values) map.set(command.key, command.name);
    return map;
});
const displayRows = computed(() =>
    props.rows.slice(0, expanded.value || props.compact ? props.rows.length : collapsedRowCount)
);
const quickPickerTop = computed(() => `${70 + (quickTarget.value ?? 0) * 34.4}px`);
const isRecruitmentCommand = computed(
    () => selectedCommand.value?.key === 'che_징병' || selectedCommand.value?.key === 'che_모병'
);
const isRecruitmentOverlayOpen = computed(() => pickerOpen.value && isRecruitmentCommand.value);
const rowLabel = (row: ReservedCommandRow): string => row.label ?? labelMap.value.get(row.action) ?? row.action;
const selectedIndices = () => normalizedSelection(selected.value, previousSelected.value, props.rows.length);
const pattern = () => extractPattern(props.rows, selectedIndices());
const touchMenus = () => (menuRevision.value += 1);

const releaseSelection = () => {
    if (selected.value.size) previousSelected.value = new Set(selected.value);
    selected.value = new Set();
};
const setSelection = (next: Set<number>) => (selected.value = new Set(next));
const toggleSelection = (next: Set<number>) => {
    const result = new Set(selected.value);
    for (const index of next) {
        if (result.has(index)) result.delete(index);
        else result.add(index);
    }
    selected.value = result;
};
const finishDrag = (next: Set<number>) => {
    if (dragKind.value === 'toggle') toggleSelection(next);
    else setSelection(next);
    dragKind.value = null;
};

const openPicker = (turnIndex?: number) => {
    quickTarget.value = turnIndex ?? null;
    pickerOpen.value = true;
    selectedCommand.value = null;
    commandArgs.value = {};
    commandArgsValid.value = false;
};
const closePicker = () => {
    pickerOpen.value = false;
    quickTarget.value = null;
    selectedCommand.value = null;
};

let previousBodyOverflow: string | null = null;
const restoreBodyScroll = () => {
    if (previousBodyOverflow === null) return;
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = null;
};

watch(isRecruitmentOverlayOpen, async (open) => {
    if (!open) {
        restoreBodyScroll();
        return;
    }
    if (previousBodyOverflow === null) previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    await nextTick();
    pickerElement.value?.querySelector<HTMLElement>('[data-picker-close]')?.focus();
});

onBeforeUnmount(restoreBodyScroll);

const trapRecruitmentFocus = (event: KeyboardEvent) => {
    if (!isRecruitmentOverlayOpen.value || event.key !== 'Tab' || !pickerElement.value) return;
    const focusable = [
        ...pickerElement.value.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
        ),
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
};
const togglePicker = (turnIndex?: number) => {
    const target = turnIndex ?? null;
    if (pickerOpen.value && quickTarget.value === target) {
        closePicker();
        return;
    }
    openPicker(turnIndex);
};
const selectCommand = (commandKey: string) => {
    const command = props.commandTable?.[props.scope]
        .flatMap((group) => group.values)
        .find((entry) => entry.key === commandKey);
    if (!command) return;
    selectedCommand.value = command;
    commandArgs.value = {};
    commandArgsValid.value = !command.reqArg;
    if (!command.reqArg) submitCommand();
};
const submitCommand = () => {
    const command = selectedCommand.value;
    if (!command || !commandArgsValid.value) return;
    const turnList = quickTarget.value === null ? selectedIndices() : [quickTarget.value];
    const entry = { turnList, action: command.key, args: { ...commandArgs.value }, label: command.name };
    emit('reserve-bulk', [entry]);
    pendingReservation.value = entry;
};

const applyPattern = (raw: CommandPatternEntry[] | undefined) => {
    if (!raw?.length) return;
    const entries = amplifyPattern(raw, selectedIndices(), props.rows.length);
    if (entries.length) emit('reserve-bulk', entries);
    releaseSelection();
};
const copy = () => {
    storage.value?.saveClipboard(pattern());
    releaseSelection();
    touchMenus();
};
const cut = () => {
    storage.value?.saveClipboard(pattern());
    clearSelection();
    touchMenus();
};
const paste = () => applyPattern(storage.value?.clipboard);
const clearSelection = () => {
    emit('reserve-bulk', [{ turnList: selectedIndices(), action: '휴식', args: {}, label: '휴식' }]);
    releaseSelection();
};
const repeatPattern = () => {
    const indexes = selectedIndices();
    if (!indexes.length) return;
    const first = indexes[0] ?? 0;
    const last = indexes.at(-1) ?? first;
    const anchors: number[] = [];
    for (let index = first; index < props.rows.length; index += last - first + 1) anchors.push(index);
    const entries = amplifyPattern(pattern(), anchors, props.rows.length);
    if (entries.length) emit('reserve-bulk', entries);
    releaseSelection();
    previousSelected.value = new Set(Array.from({ length: last - first + 1 }, (_, i) => first + i));
};
const rearrange = (direction: 'pull' | 'push') => {
    emit('reserve-bulk', moveQueueRange(props.rows, selectedIndices(), direction));
    releaseSelection();
};
const textCopy = async () => {
    const lines = selectedIndices().map((index) => {
        const row = props.rows[index];
        return `${index + 1}턴 ${row?.label ?? labelMap.value.get(row?.action ?? '') ?? row?.action ?? ''}`;
    });
    await navigator.clipboard.writeText(lines.join('\n'));
    releaseSelection();
};
const saveTemplate = () => {
    const raw = pattern();
    const fallback = raw
        .flatMap((entry) =>
            entry.turnList.map((index) => [index, (entry.label ?? entry.action).replace(/^che_|^cr_/, '')[0] ?? ''])
        )
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((entry) => entry[1])
        .join('');
    const name = window.prompt('선택한 턴들의 별명을 지어주세요', fallback)?.trim();
    if (!name) return;
    storage.value?.setTemplate(name, raw);
    releaseSelection();
    touchMenus();
};

const clickOutsideMenu = (event: Event) => {
    const details = (event.currentTarget as HTMLElement).closest('details');
    if (details instanceof HTMLDetailsElement) details.open = false;
};
</script>

<template>
    <article
        class="reserved-command-editor"
        :class="{
            compact: props.compact,
            mobile: props.mobile,
            'edit-mode': editMode,
            'picker-open': pickerOpen,
            'argument-expanded': Boolean(
                selectedCommand?.reqArg && commandArgumentPresentation(selectedCommand.key).lines.length
            ),
        }"
        :data-command-scope="props.scope"
    >
        <header v-if="props.compact && !props.mobile" class="identity legacy-bg1">
            <span>{{ props.title }} :</span><strong>{{ props.name ?? '-' }}</strong>
        </header>

        <div class="editor-layout">
            <aside class="control-pad">
                <div v-if="props.mobile && props.compact" class="mobile-identity legacy-bg1">
                    <strong>{{ props.name ?? '-' }}</strong
                    ><span>{{ props.title }}</span>
                </div>
                <button type="button" @click="editMode = !editMode">{{ editMode ? '일반 모드' : '고급 모드' }}</button>
                <div class="clock" data-command-current-time>{{ props.currentTime }}</div>
                <details class="legacy-menu">
                    <summary>반복</summary>
                    <div class="menu-items">
                        <button
                            v-for="amount in props.maxPushTurn"
                            :key="amount"
                            @click="
                                emit('repeat', amount);
                                clickOutsideMenu($event);
                            "
                        >
                            {{ amount }}턴
                        </button>
                    </div>
                </details>

                <template v-if="editMode">
                    <details class="legacy-menu range-menu">
                        <summary>범위</summary>
                        <div class="menu-items">
                            <button
                                @click="
                                    setSelection(new Set());
                                    clickOutsideMenu($event);
                                "
                            >
                                해제
                            </button>
                            <button
                                @click="
                                    setSelection(new Set(props.rows.map((_, i) => i)));
                                    clickOutsideMenu($event);
                                "
                            >
                                모든턴
                            </button>
                            <button
                                @click="
                                    setSelection(selectStep(props.rows.length, 0, 2));
                                    clickOutsideMenu($event);
                                "
                            >
                                홀수턴
                            </button>
                            <button
                                @click="
                                    setSelection(selectStep(props.rows.length, 1, 2));
                                    clickOutsideMenu($event);
                                "
                            >
                                짝수턴
                            </button>
                            <hr class="menu-divider" />
                            <template v-for="step in [3, 4, 5, 6, 7]" :key="step">
                                <small>{{ step }}턴 간격</small>
                                <div class="step-buttons">
                                    <button
                                        v-for="begin in step"
                                        :key="begin"
                                        @click="
                                            setSelection(selectStep(props.rows.length, begin - 1, step));
                                            clickOutsideMenu($event);
                                        "
                                    >
                                        {{ begin }}
                                    </button>
                                </div>
                            </template>
                        </div>
                    </details>
                    <details class="legacy-menu">
                        <summary>보관함</summary>
                        <div :key="`templates:${menuRevision}`" class="menu-items">
                            <div
                                v-for="[templateName, entries] in storage?.templates"
                                :key="`${menuRevision}:${templateName}`"
                                class="template-row"
                            >
                                <button
                                    @click="
                                        applyPattern(entries);
                                        clickOutsideMenu($event);
                                    "
                                >
                                    {{ templateName }}
                                </button>
                                <button
                                    aria-label="보관 명령 삭제"
                                    @click="
                                        storage?.deleteTemplate(templateName);
                                        touchMenus();
                                    "
                                >
                                    삭제
                                </button>
                            </div>
                            <span v-if="!storage?.templates.size" class="empty-menu">비어 있음</span>
                        </div>
                    </details>
                    <details class="legacy-menu">
                        <summary>최근{{ props.compact ? '' : ' 실행' }}</summary>
                        <div :key="`recent:${menuRevision}`" class="menu-items">
                            <button
                                v-for="entry in [...(storage?.recent.values() ?? [])].reverse()"
                                :key="JSON.stringify([entry.action, entry.args])"
                                @click="
                                    applyPattern([entry]);
                                    clickOutsideMenu($event);
                                "
                            >
                                {{ entry.label ?? labelMap.get(entry.action) ?? entry.action }}
                            </button>
                            <span v-if="!storage?.recent.size" class="empty-menu">비어 있음</span>
                        </div>
                    </details>
                </template>

                <details v-if="props.compact" class="legacy-menu">
                    <summary>당기기</summary>
                    <div class="menu-items">
                        <button
                            v-for="amount in props.maxPushTurn"
                            :key="amount"
                            @click="
                                emit('shift', -amount);
                                clickOutsideMenu($event);
                            "
                        >
                            {{ amount }}턴
                        </button>
                    </div>
                </details>
                <details v-if="props.compact" class="legacy-menu">
                    <summary>미루기</summary>
                    <div class="menu-items">
                        <button
                            v-for="amount in props.maxPushTurn"
                            :key="amount"
                            @click="
                                emit('shift', amount);
                                clickOutsideMenu($event);
                            "
                        >
                            {{ amount }}턴
                        </button>
                    </div>
                </details>
            </aside>

            <div v-if="editMode" class="advanced-actions">
                <details class="legacy-menu selected-menu">
                    <summary>선택한 턴을</summary>
                    <div class="menu-items">
                        <button
                            @click="
                                cut();
                                clickOutsideMenu($event);
                            "
                        >
                            잘라내기
                        </button>
                        <button
                            @click="
                                copy();
                                clickOutsideMenu($event);
                            "
                        >
                            복사하기
                        </button>
                        <button
                            @click="
                                paste();
                                clickOutsideMenu($event);
                            "
                        >
                            붙여넣기
                        </button>
                        <hr class="menu-divider" />
                        <button
                            @click="
                                textCopy();
                                clickOutsideMenu($event);
                            "
                        >
                            텍스트 복사
                        </button>
                        <hr class="menu-divider" />
                        <button
                            @click="
                                saveTemplate();
                                clickOutsideMenu($event);
                            "
                        >
                            보관하기
                        </button>
                        <button
                            @click="
                                repeatPattern();
                                clickOutsideMenu($event);
                            "
                        >
                            반복하기
                        </button>
                        <hr class="menu-divider" />
                        <button
                            @click="
                                clearSelection();
                                clickOutsideMenu($event);
                            "
                        >
                            비우기
                        </button>
                        <button
                            @click="
                                rearrange('pull');
                                clickOutsideMenu($event);
                            "
                        >
                            지우고 당기기
                        </button>
                        <button
                            @click="
                                rearrange('push');
                                clickOutsideMenu($event);
                            "
                        >
                            뒤로 밀기
                        </button>
                    </div>
                </details>
                <button type="button" class="select-command" @click="togglePicker()">명령 선택 ▾</button>
            </div>

            <div class="queue-area">
                <div class="queue-grid" :class="{ advanced: editMode }">
                    <DragSelect
                        v-if="editMode"
                        v-slot="{ selected: draggingSelection }"
                        class="index-column"
                        @drag-start="dragKind = 'toggle'"
                        @drag-done="finishDrag"
                    >
                        <button
                            v-for="row in displayRows"
                            :key="row.index"
                            type="button"
                            :data-turn-index="row.index"
                            :class="{
                                selected: selected.has(row.index),
                                previous: !selected.size && previousSelected.has(row.index),
                                preview: draggingSelection.has(row.index),
                            }"
                        >
                            {{ row.index + 1 }}
                        </button>
                    </DragSelect>
                    <DragSelect
                        v-slot="{ selected: draggingSelection }"
                        class="date-column"
                        :disabled="!editMode"
                        @drag-start="dragKind = 'replace'"
                        @drag-done="finishDrag"
                    >
                        <div
                            v-for="row in displayRows"
                            :key="row.index"
                            :data-turn-index="row.index"
                            :class="{ preview: draggingSelection.has(row.index) }"
                        >
                            <template v-if="props.compact">{{ row.time ?? '--:--' }}</template>
                            <template v-else>{{ row.year ? `${row.year}年 ${row.month}月` : '' }}</template>
                        </div>
                    </DragSelect>
                    <div v-if="!props.compact" class="time-column">
                        <div v-for="row in displayRows" :key="row.index">{{ row.time ?? '--:--' }}</div>
                    </div>
                    <div class="action-column">
                        <div
                            v-for="row in displayRows"
                            :key="row.index"
                            :title="row.autonomous ? `${rowLabel(row)} · 자율 행동` : rowLabel(row)"
                            :class="{ autonomous: row.autonomous }"
                        >
                            <span>{{ rowLabel(row) }}</span>
                            <small v-if="row.autonomous && row.action === '휴식'">(자율 행동)</small>
                        </div>
                    </div>
                    <div v-if="!editMode" class="edit-column">
                        <button
                            v-for="row in displayRows"
                            :key="row.index"
                            type="button"
                            :aria-label="`${row.index + 1}턴 명령 입력`"
                            @click="togglePicker(row.index)"
                        >
                            ✎
                        </button>
                    </div>
                </div>

                <div v-if="!props.compact" class="bottom-actions">
                    <button class="legacy-button legacy-button--secondary" type="button" @click="emit('shift', -1)">
                        당기기
                    </button>
                    <button class="legacy-button legacy-button--secondary" type="button" @click="emit('shift', 1)">
                        미루기
                    </button>
                    <button class="legacy-button legacy-button--secondary" type="button" @click="expanded = !expanded">
                        {{ expanded ? '접기' : '펼치기' }}
                    </button>
                </div>
            </div>
        </div>

        <Teleport to="body" :disabled="!isRecruitmentCommand">
            <div
                v-if="pickerOpen"
                ref="pickerElement"
                class="command-picker"
                :class="{ 'recruitment-picker': isRecruitmentCommand }"
                data-testid="command-picker"
                :style="isRecruitmentCommand || quickTarget === null || props.compact ? undefined : { top: quickPickerTop }"
                :role="isRecruitmentCommand ? 'dialog' : undefined"
                :aria-modal="isRecruitmentCommand ? 'true' : undefined"
                :aria-label="
                    isRecruitmentCommand
                        ? `${selectedCommand?.name ?? ''} ${quickTarget === null ? '선택한 턴' : `${quickTarget + 1}턴`} 명령 입력`
                        : undefined
                "
                @keydown.esc.stop.prevent="closePicker"
                @keydown="trapRecruitmentFocus"
            >
                <header>
                    <strong
                        ><template v-if="isRecruitmentCommand">{{ selectedCommand?.name }} · </template
                        >{{ quickTarget === null ? '선택한 턴' : `${quickTarget + 1}턴` }} 명령 입력</strong
                    ><button data-picker-close type="button" aria-label="명령 입력 닫기" @click="closePicker">×</button>
                </header>
                <CommandSelectForm
                    v-if="!selectedCommand"
                    :command-table="scopedTable"
                    :loading="props.loading"
                    :scope="props.scope"
                    :active-category="activeCategory"
                    :allow-blocked="true"
                    @update:active-category="activeCategory = $event"
                    @select="selectCommand"
                />
                <template v-else>
                    <div class="selected-command">
                        <strong>{{ selectedCommand.name }}</strong>
                        <small v-if="selectedCommand.reason"
                            >현재 상태: {{ selectedCommand.reason }} · 예약 입력은 가능합니다.</small
                        >
                    </div>
                    <RecruitmentCommandForm
                        v-if="
                            isRecruitmentCommand &&
                            props.commandTable?.inputOptions.recruitment &&
                            (selectedCommand.key === 'che_징병' || selectedCommand.key === 'che_모병')
                        "
                        :command-key="selectedCommand.key"
                        :info="props.commandTable.inputOptions.recruitment"
                        @update:args="commandArgs = $event"
                        @update:valid="commandArgsValid = $event"
                        @submit="submitCommand"
                    />
                    <CommandArgumentForm
                        v-else-if="selectedCommand.reqArg && props.commandTable"
                        :command-key="selectedCommand.key"
                        :fields="selectedCommand.inputFields"
                        :options="props.commandTable.inputOptions"
                        :map-data="props.mapData"
                        :map-layout="props.mapLayout"
                        @update:args="commandArgs = $event"
                        @update:valid="commandArgsValid = $event"
                    />
                    <div class="picker-actions">
                        <button :disabled="Boolean(pendingReservation)" @click="selectedCommand = null">
                            명령 다시 선택</button
                        ><button :disabled="!commandArgsValid || Boolean(pendingReservation)" @click="submitCommand">
                            {{ pendingReservation ? '저장 중' : '입력' }}
                        </button>
                    </div>
                </template>
            </div>
        </Teleport>
    </article>
</template>

<style scoped>
.reserved-command-editor {
    position: relative;
    width: 100%;
    min-width: 0;
    color: #fff;
    background: #1d1d1d;
    font: 14px/1.05 var(--sammo-font-sans);
}
.reserved-command-editor.picker-open {
    z-index: 50;
}
.identity {
    box-sizing: border-box;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 16.8px;
    font-weight: 400;
}
.identity strong {
    font-weight: 400;
}
.editor-layout {
    display: flex;
    flex-direction: column;
}
.control-pad {
    order: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    padding: 3px 0;
}
.queue-area {
    order: 2;
}
.control-pad > button,
.clock,
.legacy-menu > summary,
.select-command {
    box-sizing: border-box;
    min-height: 34px;
    border: 0;
    border-radius: 4px;
    display: grid;
    place-items: center;
    padding: 4px;
    background: #444;
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    list-style: none;
}
.clock {
    background: #345c85;
    font-variant-numeric: tabular-nums;
}
.legacy-menu {
    position: relative;
    min-width: 0;
}
.legacy-menu > summary::-webkit-details-marker {
    display: none;
}
.menu-items {
    position: absolute;
    z-index: 60;
    top: 100%;
    left: 0;
    min-width: 130px;
    max-height: 330px;
    overflow: auto;
    padding: 4px;
    border: 1px solid #777;
    background: #292929;
    box-shadow: 0 4px 12px #000;
}
.menu-items > button,
.template-row button {
    box-sizing: border-box;
    width: 100%;
    min-height: 30px;
    border: 0;
    padding: 5px 8px;
    background: transparent;
    color: #fff;
    text-align: left;
    cursor: pointer;
}
.menu-items > button:hover,
.template-row button:hover {
    background: #147a64;
}
.menu-items small,
.empty-menu {
    display: block;
    padding: 5px 8px;
    color: #bbb;
}
.menu-divider {
    width: 100%;
    height: 0;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid #444;
    opacity: 1;
}
.step-buttons,
.template-row {
    display: flex;
}
.step-buttons button {
    flex: 1;
    min-width: 28px;
    min-height: 28px;
}
.template-row button:first-child {
    flex: 1;
}
.template-row button:last-child {
    width: auto;
    color: #ffaaa0;
}
.queue-grid {
    display: grid;
    grid-template-columns: 75px 40px minmax(0, 1fr) 38px;
}
.queue-grid.advanced {
    grid-template-columns: 34px 75px 40px minmax(0, 1fr);
}
.index-column,
.date-column,
.time-column,
.action-column,
.edit-column {
    display: grid;
    grid-auto-rows: 34.4px;
    min-width: 0;
}
.edit-mode .index-column,
.edit-mode .date-column,
.edit-mode .time-column,
.edit-mode .action-column {
    grid-auto-rows: 29.35px;
}
.index-column button,
.date-column > div,
.time-column > div,
.action-column > div,
.edit-column button {
    min-width: 0;
    min-height: 0;
    border: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 2px;
    color: #fff;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.index-column button {
    margin: 2px;
    border-radius: 3px;
    background: #006f98;
}
.index-column button.selected {
    background: #18a9ce;
    color: #00151d;
}
.index-column button.previous {
    background: #168e58;
}
.index-column button.preview {
    background: #eefcff;
    color: #00151d;
}
.date-column > div {
    background: #153c68;
}
.date-column > div.preview {
    color: #00ffff;
}
.time-column > div {
    background: #000;
    font-variant-numeric: tabular-nums;
}
.action-column > div {
    background: #0c1a41;
}
.action-column > div:nth-child(even) {
    background: #071638;
}
.action-column > div.autonomous {
    color: #aaffff;
}
.action-column small {
    font-size: 0.72em;
    line-height: 1;
}
.edit-column button {
    background: #444;
    cursor: pointer;
}
.advanced-actions {
    display: grid;
    grid-template-columns: 5fr 7fr;
    order: 1;
}
.advanced-actions > * {
    border-radius: 0 !important;
}
.bottom-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding-top: 3px;
}
.command-picker {
    position: absolute;
    z-index: 80;
    inset: 38px 0 auto 0;
    box-sizing: border-box;
    max-height: calc(100% - 38px);
    overflow: auto;
    padding: 6px;
    border: 1px solid #888;
    background: #303030;
    box-shadow: 0 6px 16px #000;
}
.reserved-command-editor:not(.compact) .command-picker {
    max-height: none;
    overflow: visible;
}
.command-picker > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
}
.command-picker > header button {
    width: 32px;
    height: 28px;
}
.selected-command {
    display: grid;
    gap: 3px;
    padding: 6px;
    background: #0d204d;
}
.selected-command small {
    color: #ffe0a0;
}
.picker-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
}
.picker-actions button {
    min-height: 34px;
}

.compact .editor-layout {
    display: flex;
    flex-direction: column;
}
.compact .queue-area {
    order: 1;
}
.compact .control-pad {
    order: 2;
    min-height: 79px;
    grid-template-columns: repeat(3, 1fr);
}
.compact .queue-grid {
    grid-template-columns: 40px minmax(0, 1fr) 38px;
}
.compact .queue-grid.advanced {
    grid-template-columns: 40px 32px minmax(0, 1fr);
}
.compact .date-column,
.compact .action-column,
.compact .edit-column,
.compact .index-column {
    grid-auto-rows: 30px;
}
.compact .advanced-actions {
    position: absolute;
    right: 0;
    bottom: 82px;
    left: 0;
    z-index: 15;
}
.compact .command-picker {
    top: 54px;
    height: 344px;
    max-height: 344px;
}

.command-picker.recruitment-picker {
    position: fixed;
    z-index: 1100;
    inset: 0;
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-height: none;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0;
    border: 0;
    background: #1d1d1d;
    box-shadow: none;
    transform: none;
}
.command-picker.recruitment-picker > header {
    position: sticky;
    z-index: 30;
    top: 0;
    box-sizing: border-box;
    min-height: 44px;
    padding: 6px 8px;
    border-bottom: 1px solid #777;
    background: #302016 var(--sammo-texture-walnut);
}
.command-picker.recruitment-picker > header button {
    min-width: 36px;
    min-height: 32px;
    cursor: pointer;
}
.command-picker.recruitment-picker .selected-command,
.command-picker.recruitment-picker :deep(.recruitment-command-form),
.command-picker.recruitment-picker .picker-actions {
    width: min(100%, 1000px);
    margin-right: auto;
    margin-left: auto;
}
.command-picker.recruitment-picker :deep(.recruitment-command-form) {
    flex: 1 0 auto;
}
.command-picker.recruitment-picker .picker-actions {
    position: sticky;
    z-index: 30;
    bottom: 0;
    box-sizing: border-box;
    margin-top: 0;
    padding: 6px;
    border-top: 1px solid #777;
    background: #302016 var(--sammo-texture-walnut);
}

@media (min-width: 1025px) {
    .argument-expanded:not(.compact) .command-picker {
        right: 0;
        left: auto;
        width: 700px;
    }
    .compact:not(.mobile) .command-picker {
        position: fixed;
        z-index: 1000;
        top: 86px;
        right: auto;
        left: calc(50% - 476px);
        width: 238px;
    }
    .compact.argument-expanded:not(.mobile) .command-picker {
        left: calc(50% - 350px);
        width: 700px;
        height: auto;
        max-height: calc(100vh - 104px);
        overflow: auto;
    }
}

.mobile.compact .editor-layout {
    height: 360px;
    display: grid;
    grid-template-columns: 109px 391px;
}
.mobile.compact .control-pad {
    order: initial;
    min-height: 0;
    padding: 0;
    grid-template-columns: 1fr;
    align-content: start;
}
.mobile.compact .queue-area {
    order: initial;
    padding-top: 10px;
}
.mobile.compact .queue-grid {
    grid-template-columns: 74px minmax(0, 1fr) 53px;
}
.mobile.compact .queue-grid.advanced {
    grid-template-columns: 74px 53px minmax(0, 1fr);
}
.mobile-identity {
    min-height: 60px;
    display: grid;
    place-items: center;
}
.mobile.compact .command-picker {
    top: 30px;
    left: 130px;
    width: 370px;
    height: 327px;
}
.mobile.compact.argument-expanded .command-picker {
    position: relative;
    top: auto;
    left: auto;
    width: 100%;
    height: auto;
    max-height: none;
    margin-top: -330px;
    overflow: visible;
}
.mobile.compact .advanced-actions {
    right: 0;
    bottom: 0;
    left: 109px;
}

</style>
