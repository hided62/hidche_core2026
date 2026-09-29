import type { ObjectDirective } from 'vue';

type FitState = { observer: ResizeObserver; frame: number; alive: boolean };
const states = new WeakMap<HTMLElement, FitState>();

const fit = (element: HTMLElement): void => {
    // Always measure from the CSS tier, so shorter text and wider cells can grow back.
    element.style.removeProperty('font-size');
    const maximum = Number.parseFloat(getComputedStyle(element).fontSize);
    const available = element.clientWidth;
    if (!available) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const natural = range.getBoundingClientRect().width;
    const minimum = Number.parseFloat(getComputedStyle(element).getPropertyValue('--sammo-font-size-minimum'));
    const size = Math.min(maximum, Math.max(minimum, (maximum * available) / Math.max(natural, 1)));
    element.dataset.fontFitMax = String(maximum);
    if (size < maximum) element.style.fontSize = `${Math.floor(size * 100) / 100}px`;
};

const schedule = (element: HTMLElement): void => {
    const state = states.get(element);
    if (!state?.alive) return;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => fit(element));
};

/** One-line UI labels: CSS selects the maximum tier; 10px is the readability floor. */
export const vFitText: ObjectDirective<HTMLElement> = {
    mounted(element) {
        const observer = new ResizeObserver(() => schedule(element));
        states.set(element, { observer, frame: 0, alive: true });
        observer.observe(element);
        schedule(element);
        void document.fonts.ready.then(() => schedule(element));
    },
    updated: schedule,
    beforeUnmount(element) {
        const state = states.get(element);
        if (!state) return;
        state.alive = false;
        cancelAnimationFrame(state.frame);
        state.observer.disconnect();
        states.delete(element);
    },
};
