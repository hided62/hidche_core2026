const logRegex = /<([RBGMCLSODYW]1?|1|\/)>/g;

const convertMap: Record<string, string> = {
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

const convertMap2: Record<string, string> = {
    1: 'font-size: 0.9em;',
};

export const formatLog = (text?: string): string => {
    if (!text) {
        return '';
    }

    let match: RegExpExecArray | null = null;
    let lastIndex = 0;
    const result: string[] = [];

    while ((match = logRegex.exec(text)) !== null) {
        const partAll = match[0];
        const subPart = match[1];
        const index = match.index;

        if (lastIndex !== index) {
            result.push(text.slice(lastIndex, index));
        }

        if (subPart === '/') {
            result.push('</span>');
        } else if (subPart.length === 2) {
            result.push(
                `<span style="${convertMap[subPart[0]] ?? ''}${convertMap2[subPart[1]] ?? ''}">`
            );
        } else {
            result.push(`<span style="${convertMap[subPart] ?? ''}">`);
        }

        lastIndex = index + partAll.length;
    }

    if (lastIndex !== text.length) {
        result.push(text.slice(lastIndex));
    }

    return result.join('');
};
