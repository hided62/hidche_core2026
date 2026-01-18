export const getNpcColor = (npcState: number): string | undefined => {
    if (npcState === 6) {
        return 'mediumaquamarine';
    }
    if (npcState === 5) {
        return 'darkcyan';
    }
    if (npcState === 4) {
        return 'deepskyblue';
    }
    if (npcState >= 2) {
        return 'cyan';
    }
    if (npcState === 1) {
        return 'skyblue';
    }
    return undefined;
};
