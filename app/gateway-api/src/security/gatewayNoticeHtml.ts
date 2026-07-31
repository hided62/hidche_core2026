import sanitizeHtml from 'sanitize-html';

const safeNamedColor =
    /^(?:black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|orange|cyan|magenta|skyblue|orangered|limegreen|darkorange)$/i;
const safeFontColor = (value: string): boolean => /^#[0-9a-f]{3,8}$/i.test(value) || safeNamedColor.test(value);
const safeFontFace = /^[\p{L}\p{N}\s,'".-]+$/u;

const options: sanitizeHtml.IOptions = {
    allowedTags: ['br', 'b', 'strong', 'em', 'i', 'u', 's', 'strike', 'small', 'sup', 'sub', 'span', 'a', 'font'],
    allowedAttributes: {
        '*': ['style', 'title'],
        a: ['href', 'target', 'rel', 'title', 'style'],
        font: ['color', 'size', 'face', 'style', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    allowedStyles: {
        '*': {
            color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, safeNamedColor],
            'font-size': [
                /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i,
                /^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i,
            ],
            'font-style': [/^(?:normal|italic|oblique)$/i],
            'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
            'text-decoration': [
                /^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i,
            ],
        },
    },
    transformTags: {
        a: (tagName, attribs) => {
            const target = attribs.target === '_blank' || attribs.target === '_self' ? attribs.target : undefined;
            const { target: _target, rel: _rel, ...rest } = attribs;
            return {
                tagName,
                attribs: target
                    ? {
                          ...rest,
                          target,
                          ...(target === '_blank' ? { rel: 'noopener noreferrer nofollow' } : {}),
                      }
                    : rest,
            };
        },
        font: (tagName, attribs) => ({
            tagName,
            attribs: {
                ...(attribs.color && safeFontColor(attribs.color) ? { color: attribs.color } : {}),
                ...(attribs.size && /^[1-7]$/.test(attribs.size) ? { size: attribs.size } : {}),
                ...(attribs.face && safeFontFace.test(attribs.face) ? { face: attribs.face } : {}),
                ...(attribs.style ? { style: attribs.style } : {}),
                ...(attribs.title ? { title: attribs.title } : {}),
            },
        }),
    },
};

/**
 * Canonicalizes Ref-compatible gateway notice markup on both writes and reads.
 * Reads are purified again so pre-existing rows cannot execute active content.
 */
export const purifyGatewayNoticeHtml = (value: string | null | undefined): string => {
    if (!value) return '';
    return sanitizeHtml(value, options);
};
