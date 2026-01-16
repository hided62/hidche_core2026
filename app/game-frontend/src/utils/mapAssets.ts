const normalizeBase = (value: string | undefined | null): string => {
    const base = (value ?? '').trim();
    return base.replace(/\/+$/, '');
};

export const buildAssetUrl = (base: string | undefined | null, path: string): string => {
    const normalizedBase = normalizeBase(base);
    const normalizedPath = path.replace(/^\/+/, '');
    if (!normalizedBase) {
        return `/${normalizedPath}`;
    }
    return `${normalizedBase}/${normalizedPath}`;
};

export const normalizeColorToken = (color: string | undefined | null): string | null => {
    if (!color) {
        return null;
    }
    const cleaned = color.trim().replace(/^#/, '').toUpperCase();
    return cleaned.length > 0 ? cleaned : null;
};
