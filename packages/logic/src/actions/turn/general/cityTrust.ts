import { clamp } from 'es-toolkit';

export const resolveCityTrustValue = (value: unknown, fallback = 50): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const adjustCityTrust = (current: number, delta: number): number => clamp(current + delta, 0, 100);
