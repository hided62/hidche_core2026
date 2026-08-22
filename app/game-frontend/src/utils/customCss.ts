export const CUSTOM_CSS_KEY = 'sam_customCSS';
export const CUSTOM_CSS_STYLE_ID = 'sammo-custom-css';

export const applyCustomCss = (text: string): void => {
    if (typeof document === 'undefined') return;

    let style = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = CUSTOM_CSS_STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = text;
};

export const applyStoredCustomCss = (): void => {
    if (typeof window === 'undefined') return;
    applyCustomCss(window.localStorage.getItem(CUSTOM_CSS_KEY) ?? '');
};
