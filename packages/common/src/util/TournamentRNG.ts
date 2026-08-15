import { LiteHashDRBG } from './LiteHashDRBG.js';
import { RandUtil } from './RandUtil.js';

export interface TournamentRngContext {
    openYear: number;
    openMonth: number;
    stage: number;
    phase: number;
    matchIndex: number;
    participantIndex: number;
    gameIndex?: number;
    extraSeed?: string | number;
}

const buildTournamentSeedKey = (baseSeed: string, context: TournamentRngContext): string => {
    const gameIndex = context.gameIndex !== undefined ? `|game:${context.gameIndex}` : '';
    const extraSeed = context.extraSeed !== undefined ? `|extra:${context.extraSeed}` : '';
    return [
        'Tournament',
        `open:${context.openYear}-${context.openMonth}`,
        `stage:${context.stage}`,
        `phase:${context.phase}`,
        `match:${context.matchIndex}`,
        `participant:${context.participantIndex}`,
        gameIndex,
        extraSeed,
        `seed:${baseSeed}`,
    ]
        .filter((value) => value.length > 0)
        .join('|');
};

export const createTournamentRng = (baseSeed: string, context: TournamentRngContext): RandUtil =>
    new RandUtil(LiteHashDRBG.build(buildTournamentSeedKey(baseSeed, context)));
