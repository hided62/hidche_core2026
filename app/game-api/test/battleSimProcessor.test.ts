import { describe, expect, it } from 'vitest';
import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import type { BattleSimJobPayload } from '../src/battleSim/types.js';
import { processBattleSimJob } from '../src/battleSim/processor.js';

const buildPayload = (action: BattleSimJobPayload['action']): BattleSimJobPayload => ({
    action,
    repeatCnt: 1,
    year: 200,
    month: 1,
    seed: 'test-seed',
    scenarioEffect: null,
    attackerGeneral: {
        no: 1,
        name: 'Attacker',
        nation: 1,
        turntime: '2026-01-01 00:00:00',
        personal: null,
        special2: null,
        crew: 1000,
        crewtype: 100,
        atmos: 100,
        train: 100,
        intel: 70,
        intel_exp: 0,
        book: null,
        strength: 70,
        strength_exp: 0,
        weapon: null,
        injury: 0,
        leadership: 70,
        leadership_exp: 0,
        horse: null,
        item: null,
        explevel: 0,
        experience: 100,
        dedication: 100,
        officer_level: 3,
        officer_city: 1,
        gold: 1000,
        rice: 1000,
        dex1: 0,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
        defence_train: 0,
        recent_war: null,
        warnum: 0,
        killnum: 0,
        killcrew: 0,
    },
    attackerCity: {
        city: 1,
        nation: 1,
        supply: 1,
        name: 'AttackerCity',
        pop: 10000,
        agri: 1000,
        comm: 1000,
        secu: 1000,
        def: 100,
        wall: 100,
        trust: 100,
        level: 2,
        pop_max: 10000,
        agri_max: 1000,
        comm_max: 1000,
        secu_max: 1000,
        def_max: 200,
        wall_max: 200,
        dead: 0,
        state: 0,
        conflict: '{}',
    },
    attackerNation: {
        type: 'test',
        tech: 1000,
        level: 1,
        capital: 1,
        nation: 1,
        name: 'AttackerNation',
        gold: 1000,
        rice: 1000,
        gennum: 1,
    },
    defenderGenerals: [
        {
            no: 2,
            name: 'Defender',
            nation: 2,
            turntime: '2026-01-01 00:00:00',
            personal: null,
            special2: null,
            crew: 1000,
            crewtype: 100,
            atmos: 100,
            train: 100,
            intel: 60,
            intel_exp: 0,
            book: null,
            strength: 60,
            strength_exp: 0,
            weapon: null,
            injury: 0,
            leadership: 60,
            leadership_exp: 0,
            horse: null,
            item: null,
            explevel: 0,
            experience: 100,
            dedication: 100,
            officer_level: 3,
            officer_city: 2,
            gold: 1000,
            rice: 1000,
            dex1: 0,
            dex2: 0,
            dex3: 0,
            dex4: 0,
            dex5: 0,
            defence_train: 0,
            recent_war: null,
            warnum: 0,
            killnum: 0,
            killcrew: 0,
        },
    ],
    defenderCity: {
        city: 2,
        nation: 2,
        supply: 1,
        name: 'DefenderCity',
        pop: 10000,
        agri: 1000,
        comm: 1000,
        secu: 1000,
        def: 100,
        wall: 100,
        trust: 100,
        level: 2,
        pop_max: 10000,
        agri_max: 1000,
        comm_max: 1000,
        secu_max: 1000,
        def_max: 200,
        wall_max: 200,
        dead: 0,
        state: 0,
        conflict: '{}',
    },
    defenderNation: {
        type: 'test',
        tech: 1000,
        level: 1,
        capital: 2,
        nation: 2,
        name: 'DefenderNation',
        gold: 1000,
        rice: 1000,
        gennum: 1,
    },
    unitSet: {
        id: 'test',
        name: 'test',
        crewTypes: [
            {
                id: 100,
                armType: 1,
                name: '보병',
                attack: 100,
                defence: 100,
                speed: 7,
                avoid: 10,
                magicCoef: 0,
                cost: 9,
                rice: 9,
                requirements: [],
                attackCoef: {},
                defenceCoef: {},
                info: [],
                initSkillTrigger: null,
                phaseSkillTrigger: null,
                iActionList: null,
            },
            {
                id: 999,
                armType: 9,
                name: '성벽',
                attack: 0,
                defence: 0,
                speed: 1,
                avoid: 0,
                magicCoef: 0,
                cost: 0,
                rice: 9,
                requirements: [],
                attackCoef: {},
                defenceCoef: {},
                info: [],
                initSkillTrigger: null,
                phaseSkillTrigger: null,
                iActionList: null,
            },
        ],
    },
    config: {
        armPerPhase: 500,
        maxTrainByCommand: 100,
        maxAtmosByCommand: 100,
        maxTrainByWar: 110,
        maxAtmosByWar: 150,
        castleCrewTypeId: 999,
        armTypes: {
            footman: 1,
            wizard: 4,
            siege: 5,
            misc: 6,
            castle: 9,
        },
    },
    time: {
        year: 200,
        month: 1,
        startYear: 180,
    },
});

describe('battle sim processor', () => {
    it('returns the fixed-seed battle summary instead of only a successful shape', () => {
        const payload = buildPayload('battle');
        payload.repeatCnt = 1000;
        const result = processBattleSimJob(payload);

        expect(result).toMatchObject({
            result: true,
            reason: 'success',
            datetime: '2026-01-01 00:00:00',
            repeatCnt: 1,
            avgWar: 1,
            phase: 2,
            killed: 626,
            maxKilled: 626,
            minKilled: 626,
            dead: 1000,
            maxDead: 1000,
            minDead: 1000,
            attackerRice: 65,
            defenderRice: 83,
            attackerSkills: { 부상: 1 },
            defendersSkills: [{ 회피시도: 1, 회피: 1 }],
        });
        expect(result.lastWarLog?.generalActionLog).toContain('퇴각했습니다.');
    });

    it('treats a queued job from before scenarioEffect existed as the no-effect baseline', () => {
        const baselinePayload = buildPayload('battle');
        const legacyPayload = buildPayload('battle');
        delete legacyPayload.scenarioEffect;

        expect(processBattleSimJob(legacyPayload)).toEqual(processBattleSimJob(baselinePayload));
    });

    it('uses server-issued per-repeat seeds deterministically when no fixed seed is supplied', () => {
        const firstPayload = buildPayload('battle');
        delete firstPayload.seed;
        firstPayload.repeatCnt = 2;
        firstPayload.seeds = ['server-repeat-0', 'server-repeat-1'];
        const secondPayload = structuredClone(firstPayload);
        const observedSeeds: string[] = [];

        const first = processBattleSimJob(firstPayload, {
            rngFactory: (seed) => {
                observedSeeds.push(seed);
                return new RandUtil(LiteHashDRBG.build(seed));
            },
        });
        const second = processBattleSimJob(secondPayload);

        expect(first).toEqual(second);
        expect(first.repeatCnt).toBe(2);
        expect(observedSeeds).toEqual(['server-repeat-0', 'server-repeat-1']);
    });

    it('returns the fixed defender ID order for reorder action', () => {
        const payload = buildPayload('reorder');
        const result = processBattleSimJob(payload);

        expect(result.result).toBe(true);
        expect(result.order).toEqual([2]);
    });

    it('uses the legacy defence training threshold when ordering defenders', () => {
        const payload = buildPayload('reorder');
        payload.defenderGenerals[0]!.defence_train = 101;

        const result = processBattleSimJob(payload);

        expect(result.result).toBe(true);
        expect(result.order).toEqual([]);
    });

    it('keeps current city separate from the officer assignment city', () => {
        const localOfficer = buildPayload('battle');
        localOfficer.attackerGeneral.city = localOfficer.attackerCity.city;
        const remoteOfficer = buildPayload('battle');
        remoteOfficer.attackerGeneral.city = remoteOfficer.attackerCity.city;
        remoteOfficer.attackerGeneral.officer_city = 99;

        const local = processBattleSimJob(localOfficer);
        const remote = processBattleSimJob(remoteOfficer);

        expect(local.killed).toBeGreaterThan(remote.killed ?? 0);
        expect(local).not.toEqual(remote);
    });

    it('executes crew trigger handlers in simulator battles', () => {
        const payload = buildPayload('battle');
        payload.unitSet.crewTypes![0]!.phaseSkillTrigger = ['che_선제사격시도', 'che_선제사격발동'];
        payload.unitSet.crewTypes!.splice(1, 0, {
            ...payload.unitSet.crewTypes![0]!,
            id: 200,
            name: '수비 보병',
            phaseSkillTrigger: null,
        });
        payload.defenderGenerals[0]!.crewtype = 200;

        const result = processBattleSimJob(payload);

        expect(result.result).toBe(true);
        expect(result.attackerSkills?.['선제']).toBe(1);
    });

    it('fails fast when a simulator unit set references an unknown crew handler', () => {
        const payload = buildPayload('battle');
        payload.unitSet.crewTypes![0]!.iActionList = ['missing_action'];

        expect(() => processBattleSimJob(payload)).toThrow('Unknown crew type action');
    });

    it('applies StrongAttacker to general combat in the server-enriched simulator job', () => {
        const baseline = processBattleSimJob(buildPayload('battle'));
        const payload = buildPayload('battle');
        payload.scenarioEffect = 'event_StrongAttacker';
        const strong = processBattleSimJob(payload);

        expect(strong.killed).toBeGreaterThan(baseline.killed ?? 0);
    });

    it('applies the event-domestic trait carried by an imported general', () => {
        const baseline = processBattleSimJob(buildPayload('battle'));
        const payload = buildPayload('battle');
        payload.attackerGeneral.special = 'che_event_무쌍';
        const eventDomestic = processBattleSimJob(payload);

        expect(eventDomestic.killed).toBeGreaterThan(baseline.killed ?? 0);
        expect(eventDomestic).not.toEqual(baseline);
    });

    it('keeps StrongAttacker city combat identical but applies MoreEffect to it', () => {
        const baselinePayload = buildPayload('battle');
        baselinePayload.defenderGenerals = [];
        const baseline = processBattleSimJob(baselinePayload);

        const strongPayload = buildPayload('battle');
        strongPayload.defenderGenerals = [];
        strongPayload.scenarioEffect = 'event_StrongAttacker';
        expect(processBattleSimJob(strongPayload)).toEqual(baseline);

        const morePayload = buildPayload('battle');
        morePayload.defenderGenerals = [];
        morePayload.scenarioEffect = 'event_MoreEffect';
        const more = processBattleSimJob(morePayload);
        expect(more.dead).toBeLessThan(baseline.dead ?? Number.POSITIVE_INFINITY);
    });

    it('fails fast for an unknown server-derived scenario effect', () => {
        const payload = buildPayload('battle');
        payload.scenarioEffect = 'event_Missing';
        expect(() => processBattleSimJob(payload)).toThrow('Unknown scenario effect: event_Missing');
    });

    it('escapes executable markup from simulator display names while preserving legacy log structure', () => {
        const payload = buildPayload('battle');
        payload.attackerGeneral.name = '<img src=x onerror="globalThis.__battleLogXss=1">';
        payload.defenderGenerals[0]!.name = '<script>globalThis.__battleLogXss=2</script>';
        payload.attackerNation.name = '<svg onload="globalThis.__battleLogXss=3">국가</svg>';

        const result = processBattleSimJob(payload);
        const html = JSON.stringify(result.lastWarLog);

        expect(html).toContain('&lt;img src=x onerror=');
        expect(html).toContain('&lt;script&gt;globalThis.__battleLogXss=2&lt;/script&gt;');
        expect(html).toContain('<div class=\\"small_war_log\\">');
        expect(html).not.toMatch(/<img|<script|<svg/i);
    });

    it('runs the advance trigger when a progressed attacker meets the next fresh defender', () => {
        const payload = buildPayload('battle');
        payload.scenarioEffect = 'event_StrongAttacker';
        payload.defenderGenerals[0]!.crew = 100;
        payload.defenderGenerals.push({
            ...payload.defenderGenerals[0]!,
            no: 3,
            name: 'Next Defender',
            crew: 1000,
        });

        const result = processBattleSimJob(payload);
        expect(result.lastWarLog?.generalBattleDetailLog).toContain(
            '적군의 전멸에 <span style="color: cyan;">진격</span>이 이어집니다!'
        );
    });
});
