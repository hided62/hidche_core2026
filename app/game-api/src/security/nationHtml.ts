import sanitizeHtml from 'sanitize-html';

const safeIframeSource = /^(?:https?:)?\/\/(?:www\.youtube(?:-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/;
const unsafeUrlScheme = /^(?:javascript|data|vbscript):/i;
const unsafeSourceMarker = 'data-sammo-unsafe-source';

const normalizeUrlScheme = (value: string): string =>
    Array.from(value)
        .filter((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint > 0x20 && (codePoint < 0x7f || codePoint > 0x9f);
        })
        .join('');

const options: sanitizeHtml.IOptions = {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'iframe'],
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['class', 'style', 'title', 'lang', 'dir', 'align', 'data-flip'],
        a: ['href', 'name', 'title', 'data-flip'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'data-flip', unsafeSourceMarker],
        iframe: ['src', 'width', 'height', 'title', 'frameborder', 'data-flip'],
        table: ['width', 'border', 'cellpadding', 'cellspacing', 'summary', 'data-flip'],
        td: ['width', 'height', 'colspan', 'rowspan', 'headers', 'data-flip'],
        th: ['width', 'height', 'colspan', 'rowspan', 'scope', 'headers', 'data-flip'],
        col: ['width', 'span', 'data-flip'],
        colgroup: ['width', 'span', 'data-flip'],
    },
    allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
    allowProtocolRelative: true,
    allowedStyles: {
        '*': {
            color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
            'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
            'font-family': [/^[\w\s"',.-]+$/],
            'font-size': [
                /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i,
                /^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i,
            ],
            'font-style': [/^(?:normal|italic|oblique)$/i],
            'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
            'text-align': [/^(?:left|right|center|justify|start|end)$/i],
            'text-decoration': [/^[\w\s-]+$/i],
            'vertical-align': [
                /^(?:baseline|sub|super|top|text-top|middle|bottom|text-bottom|-?\d+(?:\.\d+)?(?:px|em|rem|%))$/i,
            ],
            width: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
            height: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
            'max-width': [/^(?:none|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
            'max-height': [/^(?:none|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
            'min-width': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i],
            'min-height': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i],
            margin: [/^(?:auto|-?\d+(?:\.\d+)?(?:px|em|rem|%))(?:\s+(?:auto|-?\d+(?:\.\d+)?(?:px|em|rem|%))){0,3}$/i],
            padding: [/^\d+(?:\.\d+)?(?:px|em|rem|%)(?:\s+\d+(?:\.\d+)?(?:px|em|rem|%)){0,3}$/i],
            'line-height': [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/i],
            float: [/^(?:none|left|right)$/i],
        },
    },
    transformTags: {
        img: (tagName, attribs) => {
            if (typeof attribs.src === 'string' && unsafeUrlScheme.test(normalizeUrlScheme(attribs.src))) {
                return { tagName, attribs: { [unsafeSourceMarker]: 'true' } };
            }
            if (attribs.alt !== undefined || !attribs.src) {
                return { tagName, attribs };
            }
            const filename = attribs.src.split('/').filter(Boolean).at(-1);
            return {
                tagName,
                attribs: filename ? { ...attribs, alt: filename } : attribs,
            };
        },
        iframe: (tagName, attribs) => {
            const source = typeof attribs.src === 'string' ? attribs.src.trim() : undefined;
            if (source && !safeIframeSource.test(source)) {
                const { src: _unsafeSource, ...safeAttribs } = attribs;
                return { tagName, attribs: safeAttribs };
            }
            return {
                tagName,
                attribs: source === undefined ? attribs : { ...attribs, src: source },
            };
        },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && frame.attribs[unsafeSourceMarker] === 'true',
};

/**
 * Ref's WebUtil::htmlPurify boundary for nation notice and recruitment HTML.
 * Writes are canonicalized and reads are purified again so pre-existing rows
 * cannot execute markup.
 */
export const purifyNationHtml = (value: string | null | undefined): string => {
    if (!value) {
        return '';
    }
    return sanitizeHtml(value, options);
};
