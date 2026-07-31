const legacyTagPattern = /^<([RBGMCLSODYW]1?|1|\/)>$/;

const legacyStyleMap: Record<string, string> = {
    R: 'color: red;',
    B: 'color: blue;',
    G: 'color: green;',
    M: 'color: magenta;',
    C: 'color: cyan;',
    L: 'color: limegreen;',
    S: 'color: skyblue;',
    O: 'color: orangered;',
    D: 'color: orangered;',
    Y: 'color: yellow;',
    W: 'color: white;',
    1: 'font-size: 0.9em;',
};

const safeSpanClasses = new Set([
    'ev_highlight',
    'ev_failed',
    'ev_notice',
    'me',
    'you',
    'name_plate',
    'crew_type',
    'name_plate_cover',
    'crew_plate',
    'remain_crew',
    'killed_plate',
    'killed_crew',
    'name',
    'war_type',
    'war_type_attack',
    'war_type_defense',
    'war_type_siege',
]);

const escapeText = (value: string): string =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const normalizeStructuralTag = (tag: string): string | null => {
    if (/^<b\s*>$/i.test(tag)) return '<b>';
    if (/^<\/b\s*>$/i.test(tag)) return '</b>';
    if (/^<br\s*\/?\s*>$/i.test(tag)) return '<br>';
    if (/^<\/span\s*>$/i.test(tag)) return '</span>';
    if (/^<\/div\s*>$/i.test(tag)) return '</div>';

    const colorSpan = tag.match(/^<span\s+style\s*=\s*(['"])\s*color\s*:\s*(#[0-9a-f]{6})\s*;?\s*\1\s*>$/i);
    if (colorSpan) return `<span style="color: ${colorSpan[2]};">`;

    const open = tag.match(/^<(span|div)\s+class\s*=\s*(['"])([^'"]+)\2\s*>$/i);
    if (!open) return null;

    const element = open[1]!.toLowerCase();
    const classes = open[3]!.trim().split(/\s+/u);
    if (element === 'div') {
        return classes.length === 1 && classes[0] === 'small_war_log' ? '<div class="small_war_log">' : null;
    }
    if (classes.length === 0 || classes.some((className) => !safeSpanClasses.has(className))) {
        return null;
    }
    return `<span class="${classes.join(' ')}">`;
};

export type FormatLegacyLogHtmlOptions = {
    colorize?: boolean;
};

/**
 * Converts Ref's custom color markers while rebuilding only the small set of
 * HTML structures emitted by legacy log writers. Everything else is text.
 */
export const formatLegacyLogHtml = (value?: string | null, options: FormatLegacyLogHtmlOptions = {}): string => {
    if (!value) return '';

    const colorize = options.colorize ?? true;
    return value
        .split(/(<[^>]*>)/gu)
        .map((part) => {
            if (!part.startsWith('<') || !part.endsWith('>')) {
                return escapeText(part);
            }

            const legacy = part.match(legacyTagPattern)?.[1];
            if (legacy) {
                if (!colorize) return '';
                if (legacy === '/') return '</span>';
                const colorCode = legacy === '1' ? null : legacy[0]!;
                const small = legacy === '1' || legacy.endsWith('1');
                return `<span style="${colorCode ? (legacyStyleMap[colorCode] ?? '') : ''}${small ? legacyStyleMap['1'] : ''}">`;
            }

            return normalizeStructuralTag(part) ?? escapeText(part);
        })
        .join('');
};
