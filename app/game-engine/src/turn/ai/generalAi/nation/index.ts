import type { GeneralAI } from '../core.js';
import { do부대전방발령, do부대후방발령, do부대구출발령 } from './assignments/troopAssignments.js';
import {
    do부대유저장후방발령,
    do유저장후방발령,
    do유저장구출발령,
    do유저장전방발령,
    do유저장내정발령,
} from './assignments/userAssignments.js';
import { doNPC후방발령, doNPC구출발령, doNPC전방발령, doNPC내정발령 } from './assignments/npcAssignments.js';
import { do유저장긴급포상, do유저장포상, doNPC긴급포상, doNPC포상, doNPC몰수 } from './rewards.js';
import { do불가침제의, do선전포고 } from './diplomacy.js';
import { do천도 } from './capital.js';

export const nationActionHandlers: Record<
    string,
    (ai: GeneralAI) => ReturnType<GeneralAI['buildNationCandidate']> | null
> = {
    불가침제의: do불가침제의,
    선전포고: do선전포고,
    천도: do천도,
    유저장긴급포상: do유저장긴급포상,
    부대전방발령: do부대전방발령,
    유저장구출발령: do유저장구출발령,
    유저장후방발령: do유저장후방발령,
    부대유저장후방발령: do부대유저장후방발령,
    유저장전방발령: do유저장전방발령,
    유저장포상: do유저장포상,
    부대구출발령: do부대구출발령,
    부대후방발령: do부대후방발령,
    NPC긴급포상: doNPC긴급포상,
    NPC구출발령: doNPC구출발령,
    NPC후방발령: doNPC후방발령,
    NPC포상: doNPC포상,
    NPC전방발령: doNPC전방발령,
    유저장내정발령: do유저장내정발령,
    NPC내정발령: doNPC내정발령,
    NPC몰수: doNPC몰수,
};
