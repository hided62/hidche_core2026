<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useGameFeedback, type GameFeedbackKind } from '../../composables/useGameFeedback';

const { toasts, dialog, dismissToast, acknowledgeDialog, cancelDialog } = useGameFeedback();
const dialogPanel = ref<HTMLElement | null>(null);
const acknowledgeButton = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
let returnFocus: HTMLElement | null = null;
let previousBodyOverflow = '';

const titleFor = (kind: GameFeedbackKind): string => {
    if (kind === 'success') return '완료';
    if (kind === 'error') return '처리 실패';
    return '안내';
};

const iconFor = (kind: GameFeedbackKind): string => {
    if (kind === 'success') return '✓';
    if (kind === 'error') return '!';
    return 'i';
};

const restorePage = (): void => {
    document.body.style.overflow = previousBodyOverflow;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
};

watch(
    dialog,
    async (next, previous) => {
        if (next && !previous) {
            returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            previousBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        if (next) {
            await nextTick();
            (next.cancelLabel ? cancelButton.value : acknowledgeButton.value)?.focus();
            return;
        }
        if (previous) restorePage();
    },
    { flush: 'post' }
);

const handleDialogKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
        event.preventDefault();
        if (dialog.value?.cancelLabel) cancelDialog();
        else acknowledgeDialog();
        return;
    }
    if (event.key !== 'Tab' || !dialogPanel.value) return;
    const focusable = [...dialogPanel.value.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
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
    if (dialog.value) restorePage();
});
</script>

<template>
    <Teleport to="body">
        <div class="game-toast-viewport" aria-label="게임 알림">
            <TransitionGroup name="game-toast" tag="div" class="game-toast-stack">
                <article
                    v-for="toast in toasts"
                    :key="toast.id"
                    class="game-toast"
                    :class="`game-toast--${toast.kind}`"
                    :role="toast.kind === 'error' ? 'alert' : 'status'"
                    :aria-live="toast.kind === 'error' ? 'assertive' : 'polite'"
                    data-testid="game-toast"
                    :data-feedback-kind="toast.kind"
                >
                    <span class="game-feedback-icon" aria-hidden="true">{{ iconFor(toast.kind) }}</span>
                    <span class="game-feedback-copy">
                        <strong>{{ titleFor(toast.kind) }}</strong>
                        <span>{{ toast.message }}</span>
                    </span>
                    <button
                        type="button"
                        class="game-feedback-close"
                        aria-label="알림 닫기"
                        @click="dismissToast(toast.id)"
                    >
                        ×
                    </button>
                </article>
            </TransitionGroup>
        </div>

        <Transition name="game-dialog">
            <div v-if="dialog" class="game-dialog-backdrop" data-testid="game-notice-dialog">
                <section
                    ref="dialogPanel"
                    class="game-dialog-panel"
                    :class="`game-dialog-panel--${dialog.kind}`"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="game-dialog-title"
                    aria-describedby="game-dialog-message"
                    @keydown="handleDialogKeydown"
                >
                    <header>
                        <span class="game-feedback-icon" aria-hidden="true">{{ iconFor(dialog.kind) }}</span>
                        <h2 id="game-dialog-title">{{ dialog.title }}</h2>
                    </header>
                    <p id="game-dialog-message">{{ dialog.message }}</p>
                    <footer>
                        <button
                            v-if="dialog.cancelLabel"
                            ref="cancelButton"
                            type="button"
                            class="game-dialog-cancel"
                            @click="cancelDialog"
                        >
                            {{ dialog.cancelLabel }}
                        </button>
                        <button ref="acknowledgeButton" type="button" @click="acknowledgeDialog">
                            {{ dialog.acknowledgeLabel }}
                        </button>
                    </footer>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.game-toast-viewport {
    position: fixed;
    z-index: 2000;
    top: max(0.75rem, env(safe-area-inset-top));
    right: max(0.75rem, env(safe-area-inset-right));
    width: min(24rem, calc(100vw - 1.5rem));
    pointer-events: none;
}

.game-toast-stack {
    display: grid;
    gap: 0.5rem;
}

.game-toast {
    display: grid;
    grid-template-columns: 1.65rem minmax(0, 1fr) 1.8rem;
    gap: 0.65rem;
    align-items: start;
    padding: 0.75rem;
    color: #fff;
    background: rgb(12 12 12 / 96%);
    border: 1px solid #78653d;
    border-left: 4px solid #a68b52;
    box-shadow: 0 12px 30px rgb(0 0 0 / 55%);
    pointer-events: auto;
}

.game-toast--success,
.game-dialog-panel--success {
    border-left-color: #53b86b;
}

.game-toast--error,
.game-dialog-panel--error {
    border-left-color: #d85c5c;
}

.game-toast--info,
.game-dialog-panel--info {
    border-left-color: #5b91cf;
}

.game-feedback-icon {
    display: grid;
    place-items: center;
    width: 1.65rem;
    height: 1.65rem;
    color: #080808;
    background: #a68b52;
    border-radius: 999px;
    font-weight: 800;
}

.game-toast--success .game-feedback-icon,
.game-dialog-panel--success .game-feedback-icon {
    background: #53b86b;
}

.game-toast--error .game-feedback-icon,
.game-dialog-panel--error .game-feedback-icon {
    background: #d85c5c;
}

.game-toast--info .game-feedback-icon,
.game-dialog-panel--info .game-feedback-icon {
    background: #5b91cf;
}

.game-feedback-copy {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
    line-height: 1.4;
    overflow-wrap: anywhere;
}

.game-feedback-copy strong {
    color: #e5c982;
    font-size: 0.78rem;
}

.game-feedback-close {
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
    color: #ddd;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
}

.game-feedback-close:hover,
.game-feedback-close:focus-visible {
    color: #fff;
    background: #403723;
    outline: 2px solid #c8aa68;
    outline-offset: 1px;
}

.game-dialog-backdrop {
    position: fixed;
    z-index: 2100;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(0 0 0 / 78%);
}

.game-dialog-panel {
    width: min(28rem, calc(100vw - 2rem));
    padding: 1rem;
    color: #fff;
    background: #111;
    border: 1px solid #78653d;
    border-left: 4px solid #a68b52;
    box-shadow: 0 18px 48px rgb(0 0 0 / 70%);
}

.game-dialog-panel header {
    display: flex;
    gap: 0.7rem;
    align-items: center;
}

.game-dialog-panel h2,
.game-dialog-panel p {
    margin: 0;
}

.game-dialog-panel h2 {
    color: #e5c982;
    font-size: 1rem;
}

.game-dialog-panel p {
    padding: 1rem 0;
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.game-dialog-panel footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
}

.game-dialog-panel footer button {
    min-width: 5rem;
    padding: 0.45rem 0.9rem;
    color: #fff;
    background: #444;
    border: 1px solid #78653d;
    cursor: pointer;
}

.game-dialog-panel footer button:hover,
.game-dialog-panel footer button:focus-visible {
    background: #5a4a2d;
    outline: 2px solid #c8aa68;
    outline-offset: 2px;
}

.game-dialog-panel footer .game-dialog-cancel {
    color: #ddd;
    background: #292929;
    border-color: #626262;
}

.game-toast-enter-active,
.game-toast-leave-active,
.game-toast-move,
.game-dialog-enter-active,
.game-dialog-leave-active {
    transition:
        transform 160ms ease,
        opacity 160ms ease;
}

.game-toast-enter-from,
.game-toast-leave-to {
    opacity: 0;
    transform: translateX(0.75rem);
}

.game-dialog-enter-from,
.game-dialog-leave-to {
    opacity: 0;
}

@media (max-width: 640px) {
    .game-toast-viewport {
        top: auto;
        right: max(0.5rem, env(safe-area-inset-right));
        bottom: max(0.5rem, env(safe-area-inset-bottom));
        left: max(0.5rem, env(safe-area-inset-left));
        width: auto;
    }

    .game-dialog-backdrop {
        place-items: end center;
        padding: 0.75rem;
        padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }

    .game-dialog-panel {
        width: min(28rem, calc(100vw - 1.5rem));
    }

    .game-toast-enter-from,
    .game-toast-leave-to {
        transform: translateY(0.75rem);
    }
}

@media (prefers-reduced-motion: reduce) {
    .game-toast-enter-active,
    .game-toast-leave-active,
    .game-toast-move,
    .game-dialog-enter-active,
    .game-dialog-leave-active {
        transition: none;
    }
}
</style>
