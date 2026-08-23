import { JosaUtil } from '@sammo-ts/common';

import type { General, Nation } from '@sammo-ts/logic/domain/entities.js';
import { resolveMessageTargetIcon, type MessageDraft } from './message.js';

type ScoutGeneral = Pick<General, 'id' | 'name' | 'nationId' | 'officerLevel'>;
type ScoutNation = Pick<Nation, 'id' | 'name' | 'color'>;

export interface ScoutMessageDraftInput {
    srcGeneral: ScoutGeneral;
    destGeneral: ScoutGeneral;
    srcNation: ScoutNation | null;
    destNation: ScoutNation | null;
    time: Date;
    sharedIconBaseUrl?: string;
}

/**
 * Pure equivalent of Ref ScoutMessage::buildScoutMessage(). Ref constructs
 * both targets without a general picture, so MessageTarget supplies the shared
 * default icon, and every caller persists the receiver copy only via send(true).
 */
export const buildScoutMessageDraft = (input: ScoutMessageDraftInput): MessageDraft | null => {
    const { srcGeneral, destGeneral, srcNation, destNation } = input;
    if (
        srcGeneral.id === destGeneral.id ||
        destGeneral.officerLevel === 12 ||
        srcGeneral.nationId === 0 ||
        srcGeneral.nationId === destGeneral.nationId ||
        !srcNation ||
        srcNation.id !== srcGeneral.nationId
    ) {
        return null;
    }

    const resolvedDestNation =
        destGeneral.nationId === 0
            ? { id: 0, name: '재야', color: '#000000' }
            : destNation?.id === destGeneral.nationId
              ? destNation
              : null;
    if (!resolvedDestNation) {
        return null;
    }

    const josaRo = JosaUtil.pick(srcNation.name, '로');
    const icon = resolveMessageTargetIcon(null, input.sharedIconBaseUrl);
    return {
        msgType: 'private',
        src: {
            generalId: srcGeneral.id,
            generalName: srcGeneral.name,
            nationId: srcGeneral.nationId,
            nationName: srcNation.name,
            color: srcNation.color,
            icon,
        },
        dest: {
            generalId: destGeneral.id,
            generalName: destGeneral.name,
            nationId: destGeneral.nationId,
            nationName: resolvedDestNation.name,
            color: resolvedDestNation.color,
            icon,
        },
        text: `${srcNation.name}${josaRo} 망명 권유 서신`,
        time: input.time,
        validUntil: new Date('9999-12-31T12:59:59.000Z'),
        option: { action: 'scout' },
        sendDestOnly: true,
    };
};
