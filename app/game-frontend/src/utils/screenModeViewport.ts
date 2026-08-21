export const SCREEN_MODE_KEY = 'sam.screenMode';
export const SCREEN_MODE_CHANGE_EVENT = 'tryChangeScreenMode';

export type ScreenMode = 'auto' | '500px' | '1000px';

export type AutoViewportMeasurements = {
    deviceWidth: number;
    viewportHeight: number;
    targetHeight?: number;
};

export const normalizeScreenMode = (value: string | null): ScreenMode =>
    value === '500px' || value === '1000px' ? value : 'auto';

export const resolveAutoViewportContent = ({
    deviceWidth,
    viewportHeight,
    targetHeight = 700,
}: AutoViewportMeasurements): string => {
    if (deviceWidth < 500) {
        return 'width=500';
    }

    if (viewportHeight < targetHeight) {
        const widthAtTargetHeight = (deviceWidth / viewportHeight) * targetHeight;
        return widthAtTargetHeight >= 700 ? 'width=1000' : `height=${Math.ceil(targetHeight)}`;
    }

    return deviceWidth >= 700 ? 'width=1000' : 'width=device-width, initial-scale=1';
};

export const resolveViewportContent = (mode: ScreenMode, measurements: AutoViewportMeasurements): string => {
    if (mode === '500px') return 'width=500';
    if (mode === '1000px') return 'width=1000';
    return resolveAutoViewportContent(measurements);
};

const findOrCreateViewportMeta = (): HTMLMetaElement => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (existing) return existing;

    const viewportMeta = document.createElement('meta');
    viewportMeta.name = 'viewport';
    document.head.appendChild(viewportMeta);
    return viewportMeta;
};

export const installScreenModeViewport = (targetHeight = 700): void => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportMeta = findOrCreateViewportMeta();
    let previousMode: ScreenMode | null = null;
    let previousDeviceWidth: number | null = null;

    const adjustViewport = () => {
        const mode = normalizeScreenMode(window.localStorage.getItem(SCREEN_MODE_KEY));
        const deviceWidth = window.screen.availWidth;

        if (mode === previousMode && mode === 'auto' && deviceWidth === previousDeviceWidth) return;
        if (mode === previousMode && mode !== 'auto') return;

        previousMode = mode;
        previousDeviceWidth = deviceWidth;
        viewportMeta.content = resolveViewportContent(mode, {
            deviceWidth,
            viewportHeight: window.innerHeight,
            targetHeight,
        });
    };

    adjustViewport();
    window.addEventListener('resize', adjustViewport);
    window.addEventListener('orientationchange', adjustViewport);
    window.addEventListener('storage', (event) => {
        if (event.key === SCREEN_MODE_KEY) adjustViewport();
    });
    document.addEventListener(SCREEN_MODE_CHANGE_EVENT, adjustViewport);
};
