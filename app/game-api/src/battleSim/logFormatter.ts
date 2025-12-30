export const convertLog = (value: string, type = 1): string => {
    if (!value) {
        return '';
    }
    let result = value;
    if (type > 0) {
        result = result.replaceAll('<1>', '<font size=1>');
        result = result.replaceAll('<Y1>', '<font size=1 color=yellow>');
        result = result.replaceAll('<R>', '<font color=red>');
        result = result.replaceAll('<B>', '<font color=blue>');
        result = result.replaceAll('<G>', '<font color=green>');
        result = result.replaceAll('<M>', '<font color=magenta>');
        result = result.replaceAll('<C>', '<font color=cyan>');
        result = result.replaceAll('<L>', '<font color=limegreen>');
        result = result.replaceAll('<S>', '<font color=skyblue>');
        result = result.replaceAll('<O>', '<font color=orangered>');
        result = result.replaceAll('<D>', '<font color=orangered>');
        result = result.replaceAll('<Y>', '<font color=yellow>');
        result = result.replaceAll('<W>', '<font color=white>');
        result = result.replaceAll('</>', '</font>');
        return result;
    }

    result = result.replaceAll('<1>', '');
    result = result.replaceAll('<Y1>', '');
    result = result.replaceAll('<R>', '');
    result = result.replaceAll('<B>', '');
    result = result.replaceAll('<G>', '');
    result = result.replaceAll('<M>', '');
    result = result.replaceAll('<C>', '');
    result = result.replaceAll('<L>', '');
    result = result.replaceAll('<S>', '');
    result = result.replaceAll('<O>', '');
    result = result.replaceAll('<D>', '');
    result = result.replaceAll('<Y>', '');
    result = result.replaceAll('<W>', '');
    result = result.replaceAll('</>', '');
    return result;
};
