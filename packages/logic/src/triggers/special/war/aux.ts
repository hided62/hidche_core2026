import { isRecord } from '@sammo-ts/common';

export interface WarDexAux {
    isAttacker?: boolean;
    opposeType?: { armType: number };
}

export const parseWarDexAux = (aux: unknown): WarDexAux => {
    if (!isRecord(aux)) {
        return {};
    }

    const isAttacker = typeof aux.isAttacker === 'boolean' ? aux.isAttacker : undefined;
    const opposeRaw = aux.opposeType;

    if (!isRecord(opposeRaw)) {
        return isAttacker === undefined ? {} : { isAttacker };
    }

    const armType = opposeRaw.armType;
    if (typeof armType !== 'number') {
        return isAttacker === undefined ? {} : { isAttacker };
    }

    const opposeType = { armType };
    return isAttacker === undefined ? { opposeType } : { isAttacker, opposeType };
};

export const getAuxArmType = (aux: unknown): number | undefined => {
    if (!isRecord(aux)) {
        return undefined;
    }
    const armType = aux.armType;
    return typeof armType === 'number' ? armType : undefined;
};
