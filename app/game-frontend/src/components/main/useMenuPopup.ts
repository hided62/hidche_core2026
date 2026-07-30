import { nextTick, onMounted, onUnmounted, ref } from 'vue';

export const useMenuPopup = () => {
    const root = ref<HTMLElement | null>(null);
    const openId = ref<string | null>(null);
    let trigger: HTMLElement | null = null;

    const close = (restoreFocus = false) => {
        openId.value = null;
        if (restoreFocus && trigger) {
            void nextTick(() => trigger?.focus());
        }
    };

    const toggle = (id: string, event: MouseEvent) => {
        const nextOpen = openId.value === id ? null : id;
        trigger = nextOpen ? (event.currentTarget as HTMLElement) : null;
        openId.value = nextOpen;
    };

    const setRoot = (element: unknown) => {
        root.value = element instanceof HTMLElement ? element : null;
    };

    const onPointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (target instanceof Node && !root.value?.contains(target)) {
            close();
        }
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && openId.value) {
            event.preventDefault();
            close(true);
        }
    };

    onMounted(() => {
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
    });

    onUnmounted(() => {
        document.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('keydown', onKeyDown);
    });

    return { setRoot, openId, close, toggle };
};
