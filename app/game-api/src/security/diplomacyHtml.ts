import sanitizeHtml from 'sanitize-html';

const options: sanitizeHtml.IOptions = {
    allowedTags: [
        'p',
        'br',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'strike',
        'blockquote',
        'ul',
        'ol',
        'li',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'code',
        'pre',
        'hr',
        'a',
        'img',
    ],
    allowedAttributes: {
        a: ['href', 'target', 'rel', 'title'],
        img: ['src', 'alt', 'title', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
        a: ['http', 'https', 'mailto', 'tel'],
        img: ['http', 'https'],
    },
    allowProtocolRelative: false,
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
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
};

/**
 * Canonicalizes the HTML emitted by the diplomacy Tiptap editors. Writes are
 * purified before persistence and reads are purified again for legacy rows.
 */
export const purifyDiplomacyHtml = (value: string | null | undefined): string => {
    if (!value) {
        return '';
    }
    return sanitizeHtml(value, options);
};
