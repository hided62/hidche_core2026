<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{ disabled?: boolean; attribute?: string }>(), {
    disabled: false,
    attribute: 'data-turn-index',
});
const emit = defineEmits<{ (event: 'drag-start'): void; (event: 'drag-done', selected: Set<number>): void }>();
const root = ref<HTMLElement | null>(null);
const preview = ref(new Set<number>());
let dragging = false;
let startX = 0;
let startY = 0;
let box: HTMLDivElement | null = null;
let activePointerId: number | null = null;

const intersects = (left: DOMRect, right: DOMRect) =>
    left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top;

const update = (clientX: number, clientY: number) => {
    if (!root.value || !box) return;
    const rootRect = root.value.getBoundingClientRect();
    const x = clientX - rootRect.left;
    const y = clientY - rootRect.top;
    box.style.left = `${Math.min(startX, x)}px`;
    box.style.top = `${Math.min(startY, y)}px`;
    box.style.width = `${Math.abs(x - startX)}px`;
    box.style.height = `${Math.abs(y - startY)}px`;
    const boxRect = box.getBoundingClientRect();
    const next = new Set<number>();
    for (const element of root.value.children) {
        if (element === box || !intersects(boxRect, element.getBoundingClientRect())) continue;
        const raw = element.getAttribute(props.attribute);
        if (raw !== null) next.add(Number(raw));
    }
    preview.value = next;
};

const pointerMove = (event: PointerEvent) =>
    dragging && event.pointerId === activePointerId && update(event.clientX, event.clientY);
const pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return;
    if (!dragging) return;
    dragging = false;
    if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
    activePointerId = null;
    box?.remove();
    box = null;
    emit('drag-done', new Set(preview.value));
    preview.value = new Set();
};
const pointerDown = (event: PointerEvent) => {
    if (props.disabled || !root.value || event.button !== 0) return;
    event.preventDefault();
    const rect = root.value.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    box = document.createElement('div');
    box.className = 'drag-selection-box';
    root.value.append(box);
    dragging = true;
    activePointerId = event.pointerId;
    root.value.setPointerCapture(event.pointerId);
    update(event.clientX, event.clientY);
    emit('drag-start');
};

onMounted(() => {
    root.value?.addEventListener('pointerdown', pointerDown);
    root.value?.addEventListener('pointermove', pointerMove);
    root.value?.addEventListener('pointerup', pointerUp);
    root.value?.addEventListener('pointercancel', pointerUp);
});
onBeforeUnmount(() => {
    root.value?.removeEventListener('pointerdown', pointerDown);
    root.value?.removeEventListener('pointermove', pointerMove);
    root.value?.removeEventListener('pointerup', pointerUp);
    root.value?.removeEventListener('pointercancel', pointerUp);
});
</script>

<template>
    <div ref="root" class="drag-select" :style="{ touchAction: props.disabled ? undefined : 'none' }">
        <slot :selected="preview" />
    </div>
</template>

<style scoped>
.drag-select {
    position: relative;
    min-width: 0;
    user-select: none;
}
.drag-select :deep(.drag-selection-box) {
    position: absolute;
    z-index: 30;
    border: 1px solid #7ee8ff;
    background: rgb(0 180 255 / 28%);
    pointer-events: none;
}
</style>
