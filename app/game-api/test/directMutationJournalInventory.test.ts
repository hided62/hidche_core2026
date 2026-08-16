import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const classifications = {
    durableJournal: [
        'betting.bet',
        'messages.delete',
        'messages.respond',
        'messages.send',
        'nation.setBill',
        'nation.setBlockScout',
        'nation.setBlockWar',
        'nation.setNotice',
        'nation.setRate',
        'nation.setScoutMsg',
        'nation.setSecretLimit',
        'npc.setGeneralPriority',
        'npc.setNationPolicy',
        'npc.setNationPriority',
        'turns.repeatGeneral',
        'turns.setGeneral',
        'turns.setGeneralBulk',
        'turns.shiftGeneral',
        'vote.closePoll',
        'vote.createPoll',
        'vote.submitVote',
        'vote.updatePoll',
    ],
    separateAccessJournal: ['public.recordAccess'],
    explicitNoRealtimeConsumer: [
        'board.writeArticle',
        'board.writeComment',
        'diplomacy.destroyLetter',
        'diplomacy.respondLetter',
        'diplomacy.rollbackLetter',
        'diplomacy.sendLetter',
        'inherit.checkOwner',
        'join.getSelectionPool',
        'join.listPossessCandidates',
        'messages.readLatest',
        'turns.repeatNation',
        'turns.setNation',
        'turns.setNationBulk',
        'turns.shiftNation',
        'vote.addComment',
    ],
    engineOwned: [
        'auction.bidBuyRice',
        'auction.bidSellRice',
        'auction.bidUnique',
        'auction.openBuyRice',
        'auction.openSellRice',
        'auction.openUnique',
        'general.adjustIcon',
        'general.buildNationCandidate',
        'general.dieOnPrestart',
        'general.dropItem',
        'general.ensureDieOnPrestartStatus',
        'general.instantRetreat',
        'general.setMySetting',
        'general.vacation',
        'inherit.openUniqueAuction',
        'join.createGeneral',
        'join.possessGeneral',
        'join.reselectPoolGeneral',
        'join.selectPoolGeneral',
        'nation.appoint',
        'nation.changePermission',
        'nation.kick',
        'troop.create',
        'troop.exit',
        'troop.join',
        'troop.kick',
        'troop.rename',
    ],
    mixedSaga: [
        'inherit.buyHiddenBuff',
        'inherit.buyRandomUnique',
        'inherit.resetSpecialWar',
        'inherit.resetStat',
        'inherit.resetTurnTime',
        'inherit.setNextSpecialWar',
        'tournament.cancel',
        'tournament.join',
        'tournament.placeBet',
    ],
    redisProjection: [
        'tournament.patchState',
        'tournament.seedParticipants',
        'tournament.setBettingEntries',
        'tournament.setMatches',
        'tournament.setParticipants',
        'tournament.setState',
    ],
    operational: ['turnDaemon.pause', 'turnDaemon.resume', 'turnDaemon.run'],
    externalUpload: ['board.uploadImage'],
    readOnlyMutationTransport: ['battle.simulate'],
    sessionOnly: ['auth.exchangeGatewayToken'],
} as const;

const routerRoot = fileURLToPath(new URL('../src/router/', import.meta.url));

const listTypeScriptFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return listTypeScriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
    });

const extractMutationNames = (file: string): string[] => {
    const source = readFileSync(file, 'utf8');
    const names: string[] = [];
    for (const mutation of source.matchAll(/\.mutation\s*\(/gu)) {
        const prefix = source.slice(0, mutation.index);
        const propertyCandidates = [...prefix.matchAll(/^ {4,8}([A-Za-z][A-Za-z0-9]*):/gmu)];
        const exportedCandidates = [...prefix.matchAll(/^export const ([A-Za-z][A-Za-z0-9]*)\s*=/gmu)];
        const property = propertyCandidates.at(-1);
        const exported = exportedCandidates.at(-1);
        const propertyIndex = property?.index ?? -1;
        const exportedIndex = exported?.index ?? -1;
        const name = propertyIndex > exportedIndex ? property?.[1] : exported?.[1];
        if (!name) throw new Error(`Could not resolve mutation name in ${file}`);
        names.push(name);
    }
    return names;
};

const routePrefix = (file: string): string => {
    const relative = path.relative(routerRoot, file);
    const [top] = relative.split(path.sep);
    if (!top) throw new Error(`Could not resolve router prefix for ${file}`);
    return top.endsWith('.ts') ? path.basename(top, '.ts') : top;
};

describe('game-api direct mutation journal inventory', () => {
    it('requires every router mutation to retain an explicit ownership and realtime classification', () => {
        const actual = listTypeScriptFiles(routerRoot)
            .flatMap((file) => extractMutationNames(file).map((name) => `${routePrefix(file)}.${name}`))
            .sort();
        const classified = Object.values(classifications).flat().sort();

        expect(new Set(classified).size).toBe(classified.length);
        expect(classified).toHaveLength(86);
        expect(actual).toEqual(classified);
    });
});
