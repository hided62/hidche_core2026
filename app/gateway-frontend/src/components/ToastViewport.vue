<script setup lang="ts">
import { useToast, type ToastKind } from '../composables/useToast';

const { toasts, dismiss } = useToast();

const titleFor = (kind: ToastKind): string => {
    if (kind === 'success') return '완료';
    if (kind === 'error') return '처리 실패';
    return '안내';
};

const iconFor = (kind: ToastKind): string => {
    if (kind === 'success') return '✓';
    if (kind === 'error') return '!';
    return 'i';
};
</script>

<template>
    <Teleport to="body">
        <div class="toast-viewport" aria-label="작업 알림">
            <TransitionGroup name="toast" tag="div" class="toast-stack">
                <article
                    v-for="toast in toasts"
                    :key="toast.id"
                    class="toast-card"
                    :class="`toast-card--${toast.kind}`"
                    :role="toast.kind === 'error' ? 'alert' : 'status'"
                    :aria-live="toast.kind === 'error' ? 'assertive' : 'polite'"
                    data-testid="action-toast"
                    :data-toast-kind="toast.kind"
                >
                    <span class="toast-icon" aria-hidden="true">{{ iconFor(toast.kind) }}</span>
                    <span class="toast-copy">
                        <strong>{{ titleFor(toast.kind) }}</strong>
                        <span>{{ toast.message }}</span>
                    </span>
                    <button type="button" class="toast-close" aria-label="알림 닫기" @click="dismiss(toast.id)">
                        ×
                    </button>
                </article>
            </TransitionGroup>
        </div>
    </Teleport>
</template>

<style scoped>
.toast-viewport {
    position: fixed;
    z-index: 1000;
    top: max(1rem, env(safe-area-inset-top));
    right: max(1rem, env(safe-area-inset-right));
    width: min(25rem, calc(100vw - 2rem));
    pointer-events: none;
}

.toast-stack {
    display: grid;
    gap: 0.625rem;
}

.toast-card {
    display: grid;
    grid-template-columns: 1.75rem minmax(0, 1fr) 2rem;
    gap: 0.75rem;
    align-items: start;
    padding: 0.875rem;
    color: #f4f4f5;
    background: rgb(24 24 27 / 96%);
    border: 1px solid #52525b;
    border-left-width: 4px;
    border-radius: 0.625rem;
    box-shadow: 0 14px 38px rgb(0 0 0 / 45%);
    pointer-events: auto;
    backdrop-filter: blur(8px);
}

.toast-card--success {
    border-left-color: #34d399;
}

.toast-card--error {
    border-left-color: #fb7185;
}

.toast-card--info {
    border-left-color: #60a5fa;
}

.toast-icon {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    font-weight: 800;
    color: #09090b;
    background: #a1a1aa;
    border-radius: 999px;
}

.toast-card--success .toast-icon {
    background: #34d399;
}

.toast-card--error .toast-icon {
    background: #fb7185;
}

.toast-card--info .toast-icon {
    background: #60a5fa;
}

.toast-copy {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
}

.toast-copy strong {
    color: #fff;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
}

.toast-close {
    width: 2rem;
    height: 2rem;
    margin: -0.35rem -0.35rem 0 0;
    color: #d4d4d8;
    font-size: 1.35rem;
    line-height: 1;
    border-radius: 0.35rem;
    cursor: pointer;
}

.toast-close:hover,
.toast-close:focus-visible {
    color: #fff;
    background: #3f3f46;
    outline: 2px solid #a1a1aa;
    outline-offset: 1px;
}

.toast-enter-active,
.toast-leave-active,
.toast-move {
    transition:
        transform 180ms ease,
        opacity 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translateX(1rem);
}

@media (max-width: 640px) {
    .toast-viewport {
        top: auto;
        right: max(0.75rem, env(safe-area-inset-right));
        bottom: max(0.75rem, env(safe-area-inset-bottom));
        left: max(0.75rem, env(safe-area-inset-left));
        width: auto;
    }

    .toast-enter-from,
    .toast-leave-to {
        transform: translateY(0.75rem);
    }
}

@media (prefers-reduced-motion: reduce) {
    .toast-enter-active,
    .toast-leave-active,
    .toast-move {
        transition: none;
    }
}
</style>
