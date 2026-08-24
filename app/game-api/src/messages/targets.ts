import { resolveMessageTargetIcon, type MessageTarget } from '@sammo-ts/logic';

import type { DatabaseClient, GeneralRow } from '../context.js';

const DEFAULT_NATION = {
    name: '재야',
    color: '#000000',
};

const DEFAULT_SHARED_ICON_PUBLIC_URL = 'https://sam-image.hided.net/icons';

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
    const picture = general.picture?.trim() || 'default.jpg';
    return {
        generalId: general.id,
        generalName: general.name,
        nationId: general.nationId,
        nationName: nation.name,
        color: nation.color,
        icon: general.imageServer ? `d_pic/${picture}` : `${DEFAULT_SHARED_ICON_PUBLIC_URL}/${picture}`,
    };
};

export const buildNationTarget = (nationId: number, nationName: string, color: string): MessageTarget => ({
    generalId: 0,
    generalName: '',
    nationId,
    nationName,
    color,
    icon: resolveMessageTargetIcon(null),
});
