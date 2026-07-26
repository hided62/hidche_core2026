const logRegex = /<([RBGMCLSODYW]1?|1|\/)>/g;

const colorMap: Record<string, string> = {
    R: 'red',
    B: 'blue',
    G: 'green',
    M: 'magenta',
    C: 'cyan',
    L: 'limegreen',
    S: 'skyblue',
    O: 'orangered',
    D: 'orangered',
    Y: 'yellow',
    W: 'white',
};

export const formatLog = (text: string): string =>
    text.replace(logRegex, (_all, tag: string) => {
        if (tag === '/') {
            return '</span>';
        }
        const color = colorMap[tag[0] ?? ''];
        const small = tag.includes('1');
        const styles = [color ? `color: ${color}` : '', small ? 'font-size: 0.9em' : ''].filter(Boolean).join('; ');
        return `<span style="${styles}">`;
    });
