import type { GeneralAI } from '../core.js';
import { do일반내정, do긴급내정, do전쟁내정 } from './devActions.js';
import { do금쌀구매 } from './economyActions.js';
import { do징병 } from './recruitActions.js';
import { do전투준비, do소집해제, do출병 } from './warActions.js';
import { do후방워프, do전방워프, do내정워프, do귀환, do집합 } from './warpActions.js';
import { doNPC헌납, doNPC사망대비 } from './npcActions.js';
import { do국가선택, do중립, do거병, do건국, do해산, do선양, do방랑군이동 } from './politicsActions.js';

export const generalActionHandlers: Record<
    string,
    (ai: GeneralAI) => ReturnType<GeneralAI['buildGeneralCandidate']> | null
> = {
    NPC사망대비: doNPC사망대비,
    귀환: do귀환,
    금쌀구매: do금쌀구매,
    출병: do출병,
    긴급내정: do긴급내정,
    전투준비: do전투준비,
    전방워프: do전방워프,
    NPC헌납: doNPC헌납,
    징병: do징병,
    후방워프: do후방워프,
    전쟁내정: do전쟁내정,
    소집해제: do소집해제,
    일반내정: do일반내정,
    내정워프: do내정워프,
    국가선택: do국가선택,
    중립: do중립,
    집합: do집합,
    거병: do거병,
    건국: do건국,
    해산: do해산,
    선양: do선양,
    방랑군이동: do방랑군이동,
};
