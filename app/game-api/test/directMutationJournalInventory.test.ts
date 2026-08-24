import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { appRouter } from '../src/router.js';

const classifications = {
    durableJournal: [
        'betting.bet',
        'diplomacy.destroyLetter',
        'diplomacy.respondLetter',
        'diplomacy.rollbackLetter',
        'diplomacy.sendLetter',
        'inherit.checkOwner',
        'messages.delete',
        'messages.respond',
        'messages.send',
        'turns.reserved.repeatGeneral',
        'turns.reserved.setGeneral',
        'turns.reserved.setGeneralBulk',
        'turns.reserved.setNation',
        'turns.reserved.setNationBulk',
        'turns.reserved.shiftGeneral',
        'vote.closePoll',
        'vote.createPoll',
        'vote.submitVote',
        'vote.updatePoll',
    ],
    separateAccessJournal: ['public.recordAccess'],
    explicitNoRealtimeConsumer: [
        'board.writeArticle',
        'board.writeComment',
        'join.listPossessCandidates',
        'messages.readLatest',
        'turns.reserved.repeatNation',
        'turns.reserved.shiftNation',
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
        'join.getSelectionPool',
        'join.possessGeneral',
        'join.reselectPoolGeneral',
        'join.selectPoolGeneral',
        'nation.appoint',
        'nation.changePermission',
        'nation.kick',
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
    readOnlyMutationTransport: ['battle.prepareSimulation', 'battle.simulate'],
    sessionOnly: ['auth.exchangeGatewayToken'],
} as const;

const routerRoot = fileURLToPath(new URL('../src/router/', import.meta.url));

const listTypeScriptFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return listTypeScriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
    });

const countDeclaredMutations = (file: string): number =>
    [...readFileSync(file, 'utf8').matchAll(/\.mutation\s*\(/gu)].length;

interface RuntimeProcedureDef {
    type: string;
    middlewares: readonly unknown[];
}

const readRuntimeProcedureDef = (procedure: unknown): RuntimeProcedureDef => {
    if (typeof procedure !== 'function') {
        throw new Error('Mounted tRPC procedure is not callable.');
    }
    const definition: unknown = Reflect.get(procedure, '_def');
    if (typeof definition !== 'object' || definition === null) {
        throw new Error('Mounted tRPC procedure has no runtime definition.');
    }
    const type: unknown = Reflect.get(definition, 'type');
    const middlewares: unknown = Reflect.get(definition, 'middlewares');
    if (typeof type !== 'string' || !Array.isArray(middlewares)) {
        throw new Error('Mounted tRPC procedure has an unexpected runtime definition.');
    }
    return { type, middlewares };
};

const mountedProcedureDefs = new Map(
    Object.entries(appRouter._def.procedures).map(
        ([name, procedure]) => [name, readRuntimeProcedureDef(procedure)] as const
    )
);

const mountedMutationNames = (): string[] =>
    [...mountedProcedureDefs]
        .filter(([, definition]) => definition.type === 'mutation')
        .map(([name]) => name)
        .sort();

describe('game-api direct mutation journal inventory', () => {
    it('requires every router mutation to retain an explicit ownership and realtime classification', () => {
        const actual = mountedMutationNames();
        const declaredCount = listTypeScriptFiles(routerRoot).reduce(
            (total, file) => total + countDeclaredMutations(file),
            0
        );
        const classified = Object.values(classifications).flat().sort();

        // Runtime router shape is authoritative for the public path. The raw declaration
        // count independently catches mutations that were added to a router but never mounted.
        expect(declaredCount).toBe(actual.length);
        expect(new Set(classified).size).toBe(classified.length);
        expect(classified).toHaveLength(87);
        expect(actual).toEqual(classified);
    });

    it('keeps every mounted mutation authenticated except the two explicit session bootstrap paths', () => {
        // auth.status is the smallest mounted procedure that carries the shared
        // requireAuthMiddleware. Composed procedures retain the same middleware identity.
        const authMiddleware = mountedProcedureDefs.get('auth.status')?.middlewares[0];
        expect(authMiddleware).toBeDefined();

        const unauthenticated = [...mountedProcedureDefs]
            .filter(([, definition]) => definition.type === 'mutation')
            .filter(([, definition]) => !definition.middlewares.includes(authMiddleware))
            .map(([name]) => name)
            .sort();

        expect(unauthenticated).toEqual(['auth.exchangeGatewayToken', 'public.recordAccess']);
    });
});
