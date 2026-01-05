import type { MessageTarget } from '@sammo-ts/logic';

import type { DatabaseClient, GeneralRow } from '../context.js';

const DEFAULT_NATION = {
    name: '재야',
    color: '#000000',
};

export const resolveNationInfo = async (
    db: DatabaseClient,
    nationId: number
): Promise<{ name: string; color: string }> => {
    if (nationId <= 0) {
        return DEFAULT_NATION;
    }
    const nation = await db.nation.findUnique({ where: { id: nationId } });
    if (!nation) {
        return DEFAULT_NATION;
    }
    return { name: nation.name, color: nation.color };
};

export const buildTargetFromGeneral = async (db: DatabaseClient, general: GeneralRow): Promise<MessageTarget> => {
    const nation = await resolveNationInfo(db, general.nationId);
    return {
        generalId: general.id,
        generalName: general.name,
        nationId: general.nationId,
        nationName: nation.name,
        color: nation.color,
        icon: '',
    };
};

export const buildNationTarget = (nationId: number, nationName: string, color: string): MessageTarget => ({
    generalId: 0,
    generalName: '',
    nationId,
    nationName,
    color,
    icon: '',
});
